// Exact-passage selection tests only; no model, browser or token claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { extractAutomaticContext } from '../examples/browser-model-chat/memory/automatic-context.mjs';

const built = await buildCore();
const core = await import(pathToFileURL(built.corePath).href + '?sha256=' + built.sha256);
const hashText = async text => createHash('sha256').update(text, 'utf8').digest('hex');
const user = (id, content) => ({ id, role: 'user', content });
const extract = (turns, options = {}) => extractAutomaticContext(turns, { query: 'observing notebook code corrected Mars watch day', core, hashText, ...options });
const repeated = 'Please keep our earlier observing notebook code and corrected Mars watch day in mind.';
async function references(result, turns, excluded = []) {
  for (const item of result.items) {
    const original = turns.find(turn => turn.id === item.turnId);
    assert.equal(original.role, 'user'); assert.ok(!excluded.includes(item.turnId));
    assert.equal(item.quote, original.content.slice(item.offsets.start, item.offsets.end));
    assert.equal(item.turnHash, await hashText(original.content));
    assert.deepEqual(item.sourceRefs, [{ turnId: item.turnId, turnHash: item.turnHash, offsets: item.offsets, lineHash: await hashText(item.quote) }]);
  }
  assert.deepEqual(result.sources, await Promise.all(turns.map(async turn => ({ turnId: turn.id, contentHash: await hashText(turn.content) }))));
  assert.equal(result.contentHash, await hashText(result.text));
}

test('exact repeated instructions enter the real ranker once and leave room for authored code and corrected day', async () => {
  const turns = [user('t-0001', 'Our observing notebook code for the Mars watch is Cedar-17.'),
    user('t-0002', 'A correction to our plan: the Mars watch is on Tuesday, replacing Monday.'),
    ...Array.from({ length: 12 }, (_, index) => user('t-' + String(index + 3).padStart(4, '0'), repeated))];
  const mapped = [], wrapped = { RagEngine: core.RagEngine, recordFromMapping(value) { mapped.push(value); return core.recordFromMapping(value); } };
  const before = JSON.stringify(turns), result = await extract(turns, { core: wrapped });
  await references(result, turns);
  assert.equal(mapped.length, 3); assert.equal(mapped.filter(row => row.text === repeated).length, 1);
  assert.equal(result.items.filter(item => item.quote === repeated).length, 1);
  assert.match(result.text, /Cedar-17/); assert.match(result.text, /Tuesday/);
  assert.equal(result.items.find(item => item.quote === repeated).turnId, 't-0003');
  assert.equal(result.coverage.candidateCount, 14); assert.equal(result.coverage.uniqueCandidateCount, 3);
  assert.equal(result.coverage.duplicateCandidateCount, 11); assert.equal(result.coverage.omittedCandidateCount, 11);
  assert.equal(result.coverage.semanticSummary, false); assert.equal(result.coverage.completeConversation, false);
  assert.equal(JSON.stringify(turns), before); assert.deepEqual(await extract(turns, { core: wrapped }), result);
});

test('protected or assistant duplicates cannot become a primary reference or block an eligible copy', async () => {
  const quote = 'The observing notebook code is Cedar-17.';
  const turns = [user('protected', quote), { id: 'generated', role: 'assistant', content: quote },
    user('eligible', 'Unrelated introduction.\r\n\r\n' + quote), user('later-copy', quote)];
  const result = await extract(turns, { protectedTurnIds: ['protected'], query: 'observing notebook code' });
  await references(result, turns, ['protected', 'generated']);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].turnId, 'eligible');
  assert.equal(result.items[0].offsets.start, turns[2].content.indexOf(quote));
  assert.equal(result.coverage.protectedTurnCount, 1); assert.equal(result.coverage.ignoredAssistantTurnCount, 1);
  assert.equal(result.coverage.duplicateCandidateCount, 1);
  const excludedAll = await extract(turns, { protectedTurnIds: ['protected', 'eligible', 'later-copy'], query: 'observing notebook code' });
  assert.deepEqual(excludedAll.items, []); assert.doesNotMatch(excludedAll.text, /Cedar-17/);
});

test('deduplication is exact and preserves case, Unicode composition and internal whitespace', async () => {
  const quotes = ['The cafe\u0301 notebook is blue.', 'The caf\u00e9 notebook is blue.',
    'The cafe\u0301 notebook is Blue.', 'The cafe\u0301  notebook is blue.'];
  const turns = quotes.map((quote, index) => user('u-' + index, quote));
  turns.push(user('exact-copy', quotes[0]));
  const mapped = [], wrapped = { RagEngine: core.RagEngine, recordFromMapping(value) { mapped.push(value); return core.recordFromMapping(value); } };
  const result = await extract(turns, { core: wrapped, query: 'notebook blue' });
  await references(result, turns);
  assert.deepEqual(mapped.map(row => row.text), quotes);
  assert.equal(result.coverage.uniqueCandidateCount, 4); assert.equal(result.coverage.duplicateCandidateCount, 1);
  assert.ok(result.items.every(item => item.turnId !== 'exact-copy'));
});

test('weak newest fallback remains the newest eligible exact slice without a second identical ranked quote', async () => {
  const quote = 'The notebook is copper.';
  const turns = [user('earlier', quote), user('newest', quote)];
  const result = await extract(turns, { query: 'more notebook' });
  await references(result, turns);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].turnId, 'newest');
  assert.equal(result.coverage.newestFallbackUsed, true); assert.equal(result.coverage.duplicateCandidateCount, 1);
});

test('duplicate scans still obey the original candidate limit before deduplication', async () => {
  const turns = [user('too-many', 'Notebook. '.repeat(2049))];
  await assert.rejects(extract(turns), error => error.code === 'AUTOMATIC_CONTEXT_LIMIT' && /2048-candidate/.test(error.message));
});
