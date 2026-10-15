// Deterministic unit fixtures only. Character-cost measurements below are NOT
// native tokenization, model execution, context-capacity or platform proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { createRetrieval } from '../examples/browser-model-chat/memory/rag-adapter.mjs';
import { createContextManager } from '../examples/browser-model-chat/memory/context.mjs';
import { createWorkspace, storageKey } from '../examples/browser-model-chat/memory/workspace.mjs';

const built = await buildCore();
const core = await import(pathToFileURL(built.corePath).href + '?sha256=' + built.sha256);
const scope = { actorId: 'local-user', conversationId: 'local-chat' };
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const textOf = messages => messages.map(message => message.content).join('\n');
const authored = (conversation, content) => conversation.append({ role: 'user', content });
const answered = (conversation, content) => conversation.append({ role: 'assistant', content });
const transcriptHash = conversation => sha(conversation.exportState());
const dispatchEvents = events => events.list().filter(event => event.type === 'context-dispatched');

function fixtureMeter(capacity) {
  const calls = [];
  const measure = async messages => {
    calls.push(structuredClone(messages));
    const promptTokens = Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
    return { promptTokens, contextTokens: capacity, overflow: promptTokens > capacity,
      meter: 'deterministic-character-cost-fixture', actualNativeTokenization: false };
  };
  return { measure, calls };
}

function setup({ capacity = 512, reserve = 64, measure } = {}) {
  const conversation = createConversationStore();
  const events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const retrieval = createRetrieval({ core, onEvent: event => events.append(event) });
  const meter = fixtureMeter(capacity);
  const manager = createContextManager({ conversation, memory, retrieval, core, events, capacity, reserve, measure: measure || meter.measure });
  return { conversation, events, memory, retrieval, meter, manager };
}

function longHistory(conversation, marker) {
  authored(conversation, `${marker} first user detail. ` + 'Factual original prose remains stored. '.repeat(30));
  answered(conversation, `${marker} ASSISTANT_OLD_ANSWER ` + 'Assistant text is never source authority. '.repeat(30));
  authored(conversation, `${marker} second user detail. ` + 'Another original passage remains stored. '.repeat(30));
  answered(conversation, `${marker} ASSISTANT_SECOND_ANSWER ` + 'A previous answer is not an authored memory. '.repeat(30));
}

function deferredMeter(capacity = 512) {
  const meter = fixtureMeter(capacity);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  return { started, release, measure: async messages => { entered(); await waiting; return meter.measure(messages); } };
}

function adapterFixture() {
  const meter = fixtureMeter(2048);
  const calls = [];
  const control = { failBeforeDispatch: false, failAfterDispatch: false };
  return { calls, control, measure: meter.measure,
    async reply(messages, options = {}) {
      options.beforeDispatch?.();
      if (control.failBeforeDispatch) throw Error('Fixture failed before any provider send.');
      calls.push(structuredClone(messages)); // This fake adapter's actual send boundary.
      options.onDispatch?.();
      if (control.failAfterDispatch) throw Error('Fixture provider failed after send.');
      return 'Fixture response, not a model result.';
    },
  };
}

test('fixture preparation preserves the whole latest question and emits no provider-dispatch event', async () => {
  const { conversation, manager, events } = setup();
  const question = '  Whole latest question: cafe\u0301 and 🍵?\nKeep this exact spacing.  ';
  authored(conversation, question);
  const before = transcriptHash(conversation);
  const prepared = await manager.prepare();
  assert.equal(prepared.messages.at(-1).role, 'user');
  assert.equal(prepared.messages.at(-1).content, question);
  assert.equal(prepared.measurement.meter, 'deterministic-character-cost-fixture');
  assert.equal(prepared.measurement.actualNativeTokenization, false);
  assert.equal(prepared.measurement.requestSha256, sha(JSON.stringify(prepared.messages)));
  assert.equal(prepared.compaction, null);
  assert.deepEqual(dispatchEvents(events), []);
  assert.equal(transcriptHash(conversation), before);
  manager.validateDispatch(prepared.messages);
  const tampered = structuredClone(prepared.messages); tampered.at(-1).content = 'Different question';
  assert.throws(() => manager.validateDispatch(tampered), /no longer matches/);
  manager.validateDispatch(prepared.messages);
});

test('two forced automatic fixture compactions are lossy, source-linked and preserve all originals', async () => {
  const { conversation, manager, events } = setup();
  longHistory(conversation, 'FIRST');
  authored(conversation, 'What remains from the first exchange?');
  const original = transcriptHash(conversation);
  const first = await manager.prepare();
  assert.equal(first.compaction.cycle, 1);
  assert.ok(first.compaction.before.promptTokens > first.compaction.after.promptTokens);
  assert.ok(first.measurement.promptTokens + 64 <= 512);
  assert.equal(first.messages.at(-1).content, 'What remains from the first exchange?');
  assert.doesNotMatch(textOf(first.messages), /ASSISTANT_OLD_ANSWER|ASSISTANT_SECOND_ANSWER/);
  assert.equal(transcriptHash(conversation), original);
  answered(conversation, 'A short answer retained in the canonical transcript.');
  longHistory(conversation, 'SECOND');
  authored(conversation, 'What remains after another exchange?');
  const secondOriginal = transcriptHash(conversation);
  const second = await manager.prepare();
  assert.equal(second.compaction.cycle, 2);
  assert.equal(second.messages.at(-1).content, 'What remains after another exchange?');
  assert.doesNotMatch(textOf(second.messages), /ASSISTANT_OLD_ANSWER|ASSISTANT_SECOND_ANSWER/);
  const compacted = manager.snapshot().compacted;
  assert.equal(compacted.strategy, 'source-linked-automatic-extractive-v1');
  assert.match(compacted.text, /[Ll]ossy/);
  assert.equal(compacted.contentHash, sha(compacted.text));
  for (const source of compacted.sources) {
    const turn = conversation.snapshot().turns.find(turn => turn.id === source.turnId);
    assert.equal(source.contentHash, sha(turn.content));
  }
  for (const excerpt of compacted.excerpts) {
    const turn = conversation.snapshot().turns.find(turn => turn.id === excerpt.turnId);
    assert.equal(turn.role, 'user'); assert.ok(turn.content.includes(excerpt.text));
  }
  assert.equal(transcriptHash(conversation), secondOriginal);
  assert.deepEqual(events.list().filter(event => event.type === 'compacted').map(event => event.cycle), [1, 2]);
  assert.deepEqual(dispatchEvents(events), []);
});

test('correction resets derived context and excludes every historical memory source and older answer', async () => {
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160 });
  const old = authored(conversation, 'The courier passphrase is amber larch.');
  const saved = await memory.save({ text: old.content, sourceTurnIds: [old.id], scope, modelSafe: true });
  answered(conversation, 'STALE_ASSISTANT_ASSERTION: the courier passphrase is amber larch.');
  authored(conversation, 'What courier passphrase did I save?');
  await manager.prepare();
  const correction = authored(conversation, 'The courier passphrase is violet cedar.');
  await memory.correct({ recordId: saved.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  answered(conversation, 'OLDER_ASSISTANT_CONFLICT: the passphrase is invented mango.');
  authored(conversation, 'Which courier passphrase is current?');
  const before = transcriptHash(conversation);
  const request = await manager.prepare();
  assert.deepEqual(request.evidence.map(hit => [hit.recordId, hit.version]), [[saved.id, 2]]);
  assert.match(textOf(request.messages), /violet cedar/);
  assert.doesNotMatch(textOf(request.messages), /amber larch|invented mango|STALE_ASSISTANT|OLDER_ASSISTANT/);
  const summary = manager.snapshot().compacted;
  assert.ok(summary.excerpts.every(excerpt => ![old.id, correction.id].includes(excerpt.turnId)));
  assert.deepEqual(request.messages.filter(message => message.role === 'user').map(message => message.content), ['Which courier passphrase is current?']);
  assert.equal(transcriptHash(conversation), before);
});

test('forget excludes cited saved-record versions and old assistant answers from the next request', async () => {
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160 });
  const old = authored(conversation, 'The courier passphrase is amber larch.');
  const saved = await memory.save({ text: old.content, sourceTurnIds: [old.id], scope, modelSafe: true });
  const newer = authored(conversation, 'The courier passphrase is violet cedar.');
  await memory.correct({ recordId: saved.id, expectedVersion: 1, text: newer.content, sourceTurnIds: [newer.id] });
  answered(conversation, 'STALE_ASSISTANT: amber larch and violet cedar were mentioned.');
  authored(conversation, 'Which courier passphrase is current?'); await manager.prepare();
  await memory.forget({ recordId: saved.id });
  answered(conversation, 'OLD_FORGOTTEN_ANSWER: violet cedar.');
  authored(conversation, 'Do you have a saved courier passphrase?');
  const original = transcriptHash(conversation);
  const request = await manager.prepare();
  assert.deepEqual(request.evidence, []);
  assert.doesNotMatch(textOf(request.messages), /amber larch|violet cedar|STALE_ASSISTANT|OLD_FORGOTTEN_ANSWER/);
  assert.deepEqual(memory.active(scope), []);
  assert.equal(transcriptHash(conversation), original);
  assert.match(conversation.exportState(), /amber larch/);
});

test('structured fixture compaction retains declarations beyond 120 characters across four older turns without saved-fact RAG', async () => {
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160 });
  const prefix = 'Unmarked original narrative. '.repeat(70) + '\n';
  const declarations = [
    'Fact[codename]: The project codename is Amber.',
    'Fact[city]: The destination city is Bristol.',
    'Constraint[delivery]: The delivery day is Tuesday.',
    'Correction[delivery]: The delivery day is Thursday.\nConstraint[format]: Answer in one short sentence.',
  ];
  for (const declaration of declarations) authored(conversation, prefix + declaration);
  const latest = authored(conversation, 'What are the codename, city and current delivery day?');
  const original = transcriptHash(conversation);
  const prepared = await manager.prepare();
  const derived = manager.snapshot().compacted;
  assert.equal(prepared.compaction.strategy, 'source-linked-structured-extractive-v1');
  assert.ok(prepared.compaction.before.promptTokens + 160 > 2048);
  assert.ok(prepared.measurement.promptTokens + 160 <= 2048);
  assert.equal(prepared.measurement.actualNativeTokenization, false);
  assert.deepEqual(memory.active(scope), []);
  assert.deepEqual(prepared.evidence, []);
  assert.deepEqual(derived.items.map(item => item.key), ['codename', 'city', 'delivery', 'format']);
  assert.match(textOf(prepared.messages), /Amber/);
  assert.match(textOf(prepared.messages), /Bristol/);
  assert.match(textOf(prepared.messages), /Thursday/);
  assert.doesNotMatch(textOf(prepared.messages), /Tuesday|Unmarked original narrative/);
  assert.equal(derived.items.find(item => item.key === 'delivery').lineage.length, 2);
  for (const item of derived.items) {
    const turn = conversation.snapshot().turns.find(turn => turn.id === item.turnId);
    assert.ok(item.offsets.start > 120);
    assert.equal(turn.content.slice(item.offsets.start, item.offsets.end), item.quote);
    assert.equal(item.turnHash, sha(turn.content));
    assert.ok(prepared.contextSources.some(source => source.key === item.key && source.turnId === item.turnId));
  }
  assert.equal(prepared.messages.at(-1).content, latest.content);
  assert.equal(transcriptHash(conversation), original);
  assert.equal(derived.coverage.completeConversation, false);
});

test('automatic fixture compaction preserves recent whole exchanges and exact older unmarked passages', async () => {
  let count = 0;
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160,
    measure: async () => ({ promptTokens: ++count === 1 ? 2300 : 400, contextTokens: 2048, overflow: count === 1,
      actualNativeTokenization: false }) });
  const prefix = 'Caf\u00e9 archive \ud83c\udf75.\r\n' + 'The archive team sorted papers. '.repeat(40) + '\r\n';
  const originals = [
    authored(conversation, prefix + 'The Project Cedar codename is Amber.'),
    authored(conversation, prefix + 'The destination city is Bristol.'),
    authored(conversation, prefix + 'The delivery day is Tuesday.'),
    authored(conversation, prefix + 'Please keep replies concise.'),
  ];
  const recentUser = authored(conversation, 'I am checking the project notes.');
  const recentAssistant = answered(conversation, 'I will use the project notes.');
  const latest = authored(conversation, 'What are the Project Cedar codename, destination city and delivery day?');
  const original = transcriptHash(conversation); const request = await manager.prepare();
  assert.equal(request.compaction.strategy, 'source-linked-automatic-extractive-v1');
  assert.equal(request.measurement.actualNativeTokenization, false);
  assert.deepEqual(request.messages.slice(-3).map(m => m.content), [recentUser.content, recentAssistant.content, latest.content]);
  assert.deepEqual(request.evidence, []); assert.deepEqual(memory.active(scope), []);
  assert.match(textOf(request.messages), /Amber/); assert.match(textOf(request.messages), /Bristol/);
  assert.match(textOf(request.messages), /Tuesday/);
  assert.ok(request.extractiveSources.length >= 3);
  for (const source of request.extractiveSources) {
    const turn = originals.find(t => t.id === source.turnId);
    assert.ok(turn); assert.equal(source.turnHash, sha(turn.content));
    assert.equal(source.lineHash, sha(turn.content.slice(source.offsets.start, source.offsets.end)));
  }
  assert.equal(transcriptHash(conversation), original);
  assert.equal(manager.snapshot().compacted.sources.length, 4);
});

test('automatic compaction applies correction/forget source exclusions without adding saved facts', async () => {
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160 });
  const first = authored(conversation, 'My delivery day is Tuesday.');
  const record = await memory.save({ text: first.content, sourceTurnIds: [first.id], scope, modelSafe: true });
  answered(conversation, 'STALE assistant answer: Tuesday.');
  const correction = authored(conversation, 'My delivery day is Friday.');
  await memory.correct({ recordId: record.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  answered(conversation, 'STALE assistant answer: Friday.');
  await memory.forget({ recordId: record.id });
  authored(conversation, 'Do you have a saved delivery day?');
  const original = transcriptHash(conversation); const request = await manager.prepare();
  assert.deepEqual(request.evidence, []); assert.deepEqual(request.extractiveSources, []);
  assert.doesNotMatch(textOf(request.messages), /Tuesday|Friday|STALE/);
  assert.deepEqual(memory.active(scope), []);
  assert.equal(memory.snapshot().records.length, 3);
  assert.equal(transcriptHash(conversation), original);
});

test('structured conflicts fail atomically instead of replacing prior context or canonical text', async () => {
  const { conversation, manager, events } = setup();
  longHistory(conversation, 'PRIOR'); authored(conversation, 'A short question.');
  await manager.prepare();
  const prior = manager.snapshot();
  authored(conversation, 'Original narrative. '.repeat(100) + '\nFact[delivery]: Tuesday.');
  authored(conversation, 'More original narrative. '.repeat(100) + '\nFact[delivery]: Thursday.');
  authored(conversation, 'Which delivery day?');
  const original = transcriptHash(conversation);
  const eventCount = events.list().filter(event => event.type === 'compacted').length;
  await assert.rejects(manager.prepare(), error => error.code === 'STRUCTURED_CONTEXT_CONFLICT');
  assert.deepEqual(manager.snapshot(), prior);
  assert.equal(transcriptHash(conversation), original);
  assert.equal(events.list().filter(event => event.type === 'compacted').length, eventCount);
});

test('forget saved record preserves an independently repeated declaration without restoring record recall', async () => {
  const { conversation, memory, manager } = setup({ capacity: 2048, reserve: 160 });
  const first = authored(conversation, 'Fact[delivery]: My delivery day is Tuesday.');
  const saved = await memory.save({ text: first.content, sourceTurnIds: [first.id], scope, modelSafe: true });
  const repeated = authored(conversation, first.content);
  await memory.forget({ recordId: saved.id });
  const latest = authored(conversation, 'Do you have a saved delivery day?');
  const original = transcriptHash(conversation);
  const prepared = await manager.prepare();
  assert.deepEqual(memory.active(scope), []);
  assert.deepEqual(prepared.evidence, []);
  assert.match(textOf(prepared.messages), /Tuesday/);
  assert.deepEqual(prepared.contextSources.map(({ key, turnId }) => ({ key, turnId })), [{ key: 'delivery', turnId: repeated.id }]);
  assert.equal(manager.snapshot().compacted.items[0].sourceRefs.length, 1);
  assert.equal(prepared.messages.at(-1).content, latest.content);
  assert.equal(transcriptHash(conversation), original);
  assert.equal(conversation.snapshot().turns.filter(turn => turn.content === first.content).length, 2);
});

test('conversation mutation while the fixture meter awaits rejects candidate context atomically', async () => {
  const gate = deferredMeter();
  const { conversation, manager, events } = setup({ measure: gate.measure });
  longHistory(conversation, 'PENDING'); authored(conversation, 'A pending question.');
  const before = manager.snapshot(); const pending = manager.prepare(); await gate.started;
  answered(conversation, 'A concurrent canonical append.'); const original = transcriptHash(conversation);
  gate.release();
  await assert.rejects(pending, /changed while preparing/);
  assert.deepEqual(manager.snapshot(), before); assert.equal(transcriptHash(conversation), original);
  assert.deepEqual(events.list().filter(event => ['compacted', 'context-dispatched'].includes(event.type)), []);
});

test('memory mutation while the fixture meter awaits rejects stale evidence without committing derived state', async () => {
  const gate = deferredMeter();
  const { conversation, memory, manager, events } = setup({ measure: gate.measure });
  const fact = authored(conversation, 'My delivery day is Tuesday.');
  const record = await memory.save({ text: fact.content, sourceTurnIds: [fact.id], scope, modelSafe: true });
  authored(conversation, 'What is my delivery day?');
  const before = manager.snapshot(); const pending = manager.prepare(); await gate.started;
  await memory.forget({ recordId: record.id }); const original = transcriptHash(conversation);
  gate.release();
  await assert.rejects(pending, /changed while preparing/);
  assert.deepEqual(manager.snapshot(), before); assert.equal(transcriptHash(conversation), original);
  assert.deepEqual(events.list().filter(event => ['compacted', 'context-dispatched'].includes(event.type)), []);
});

test('concurrent preparation is refused and a completed candidate still validates exactly', async () => {
  const gate = deferredMeter();
  const { conversation, manager, events } = setup({ measure: gate.measure });
  authored(conversation, 'One authored question.');
  const pending = manager.prepare(); await gate.started;
  await assert.rejects(manager.prepare(), /already in progress/);
  gate.release(); const prepared = await pending;
  manager.validateDispatch(prepared.messages);
  assert.deepEqual(dispatchEvents(events), []);
});

test('failed over-budget compaction keeps prior context and canonical hashes without truncating the latest turn', async () => {
  const { conversation, manager, meter, events } = setup();
  longHistory(conversation, 'PRIOR'); authored(conversation, 'A short question.');
  await manager.prepare(); const priorContext = manager.snapshot();
  answered(conversation, 'An answer.');
  const tooLarge = 'WHOLE_LATEST_QUESTION_'.repeat(150); authored(conversation, tooLarge);
  const original = transcriptHash(conversation), compactedEvents = events.list().filter(event => event.type === 'compacted').length;
  await assert.rejects(manager.prepare(), /exceeds/);
  assert.deepEqual(manager.snapshot(), priorContext);
  assert.equal(transcriptHash(conversation), original);
  assert.equal(sha(meter.calls.at(-1).at(-1).content), sha(tooLarge));
  assert.equal(events.list().filter(event => event.type === 'compacted').length, compactedEvents);
});

test('invalid fixture measurements fail closed without claiming native token evidence', async () => {
  for (const result of [{ promptTokens: 0, contextTokens: 512, overflow: false },
    { promptTokens: 4.5, contextTokens: 512, overflow: false }, { promptTokens: 100, contextTokens: 2048, overflow: false },
    { promptTokens: 100, contextTokens: 512, overflow: 'false' }]) {
    const { conversation, manager, events } = setup({ measure: async () => result });
    authored(conversation, 'Question.'); const before = manager.snapshot();
    await assert.rejects(manager.prepare(), /measurement unavailable|context mismatch/);
    assert.deepEqual(manager.snapshot(), before); assert.deepEqual(dispatchEvents(events), []);
  }
});

test('workspace records context-dispatched only after the fake adapter send boundary', async () => {
  const adapter = adapterFixture();
  const workspace = await createWorkspace({ adapter, core, graphEnabled: false });
  try {
    authored(workspace.conversation, 'A dispatch boundary question.');
    const prepared = await workspace.prepare();
    assert.deepEqual(dispatchEvents(workspace.events), []);
    adapter.control.failBeforeDispatch = true;
    await assert.rejects(workspace.provider.reply(prepared.messages), /before any provider send/);
    assert.equal(adapter.calls.length, 0); assert.deepEqual(dispatchEvents(workspace.events), []);
    const altered = structuredClone(prepared.messages); altered.at(-1).content = 'An unauthorized replacement.';
    await assert.rejects(workspace.provider.reply(altered), /no longer matches/);
    assert.equal(adapter.calls.length, 0);
    adapter.control.failBeforeDispatch = false; adapter.control.failAfterDispatch = true;
    await assert.rejects(workspace.provider.reply(prepared.messages), /after send/);
    assert.equal(adapter.calls.length, 1);
    const dispatched = dispatchEvents(workspace.events);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].requestSha256, sha(JSON.stringify(adapter.calls[0])));
    assert.equal(dispatched[0].conversationVersion, workspace.conversation.snapshot().version);
    await assert.rejects(workspace.provider.reply(prepared.messages), /no longer matches/);
    assert.equal(adapter.calls.length, 1, 'a consumed candidate cannot dispatch twice');
  } finally { workspace.dispose(); }
});

test('absent, active, failed and disposed graph views leave provider requests and memories equivalent', async () => {
  const outcomes = [];
  for (const mode of ['absent', 'active', 'failed', 'disposed']) {
    const adapter = adapterFixture();
    const workspace = await createWorkspace({ adapter, core, graphEnabled: mode !== 'absent' });
    let unsubscribe;
    try {
      if (mode === 'failed') unsubscribe = workspace.events.subscribe(() => { throw Error('Fixture graph renderer failed.'); });
      if (mode === 'disposed') workspace.graph.dispose();
      const fact = authored(workspace.conversation, 'My delivery day is Tuesday.');
      await workspace.memory.save({ text: fact.content, sourceTurnIds: [fact.id], scope, modelSafe: true });
      answered(workspace.conversation, 'An earlier answer.'); authored(workspace.conversation, 'What is my delivery day?');
      const prepared = await workspace.prepare(); await workspace.provider.reply(prepared.messages);
      outcomes.push({ messages: adapter.calls, evidence: prepared.evidence, memories: workspace.memory.snapshot(), events: workspace.events.list() });
    } finally { unsubscribe?.(); workspace.dispose(); }
  }
  for (const outcome of outcomes) assert.deepEqual(outcome, outcomes[0]);
});

test('rejected model summaries cannot admit facts, and restored tombstones cannot leak through a new context manager', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const workspace = await createWorkspace({ adapter: adapterFixture(), core, storage, graphEnabled: false });
  let restored;
  try {
    const fact = authored(workspace.conversation, 'The courier passphrase is amber larch.');
    const record = await workspace.memory.save({ text: fact.content, sourceTurnIds: [fact.id], scope, modelSafe: true });
    const assistant = answered(workspace.conversation, 'MODEL_PROPOSAL: the courier passphrase is invented mango.');
    const beforeMemory = workspace.memory.exportState(), beforeTranscript = transcriptHash(workspace.conversation);
    const rejected = workspace.context.rejectModelSummary({ text: assistant.content, sourceTurnIds: [assistant.id] });
    assert.equal(rejected.admitted, false);
    await assert.rejects(workspace.memory.save({ text: assistant.content, sourceTurnIds: [assistant.id], scope, modelSafe: true }), /user-authored/);
    assert.equal(workspace.memory.exportState(), beforeMemory); assert.equal(transcriptHash(workspace.conversation), beforeTranscript);
    assert.equal(workspace.events.list().filter(event => event.type === 'summary-rejected').length, 1);
    assert.throws(() => workspace.context.rejectModelSummary({ text: 'Proposal', sourceTurnIds: ['t-9999'] }), /unknown/);
    await workspace.memory.forget({ recordId: record.id });
    assert.equal((await workspace.persist()).durable, true); assert.ok(values.has(storageKey));
    const fullOriginal = workspace.conversation.exportState(), fullMemory = workspace.memory.exportState();
    restored = await createWorkspace({ adapter: adapterFixture(), core, storage, graphEnabled: false });
    assert.equal(restored.conversation.exportState(), fullOriginal); assert.equal(restored.memory.exportState(), fullMemory);
    assert.deepEqual(restored.memory.active(scope), []);
    authored(restored.conversation, 'Do you have a saved courier passphrase?');
    const original = transcriptHash(restored.conversation), request = await restored.prepare();
    assert.deepEqual(request.evidence, []);
    assert.doesNotMatch(textOf(request.messages), /amber larch|invented mango|MODEL_PROPOSAL/);
    assert.equal(request.messages.at(-1).content, 'Do you have a saved courier passphrase?');
    assert.equal(transcriptHash(restored.conversation), original);
    assert.match(restored.conversation.exportState(), /amber larch|invented mango/);
  } finally { restored?.dispose(); workspace.dispose(); }
});
