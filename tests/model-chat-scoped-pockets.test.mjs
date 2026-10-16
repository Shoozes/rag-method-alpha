import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { createConversationStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createScopedPockets } from '../examples/browser-model-chat/memory/scoped-pockets.mjs';

const built = await buildCore();
const core = await import(pathToFileURL(built.corePath).href + '?sha256=' + built.sha256);
const hash = text => createHash('sha256').update(text).digest('hex');
const starterFacts = [
  { id: 'earth-orbit', text: 'Earth orbits the Sun.', sourceURL: 'https://science.nasa.gov/earth/facts/' },
  { id: 'moon-orbit', text: 'The Moon orbits Earth.', sourceURL: 'https://science.nasa.gov/moon/facts/' },
];
async function fixture(options = {}) {
  const ownerScope = options.ownerScope ?? { actorId: 'actor-a', personaId: 'persona-a', conversationId: 'chat-a' };
  const conversation = options.conversation ?? createConversationStore(ownerScope);
  let scope = 'all', protectedTurns = [];
  const pockets = await createScopedPockets({ core, ownerScope, conversation, starterFacts,
    getActiveScope: () => scope, getProtectedTurnIds: () => protectedTurns, ...options });
  return { pockets, conversation, ownerScope, setScope: value => { scope = value; }, protect: value => { protectedTurns = value; } };
}
const user = (conversation, content = 'My project codename is Amber.') => conversation.append({ role: 'user', content });
const personaHits = async (pockets, query = 'project codename') => (await pockets.search({ query })).hits.filter(hit => hit.scope === 'persona');

test('actual core ranks only passed Global sources and explicit Persona excerpts in the active scope', async () => {
  let ranked = 0;
  class ObservedEngine extends core.RagEngine { search(...args) { ranked++; return super.search(...args); } }
  const f = await fixture({ core: { ...core, RagEngine: ObservedEngine } });
  user(f.conversation, 'An unsaved secret preference is violet.');
  assert.deepEqual((await f.pockets.search({ query: 'secret violet' })).hits, []);
  const turn = user(f.conversation), pinned = await f.pockets.pin({ turnId: turn.id, text: turn.content });
  assert.equal(ranked, 1);
  const hit = (await personaHits(f.pockets))[0];
  assert.equal(hit.id, 'persona:' + pinned.id); assert.equal(hit.role, 'user'); assert.equal(hit.text, turn.content);
  assert.deepEqual(hit.provenance.origin, pinned.origin); assert.ok(!('source' in hit.provenance));
  const global = (await f.pockets.search({ query: 'Earth Sun' })).hits[0];
  assert.equal(global.scope, 'global'); assert.equal(global.role, 'source'); assert.equal(global.provenance.sourceURL, starterFacts[0].sourceURL);
  for (const [scope, expected] of [['all', 3], ['global', 2], ['persona', 1], ['conversation', 0]]) {
    f.setScope(scope); assert.equal(f.pockets.snapshot().totalNodes, expected);
    const hits = (await f.pockets.search({ query: 'project Earth' })).hits;
    assert.ok(hits.every(hit => scope === 'all' || hit.scope === scope));
  }
  f.setScope('all');
  assert.equal((await f.pockets.search({ query: 'is the my a an' })).hits.length, 0);
  assert.equal((await f.pockets.search({ query: 'violet submarine' })).hits.length, 0);
});

test('pins preserve exact CRLF, emoji, decomposed Unicode, offsets and immutable owner/source hashes', async () => {
  const f = await fixture(), content = 'Opening\r\n🚀 cafe\u0301\r\nEnd';
  const turn = user(f.conversation, content), text = '🚀 cafe\u0301', start = content.indexOf(text);
  const record = await f.pockets.pin({ turnId: turn.id, text, offsets: { start, end: start + text.length, unit: 'utf16' } });
  assert.deepEqual(record.origin, { ...f.ownerScope, turnId: turn.id, turnHash: hash(content),
    offsets: { start, end: start + text.length, unit: 'utf16' }, lineHash: hash(text) });
  assert.equal(record.source.content, content); assert.equal(record.text, text);
  assert.equal((await f.pockets.search({ query: 'cafe\u0301' })).hits[0].text, text);
  assert.ok(Object.isFrozen(record.origin.offsets)); assert.ok(Object.isFrozen(f.pockets.ownerScope));
  assert.throws(() => { record.origin.offsets.start = 0; }, TypeError);
  const snapshot = f.pockets.snapshot(); assert.ok(Object.isFrozen(snapshot.nodes[0].provenance));
  const state = f.pockets.exportPersona(); const restored = await fixture({ conversation: f.conversation, personaState: state });
  assert.equal(restored.pockets.exportPersona(), state);
});

test('assistant text, fabricated spans, foreign owner and input mutation cannot become Persona memory', async () => {
  const f = await fixture(), assistant = f.conversation.append({ role: 'assistant', content: 'Invented codename Silver.' });
  await assert.rejects(f.pockets.pin({ turnId: assistant.id, text: assistant.content }), /user source/);
  const turn = user(f.conversation);
  for (const request of [{ turnId: turn.id, text: 'Silver' }, { turnId: turn.id, text: 'Amber', offsets: { start: 0, end: 5, unit: 'utf16' } }]) {
    await assert.rejects(f.pockets.pin(request), /offsets/);
  }
  const request = { turnId: turn.id, text: turn.content }, pending = f.pockets.pin(request);
  request.text = 'Changed by caller'; assert.equal((await pending).text, turn.content);
  await assert.rejects(fixture({ ownerScope: { ...f.ownerScope, actorId: 'actor-b' }, conversation: f.conversation }), /owner changed/);
  assert.equal(JSON.parse(f.pockets.exportPersona()).records.length, 1);
});

test('correction versions and forgotten tombstones survive reload without old text resurrection', async () => {
  const f = await fixture(), initial = user(f.conversation), original = await f.pockets.pin({ turnId: initial.id, text: initial.content });
  const correction = user(f.conversation, 'My project codename is Copper.');
  await assert.rejects(f.pockets.correct({ recordId: original.id, expectedVersion: 0, turnId: correction.id, text: correction.content }), /version conflict/);
  const updated = await f.pockets.correct({ recordId: original.id, expectedVersion: 1, turnId: correction.id, text: correction.content });
  assert.equal(updated.version, 2); assert.equal(updated.origin.turnId, correction.id);
  assert.equal((await personaHits(f.pockets, 'Amber')).length, 0); assert.equal((await personaHits(f.pockets, 'Copper'))[0].version, 2);
  await assert.rejects(f.pockets.forgetPersona({ recordId: original.id, expectedVersion: 1 }), /version conflict/);
  const forgotten = await f.pockets.forgetPersona({ recordId: original.id, expectedVersion: 2 });
  assert.equal(forgotten.version, 3); assert.equal(forgotten.text, '');
  const serialized = f.pockets.exportPersona(), restored = await fixture({ conversation: f.conversation, personaState: serialized });
  assert.equal(restored.pockets.exportPersona(), serialized); assert.equal((await personaHits(restored.pockets)).length, 0);
  assert.equal((await restored.pockets.forgetPersona({ recordId: original.id })).version, 3);
  await assert.rejects(restored.pockets.correct({ recordId: original.id, expectedVersion: 3, turnId: correction.id, text: correction.content }), /version conflict/);
});

test('same actor/persona can reuse proof across conversations, never across actors or personas', async () => {
  const f = await fixture(), turn = user(f.conversation); await f.pockets.pin({ turnId: turn.id, text: turn.content });
  const personaState = f.pockets.exportPersona(), ownerScope = { ...f.ownerScope, conversationId: 'chat-b' };
  const next = await fixture({ ownerScope, personaState });
  next.protect([turn.id]);
  const hit = (await next.pockets.search({ query: 'codename', purpose: 'prompt' })).hits[0];
  assert.equal(hit.provenance.origin.conversationId, 'chat-a'); assert.equal(next.pockets.ownerScope.conversationId, 'chat-b');
  for (const owner of [{ ...ownerScope, actorId: 'actor-b' }, { ...ownerScope, personaId: 'persona-b' }]) await assert.rejects(fixture({ ownerScope: owner, personaState }), /import owner/);
  const state = JSON.parse(personaState); state.owner = { personaId: 'persona-a', actorId: 'actor-a' };
  await fixture({ ownerScope, personaState: JSON.stringify(state) });
});

test('import rejects source, role, offsets, hash, origin, history and tombstone tampering', async () => {
  const f = await fixture(), turn = user(f.conversation); await f.pockets.pin({ turnId: turn.id, text: turn.content });
  const original = JSON.parse(f.pockets.exportPersona());
  const mutations = [state => { state.extra = true; }, state => { state.records[0].origin.personaId = 'other'; },
    state => { state.records[0].source.role = 'assistant'; }, state => { state.records[0].source.conversationId = 'other'; },
    state => { state.records[0].origin.offsets.start++; }, state => { state.records[0].origin.offsets.unit = 'codepoints'; },
    state => { state.records[0].origin.lineHash = '0'.repeat(64); }, state => { state.records[0].contentHash = '0'.repeat(64); },
    state => { state.records[0].version = 2; }, state => { state.records.push(structuredClone(state.records[0])); },
    state => { state.records[0].status = 'superseded'; }, state => { state.records[0].status = 'forgotten'; state.records[0].text = ''; state.records[0].contentHash = hash(''); },
    state => { const r = state.records[0]; r.source.content = 'Counterfeit user source.'; r.text = r.source.content; r.contentHash = hash(r.text);
      r.origin.turnHash = hash(r.source.content); r.origin.lineHash = hash(r.text); r.origin.offsets = { start: 0, end: r.text.length, unit: 'utf16' }; }];
  for (const mutate of mutations) {
    const state = structuredClone(original); mutate(state);
    await assert.rejects(fixture({ conversation: f.conversation, personaState: JSON.stringify(state) }), /Invalid scoped pocket/);
  }
  await f.pockets.forgetPersona({ recordId: 'p-0001' });
  const state = JSON.parse(f.pockets.exportPersona());
  state.records.push({ ...state.records[0], version: 3, status: 'active' });
  await assert.rejects(fixture({ conversation: f.conversation, personaState: JSON.stringify(state) }), /tombstone/);
});

test('Global disables are stable actor-owned tombstones and future starter packs cannot reseed removed IDs', async () => {
  const f = await fixture(); await f.pockets.removeGlobal({ recordId: 'earth-orbit' });
  const globalState = f.pockets.exportGlobal(), restored = await fixture({ globalState });
  assert.equal(restored.pockets.exportGlobal(), globalState); assert.equal((await restored.pockets.search({ query: 'Sun' })).hits.length, 0);
  const otherPersona = await fixture({ ownerScope: { ...f.ownerScope, personaId: 'persona-b' }, globalState });
  assert.equal(otherPersona.pockets.snapshot().totalNodes, 1);
  await assert.rejects(fixture({ ownerScope: { ...f.ownerScope, actorId: 'actor-b' }, globalState }), /global import owner/);
  const withoutPack = await fixture({ starterFacts: [], globalState });
  const reintroduced = await fixture({ globalState: withoutPack.pockets.exportGlobal() });
  assert.equal(reintroduced.pockets.snapshot().totalNodes, 1);
  await assert.rejects(f.pockets.removeGlobal({ recordId: 'not-a-source' }), /unknown global/);
  for (const sourceURL of ['http://nasa.gov/fact', 'https://nasa.gov.evil.invalid/fact', 'https://operator:password@nasa.gov/fact']) {
    await assert.rejects(fixture({ starterFacts: [{ ...starterFacts[0], sourceURL }] }), /NASA/);
  }
});

test('pending searches fail closed on scope, protected-source or record revision changes', async () => {
  const f = await fixture(), turn = user(f.conversation), record = await f.pockets.pin({ turnId: turn.id, text: turn.content });
  f.protect([turn.id]); assert.equal((await f.pockets.search({ query: 'codename', purpose: 'prompt' })).hits.length, 0);
  assert.equal((await personaHits(f.pockets)).length, 1); f.protect([]);
  let pending = f.pockets.search({ query: 'codename' }); f.setScope('global');
  await assert.rejects(pending, { code: 'SCOPED_POCKETS_CHANGED' }); f.setScope('all');
  pending = f.pockets.search({ query: 'codename', purpose: 'prompt' }); f.protect([turn.id]);
  await assert.rejects(pending, { code: 'SCOPED_POCKETS_CHANGED' }); f.protect([]);
  pending = f.pockets.search({ query: 'Earth' }); await f.pockets.removeGlobal({ recordId: 'earth-orbit' });
  await assert.rejects(pending, { code: 'SCOPED_POCKETS_CHANGED' });
  await f.pockets.forgetPersona({ recordId: record.id }); assert.equal((await personaHits(f.pockets)).length, 0);
});

test('snapshot windows prefer accepted IDs, preserve immutable values and do not mutate the core or caller data', async () => {
  const sources = structuredClone(starterFacts), before = JSON.stringify(sources), f = await fixture({ starterFacts: sources });
  sources[0].text = 'Changed later';
  const snapshot = f.pockets.snapshot({ preferredIds: ['persona:foreign', 'global:moon-orbit'], limit: 1 });
  assert.equal(snapshot.nodes[0].id, 'global:moon-orbit'); assert.equal(snapshot.totalNodes, 2);
  assert.equal(f.pockets.snapshot({ limit: 0 }).nodes.length, 0);
  assert.equal(f.pockets.snapshot().nodes[0].text, JSON.parse(before)[0].text);
  assert.equal((await f.pockets.search({ query: 'Earth' })).hits.length, 2);
  assert.equal(JSON.stringify(starterFacts), before);
  f.setScope('invalid'); assert.throws(() => f.pockets.snapshot(), /active scope/);
});

test('32 excerpt, 4000 UTF16 text and combined 256 KiB limits reject atomically', async () => {
  const f = await fixture(), turn = user(f.conversation);
  for (let i = 0; i < 32; i++) await f.pockets.pin({ turnId: turn.id, text: turn.content });
  let before = f.pockets.exportPersona();
  await assert.rejects(f.pockets.pin({ turnId: turn.id, text: turn.content }), /32 persona/); assert.equal(f.pockets.exportPersona(), before);
  const large = await fixture(), huge = user(large.conversation, 'ledger '.repeat(12800));
  for (let i = 0; i < 2; i++) await large.pockets.pin({ turnId: huge.id, text: 'ledger' });
  before = large.pockets.exportPersona();
  await assert.rejects(large.pockets.pin({ turnId: huge.id, text: 'ledger' }), /256 KiB/); assert.equal(large.pockets.exportPersona(), before);
  await assert.rejects(large.pockets.pin({ turnId: huge.id, text: huge.content.slice(0, 4001) }), /bounded/);
  await assert.rejects(fixture({ personaState: ' '.repeat(256 * 1024 + 1) }), /256 KiB/);
});

test('prompt search accepts the whole 4000-unit question and retrieves a long untruncated excerpt', async () => {
  const f = await fixture(), text = 'codename ' + 'ledger '.repeat(570), turn = user(f.conversation, text);
  await f.pockets.pin({ turnId: turn.id, text });
  const query = 'codename ' + 'context '.repeat(498) + 'checks!';
  assert.equal(query.length, 4000);
  const result = await f.pockets.search({ query, purpose: 'prompt' });
  assert.equal(result.queryHash, hash(query)); assert.equal(result.hits[0].text, text);
  await assert.rejects(f.pockets.search({ query, purpose: 'display' }), /bounded/);
  await assert.rejects(f.pockets.search({ query: query + 'x', purpose: 'prompt' }), /bounded/);
});

test('JSON source field order does not change origin binding, including historical tombstones', async () => {
  const f = await fixture(), turn = user(f.conversation); await f.pockets.pin({ turnId: turn.id, text: turn.content });
  await f.pockets.forgetPersona({ recordId: 'p-0001' });
  const state = JSON.parse(f.pockets.exportPersona());
  state.owner = { personaId: state.owner.personaId, actorId: state.owner.actorId };
  for (const record of state.records) record.source = { content: record.source.content, conversationId: record.source.conversationId,
    role: record.source.role, actorId: record.source.actorId, id: record.source.id };
  for (const conversationId of ['chat-a', 'chat-b']) {
    const restored = await fixture({ ownerScope: { ...f.ownerScope, conversationId },
      ...(conversationId === 'chat-a' ? { conversation: f.conversation } : {}), personaState: JSON.stringify(state) });
    assert.equal(restored.pockets.snapshot().nodes.filter(node => node.scope === 'persona').length, 0);
  }
});

test('different retained proofs cannot claim the same original conversation turn', async () => {
  const f = await fixture(), turn = user(f.conversation); await f.pockets.pin({ turnId: turn.id, text: turn.content });
  const state = JSON.parse(f.pockets.exportPersona()), second = structuredClone(state.records[0]);
  second.id = 'p-0002'; second.text = second.source.content = 'A conflicting authored source.';
  second.contentHash = second.origin.turnHash = second.origin.lineHash = hash(second.text);
  second.origin.offsets = { start: 0, end: second.text.length, unit: 'utf16' }; state.records.push(second);
  await assert.rejects(fixture({ ownerScope: { ...f.ownerScope, conversationId: 'chat-b' }, personaState: JSON.stringify(state) }), /inconsistent retained source/);
});
