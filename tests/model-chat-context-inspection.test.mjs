// Local deterministic fixture meters and adapter boundaries only; no model or Worker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createContextManager } from '../examples/browser-model-chat/memory/context.mjs';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const measured = () => ({ promptTokens: 400, contextTokens: 2048, overflow: false, actualNativeTokenization: false });
function gate() { let release, enter; return { waiting: new Promise(resolve => { release = resolve; }), started: new Promise(resolve => { enter = resolve; }),
  release: () => release(), enter: () => enter() }; }
function setup({ automaticHits = [], candidates = [], evidence = [], measure = async () => measured() } = {}) {
  const conversation = createConversationStore(), events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const calls = { measure: 0, automatic: 0, retrieval: 0 };
  const automaticMemory = { identity: () => 'fixture-policy', getBlockedTurnIds: () => [], getScope: () => 'all', allowConversation: () => true,
    async prepareContext() { calls.automatic++; return { hits: automaticHits, inspection: { candidates,
      stage: 'core-returned-before-automatic-limit', availability: { scores: 'available', reasons: 'unavailable', reason: null } } }; }, markUsed() {} };
  const retrieval = { async search() { calls.retrieval++; return { hits: evidence }; } };
  const context = createContextManager({ conversation, memory, events, automaticMemory, retrieval,
    measure: async (...args) => { calls.measure++; return measure(...args); } });
  return { conversation, memory, events, context, calls };
}
const hit = (number, text = 'The delivery day is Friday.') => ({ nodeId: 'turn:t-000' + number, turnId: 't-000' + number, kind: 'conversation',
  role: 'user', scope: 'conversation', text, turnHash: sha(text), lineHash: sha(text), offsets: { start: 0, end: text.length, unit: 'utf16' } });

test('inspection starts empty, makes no calls and exposes immutable observer snapshots without rejected-promise leaks', async () => {
  const { context, conversation, calls } = setup();
  try {
    const initial = context.inspectionSnapshot();
    assert.equal(initial.ephemeral, true); assert.equal(initial.phase, 'unmeasured');
    assert.equal(initial.latestPrepared, null); assert.equal(initial.lastSubmitted, null); assert.equal(calls.measure, 0);
    assert.throws(() => context.subscribeInspection(null), /observer/);
    let attempts = 0, blocked = 0; const seen = [];
    context.subscribeInspection(async snapshot => { await Promise.resolve(); attempts++;
      try { snapshot.phase = 'forged'; } catch { blocked++; } throw Error('Optional async inspector failed.'); });
    context.subscribeInspection(snapshot => seen.push(snapshot));
    conversation.append({ role: 'user', content: 'An inspector fixture question.' }); await context.prepare();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(seen.at(-1).phase, 'prepared'); assert.ok(attempts >= 2); assert.equal(blocked, attempts);
    assert.equal(calls.measure, 1); assert.equal(calls.automatic, 1); assert.equal(calls.retrieval, 1);
    assert.throws(() => { context.inspectionSnapshot().latestPrepared.exactMessages[0].content = 'forged'; }, TypeError);
  } finally { context.dispose(); }
});

test('prepared ledger distinguishes existing ranked candidates from actual admitted quotes and preserves literal scores', async () => {
  const selected = hit(1), candidates = [1, 2, 3].map(number => ({ nodeId: 'turn:t-000' + number, kind: 'conversation', scope: 'conversation',
    role: 'user', sourceTurnIds: ['t-000' + number], score_micro: 910000 - number, keyword_micro: number * 100,
    components: { keyword_micro: number * 100, authority_micro: 7, provider_secret: 1234 }, reasons: [], Authorization: 'FORBIDDEN_HEADER' }));
  const { context, conversation, calls, events } = setup({ automaticHits: [selected], candidates });
  try {
    conversation.append({ role: 'user', content: selected.text });
    conversation.append({ role: 'user', content: 'Older candidate two.' }); conversation.append({ role: 'user', content: 'Older candidate three.' });
    conversation.append({ role: 'user', content: 'Which delivery day?' }); const prepared = await context.prepare();
    const snapshot = context.inspectionSnapshot(), record = snapshot.latestPrepared;
    assert.equal(snapshot.phase, 'prepared'); assert.equal(snapshot.lastSubmitted, null); assert.equal(record.replyTurnId, null);
    assert.deepEqual(record.candidates.map(row => row.admitted), [true, false, false]);
    assert.deepEqual(record.admitted.map(row => row.nodeId), [selected.nodeId]);
    assert.equal(record.admitted[0].text, selected.text); assert.equal(record.admitted[0].score_micro, 909999);
    assert.equal(record.admitted[0].keyword_micro, 100); assert.equal(record.admitted[0].components.authority_micro, 7);
    assert.equal(record.admitted[0].components.provider_secret, undefined); assert.deepEqual(record.admitted[0].reasons, []);
    assert.equal(record.candidates[1].text, null); assert.match(record.candidates[1].textUnavailableReason, /not retained/);
    assert.equal(record.complete, true); assert.deepEqual(record.exactMessages, prepared.messages);
    assert.equal(sha(record.exactMessages), record.requestSha256); assert.equal(record.requestSha256, prepared.measurement.requestSha256);
    assert.deepEqual(JSON.parse(record.exactMemoryContext), prepared.messages.filter(message => message.role === 'system'));
    assert.match(record.candidateCoverage, /Not all scanned corpus candidates/);
    assert.equal(JSON.stringify(snapshot).includes('FORBIDDEN_HEADER'), false);
    assert.deepEqual(events.list().filter(event => event.type === 'context-dispatched'), []);
    assert.deepEqual(calls, { measure: 1, automatic: 1, retrieval: 1 });
  } finally { context.dispose(); }
});

test('only actual dispatch moves prepared inspection to submitted and a later failed candidate cannot replace it', async () => {
  const pendingGate = gate(); let waiting = false;
  const { context, conversation } = setup({ measure: async () => { if (waiting) { pendingGate.enter(); await pendingGate.waiting; } return measured(); } });
  try {
    conversation.append({ role: 'user', content: 'First request.' }); const first = await context.prepare();
    const changed = structuredClone(first.messages); changed.at(-1).content = 'Unauthorized request.';
    assert.throws(() => context.dispatched(changed), /no longer matches/); assert.equal(context.inspectionSnapshot().lastSubmitted, null);
    context.dispatched(first.messages); const submitted = context.inspectionSnapshot().lastSubmitted;
    assert.equal(submitted.phase, 'submitted'); assert.equal(context.inspectionSnapshot().latestPrepared, null);
    conversation.append({ role: 'assistant', content: 'Accepted fixture reply.' });
    assert.equal(context.inspectionSnapshot().phase, 'stale');
    conversation.append({ role: 'user', content: 'Second request.' }); waiting = true;
    const abort = new AbortController(), pending = context.prepare({ signal: abort.signal }); await pendingGate.started;
    assert.equal(context.inspectionSnapshot().phase, 'preparing');
    const rejected = assert.rejects(pending, error => error.name === 'AbortError'); abort.abort(); await rejected;
    pendingGate.release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.inspectionSnapshot().phase, 'cancelled'); assert.equal(context.inspectionSnapshot().latestPrepared, null);
    assert.deepEqual(context.inspectionSnapshot().lastSubmitted, submitted);
  } finally { context.dispose(); }
});

test('stale or cancelled unsubmitted inspection never becomes a submitted request', async () => {
  const { context, conversation } = setup();
  try {
    conversation.append({ role: 'user', content: 'Question before mutation.' }); const prepared = await context.prepare();
    conversation.append({ role: 'assistant', content: 'A concurrent canonical append.' });
    assert.equal(context.inspectionSnapshot().phase, 'stale'); assert.equal(context.inspectionSnapshot().latestPrepared.phase, 'stale');
    assert.throws(() => context.dispatched(prepared.messages), /no longer matches/); assert.equal(context.inspectionSnapshot().lastSubmitted, null);
    conversation.append({ role: 'user', content: 'A new cancellable question.' });
    const abort = new AbortController(); await context.prepare({ signal: abort.signal }); abort.abort();
    assert.equal(context.inspectionSnapshot().phase, 'cancelled'); assert.equal(context.inspectionSnapshot().latestPrepared.phase, 'cancelled');
    assert.equal(context.inspectionSnapshot().lastSubmitted, null);
  } finally { context.dispose(); }
});

test('oversize request or memory blocks are explicitly unavailable rather than clipped and relabeled exact', async () => {
  const ordinary = setup();
  try {
    ordinary.conversation.append({ role: 'user', content: 'Long exact authored text. '.repeat(1800) });
    const request = await ordinary.context.prepare(), record = ordinary.context.inspectionSnapshot().latestPrepared;
    assert.equal(record.complete, false); assert.equal(record.exactMessages, null); assert.match(record.unavailableReason, /32 KiB/);
    assert.equal(record.requestSha256, sha(request.messages)); assert.equal(record.memoryContextComplete, true);
    assert.deepEqual(JSON.parse(record.exactMemoryContext), request.messages.filter(message => message.role === 'system'));
  } finally { ordinary.context.dispose(); }
  const longHit = hit(1, 'Large source excerpt. '.repeat(900)), memory = setup({ automaticHits: [longHit] });
  try {
    memory.conversation.append({ role: 'user', content: 'Question with an oversized memory prefix.' }); await memory.context.prepare();
    const record = memory.context.inspectionSnapshot().latestPrepared;
    assert.equal(record.memoryContextComplete, false); assert.equal(record.exactMemoryContext, null); assert.match(record.memoryContextUnavailableReason, /16 KiB/);
    assert.equal(record.admitted[0].text, null); assert.match(record.admitted[0].textUnavailableReason, /row limit/);
    assert.equal(record.complete, true, 'the whole request remains separately exact when below its larger limit');
  } finally { memory.context.dispose(); }
});

test('snapshot retention is bounded to latest preparation plus one actual submission, then disposal clears both', async () => {
  const { context, conversation } = setup();
  conversation.append({ role: 'user', content: 'First request.' }); const first = await context.prepare(); context.dispatched(first.messages);
  conversation.append({ role: 'assistant', content: 'First answer.' }); conversation.append({ role: 'user', content: 'Second request.' });
  const second = await context.prepare(), snapshot = context.inspectionSnapshot();
  assert.equal(snapshot.latestPrepared.requestSha256, second.measurement.requestSha256);
  assert.equal(snapshot.lastSubmitted.requestSha256, first.measurement.requestSha256);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.latestPrepared)) <= snapshot.limits.recordBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.lastSubmitted)) <= snapshot.limits.recordBytes);
  context.replyFailed({ requestSha256: first.measurement.requestSha256 });
  assert.equal(context.inspectionSnapshot().phase, 'prepared', 'an old request failure cannot invalidate a newer prepared request');
  assert.equal(context.inspectionSnapshot().latestPrepared.requestSha256, second.measurement.requestSha256);
  context.dispose(); assert.equal(context.inspectionSnapshot().latestPrepared, null); assert.equal(context.inspectionSnapshot().lastSubmitted, null);
});

test('adversarial diagnostic metadata cannot exceed the aggregate ephemeral record limit', async () => {
  const candidates = Array.from({ length: 24 }, (_, index) => ({ nodeId: 'turn:candidate-' + index,
    sourceTurnIds: Array.from({ length: 32 }, (_, source) => `${index}-${source}-` + 'x'.repeat(700)), score_micro: index, keyword_micro: index }));
  const { context, conversation } = setup({ automaticHits: [hit(1)], candidates });
  try {
    conversation.append({ role: 'user', content: 'A short question with deliberately overlarge fixture metadata.' }); await context.prepare();
    const snapshot = context.inspectionSnapshot(), record = snapshot.latestPrepared;
    assert.equal(record.candidateCount, 24); assert.equal(record.candidatesComplete, false);
    assert.ok(record.candidates.length < 24); assert.ok(Buffer.byteLength(JSON.stringify(record)) <= snapshot.limits.recordBytes);
    assert.equal(record.complete, false); assert.equal(record.exactMessages, null); assert.match(record.unavailableReason, /aggregate/);
    assert.equal(record.memoryContextComplete, true, 'small exact memory prefix survives diagnostic backpressure');
  } finally { context.dispose(); }
});

test('workspace binds only the actual next accepted assistant reply to its matching submitted hash; reload stays empty', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const core = { RagEngine: class { search() { return { results: [], context_tokens: 0 }; } }, recordFromMapping() {}, assertContextMatches() {}, formatContextPacket() { return ''; } };
  const control = { failBefore: false, failAfter: false }, adapter = { async measure() { return measured(); }, async reply(messages, options) {
    options.beforeDispatch(); if (control.failBefore) throw Error('Fixture failure before send.');
    options.onDispatch(); if (control.failAfter) throw Error('Fixture failure after send.'); return 'Accepted fixture answer.';
  } };
  const workspace = await createWorkspace({ adapter, core, storage, graphEnabled: false, automaticMemoryEnabled: false }); let restored;
  try {
    workspace.conversation.append({ role: 'user', content: 'A question.' }); const prepared = await workspace.prepare();
    control.failBefore = true; await assert.rejects(workspace.provider.reply(prepared.messages), /before send/);
    assert.equal(workspace.context.inspectionSnapshot().phase, 'error'); assert.equal(workspace.context.inspectionSnapshot().lastSubmitted, null);
    control.failBefore = false; control.failAfter = true; await assert.rejects(workspace.provider.reply(prepared.messages), /after send/);
    assert.equal(workspace.context.inspectionSnapshot().phase, 'error'); assert.equal(workspace.context.inspectionSnapshot().lastSubmitted.phase, 'submitted');
    const answer = workspace.conversation.append({ role: 'assistant', content: 'Accepted fixture answer.' });
    assert.equal(workspace.context.bindReply({ answerTurnId: answer.id, requestSha256: '0'.repeat(64) }), false);
    assert.equal(workspace.context.bindReply({ answerTurnId: 't-0001', requestSha256: prepared.measurement.requestSha256 }), false);
    await workspace.captureAnswerSources({ answerTurnId: answer.id, requestSha256: prepared.measurement.requestSha256 });
    assert.equal(workspace.context.inspectionSnapshot().lastSubmitted.replyTurnId, answer.id);
    await workspace.persist(); const serialized = [...values.values()][0];
    assert.equal(serialized.includes('memory-context-inspection'), false); assert.equal(serialized.includes('latestPrepared'), false);
    restored = await createWorkspace({ adapter, core, storage, graphEnabled: false, automaticMemoryEnabled: false });
    assert.equal(restored.context.inspectionSnapshot().phase, 'unmeasured'); assert.equal(restored.context.inspectionSnapshot().lastSubmitted, null);
  } finally { restored?.dispose(); workspace.dispose(); }
});
