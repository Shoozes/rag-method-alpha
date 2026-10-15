// Deterministic provider/meter fixtures only; no native-model or platform proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { createWorkspace, storageKey } from '../examples/browser-model-chat/memory/workspace.mjs';

const built = await buildCore();
const core = await import(pathToFileURL(built.corePath).href + '?sha256=' + built.sha256);
const scope = { actorId: 'local-user', conversationId: 'local-chat' };
function fixture() {
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const control = { overflow: false };
  const adapter = {
    async measure(messages) {
      calls.push({ kind: 'fixture-measure', messages });
      const overflow = control.overflow; control.overflow = false;
      return { promptTokens: overflow ? 2300 : 300, contextTokens: 2048, overflow, actualNativeTokenization: false };
    },
    async reply(messages, options = {}) {
      options.beforeDispatch?.(); calls.push({ kind: 'fixture-reply', messages }); options.onDispatch?.();
      return 'Fixture answer, not model output.';
    },
  };
  return { storage, values, calls, control, adapter };
}
async function answer(workspace, question) {
  workspace.conversation.append({ role: 'user', content: question });
  const prepared = await workspace.prepare();
  const content = await workspace.provider.reply(prepared.messages);
  const turn = workspace.conversation.append({ role: 'assistant', content });
  await workspace.captureAnswerSources({ answerTurnId: turn.id, requestSha256: prepared.measurement.requestSha256 });
  return { turn, prepared, sources: workspace.sourcesForAnswer(turn.id) };
}

test('saved-record answer citations reload unchanged without provider calls or transcript mutation', async () => {
  const f = fixture(); const workspace = await createWorkspace({ ...f, core }); let restored;
  try {
    const turn = workspace.conversation.append({ role: 'user', content: 'My delivery day is Tuesday.' });
    await workspace.memory.save({ text: turn.content, sourceTurnIds: [turn.id], scope, modelSafe: true });
    const accepted = await answer(workspace, 'What is my delivery day?');
    assert.equal(accepted.sources.length, 1); assert.equal(accepted.sources[0].kind, 'saved-record');
    assert.equal(accepted.sources[0].version, 1);
    assert.equal((await workspace.persist()).durable, true);
    const original = workspace.conversation.exportState(), count = f.calls.length;
    restored = await createWorkspace({ ...f, core });
    assert.equal(f.calls.length, count, 'restore cannot call the provider or meter');
    assert.equal(restored.conversation.exportState(), original);
    assert.deepEqual(restored.sourcesForAnswer(accepted.turn.id), accepted.sources);
    const returned = restored.sourcesForAnswer(accepted.turn.id); returned[0].turnHash = 'changed';
    assert.deepEqual(restored.sourcesForAnswer(accepted.turn.id), accepted.sources);
  } finally { restored?.dispose(); workspace.dispose(); }
});

test('correction and forgotten tombstone retain both historical citation versions without restoring retrieval', async () => {
  const f = fixture(); const workspace = await createWorkspace({ ...f, core }); let restored;
  try {
    const first = workspace.conversation.append({ role: 'user', content: 'My delivery day is Tuesday.' });
    const record = await workspace.memory.save({ text: first.content, sourceTurnIds: [first.id], scope, modelSafe: true });
    const older = await answer(workspace, 'What is my delivery day?');
    const correction = workspace.conversation.append({ role: 'user', content: 'My delivery day is Friday.' });
    await workspace.memory.correct({ recordId: record.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
    const newer = await answer(workspace, 'What is my delivery day now?');
    assert.equal(newer.sources[0].version, 2); assert.equal(newer.sources[0].turnId, correction.id);
    await workspace.memory.forget({ recordId: record.id });
    const original = workspace.conversation.exportState(); await workspace.persist();
    restored = await createWorkspace({ ...f, core });
    assert.deepEqual(restored.sourcesForAnswer(older.turn.id), older.sources);
    assert.deepEqual(restored.sourcesForAnswer(newer.turn.id), newer.sources);
    assert.deepEqual(restored.memory.active(scope), []);
    const after = await answer(restored, 'Do you have a saved delivery day?');
    assert.deepEqual(after.prepared.evidence, []);
    assert.ok(after.sources.every(source => source.kind === 'extractive'));
    assert.ok(after.sources.every(source => ![first.id, correction.id].includes(source.turnId)));
    assert.doesNotMatch(after.prepared.messages.map(m => m.content).join('\n'), /Tuesday|Friday/);
    assert.deepEqual(restored.memory.snapshot().records.map(r => r.status), ['superseded', 'superseded', 'forgotten']);
    assert.equal(restored.conversation.exportState().includes(JSON.parse(original).turns[0].content), true);
    assert.deepEqual(restored.conversation.snapshot().turns.slice(0, 6), JSON.parse(original).turns);
  } finally { restored?.dispose(); workspace.dispose(); }
});

test('structured citation offsets and source hashes persist; corrupted annotations or dispatch sources refuse restore', async () => {
  const f = fixture(); const workspace = await createWorkspace({ ...f, core }); let restored;
  try {
    workspace.conversation.append({ role: 'user', content: 'Unmarked narrative. '.repeat(20) + '\nFact[city]: Bristol.' });
    workspace.conversation.append({ role: 'user', content: 'Correction[city]: Bath.\nConstraint[format]: One sentence.' });
    f.control.overflow = true;
    const accepted = await answer(workspace, 'Which city and response format?');
    assert.equal(accepted.sources.length, 2); assert.ok(accepted.sources.every(s => s.kind === 'structured'));
    const original = workspace.conversation.exportState(); await workspace.persist();
    const saved = f.values.get(storageKey);
    restored = await createWorkspace({ ...f, core });
    assert.deepEqual(restored.sourcesForAnswer(accepted.turn.id), accepted.sources);
    assert.equal(restored.conversation.exportState(), original);
    for (const mutate of [
      value => { value.answerCitations[0].sources[0].turnHash = '0'.repeat(64); },
      value => { value.answerCitations[0].answerHash = '0'.repeat(64); },
      value => { value.events.find(e => e.type === 'context-dispatched').contextSources[0].offsets.end--; },
      value => { value.answerCitations = null; },
    ]) {
      const value = JSON.parse(saved); mutate(value); f.values.set(storageKey, JSON.stringify(value));
      await assert.rejects(createWorkspace({ ...f, core }), /citation|Citation|event binding/);
    }
  } finally { restored?.dispose(); workspace.dispose(); }
});

test('legacy v1 snapshots migrate missing annotations to empty without inventing old source links', async () => {
  const f = fixture(); const workspace = await createWorkspace({ ...f, core }); let restored;
  try {
    const fact = workspace.conversation.append({ role: 'user', content: 'My delivery day is Tuesday.' });
    await workspace.memory.save({ text: fact.content, sourceTurnIds: [fact.id], scope, modelSafe: true });
    const accepted = await answer(workspace, 'What is my delivery day?'); await workspace.persist();
    const legacy = JSON.parse(f.values.get(storageKey)); delete legacy.answerCitations;
    f.values.set(storageKey, JSON.stringify(legacy)); const original = legacy.conversation;
    restored = await createWorkspace({ ...f, core });
    assert.deepEqual(restored.sourcesForAnswer(accepted.turn.id), []);
    assert.equal(restored.conversation.exportState(), original);
    assert.equal(restored.memory.active(scope).length, 1); await restored.persist();
    assert.deepEqual(JSON.parse(f.values.get(storageKey)).answerCitations, []);
  } finally { restored?.dispose(); workspace.dispose(); }
});
