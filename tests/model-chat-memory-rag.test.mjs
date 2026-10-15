import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { createRetrieval } from '../examples/browser-model-chat/memory/rag-adapter.mjs';

const built = await buildCore();
const core = await import(pathToFileURL(built.corePath).href + '?sha256=' + built.sha256);
const repository = fileURLToPath(new URL('../', import.meta.url));
const scope = { actorId: 'operator-a', conversationId: 'conversation-a' };
const hash = text => createHash('sha256').update(text).digest('hex');
function fact(id = 'gate', text = 'The harbor gate opens at dawn.', changes = {}) {
  return { id, version: 1, text, contentHash: hash(text), sourceTurnIds: ['turn-authored-1'], scope: { ...scope },
    modelSafe: true, status: 'active', ...changes };
}
const search = (retrieval, records, query = 'When does the harbor gate open?', changes = {}) => retrieval.search({
  query, records, scope: { ...scope }, queryId: 'query-1', ...changes,
});

test('single ignored core bundle retains original source identities and imports no external package', async () => {
  assert.ok(built.corePath.endsWith(join('.artifacts', 'memory', 'rag-core.mjs')));
  const bytes = await readFile(built.corePath);
  assert.equal(bytes.length, built.bytes); assert.equal(hash(bytes), built.sha256);
  assert.ok(built.bytes > 1000 && built.bytes < 500000);
  assert.ok(built.sources.some(item => item.path === 'modules/browser-rag-ts/src/core/retrieval/engine.ts'));
  assert.ok(built.sources.some(item => item.path === 'modules/browser-rag-ts/src/application/contextPacket.ts'));
  assert.ok(!built.sources.some(item => /node_modules|graphRenderer|demo\//.test(item.path)));
  for (const source of built.sources) assert.equal(hash(await readFile(join(repository, source.path))), source.sha256, source.path);
  assert.equal(typeof core.RagEngine, 'function');
  await assert.rejects(buildCore({ output: 'memory-public.mjs' }), /\.artifacts\/memory/);
});

test('real existing core returns relevant authored evidence with matching query/context/source identities', async () => {
  const events = []; let validations = 0;
  const retrieval = createRetrieval({ core: { ...core, assertContextMatches(...args) { validations++; return core.assertContextMatches(...args); } }, onEvent: value => events.push(value) });
  const authored = fact(); const result = await search(retrieval, [authored]);
  assert.equal(validations, 1);
  assert.deepEqual(result.hits, [{ recordId: authored.id, version: 1, text: authored.text,
    contentHash: authored.contentHash, sourceTurnIds: authored.sourceTurnIds, scope }]);
  assert.equal(result.contextPacket.query_id, 'query-1');
  assert.equal(result.contextPacket.chunks[0].text, authored.text);
  assert.equal(result.contextPacket.chunks[0].id, 'memory:["gate",1]');
  assert.match(result.contextText, /Record: memory:\["gate",1\]/);
  assert.deepEqual(events, [{ type: 'recalled', queryId: 'query-1', scope, recordIds: ['gate'], versions: [1],
    sourceTurnIds: ['turn-authored-1'], selectedCount: 1, eligibleCount: 1, mode: 'keyword_only', term_gate: 'english-function-word-overlap-v1' }]);
});

test('unrelated negatives stay empty despite conversation-memory authority and provenance', async () => {
  const result = await search(createRetrieval({ core }), [fact()], 'flying violet whale');
  assert.deepEqual(result.hits, []); assert.deepEqual(result.contextPacket.chunks, []);
  assert.equal(result.contextPacket.estimated_tokens, 0);
});

test('English function words alone cannot retrieve delivery/codename facts for an unrelated question', async () => {
  const records = [fact('delivery', 'My delivery day is Tuesday.'), fact('codename', 'The codename is amber lantern.')];
  const retrieval = createRetrieval({ core });
  for (const query of ['What is the capital of France?', 'What is my unrelated planetary orbit?', 'is the my a an']) {
    const result = await search(retrieval, records, query);
    assert.deepEqual(result.hits, []); assert.deepEqual(result.contextPacket.chunks, []);
    assert.equal(result.contextPacket.estimated_tokens, 0);
    assert.equal(result.term_gate, 'english-function-word-overlap-v1');
  }
  const delivery = await search(retrieval, records, 'What is my delivery day?');
  assert.deepEqual(delivery.hits.map(hit => hit.recordId), ['delivery']);
  assert.deepEqual(delivery.contextPacket.chunks.map(chunk => chunk.id), ['memory:["delivery",1]']);
  const codename = await search(retrieval, records, 'Which codename is mine?');
  assert.deepEqual(codename.hits.map(hit => hit.recordId), ['codename']);
  assert.ok(delivery.contextPacket.estimated_tokens > 0);
});

test('correction chooses latest version before active filters even when older snapshots still say active', async () => {
  const previous = fact();
  const corrected = fact('gate', 'The harbor gate opens at noon.', { version: 2, sourceTurnIds: ['turn-correction-2'] });
  const retrieval = createRetrieval({ core });
  const result = await search(retrieval, [corrected, previous]);
  assert.equal(result.hits.length, 1); assert.equal(result.hits[0].version, 2);
  assert.equal(result.hits[0].text, corrected.text);
  assert.deepEqual(result.hits[0].sourceTurnIds, ['turn-correction-2']);
  assert.deepEqual((await search(retrieval, [previous, corrected], 'dawn')).hits, []);
});

test('forgotten latest tombstone cannot revive earlier active text', async () => {
  const forgotten = fact('gate', '', { version: 2, status: 'forgotten' });
  const result = await search(createRetrieval({ core }), [fact(), forgotten]);
  assert.deepEqual(result.hits, []); assert.deepEqual(result.contextPacket.chunks, []);
});

test('scope and model-safe checks fail closed without borrowing older accessible versions', async () => {
  const otherActor = fact('other-actor', 'The harbor gate opens at noon.', { scope: { ...scope, actorId: 'operator-b' } });
  const otherConversation = fact('other-chat', 'The harbor gate opens at noon.', { scope: { ...scope, conversationId: 'conversation-b' } });
  const unsafe = fact('unsafe', 'The harbor gate opens at noon.', { modelSafe: false });
  const noStatus = fact('unaccepted', 'The harbor gate opens at noon.', { status: 'proposed' });
  const retrieval = createRetrieval({ core });
  assert.deepEqual((await search(retrieval, [otherActor, otherConversation, unsafe, noStatus])).hits, []);
  const unsafeLatest = fact('gate', 'The harbor gate opens at noon.', { version: 2, modelSafe: false });
  assert.deepEqual((await search(retrieval, [fact(), unsafeLatest])).hits, []);
  const inaccessibleLatest = fact('gate', 'The harbor gate opens at noon.', { version: 3, scope: otherActor.scope });
  assert.deepEqual((await search(retrieval, [fact(), inaccessibleLatest])).hits, []);
});

test('maximum three hits are actual core-selected records with bounded source provenance', async () => {
  const records = Array.from({ length: 8 }, (_, index) => fact('beacon-' + index, 'Beacon reading number ' + index + '.', { sourceTurnIds: ['turn-' + index] }));
  const events = []; const result = await search(createRetrieval({ core, onEvent: event => events.push(event) }), records, 'beacon');
  assert.equal(result.hits.length, 3); assert.equal(result.contextPacket.chunks.length, 3);
  assert.equal(events[0].eligibleCount, 8); assert.equal(events[0].selectedCount, 3);
  for (const hit of result.hits) assert.deepEqual(hit, { recordId: hit.recordId, version: 1,
    text: records.find(item => item.id === hit.recordId).text,
    contentHash: records.find(item => item.id === hit.recordId).contentHash,
    sourceTurnIds: records.find(item => item.id === hit.recordId).sourceTurnIds, scope });
});

test('corrupted integrity/version/provenance and context mismatch emit no recall event', async () => {
  const events = [], retrieval = createRetrieval({ core, onEvent: event => events.push(event) });
  for (const records of [[fact('gate', 'The harbor gate opens at noon.', { contentHash: hash('different') })],
    [fact(), fact()], [fact('gate', 'The harbor gate opens at dawn.', { version: 0 })],
    [fact('gate', 'The harbor gate opens at dawn.', { sourceTurnIds: [] })],
    [fact('gate', ' The harbor gate opens at dawn.')]]) {
    await assert.rejects(search(retrieval, records), /Invalid memory retrieval/);
  }
  const rejectedPacket = createRetrieval({ core: { ...core, assertContextMatches() { throw Error('Rejected context identity'); } }, onEvent: event => events.push(event) });
  await assert.rejects(search(rejectedPacket, [fact()]), /Rejected context identity/);
  assert.deepEqual(events, []);
});

test('input and observer mutation cannot change accepted retrieval or later calls', async () => {
  const authored = fact();
  const retrieval = createRetrieval({ core, onEvent(event) { event.recordIds.length = 0; event.scope.actorId = 'mutated'; throw Error('Observer stopped'); } });
  const pending = search(retrieval, [authored]);
  authored.text = 'Mutated during async verification.'; authored.sourceTurnIds.push('mutated-source'); authored.scope.actorId = 'mutated';
  const result = await pending;
  assert.equal(result.hits[0].text, 'The harbor gate opens at dawn.');
  assert.deepEqual(result.hits[0].sourceTurnIds, ['turn-authored-1']); assert.deepEqual(result.hits[0].scope, scope);
  assert.equal((await search(retrieval, [fact()])).hits.length, 1);
});
