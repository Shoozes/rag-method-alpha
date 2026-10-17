// Labeled deterministic fixture meters/core only. No model, native tokenizer,
// runtime, Worker, provider, download or build is used by this API test suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createContextManager, ManualCompactionError } from '../examples/browser-model-chat/memory/context.mjs';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { createCompactionCue } from '../examples/browser-model-chat/memory/compaction-cue.mjs';
import { createWorkspace, storageKey } from '../examples/browser-model-chat/memory/workspace.mjs';

const measurement = promptTokens => ({ promptTokens, contextTokens: 2048, overflow: promptTokens > 2048,
  actualNativeTokenization: false, meter: 'manual-compaction-unit-fixture' });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred = () => {
  let release, enter;
  return { value: new Promise(resolve => { release = resolve; }), started: new Promise(resolve => { enter = resolve; }),
    release: value => release(value), enter: () => enter() };
};
const fixtureCore = {
  recordFromMapping: value => value,
  assertContextMatches() { throw Error('Workspace reopen must not retrieve.'); },
  formatContextPacket() { throw Error('Workspace reopen must not retrieve.'); },
  RagEngine: class {
    constructor(records) { this.records = records; }
    search(_query, options) { return { results: this.records.slice(0, options.top_k).map(record => ({ record, has_retrieval_signal: true, keyword_micro: 1 })) }; }
  },
};
function setup({ meter, readiness = true, automaticMemory, eventFailure = false } = {}) {
  const conversation = createConversationStore(), ledger = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => ledger.append(event) });
  const state = { phase: 'ready' }, calls = [];
  const events = eventFailure ? { ...ledger, append: () => { throw Error('Fixture ledger refused before append.'); } } : ledger;
  const context = createContextManager({ conversation, memory, core: fixtureCore, automaticMemory, events,
    ...(readiness ? { getControllerState: () => { if (state.failure) throw state.failure; return state; } } : {}),
    measure: async (messages, options) => { calls.push(structuredClone(messages)); return meter ? meter(messages, options, calls.length) : measurement(calls.length === 1 ? 1100 : 400); } });
  return { context, conversation, memory, events: ledger, state, calls };
}
function history(conversation, { structured = false, exchanges = 4 } = {}) {
  for (let index = 0; index < exchanges; index++) {
    conversation.append({ role: 'user', content: structured && index === 0 ? 'Fact[delivery]: The delivery day is Friday.'
      : `Delivery detail ${index + 1}: the Friday delivery has a labeled parcel.` });
    conversation.append({ role: 'assistant', content: `Generated fixture answer ${index + 1}; never authored evidence.` });
  }
}
const compactions = events => events.list().filter(event => event.type === 'compacted');
const assertCode = code => error => error instanceof ManualCompactionError && error.code === 'MANUAL_COMPACTION_' + code;

test('manual status and refusal fail closed on missing/unready controller without measuring', async () => {
  const absent = setup({ readiness: false });
  try {
    history(absent.conversation);
    assert.deepEqual(absent.context.manualCompactionStatus(), { eligible: false, busy: false, reason: 'unavailable' });
    await assert.rejects(absent.context.compactNow(), assertCode('UNAVAILABLE'));
    assert.equal(absent.calls.length, 0);
  } finally { absent.context.dispose(); }
  const f = setup();
  try {
    history(f.conversation);
    for (const phase of ['idle', 'checking', 'initializing', 'error', 'cancelled']) {
      f.state.phase = phase;
      assert.equal(f.context.manualCompactionStatus().reason, 'model-not-ready');
      await assert.rejects(f.context.compactNow(), assertCode('MODEL_NOT_READY'));
    }
    f.state.phase = 'generating';
    assert.deepEqual(f.context.manualCompactionStatus(), { eligible: false, busy: true, reason: 'busy' });
    await assert.rejects(f.context.compactNow(), assertCode('BUSY'));
    f.state.phase = 'ready'; f.state.failure = Error('Controller unavailable.');
    assert.equal(f.context.manualCompactionStatus().reason, 'unavailable');
    assert.equal(f.calls.length, 0); assert.equal(f.events.list().length, 0);
  } finally { f.context.dispose(); }
  assert.equal(f.context.manualCompactionStatus().reason, 'disposed');
  await assert.rejects(f.context.compactNow(), assertCode('DISPOSED'));
});

test('empty and short ordinary history remain ineligible without crossing the protected recent exchange', async () => {
  const f = setup();
  try {
    assert.equal(f.context.manualCompactionStatus().reason, 'empty');
    await assert.rejects(f.context.compactNow(), assertCode('EMPTY'));
    history(f.conversation, { exchanges: 2 });
    const original = f.conversation.exportState();
    const status = f.context.manualCompactionStatus();
    assert.deepEqual(status, { eligible: false, busy: false, reason: 'insufficient-history' });
    assert.throws(() => { status.eligible = true; }, TypeError);
    await assert.rejects(f.context.compactNow(), assertCode('INSUFFICIENT_HISTORY'));
    assert.equal(f.conversation.exportState(), original); assert.equal(f.calls.length, 0);
  } finally { f.context.dispose(); }
});

test('under-budget assistant-last manual compaction retains the real recent exchange and emits one source-bound event', async () => {
  let marked = 0;
  const automaticMemory = { identity: () => 'fixture-policy', allowConversation: () => true, getBlockedTurnIds: () => [],
    prepareContext: async () => ({ hits: [] }), markUsed: () => { marked++; }, getScope: () => 'conversation' };
  const f = setup({ automaticMemory });
  try {
    history(f.conversation); const original = f.conversation.exportState(), memory = f.memory.exportState();
    const turns = f.conversation.snapshot().turns;
    assert.equal(turns.at(-1).role, 'assistant');
    assert.deepEqual(f.context.manualCompactionStatus(), { eligible: true, busy: false, reason: 'ready' });
    const result = await f.context.compactNow();
    assert.equal(f.calls.length, 2); assert.equal(result.compaction.cycle, 1);
    assert.equal(result.compaction.before.promptTokens, 1100); assert.equal(result.compaction.after.promptTokens, 400);
    assert.equal(f.context.snapshot().cutoff, 4);
    assert.deepEqual(result.messages.slice(-4), turns.slice(-4).map(({ role, content }) => ({ role, content })));
    for (const item of f.context.snapshot().compacted.items) {
      const turn = turns.find(turn => turn.id === item.turnId);
      assert.equal(turn.role, 'user'); assert.equal(item.quote, turn.content.slice(item.offsets.start, item.offsets.end));
    }
    const [event] = compactions(f.events); assert.equal(compactions(f.events).length, 1);
    assert.deepEqual(event.sourceTurnIds, turns.slice(0, 4).map(turn => turn.id));
    assert.equal(event.requestBeforeSha256, digest(f.calls[0])); assert.equal(event.requestAfterSha256, digest(result.messages));
    assert.equal(event.summaryHash, f.context.snapshot().compacted.contentHash);
    assert.equal(event.trigger, 'manual');
    const cue = createCompactionCue();
    const nodes = turns.map(turn => ({ id: 'turn:' + turn.id, kind: 'message', scope: 'conversation', turnId: turn.id }));
    assert.equal(cue.observe(event), true);
    assert.deepEqual(cue.take(nodes).nodeIds, event.sourceTurnIds.map(id => 'turn:' + id));
    assert.equal(cue.take(nodes), null); assert.equal(cue.observe(event), false); cue.dispose();
    assert.equal(f.context.usageSnapshot().measurement.quality, 'fixture');
    assert.equal(f.context.usageSnapshot().measurement.promptTokens, 400);
    assert.equal(f.context.inspectionSnapshot().latestPrepared.purpose, 'manual-compaction');
    assert.equal(f.context.inspectionSnapshot().lastSubmitted, null);
    assert.throws(() => f.context.validateDispatch(result.messages), /no longer matches/);
    assert.throws(() => f.context.dispatched(result.messages), /no longer matches/);
    assert.equal(f.events.list().some(event => event.type === 'context-dispatched'), false); assert.equal(marked, 0);
    assert.equal(f.conversation.exportState(), original); assert.equal(f.memory.exportState(), memory);
    await assert.rejects(f.context.compactNow(), assertCode('INSUFFICIENT_HISTORY'));
    assert.equal(compactions(f.events).length, 1); assert.equal(f.calls.length, 2);
  } finally { f.context.dispose(); }
});

test('manual compaction reuses structured correction lineage and never admits assistant assertions', async () => {
  const f = setup();
  try {
    history(f.conversation, { structured: true });
    f.conversation.append({ role: 'user', content: 'Correction[delivery]: The delivery day is Monday.' });
    f.conversation.append({ role: 'assistant', content: 'Fact[delivery]: invented Tuesday is not an authored declaration.' });
    await f.context.compactNow();
    const summary = f.context.snapshot().compacted;
    assert.equal(summary.strategy, 'source-linked-structured-extractive-v1');
    assert.equal(summary.items[0].value, 'The delivery day is Monday.');
    assert.equal(summary.items[0].lineage.length, 2);
    assert.ok(!summary.text.includes('invented Tuesday'));
    assert.equal(compactions(f.events).length, 1);
  } finally { f.context.dispose(); }
});

test('blocked older user turns and disabled conversation scope cannot be forced into context', async () => {
  let allowed = true, blocked = [];
  const automaticMemory = { identity: () => 'fixture-policy', allowConversation: () => allowed, getBlockedTurnIds: () => blocked,
    prepareContext: async () => ({ hits: [] }) };
  const f = setup({ automaticMemory });
  try {
    history(f.conversation); blocked = f.conversation.snapshot().turns.slice(0, 4).filter(turn => turn.role === 'user').map(turn => turn.id);
    assert.equal(f.context.manualCompactionStatus().reason, 'insufficient-history');
    await assert.rejects(f.context.compactNow(), assertCode('INSUFFICIENT_HISTORY'));
    blocked = [blocked[0]]; assert.equal(f.context.manualCompactionStatus().eligible, true);
    await f.context.compactNow();
    assert.ok(f.context.snapshot().compacted.items.every(item => !blocked.includes(item.turnId)));
    allowed = false;
    assert.equal(f.context.manualCompactionStatus().reason, 'scope-disabled');
    await assert.rejects(f.context.compactNow(), assertCode('SCOPE_DISABLED'));
  } finally { f.context.dispose(); }
});

test('policy refresh cannot be forced past a newly authored memory record', async () => {
  const f = setup();
  try {
    history(f.conversation);
    const turn = f.conversation.snapshot().turns[0];
    await f.memory.save({ sourceTurnIds: [turn.id], text: turn.content,
      scope: { actorId: 'local-user', conversationId: 'local-chat' }, modelSafe: true });
    assert.equal(f.context.manualCompactionStatus().reason, 'policy-refresh');
    await assert.rejects(f.context.compactNow(), assertCode('POLICY_REFRESH'));
    assert.equal(f.calls.length, 0); assert.equal(compactions(f.events).length, 0);
  } finally { f.context.dispose(); }
});

test('no selected new authored passage refuses without a false summary or reduced count', async () => {
  const f = setup();
  try {
    history(f.conversation);
    f.conversation.append({ role: 'user', content: 'Explain unrelated astrophysics quasars.' });
    f.conversation.append({ role: 'assistant', content: 'Generated astrophysics fixture answer.' });
    const before = f.context.snapshot();
    await assert.rejects(f.context.compactNow(), assertCode('NO_SOURCE_CONTEXT'));
    assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
    assert.equal(f.calls.length, 1); assert.equal(f.context.usageSnapshot().measurement.promptTokens, 1100);
  } finally { f.context.dispose(); }
});

test('equal, larger and still-overflowing post-measurements preserve prior context and the before count', async () => {
  for (const after of [1100, 1200, 2000]) {
    const f = setup({ meter: (_messages, _options, count) => measurement(count === 1 ? 1100 : after) });
    try {
      history(f.conversation); const before = f.context.snapshot();
      await assert.rejects(f.context.compactNow(), assertCode(after === 2000 ? 'FAILED' : 'NO_REDUCTION'));
      assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
      assert.equal(f.context.usageSnapshot().measurement.promptTokens, 1100);
      assert.equal(f.context.usageSnapshot().compaction, null);
    } finally { f.context.dispose(); }
  }
});

test('cancellation before and during either fixture measurement never commits a late compaction', async () => {
  for (const at of [0, 1, 2]) {
    const gate = deferred(), abort = new AbortController();
    const f = setup({ meter: (_messages, _options, count) => { if (count === at) { gate.enter(); return gate.value; } return measurement(1100); } });
    try {
      history(f.conversation); const before = f.context.snapshot();
      if (!at) abort.abort();
      const pending = f.context.compactNow({ signal: abort.signal });
      if (at) { await gate.started; abort.abort(); }
      await assert.rejects(pending, { name: 'AbortError' });
      gate.release(measurement(400)); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
      assert.equal(f.context.usageSnapshot().phase, 'cancelled'); assert.equal(f.context.usageSnapshot().compaction, null);
      assert.notEqual(f.context.usageSnapshot().measurement?.promptTokens, 400);
    } finally { f.context.dispose(); }
  }
});

test('meter and event-ledger errors are typed and commit neither a new cycle nor an after count', async () => {
  for (const eventFailure of [false, true]) {
    const f = setup({ eventFailure, ...(!eventFailure ? { meter: (_messages, _options, count) => {
      if (count === 2) throw Error('Controlled fixture meter error.'); return measurement(1100);
    } } : {}) });
    try {
      history(f.conversation); const before = f.context.snapshot();
      await assert.rejects(f.context.compactNow(), assertCode('FAILED'));
      assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
      assert.equal(f.context.usageSnapshot().measurement.promptTokens, 1100);
    } finally { f.context.dispose(); }
  }
});

test('manual reserves preparation synchronously and rejects manual/automatic overlap until finally releases', async () => {
  const gate = deferred();
  const f = setup({ meter: (_messages, _options, count) => { if (count === 2) { gate.enter(); return gate.value; } return measurement(1100); } });
  try {
    history(f.conversation); const observed = [];
    f.context.subscribeUsage(() => observed.push(f.context.manualCompactionStatus()));
    const pending = f.context.compactNow();
    assert.equal(f.context.manualCompactionStatus().reason, 'busy');
    await assert.rejects(f.context.compactNow(), assertCode('BUSY'));
    await assert.rejects(f.context.prepare(), /already in progress/);
    await gate.started; gate.release(measurement(400)); await pending;
    assert.equal(compactions(f.events).length, 1); assert.equal(f.calls.length, 2);
    assert.equal(f.context.manualCompactionStatus().busy, false);
    assert.equal(observed.at(-1).busy, false);
  } finally { f.context.dispose(); }
});

test('automatic preparation keeps its normal overflow trigger and excludes manual while pending', async () => {
  const gate = deferred();
  const f = setup({ meter: () => { gate.enter(); return gate.value; } });
  try {
    history(f.conversation); f.conversation.append({ role: 'user', content: 'Which delivery day?' });
    const pending = f.context.prepare(); await gate.started;
    await assert.rejects(f.context.compactNow(), assertCode('BUSY'));
    gate.release(measurement(1100)); const result = await pending;
    assert.equal(result.compaction, null); assert.equal(f.calls.length, 1); assert.equal(compactions(f.events).length, 0);
    f.context.validateDispatch(result.messages);
  } finally { f.context.dispose(); }
});

test('readiness or canonical identity changes during measurement prevent manual commit', async () => {
  for (const changed of ['idle', 'generating', 'conversation']) {
    const gate = deferred();
    const f = setup({ meter: (_messages, _options, count) => { if (count === 2) { gate.enter(); return gate.value; } return measurement(1100); } });
    try {
      history(f.conversation); const before = f.context.snapshot();
      const pending = f.context.compactNow(); await gate.started;
      if (changed === 'conversation') f.conversation.append({ role: 'user', content: 'A new canonical user turn.' });
      else f.state.phase = changed;
      gate.release(measurement(400));
      await assert.rejects(pending, assertCode(changed === 'conversation' ? 'FAILED' : changed === 'idle' ? 'MODEL_NOT_READY' : 'BUSY'));
      assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
      assert.equal(f.context.usageSnapshot().measurement.promptTokens, 1100);
    } finally { f.context.dispose(); }
  }
});

test('disposal cancels a pending manual operation and ignores a late fixture result', async () => {
  const gate = deferred(), f = setup({ meter: () => { gate.enter(); return gate.value; } });
  history(f.conversation); const before = f.context.snapshot();
  const pending = f.context.compactNow(); await gate.started; f.context.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  gate.release(measurement(400)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.context.snapshot(), before); assert.equal(compactions(f.events).length, 0);
});

test('cancellation from the committed event observer cannot turn success into a cancelled half-commit', async () => {
  const f = setup(), abort = new AbortController();
  try {
    history(f.conversation);
    f.events.subscribe(event => { if (event.type === 'compacted') abort.abort(); });
    const result = await f.context.compactNow({ signal: abort.signal });
    assert.equal(result.compaction.cycle, 1); assert.equal(compactions(f.events).length, 1);
    assert.equal(f.context.snapshot().cycle, 1); assert.equal(f.context.usageSnapshot().phase, 'ready');
    assert.equal(f.context.usageSnapshot().measurement.promptTokens, 400);
  } finally { f.context.dispose(); }
});

test('a later failed manual cycle preserves the earlier real summary and event unchanged', async () => {
  const f = setup({ meter: (_messages, _options, count) => {
    if (count === 4) throw Error('Second manual cycle fixture failure.');
    return measurement(count === 2 ? 400 : 1300);
  } });
  try {
    history(f.conversation); await f.context.compactNow();
    const before = f.context.snapshot(), retained = compactions(f.events);
    history(f.conversation);
    await assert.rejects(f.context.compactNow(), assertCode('FAILED'));
    assert.deepEqual(f.context.snapshot(), before); assert.deepEqual(compactions(f.events), retained);
    assert.equal(f.context.usageSnapshot().measurement.promptTokens, 1300);
    assert.equal(f.context.usageSnapshot().compaction, null);
  } finally { f.context.dispose(); }
});

test('the actual manual event reopens through workspace validation and historical cues never replay', async () => {
  const f = setup(); let reopened;
  try {
    history(f.conversation); await f.context.compactNow();
    const serialized = JSON.stringify({ schema: 'private-one-chat-memory/v1', conversation: f.conversation.exportState(),
      memory: f.memory.exportState(), events: f.events.list() });
    reopened = await createWorkspace({ adapter: { measure() { throw Error('Reopening must not measure.'); } }, core: fixtureCore,
      automaticMemoryEnabled: false, storage: { getItem: key => key === storageKey ? serialized : null } });
    assert.deepEqual(reopened.events.list(), f.events.list());
    assert.deepEqual(reopened.conversation.snapshot(), f.conversation.snapshot());
    assert.equal(reopened.context.usageSnapshot().phase, 'unmeasured');
    const cue = createCompactionCue(reopened.events.list()), [event] = compactions(reopened.events);
    assert.equal(cue.observe(event), false); assert.equal(cue.take([]), null); cue.dispose();
  } finally { reopened?.dispose(); f.context.dispose(); }
});
