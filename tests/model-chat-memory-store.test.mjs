import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';

const scope = { actorId: 'local-user', conversationId: 'local-chat' };
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const serialized = value => JSON.stringify(value);
function fixture(onEvent = () => {}) {
  const conversation = createConversationStore();
  const original = conversation.append({ role: 'user', content: 'I prefer green tea.\nMy timezone is UTC.' });
  const assistant = conversation.append({ role: 'assistant', content: 'You enjoy coffee and live in Paris.' });
  const correction = conversation.append({ role: 'user', content: 'Correction: I prefer black tea.' });
  const memory = createMemoryStore({ conversation, onEvent });
  const save = overrides => memory.save({ text: 'I prefer green tea.', sourceTurnIds: [original.id], scope, modelSafe: true, ...overrides });
  return { conversation, original, assistant, correction, memory, save };
}

test('canonical transcript preserves original text, stable IDs and immutable snapshots', () => {
  const conversation = createConversationStore();
  const text = '  Exact whitespace\r\nCafe\u0301 🍵  ';
  const turn = conversation.append({ role: 'user', content: text });
  assert.deepEqual(turn, { id: 't-0001', role: 'user', content: text, ...scope });
  assert.throws(() => { turn.content = 'changed'; }, TypeError);
  const before = conversation.snapshot();
  assert.throws(() => before.turns.push({}), TypeError);
  const second = conversation.append({ role: 'assistant', content: 'A response.' });
  assert.equal(second.id, 't-0002');
  assert.equal(before.version, 1);
  assert.equal(before.turns.length, 1);
  assert.equal(conversation.snapshot().version, 2);
  assert.equal(conversation.snapshot().turns[0].content, text);
});

test('transcript rejects invalid turns and restores only a matching append-only history', () => {
  assert.throws(() => createConversationStore({ actorId: '' }), /identity/);
  const { conversation } = fixture();
  for (const value of [{ role: 'system', content: 'secret' }, { role: 'user', content: ' ' }, { role: 'user', content: {} }]) {
    assert.throws(() => conversation.append(value));
  }
  const restored = createConversationStore();
  restored.importState(conversation.exportState());
  assert.deepEqual(restored.snapshot(), conversation.snapshot());
  for (const mutate of [state => { state.actorId = 'other'; }, state => { state.turns[0].content = 'rewritten'; },
    state => { state.turns.pop(); state.version--; }, state => { state.turns[1].id = 't-0001'; }, state => { state.extra = true; }]) {
    const state = JSON.parse(conversation.exportState()); mutate(state);
    assert.throws(() => restored.importState(serialized(state)));
    assert.deepEqual(restored.snapshot(), conversation.snapshot());
  }
  assert.throws(() => restored.importState('{'));
  assert.throws(() => restored.importState(restored.snapshot()), /serialized/);
  conversation.append({ role: 'user', content: 'An appended original.' });
  restored.importState(conversation.exportState());
  assert.equal(restored.snapshot().turns[3].id, 't-0004');
});

test('saved memory is an exact user quote with byte hashes and an event after commit', async () => {
  let observed;
  const events = [];
  const { memory, save, original } = fixture(event => { events.push(event); observed = memory.active(scope); });
  const record = await save();
  assert.equal(record.id, 'm-0001'); assert.equal(record.version, 1); assert.equal(record.status, 'active');
  assert.equal(record.contentHash, sha(record.text));
  assert.deepEqual(record.sourceHashes, [{ turnId: original.id, contentHash: sha(original.content) }]);
  assert.deepEqual(observed, [record]);
  assert.deepEqual(events, [{ type: 'saved', recordId: record.id, version: 1, sourceTurnIds: [original.id], contentHash: sha(record.text) }]);
  assert.throws(() => { record.scope.actorId = 'other'; }, TypeError);
  assert.throws(() => events[0].sourceTurnIds.push('t-9999'), TypeError);
  assert.deepEqual(memory.active(scope), [record]);
});

test('assistant targets, summaries, false safety and inaccurate citations cannot become memories', async () => {
  const events = [];
  const { memory, save, original, assistant, correction } = fixture(event => events.push(event));
  for (const value of [
    { text: assistant.content, sourceTurnIds: [assistant.id] },
    { text: 'The user likes tea.', sourceTurnIds: [original.id] },
    { text: 'i prefer green tea.', sourceTurnIds: [original.id] },
    { sourceTurnIds: [original.id, correction.id] }, { sourceTurnIds: [] },
    { sourceTurnIds: [original.id, original.id] }, { sourceTurnIds: ['t-9999'] },
    { scope: { ...scope, actorId: 'other' } }, { scope: { ...scope, conversationId: 'other' } },
    { scope: { ...scope, permission: true } }, { modelSafe: false }, { modelSafe: undefined },
  ]) await assert.rejects(save(value));
  assert.deepEqual(memory.active(scope), []); assert.deepEqual(events, []);
  assert.equal((await save()).id, 'm-0001', 'failed validation does not consume stable IDs');
});

test('correction supersedes a version without rewriting original transcript or earlier content', async () => {
  const { conversation, memory, save, correction } = fixture();
  const transcript = conversation.exportState();
  const first = await save();
  const second = await memory.correct({ recordId: first.id, expectedVersion: 1, text: 'I prefer black tea.', sourceTurnIds: [correction.id] });
  assert.equal(second.id, first.id); assert.equal(second.version, 2); assert.equal(second.contentHash, sha(second.text));
  assert.deepEqual(memory.snapshot().records.map(record => [record.version, record.status, record.text]), [
    [1, 'superseded', 'I prefer green tea.'], [2, 'active', 'I prefer black tea.'],
  ]);
  assert.deepEqual(memory.active(scope), [second]);
  assert.equal(first.status, 'active', 'a previously returned snapshot is unchanged');
  assert.equal(conversation.exportState(), transcript);
});

test('serialized writes reject concurrent stale corrections and remain usable after rejection', async () => {
  const { memory, save, correction } = fixture();
  const first = await save();
  const input = { recordId: first.id, expectedVersion: 1, text: 'I prefer black tea.', sourceTurnIds: [correction.id] };
  const outcomes = await Promise.allSettled([memory.correct(input), memory.correct(input)]);
  assert.deepEqual(outcomes.map(value => value.status), ['fulfilled', 'rejected']);
  assert.match(outcomes[1].reason.message, /version conflict/);
  assert.equal(memory.snapshot().records.length, 2);
  await assert.rejects(memory.correct({ ...input, expectedVersion: 2, text: 'A generated summary.' }), /exact substring/);
  assert.equal((await memory.forget({ recordId: first.id })).version, 3);
});

test('forget creates an empty latest tombstone, is idempotent and cannot be corrected or revived', async () => {
  const events = [];
  const { memory, save, original } = fixture(event => events.push(event));
  const first = await save();
  const forgotten = await memory.forget({ recordId: first.id });
  assert.equal(forgotten.status, 'forgotten'); assert.equal(forgotten.version, 2);
  assert.equal(forgotten.text, ''); assert.equal(forgotten.contentHash, sha(''));
  assert.deepEqual(memory.active(scope), []);
  assert.deepEqual(await memory.forget({ recordId: first.id }), forgotten);
  assert.equal(events.length, 2, 'idempotent forget emits no duplicate event');
  await assert.rejects(memory.correct({ recordId: first.id, expectedVersion: 2, text: first.text, sourceTurnIds: [original.id] }), /cannot revive/);
  assert.equal(memory.snapshot().records[0].text, first.text, 'audit history preserves the earlier original');
  await assert.rejects(memory.forget({ recordId: 'm-9999' }), /Unknown/);
});

test('active memory requires both exact actor and conversation scope', async () => {
  const { memory, save } = fixture();
  const first = await save();
  for (const requested of [{}, { actorId: scope.actorId }, { conversationId: scope.conversationId },
    { ...scope, actorId: 'other' }, { ...scope, conversationId: 'other' }]) assert.deepEqual(memory.active(requested), []);
  assert.deepEqual(memory.active(scope), [first]);
});

test('persisted corrected and forgotten histories restore with valid active views and stable IDs', async () => {
  const { conversation, memory, save, original, correction } = fixture();
  const first = await save();
  await memory.correct({ recordId: first.id, expectedVersion: 1, text: 'I prefer black tea.', sourceTurnIds: [correction.id] });
  await memory.forget({ recordId: first.id });
  const second = await save({ text: 'My timezone is UTC.' });
  const copiedConversation = createConversationStore(); copiedConversation.importState(conversation.exportState());
  const events = [];
  const restored = createMemoryStore({ conversation: copiedConversation, onEvent: event => events.push(event) });
  await restored.importState(memory.exportState());
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  assert.deepEqual(restored.active(scope), [second]); assert.deepEqual(events, [], 'restore does not replay authored events');
  assert.equal((await restored.save({ text: 'green tea', sourceTurnIds: [original.id], scope, modelSafe: true })).id, 'm-0003');
});

test('tampered persistence fails atomically: hashes, sources, scopes, version gaps and tombstone revival', async () => {
  const { conversation, memory, save, original } = fixture();
  const first = await save(); await memory.forget({ recordId: first.id });
  const clean = memory.exportState();
  for (const mutate of [
    state => { state.records[0].contentHash = '0'.repeat(64); },
    state => { state.records[0].sourceHashes[0].contentHash = '0'.repeat(64); },
    state => { state.records[0].sourceTurnIds = ['t-0002']; },
    state => { state.records[0].scope.actorId = 'other'; },
    state => { state.records[1].version = 3; },
    state => { state.records[0].status = 'active'; },
    state => { state.records[1].text = 'revived'; },
    state => { state.records.push({ ...state.records[0], version: 3, status: 'active' }); },
    state => { state.records[0].modelSafe = false; },
    state => { state.records[1].sourceTurnIds = [original.id, 't-9999']; },
    state => { state.records[0].extra = 'untrusted'; },
  ]) {
    const state = JSON.parse(clean); mutate(state);
    const restored = createMemoryStore({ conversation });
    await assert.rejects(restored.importState(serialized(state)));
    assert.deepEqual(restored.snapshot().records, [], 'no partially accepted state');
  }
  await assert.rejects(memory.importState('{'));
  assert.equal(memory.exportState(), clean);
});

test('restore may extend existing history but cannot roll it back or replace earlier originals', async () => {
  const { conversation, memory, save, correction } = fixture();
  const first = await save(); const initial = memory.exportState();
  const restored = createMemoryStore({ conversation }); await restored.importState(initial);
  await memory.correct({ recordId: first.id, expectedVersion: 1, text: 'I prefer black tea.', sourceTurnIds: [correction.id] });
  await restored.importState(memory.exportState());
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  await assert.rejects(restored.importState(initial), /cannot be removed or changed/);
  await restored.forget({ recordId: first.id }); const forgotten = restored.exportState();
  await assert.rejects(restored.importState(memory.exportState()), /cannot be removed or changed/);
  assert.equal(restored.exportState(), forgotten);
});

test('throwing or rejecting observers never fail writes or expose memory text in event payloads', async () => {
  for (const onEvent of [() => { throw new Error('Observer failure'); }, () => Promise.reject(new Error('Async observer failure'))]) {
    const { memory, save } = fixture(onEvent);
    const record = await save();
    assert.equal(memory.active(scope)[0].id, record.id);
    assert.equal((await memory.forget({ recordId: record.id })).status, 'forgotten');
  }
  const events = [];
  const { save } = fixture(event => events.push(event)); await save();
  assert.equal(serialized(events).includes('green tea'), false);
  await new Promise(resolve => setImmediate(resolve));
});
