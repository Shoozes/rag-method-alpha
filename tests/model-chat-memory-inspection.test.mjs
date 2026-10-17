// Existing keyword core only; no build, model, provider or extra retrieval pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRetrieval, inspectRetrievalResults } from '../examples/browser-model-chat/memory/rag-adapter.mjs';
import { createConversationIndex } from '../examples/browser-model-chat/memory/conversation-index.mjs';
import { createScopedPockets } from '../examples/browser-model-chat/memory/scoped-pockets.mjs';
import { createAutomaticMemory } from '../examples/browser-model-chat/memory/automatic-memory.mjs';
import { createConversationStore } from '../examples/browser-model-chat/memory/store.mjs';

const core = await import(pathToFileURL(resolve(process.env.BROWSER_MEMORY_CORE_MODULE?.trim() || '.artifacts/memory/rag-core.mjs')).href);
const hash = text => createHash('sha256').update(text).digest('hex');
const owner = { actorId: 'inspector-user', personaId: 'inspector-persona', conversationId: 'inspector-chat' };
function observed() {
  const responses = [];
  class ObservedEngine extends core.RagEngine {
    search(...args) { const result = super.search(...args); responses.push(result); return result; }
  }
  return { core: { ...core, RagEngine: ObservedEngine }, responses };
}
function assertScore(row, result) {
  assert.equal(row.score_micro, result.score_micro);
  assert.equal(row.keyword_micro, result.keyword_micro);
  assert.equal(row.components.keyword_micro, result.keyword_micro);
  assert.deepEqual(row.reasons, []);
  assert.equal('text' in row, false);
  assert.equal('record' in row, false);
}

test('inspection retains actual numeric fields, zero values and honest missing-score availability', () => {
  const actual = { score_micro: 0, keyword_micro: 2, exact_micro: 0, semantic_micro: NaN,
    invented_micro: 99, text: 'must not duplicate this payload' };
  const detail = inspectRetrievalResults([actual], () => ({ nodeId: 'turn:t-0001', sourceTurnIds: ['t-0001'] }));
  assert.equal(detail.candidates[0].score_micro, 0);
  assert.deepEqual(detail.candidates[0].components, { exact_micro: 0, keyword_micro: 2 });
  assert.equal(detail.availability.scores, 'available'); assert.equal(detail.availability.reason, null);
  assert.equal(Object.isFrozen(detail.candidates[0].sourceTurnIds), true);
  assert.doesNotMatch(JSON.stringify(detail), /must not duplicate|invented_micro/);
  const missing = inspectRetrievalResults([{ keyword_micro: 7, score_micro: Infinity }], () => ({ nodeId: 'unknown-score', sourceTurnIds: [] }));
  assert.equal(missing.candidates[0].score_micro, null); assert.equal(missing.candidates[0].keyword_micro, 7);
  assert.equal(missing.availability.scores, 'partial'); assert.ok(missing.availability.reason);
  const empty = inspectRetrievalResults([], () => { throw Error('No descriptors expected'); });
  assert.deepEqual(empty.candidates, []); assert.equal(empty.availability.scores, 'unavailable');
  assert.match(empty.coverage, /not exhaustive/);
});

test('saved retrieval appends score inspection without changing hits, context packet or search count', async () => {
  const seen = observed(), text = 'The copper harbor gate opens at dawn.';
  const scope = { actorId: owner.actorId, conversationId: owner.conversationId };
  const record = { id: 'harbor', version: 1, text, contentHash: hash(text), sourceTurnIds: ['t-0001'],
    scope, status: 'active', modelSafe: true };
  const result = await createRetrieval({ core: seen.core }).search({ queryId: 'query-inspection', query: 'copper harbor gate', records: [record], scope });
  assert.equal(seen.responses.length, 1);
  assert.deepEqual(result.hits, [{ recordId: record.id, version: 1, text, sourceTurnIds: record.sourceTurnIds, contentHash: record.contentHash, scope }]);
  assert.equal(result.contextPacket.chunks[0].text, text);
  const row = result.inspection.candidates[0]; assertScore(row, seen.responses[0].results[0]);
  assert.equal(row.nodeId, 'record:harbor'); assert.equal(row.recordId, 'harbor'); assert.equal(row.scope, 'conversation');
  assert.deepEqual(row.sourceTurnIds, ['t-0001']);
  assert.equal(result.contextText.includes('score_micro'), false);
});

test('conversation ranking exposes the existing score while preserving prompt-only source exclusions', async () => {
  const seen = observed(), conversation = createConversationStore(owner);
  const source = conversation.append({ role: 'user', content: 'The copper compass is in Bristol.' });
  const generated = conversation.append({ role: 'assistant', content: 'A generated copper answer.' });
  const latest = conversation.append({ role: 'user', content: 'Where is the copper compass?' });
  const before = conversation.exportState();
  const index = createConversationIndex({ core: seen.core, conversation, ownerScope: { kind: 'conversation', ...owner } });
  const result = await index.search({ query: latest.content, purpose: 'prompt', excludeTurnIds: [latest.id] });
  assert.equal(seen.responses.length, 1); assert.deepEqual(result.hits.map(hit => hit.turnId), [source.id]);
  assert.equal('score_micro' in result.hits[0], false);
  assertScore(result.inspection.candidates[0], seen.responses[0].results[0]);
  assert.deepEqual(result.inspection.candidates[0].sourceTurnIds, [source.id]);
  assert.equal(result.inspection.candidates.some(row => row.turnId === generated.id || row.turnId === latest.id), false);
  assert.equal(conversation.exportState(), before);
});

test('shared ranking keeps persona and public-source provenance distinct without inventing source turns', async () => {
  const seen = observed(), conversation = createConversationStore(owner);
  const turn = conversation.append({ role: 'user', content: 'My copper telescope tracks Earth orbit.' });
  const pockets = await createScopedPockets({ core: seen.core, conversation, ownerScope: owner,
    starterFacts: [{ id: 'earth', text: 'Earth orbits the Sun.', sourceURL: 'https://science.nasa.gov/earth/facts/' }] });
  const saved = await pockets.pin({ turnId: turn.id, text: turn.content });
  const result = await pockets.search({ query: 'copper Earth orbit', purpose: 'display' });
  assert.equal(seen.responses.length, 1); assert.equal(result.inspection.candidates.length, result.hits.length);
  for (const [index, row] of result.inspection.candidates.entries()) assertScore(row, seen.responses[0].results[index]);
  const persona = result.inspection.candidates.find(row => row.scope === 'persona');
  assert.equal(persona.nodeId, 'persona:' + saved.id); assert.deepEqual(persona.sourceTurnIds, [turn.id]);
  const global = result.inspection.candidates.find(row => row.scope === 'global');
  assert.equal(global.nodeId, 'global:earth'); assert.deepEqual(global.sourceTurnIds, []);
  assert.ok(result.hits.every(hit => !('score_micro' in hit)));
});

test('automatic inspection reports actual pre-first-three returns without extra search calls or prompt text', async () => {
  const seen = observed(), conversation = createConversationStore(owner), memory = { snapshot: () => ({ records: [] }) };
  for (let index = 0; index < 6; index++) conversation.append({ role: 'user', content: 'Copper compass detail ' + index });
  const latest = conversation.append({ role: 'user', content: 'Which copper compass orbit Earth?' });
  const automatic = await createAutomaticMemory({ core: seen.core, conversation, memory, ownerScope: owner });
  const before = conversation.exportState();
  const result = await automatic.prepareContext({ query: latest.content, excludeTurnId: latest.id });
  assert.equal(seen.responses.length, 2, 'existing conversation and shared searches only');
  assert.equal(result.hits.length, 3); assert.ok(result.inspection.candidates.length > result.hits.length);
  assert.ok(result.inspection.candidates.length <= 15);
  assert.deepEqual(result.inspection.selectedNodeIds, result.hits.map(hit => hit.nodeId));
  assert.equal(result.inspection.finalLimit, 3);
  assert.match(result.inspection.coverage, /no cross-source ranking/);
  assert.equal(result.inspection.availability.scores, 'available');
  const actual = seen.responses.flatMap(response => response.results);
  for (const [index, row] of result.inspection.candidates.entries()) assertScore(row, actual[index]);
  assert.equal(result.inspection.candidates.some(row => row.nodeId === 'turn:' + latest.id), false);
  assert.equal(conversation.exportState(), before);
  assert.equal(JSON.stringify(result.inspection).includes('Copper compass detail'), false);
  assert.equal(Object.isFrozen(result.inspection.candidates[0]), true);
});
