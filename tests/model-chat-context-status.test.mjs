// Deterministic fixture meters only: no tokenizer, model, Worker or download.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createContextManager } from '../examples/browser-model-chat/memory/context.mjs';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';

const digest = messages => createHash('sha256').update(JSON.stringify(messages)).digest('hex');
const result = (promptTokens, extra = {}) => ({ promptTokens, contextTokens: 2048,
  overflow: promptTokens > 2048, actualNativeTokenization: false, ...extra });
function gate() {
  let release, entered;
  return { waiting: new Promise(resolve => { release = resolve; }), started: new Promise(resolve => { entered = resolve; }),
    release: value => release(value), enter: () => entered() };
}
function setup(measure = async () => result(400)) {
  const conversation = createConversationStore(), events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const calls = [];
  const context = createContextManager({ conversation, memory, events,
    measure: async (messages, options) => { calls.push({ messages, options }); return measure(messages, options); } });
  return { conversation, events, memory, context, calls };
}
function history(conversation) {
  conversation.append({ role: 'user', content: 'Fact[delivery]: The delivery day is Friday.\n' + 'Original narrative remains stored. '.repeat(100) });
  conversation.append({ role: 'assistant', content: 'Older generated text is not source authority. '.repeat(50) });
  conversation.append({ role: 'user', content: 'Which day is the delivery?' });
}
const operations = events => events.list().filter(event => ['compacted', 'context-dispatched'].includes(event.type));

test('initial and empty context are unmeasured without making calls; snapshots and observers are isolated', async () => {
  const { context, conversation, calls } = setup();
  try {
    assert.deepEqual(context.usageSnapshot(), { phase: 'unmeasured', capacity: 2048, reserve: 160, usablePromptTokens: 1888,
      measurement: null, conversationVersion: null, compaction: null, error: null, errorCode: null });
    assert.throws(() => { context.usageSnapshot().capacity = 1; }, TypeError);
    assert.throws(() => context.subscribeUsage(null), /observer/);
    const seen = [], off = context.subscribeUsage(value => { seen.push(value); throw Error('Optional view failed.'); });
    conversation.append({ role: 'user', content: 'An ordinary question.' });
    assert.equal(calls.length, 0);
    await context.prepare();
    assert.equal(context.usageSnapshot().phase, 'ready');
    assert.ok(seen.length >= 2); off();
    assert.equal(calls.length, 1);
  } finally { context.dispose(); }
});

test('rejected async usage observers cannot leak rejections, mutate snapshots or stop other observers', async () => {
  const { context, conversation, calls } = setup();
  const unhandled = [], received = [];
  let attempts = 0, blockedState = 0, blockedMeasurement = 0;
  const rejected = error => unhandled.push(error);
  process.on('unhandledRejection', rejected);
  try {
    context.subscribeUsage(async state => {
      await Promise.resolve(); attempts++;
      try { state.phase = 'forged'; } catch { blockedState++; }
      if (state.measurement) { try { state.measurement.promptTokens = 1; } catch { blockedMeasurement++; } }
      throw Error('Async optional view failed after yielding.');
    });
    context.subscribeUsage(state => received.push(state));
    conversation.append({ role: 'user', content: 'A question with failing async observers.' });
    const prepared = await context.prepare();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(attempts >= 2); assert.equal(blockedState, attempts); assert.ok(blockedMeasurement >= 1);
    assert.equal(received.at(-1).phase, 'ready'); assert.equal(received.at(-1).measurement.promptTokens, 400);
    assert.equal(received.at(-1).measurement.requestSha256, digest(prepared.messages));
    assert.equal(context.usageSnapshot().phase, 'ready'); assert.equal(calls.length, 1);
    assert.deepEqual(unhandled, []); context.validateDispatch(prepared.messages);
  } finally { context.dispose(); process.removeListener('unhandledRejection', rejected); }
});

test('the actual 1888-token prompt boundary includes system/retrieval overhead and leaves 160 for output', async () => {
  const { context, conversation, calls, events } = setup(async () => result(1888));
  try {
    conversation.append({ role: 'user', content: 'Question at the usable budget boundary.' });
    const prepared = await context.prepare();
    const usage = context.usageSnapshot();
    assert.equal(calls.length, 1); assert.equal(usage.phase, 'ready');
    assert.equal(usage.measurement.promptTokens, usage.usablePromptTokens);
    assert.equal(usage.measurement.requestSha256, digest(prepared.messages));
    assert.equal(usage.measurement.quality, 'fixture');
    assert.equal(calls[0].messages[0].role, 'system');
    assert.match(calls[0].messages[0].content, /Continue the conversation/);
    assert.doesNotMatch(calls[0].messages[0].content, /No saved evidence matched|No older user passage selected/);
    assert.deepEqual(calls[0].messages, prepared.messages);
    assert.equal(calls[0].messages.at(-1).role, 'user');
    assert.deepEqual(operations(events), []); assert.equal(usage.compaction, null);
  } finally { context.dispose(); }
});

test('a prompt just above the usable budget stays high while compacting and drops only after committed preparation', async () => {
  const afterGate = gate(); let count = 0;
  const { context, conversation, calls, events } = setup(async () => {
    if (++count === 1) return result(1889);
    afterGate.enter(); return afterGate.waiting;
  });
  try {
    history(conversation);
    const original = conversation.exportState(), seen = [];
    context.subscribeUsage(value => seen.push(value));
    const preparedPromise = context.prepare(); await afterGate.started;
    const pending = context.usageSnapshot();
    assert.equal(pending.phase, 'compacting'); assert.equal(pending.measurement.promptTokens, 1889);
    assert.equal(pending.measurement.overflow, false, 'output reservation triggers compaction before native context overflow');
    assert.equal(context.snapshot().cycle, 0); assert.deepEqual(operations(events), []);
    afterGate.release(result(420)); const prepared = await preparedPromise;
    const ready = context.usageSnapshot();
    assert.equal(ready.phase, 'ready'); assert.equal(ready.measurement.promptTokens, 420);
    assert.equal(ready.measurement.requestSha256, digest(prepared.messages));
    assert.deepEqual(ready.compaction, { cycle: 1, beforePromptTokens: 1889, afterPromptTokens: 420 });
    assert.equal(context.snapshot().cycle, 1); assert.equal(calls.length, 2);
    assert.equal(operations(events).length, 1); assert.equal(conversation.exportState(), original);
    assert.ok(seen.filter(value => value.phase !== 'ready').every(value => value.measurement?.promptTokens !== 420));
  } finally { context.dispose(); }
});

test('failed compaction retains the before count and prior context without a false successful drop', async () => {
  let count = 0;
  const { context, conversation, events } = setup(async () => result(++count === 1 ? 2300 : 2000));
  try {
    history(conversation); const before = context.snapshot(), original = conversation.exportState();
    await assert.rejects(context.prepare(), /still exceeds/);
    const usage = context.usageSnapshot();
    assert.equal(usage.phase, 'error'); assert.equal(usage.measurement.promptTokens, 2300);
    assert.equal(usage.compaction, null); assert.match(usage.error, /still exceeds/);
    assert.deepEqual(context.snapshot(), before); assert.deepEqual(operations(events), []);
    assert.equal(conversation.exportState(), original);
  } finally { context.dispose(); }
});

test('cancel during the second meter rejects promptly, forwards abort and ignores a late successful result', async () => {
  const afterGate = gate(), abort = new AbortController(); let count = 0;
  const { context, conversation, calls, events } = setup(async () => {
    if (++count === 1) return result(2300);
    afterGate.enter(); return afterGate.waiting;
  });
  try {
    history(conversation); const before = context.snapshot();
    const pending = context.prepare({ signal: abort.signal }); await afterGate.started;
    const rejected = assert.rejects(pending, error => error.name === 'AbortError'); abort.abort(); await rejected;
    assert.equal(calls[1].options.signal.aborted, true);
    assert.equal(context.usageSnapshot().phase, 'cancelled');
    assert.equal(context.usageSnapshot().measurement.promptTokens, 2300);
    afterGate.release(result(350)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.usageSnapshot().phase, 'cancelled');
    assert.deepEqual(context.snapshot(), before); assert.deepEqual(operations(events), []);
  } finally { context.dispose(); }
});

test('pre-aborted preparation makes no meter calls, and abort between preparation and dispatch blocks send', async () => {
  const { context, conversation, calls, events } = setup();
  try {
    conversation.append({ role: 'user', content: 'A cancellable question.' });
    const preAborted = new AbortController(); preAborted.abort();
    await assert.rejects(context.prepare({ signal: preAborted.signal }), error => error.name === 'AbortError');
    assert.equal(calls.length, 0); assert.equal(context.usageSnapshot().phase, 'cancelled');
    const abort = new AbortController(), prepared = await context.prepare({ signal: abort.signal });
    abort.abort();
    assert.equal(context.usageSnapshot().phase, 'cancelled');
    assert.throws(() => context.validateDispatch(prepared.messages), /no longer matches|cancelled/);
    assert.deepEqual(operations(events), []);
  } finally { context.dispose(); }
});

test('conversation or saved memory changes make last measured prompt stale without measuring again', async () => {
  const { context, conversation, memory, calls } = setup();
  try {
    const authored = conversation.append({ role: 'user', content: 'The delivery day is Friday.' });
    await context.prepare(); const measured = context.usageSnapshot().measurement;
    conversation.append({ role: 'assistant', content: 'A newly accepted answer is not included in the last prompt measurement.' });
    assert.equal(context.usageSnapshot().phase, 'stale');
    assert.deepEqual(context.usageSnapshot().measurement, measured); assert.equal(calls.length, 1);
    conversation.append({ role: 'user', content: 'Which delivery day?' }); await context.prepare();
    assert.equal(context.usageSnapshot().phase, 'ready');
    await memory.save({ text: authored.content, sourceTurnIds: [authored.id], modelSafe: true,
      scope: { actorId: 'local-user', conversationId: 'local-chat' } });
    assert.equal(context.usageSnapshot().phase, 'stale'); assert.equal(calls.length, 2);
    context.invalidateUsage(); assert.equal(calls.length, 2);
  } finally { context.dispose(); }
});

test('an identity mutation during compaction fails without exposing the lower measured candidate', async () => {
  const afterGate = gate(); let count = 0;
  const { context, conversation, events } = setup(async () => {
    if (++count === 1) return result(2300);
    afterGate.enter(); return afterGate.waiting;
  });
  try {
    history(conversation); const before = context.snapshot();
    const pending = context.prepare(); await afterGate.started;
    conversation.append({ role: 'assistant', content: 'Concurrent accepted turn.' });
    afterGate.release(result(300)); await assert.rejects(pending, /changed while preparing/);
    assert.equal(context.usageSnapshot().phase, 'error');
    assert.equal(context.usageSnapshot().measurement.promptTokens, 2300);
    assert.deepEqual(context.snapshot(), before); assert.deepEqual(operations(events), []);
  } finally { context.dispose(); }
});

test('observer quality preserves estimates explicitly without inventing native token provenance', async () => {
  for (const [metadata, quality] of [[{ actualNativeTokenization: undefined }, 'measured'],
    [{ actualNativeTokenization: undefined, estimated: true }, 'estimate'], [{ meter: 'deterministic-fixture' }, 'fixture']]) {
    const { context, conversation } = setup(async () => result(300, metadata));
    try {
      conversation.append({ role: 'user', content: 'Quality fixture.' }); await context.prepare();
      assert.equal(context.usageSnapshot().measurement.quality, quality);
    } finally { context.dispose(); }
  }
});

test('workspace forwards cancellation, and retained historical measurements are unmeasured on reload', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  // Empty retrieval fixture only; this test covers the workspace transport and retained status boundary.
  const core = { RagEngine: class { constructor(records) { assert.equal(records.length, 0); } search() { return { results: [], context_tokens: 0 }; } },
    recordFromMapping() {}, assertContextMatches() {}, formatContextPacket() { return ''; } };
  const measureGate = gate(); let hold = false, calls = 0;
  const adapter = { async measure(messages, options) {
    calls++; if (hold) { measureGate.enter(); await measureGate.waiting; }
    return result(400);
  }, reply() {} };
  const workspace = await createWorkspace({ adapter, core, storage, graphEnabled: false, automaticMemoryEnabled: false });
  let restored;
  try {
    workspace.conversation.append({ role: 'user', content: 'A retained question.' });
    const prepared = await workspace.prepare(); workspace.context.dispatched(prepared.messages); await workspace.persist();
    assert.equal(workspace.events.list().filter(event => event.type === 'context-dispatched').length, 1);
    restored = await createWorkspace({ adapter, core, storage, graphEnabled: false, automaticMemoryEnabled: false });
    assert.equal(restored.context.usageSnapshot().phase, 'unmeasured');
    assert.equal(restored.context.usageSnapshot().measurement, null); assert.equal(calls, 1);
    hold = true; const abort = new AbortController();
    const pending = restored.prepare({ signal: abort.signal }); await measureGate.started;
    const rejected = assert.rejects(pending, error => error.name === 'AbortError'); abort.abort(); await rejected;
    assert.equal(restored.context.usageSnapshot().phase, 'cancelled');
    measureGate.release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(restored.context.usageSnapshot().measurement, null);
  } finally { restored?.dispose(); workspace.dispose(); }
});

test('disposing aborts pending measurement and prevents late context commits or observer notifications', async () => {
  const measureGate = gate();
  const { context, conversation, events } = setup(async () => { measureGate.enter(); return measureGate.waiting; });
  conversation.append({ role: 'user', content: 'A question while leaving the page.' });
  let notifications = 0; context.subscribeUsage(() => notifications++);
  const pending = context.prepare(); await measureGate.started;
  const rejected = assert.rejects(pending, error => error.name === 'AbortError'); context.dispose(); await rejected;
  const priorNotifications = notifications; measureGate.release(result(400)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications, priorNotifications); assert.equal(context.snapshot().cycle, 0);
  assert.deepEqual(operations(events), []); await assert.rejects(context.prepare(), /disposed/);
});
