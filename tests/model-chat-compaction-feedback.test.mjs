// Real workspace/context assembly with explicitly labeled lexical/token fixtures.
// No model, native tokenizer, provider, Worker, network or build is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';
import { createCompactionCue } from '../examples/browser-model-chat/memory/compaction-cue.mjs';
import { manualCompactionFailureView } from '../examples/browser-model-chat/memory/panel.mjs';

const core = {
  recordFromMapping: value => value,
  assertContextMatches() {}, formatContextPacket: () => '',
  RagEngine: class {
    constructor(records) { this.records = records; }
    search(_query, options) {
      return { results: this.records.slice(0, options.top_k).map(record => ({ record, has_retrieval_signal: true, keyword_micro: 1 })) };
    }
  },
};
const measurement = promptTokens => ({ promptTokens, contextTokens: 2048, overflow: promptTokens > 2048,
  actualNativeTokenization: false, meter: 'manual-feedback-unit-fixture' });
async function fixture(meter = () => measurement(400)) {
  const calls = [];
  const workspace = await createWorkspace({ core, graphEnabled: false, getControllerState: () => ({ phase: 'ready' }),
    adapter: {
      measure: async (messages, options) => { calls.push(structuredClone(messages)); return meter(messages, options, calls.length); },
      reply() { throw Error('These tests must not request a model reply.'); },
    } });
  const cue = createCompactionCue(), unsubscribe = workspace.events.subscribe(event => cue.observe(event));
  return { workspace, calls, cue, dispose() { unsubscribe(); cue.dispose(); workspace.dispose(); } };
}
const fred = [
  ['hello', 'hello! How can I assist you today?'],
  ["whats your name?", "I don't have a personal name..."],
  ['Your new name is Fred', 'Fred is a name that could be used for various purposes, such as a person, place, or concept...'],
  ['Just conversation is fine', 'No older user passage selected.'],
];
const appendExchanges = (workspace, exchanges) => {
  for (const [user, assistant] of exchanges) {
    workspace.conversation.append({ role: 'user', content: user });
    workspace.conversation.append({ role: 'assistant', content: assistant });
  }
};
const delivery = Array.from({ length: 4 }, (_, index) => [
  `Friday delivery parcel ${index + 1} has a collection label.`,
  `Generated fixture response ${index + 1}; never authored evidence.`,
]);
async function refused(f, expectedCode) {
  const w = f.workspace, original = w.conversation.exportState(), context = w.context.snapshot();
  const persona = w.automaticMemory.exportPersona(), memory = w.memory.exportState();
  let error;
  try { await w.context.compactNow(); assert.fail('The checked fixture must refuse compaction.'); }
  catch (cause) { error = cause; }
  assert.equal(error.code, expectedCode);
  assert.equal(w.conversation.exportState(), original); assert.equal(w.memory.exportState(), memory);
  assert.deepEqual(w.context.snapshot(), context); assert.equal(w.automaticMemory.exportPersona(), persona);
  assert.equal(w.events.list().filter(event => event.type === 'compacted').length, 0);
  assert.equal(w.context.summarySnapshot(), null); assert.equal(w.context.usageSnapshot().compaction, null);
  assert.equal(f.cue.take(w.conversation.snapshot().turns.map(turn => ({ id: 'turn:' + turn.id, kind: 'message', scope: 'conversation', turnId: turn.id }))), null);
  return { error, view: manualCompactionFailureView(error) };
}

test('the reported short Fred conversation can check successfully without selecting a new excerpt or reporting a failed operation', async () => {
  for (const exchanges of [3, 4]) {
    const f = await fixture();
    try {
      appendExchanges(f.workspace, fred.slice(0, exchanges));
      assert.equal(f.workspace.context.manualCompactionStatus().reason, 'ready');
      const { view } = await refused(f, 'MANUAL_COMPACTION_NO_SOURCE_CONTEXT');
      assert.equal(f.calls.length, 1); // No fictional after-count was measured.
      assert.deepEqual(f.calls[0].slice(1), fred.slice(0, exchanges).flatMap(([user, assistant]) => [{ role: 'user', content: user }, { role: 'assistant', content: assistant }]));
      assert.equal(view.error, false); assert.match(view.message, /^Nothing changed\./);
      assert.match(view.message, /No new older user excerpt was selected/);
      assert.match(view.message, /Recent messages and originals are kept/);
      assert.doesNotMatch(view.message, /did not finish|failed|summary ready|\d+.*tokens/i);
    } finally { f.dispose(); }
  }
});

test('a real two-measurement non-reduction shows the checked counts and keeps originals and success cues unchanged', async () => {
  const f = await fixture((_messages, _options, count) => measurement(count === 1 ? 400 : 425));
  try {
    appendExchanges(f.workspace, delivery);
    const { error, view } = await refused(f, 'MANUAL_COMPACTION_NO_REDUCTION');
    assert.equal(f.calls.length, 2);
    assert.equal(error.compactionCheck.beforePromptTokens, 400); assert.equal(error.compactionCheck.afterPromptTokens, 425);
    assert.deepEqual(f.calls[1].slice(-4), f.calls[0].slice(-4)); // Real recent exchange survived the attempted projection.
    assert.ok(f.calls[1].some(message => message.role === 'system' && message.content.includes('Friday delivery parcel')));
    assert.equal(view.error, false); assert.match(view.message, /Nothing changed/);
    assert.match(view.message, /425 prompt tokens versus 400 now/);
    assert.doesNotMatch(view.message, /did not finish|failed|summary ready/i);
  } finally { f.dispose(); }
});

test('native-meter failure remains a visible error instead of being disguised as a harmless no-change check', async () => {
  const f = await fixture((_messages, _options, count) => {
    if (count === 2) throw Error('Labeled fixture tokenizer failure.');
    return measurement(1100);
  });
  try {
    appendExchanges(f.workspace, delivery);
    const { view } = await refused(f, 'MANUAL_COMPACTION_FAILED');
    assert.equal(view.error, true); assert.match(view.message, /Compaction did not finish.*tokenizer failure/);
  } finally { f.dispose(); }
});

test('a genuine reduction still commits one source-bound summary and exposes its event to the existing success cue', async () => {
  const f = await fixture((_messages, _options, count) => measurement(count === 1 ? 1100 : 400));
  try {
    const w = f.workspace; appendExchanges(w, delivery);
    const original = w.conversation.exportState(), persona = w.automaticMemory.exportPersona();
    const result = await w.context.compactNow(), events = w.events.list().filter(event => event.type === 'compacted');
    assert.equal(events.length, 1); assert.equal(events[0].trigger, 'manual');
    assert.equal(result.compaction.before.promptTokens, 1100); assert.equal(result.compaction.after.promptTokens, 400);
    assert.deepEqual(result.messages.slice(-4), f.calls[0].slice(-4));
    assert.ok(w.context.summarySnapshot()); assert.equal(w.context.summarySnapshot().eventId, events[0].id);
    assert.equal(w.conversation.exportState(), original); assert.equal(w.automaticMemory.exportPersona(), persona);
    const nodes = w.conversation.snapshot().turns.map(turn => ({ id: 'turn:' + turn.id, kind: 'message', scope: 'conversation', turnId: turn.id }));
    assert.ok(f.cue.take(nodes)); assert.equal(f.cue.take(nodes), null);
  } finally { f.dispose(); }
});

test('missing or invalid after-counts never invent a measured number; cancellation remains distinct from failure', () => {
  for (const compactionCheck of [undefined, { beforePromptTokens: -1, afterPromptTokens: 300 },
    { beforePromptTokens: 400, afterPromptTokens: 399 }, { beforePromptTokens: 400, afterPromptTokens: NaN }]) {
    const view = manualCompactionFailureView({ code: 'MANUAL_COMPACTION_NO_REDUCTION', compactionCheck });
    assert.equal(view.error, false); assert.doesNotMatch(view.message, /prompt tokens versus/);
  }
  assert.deepEqual(manualCompactionFailureView(new DOMException('Fixture stop.', 'AbortError')),
    { message: 'Compaction cancelled. Prior context and originals kept.', error: false });
});
