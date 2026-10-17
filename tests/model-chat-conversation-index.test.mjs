// Actual local keyword RAG, canonical transcript fixtures; no model/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';
import { createConversationStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createConversationIndex } from '../examples/browser-model-chat/memory/conversation-index.mjs';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';

const corePath = process.env.BROWSER_MEMORY_CORE_MODULE?.trim() || (await buildCore()).corePath;
const core = await import(pathToFileURL(resolve(corePath)).href);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const ownerScope = { kind: 'conversation', actorId: 'local-user', personaId: 'persona-cedar', conversationId: 'local-chat' };
function setup(options = {}) {
  const conversation = createConversationStore();
  const index = createConversationIndex({ conversation, core, ownerScope, ...options });
  return { conversation, index, append: (text, role = 'user') => conversation.append({ role, content: text }) };
}
function assertSources(hits, conversation) {
  const originals = conversation.snapshot().turns;
  for (const hit of hits) {
    const turn = originals.find(turn => turn.id === hit.turnId);
    assert.ok(turn); assert.equal(hit.nodeId, 'turn:' + turn.id); assert.equal(hit.role, turn.role);
    assert.equal(hit.offsets.unit, 'utf16'); assert.equal(hit.text, turn.content.slice(hit.offsets.start, hit.offsets.end));
    assert.equal(hit.turnHash, digest(turn.content)); assert.equal(hit.lineHash, digest(hit.text));
    assert.ok(hit.text.length <= 4000); assert.equal(hit.text.isWellFormed(), true);
    assert.equal('modelSafe' in hit, false); assert.equal('recordId' in hit, false);
  }
}

test('snapshot derives stable actual turn nodes, with older preferred hits and at most 12 nodes', () => {
  const { conversation, index, append } = setup();
  for (let n = 1; n <= 15; n++) append('Message ' + n, n % 2 ? 'user' : 'assistant');
  const before = conversation.exportState(), view = index.snapshot();
  assert.equal(view.nodes.length, 12); assert.equal(view.nodes[0].turnId, 't-0015');
  assert.equal(view.status.eligibleTurnCount, 15); assert.equal(view.status.omittedTurnCount, 3);
  const preferred = index.snapshot({ preferredTurnIds: ['t-0001', 't-0003', 't-9999'], limit: 3 });
  assert.deepEqual(preferred.nodes.map(node => node.turnId), ['t-0001', 't-0003', 't-0015']);
  assert.deepEqual(preferred.nodes.map(node => node.role), ['user', 'user', 'user']);
  assert.equal(preferred.nodes[0].nodeId, 'turn:t-0001'); assert.equal(preferred.nodes[0].text, 'Message 1');
  assert.equal(conversation.exportState(), before); assert.equal(Object.isFrozen(view.nodes[0].offsets), true);
  assert.throws(() => { view.nodes[0].text = 'invented'; }, TypeError);
});

test('display search returns explicitly labelled user and assistant sources; prompt excludes assistant and latest query', async () => {
  const { conversation, index, append } = setup();
  const user = append('The destination city is Bristol.');
  const assistant = append('The destination city could be Cardiff.', 'assistant');
  const query = append('Which destination city did we discuss?');
  const display = await index.search({ query: 'destination city' });
  assert.deepEqual(new Set(display.hits.map(hit => hit.turnId)), new Set([user.id, assistant.id, query.id]));
  assert.deepEqual(new Set(display.hits.map(hit => hit.role)), new Set(['user', 'assistant']));
  assertSources(display.hits, conversation);
  const prompt = await index.search({ query: query.content, purpose: 'prompt' });
  assert.deepEqual(prompt.hits.map(hit => hit.turnId), [user.id]); assertSources(prompt.hits, conversation);
  const excluded = await index.search({ query: 'city', excludeTurnIds: [user.id, assistant.id, query.id] });
  assert.deepEqual(excluded.hits, []);
});

test('blank, function-word-only and unrelated queries cannot manufacture matching sources', async () => {
  const { index, append } = setup(); append('Bristol has a harbour.');
  for (const query of ['', 'What is it?', 'please tell me about it', 'zyzzyva observatory']) {
    const result = await index.search({ query }); assert.deepEqual(result.hits, []); assert.equal(result.status.state, 'ready');
  }
  assert.equal((await index.search({ query: 'What is it?' })).status.meaningfulQueryTermCount, 0);
});

test('blocked sources leave graph and all search; protected originals remain display-only', async () => {
  let blocked = [], protectedIds = [];
  const { index, append } = setup({ getBlockedTurnIds: () => blocked, getProtectedTurnIds: () => protectedIds });
  const saved = append('The project city is Bristol.');
  const corrected = append('The project city is York.');
  const duplicate = append('The project city is Bristol.');
  protectedIds = [saved.id, corrected.id];
  assert.equal(index.snapshot().nodes.length, 3);
  assert.deepEqual(new Set((await index.search({ query: 'project city' })).hits.map(hit => hit.turnId)), new Set([saved.id, corrected.id, duplicate.id]));
  assert.deepEqual((await index.search({ query: 'project city', purpose: 'prompt' })).hits, []);
  blocked = [duplicate.id];
  assert.deepEqual(index.snapshot().nodes.map(node => node.turnId), [corrected.id, saved.id]);
  assert.deepEqual(new Set((await index.search({ query: 'project city' })).hits.map(hit => hit.turnId)), new Set([saved.id, corrected.id]));
  assert.deepEqual((await index.search({ query: 'project city', purpose: 'prompt' })).hits, []);
  blocked = [saved.id, corrected.id, duplicate.id];
  assert.deepEqual(index.snapshot().nodes, []); assert.deepEqual((await index.search({ query: 'Bristol' })).hits, []);
});

async function workspaceFixture(t) {
  const forbidden = () => { throw Error('Display/prompt retrieval must not call a model or tokenization adapter.'); };
  const workspace = await createWorkspace({ core, graphEnabled: false, adapter: { measure: forbidden, reply: forbidden } });
  t.after(() => workspace.dispose());
  return workspace;
}

test('saved hello original stays searchable for display without entering automatic prompt evidence', async t => {
  const workspace = await workspaceFixture(t), automatic = workspace.automaticMemory;
  const authored = workspace.conversation.append({ role: 'user', content: 'hello' });
  const generated = workspace.conversation.append({ role: 'assistant', content: 'hello from a generated reply' });
  const latest = workspace.conversation.append({ role: 'user', content: 'hello again' });
  const { actorId, conversationId } = workspace.ownerScope;
  const saved = await workspace.memory.save({ text: 'hello', sourceTurnIds: [authored.id], scope: { actorId, conversationId }, modelSafe: true });
  const display = await automatic.search({ query: 'hello' });
  assert.deepEqual(new Set(display.hits.map(hit => hit.turnId)), new Set([authored.id, generated.id, latest.id]));
  assertSources(display.hits, workspace.conversation);
  assert.ok(automatic.snapshot().nodes.some(node => node.id === 'turn:' + authored.id));
  assert.deepEqual((await automatic.prepareContext({ query: 'hello', excludeTurnId: latest.id })).hits, []);
  await workspace.memory.forget({ recordId: saved.id });
  assert.ok(!(await automatic.search({ query: 'hello' })).hits.some(hit => hit.turnId === authored.id));
  assert.ok(!automatic.snapshot().nodes.some(node => node.id === 'turn:' + authored.id));
  assert.deepEqual((await automatic.prepareContext({ query: 'hello', excludeTurnId: latest.id })).hits, []);
});

test('persona-pinned hello keeps its visible Conversation original searchable while prompt protection and forget remain intact', async t => {
  const workspace = await workspaceFixture(t), automatic = workspace.automaticMemory;
  const authored = workspace.conversation.append({ role: 'user', content: 'hello from the owner' });
  const generated = workspace.conversation.append({ role: 'assistant', content: 'hello from a generated reply' });
  const latest = workspace.conversation.append({ role: 'user', content: 'hello next question' });
  await automatic.pinPersona({ turnId: authored.id, text: authored.content });
  const all = await automatic.search({ query: 'hello' }), persona = all.hits.find(hit => hit.scope === 'persona');
  assert.ok(persona); assert.ok(all.hits.some(hit => hit.nodeId === 'turn:' + authored.id));
  const prompt = await automatic.prepareContext({ query: 'hello', excludeTurnId: latest.id });
  assert.deepEqual(prompt.hits.map(hit => hit.nodeId), [persona.nodeId]);
  assert.ok(prompt.hits.every(hit => hit.role !== 'assistant' && hit.nodeId !== 'turn:' + authored.id && hit.nodeId !== 'turn:' + latest.id));
  await automatic.setScope('conversation');
  const display = await automatic.search({ query: 'hello' });
  assert.deepEqual(new Set(display.hits.map(hit => hit.turnId)), new Set([authored.id, generated.id, latest.id]));
  assertSources(display.hits, workspace.conversation);
  assert.deepEqual((await automatic.prepareContext({ query: 'hello', excludeTurnId: latest.id })).hits, []);
  await automatic.forget(persona);
  assert.ok(!(await automatic.search({ query: 'hello' })).hits.some(hit => hit.turnId === authored.id));
  assert.ok(!automatic.snapshot().nodes.some(node => node.id === 'turn:' + authored.id));
});

test('reloading the canonical store recreates the same derived sources without duplicate persisted rows', async () => {
  const { conversation, index, append } = setup(); append('Copper lanterns hang beside the harbour.'); append('Understood.', 'assistant');
  const serialized = conversation.exportState(), original = await index.search({ query: 'Copper lanterns' });
  const restored = createConversationStore(); restored.importState(serialized);
  const next = createConversationIndex({ conversation: restored, core, ownerScope });
  assert.deepEqual(await next.search({ query: 'Copper lanterns' }), original);
  assert.deepEqual(next.snapshot(), index.snapshot()); assert.equal(restored.exportState(), serialized);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ['actorId', 'conversationId', 'schema', 'turns', 'version']);
});

test('exact Unicode and CRLF excerpt/hash references survive core normalization', async () => {
  const { conversation, index, append } = setup();
  const text = '  A compass points north.\r\nThe city is Brístol 😀, beside the river.\r\n  ';
  append(text);
  const result = await index.search({ query: 'Brístol river' });
  assert.equal(result.hits.length, 1); assertSources(result.hits, conversation);
  assert.equal(result.hits[0].text, text); assert.equal(result.hits[0].offsets.start, 0);
});

test('late matches use bounded exact UTF16 windows without broken surrogate pairs', async () => {
  const { conversation, index, append } = setup();
  append('😀'.repeat(2600) + ' copper ' + '😀'.repeat(2600));
  const result = await index.search({ query: 'copper' });
  assert.equal(result.hits.length, 1); assert.ok(result.hits[0].offsets.start > 4000);
  assert.equal(result.status.excerptedTurnCount, 1); assert.equal(index.snapshot().status.excerptedNodeCount, 1);
  assert.ok(result.hits[0].text.includes('copper')); assertSources(result.hits, conversation);
});

test('explicit Global/Persona selection excludes this conversation index and owner identity is immutable', async () => {
  let activeScope = 'all'; const suppliedOwner = { ...ownerScope };
  const { index, append } = setup({ ownerScope: suppliedOwner, getActiveScope: () => activeScope });
  append('Copper compass'); suppliedOwner.personaId = 'another-persona';
  assert.equal((await index.search({ query: 'copper' })).hits.length, 1);
  for (activeScope of ['global', 'persona']) {
    assert.deepEqual(index.snapshot().nodes, []); const result = await index.search({ query: 'copper' });
    assert.deepEqual(result.hits, []); assert.equal(result.status.state, 'inactive');
  }
  activeScope = 'conversation'; assert.equal(index.snapshot().nodes.length, 1);
  activeScope = 'invented'; assert.throws(() => index.snapshot(), /Unknown active/);
});

test('cross-actor/conversation bindings and changed persona envelopes reject rather than leak', async () => {
  for (const changed of [{ actorId: 'other' }, { conversationId: 'other' }]) {
    assert.throws(() => setup({ ownerScope: { ...ownerScope, ...changed } }), error => error.code === 'CONVERSATION_INDEX_SCOPE_CHANGED');
  }
  let currentOwner = { ...ownerScope };
  const { index, append } = setup({ getOwnerScope: () => currentOwner }); append('Copper compass');
  currentOwner = { ...ownerScope, personaId: 'other-persona' };
  assert.throws(() => index.snapshot(), error => error.code === 'CONVERSATION_INDEX_SCOPE_CHANGED');
  await assert.rejects(index.search({ query: 'copper' }), error => error.code === 'CONVERSATION_INDEX_SCOPE_CHANGED');
  assert.throws(() => setup({ ownerScope: { actorId: 'local-user', conversationId: 'local-chat' } }), /explicit bounded/);
});

test('owner scope drift at an asynchronous hash boundary rejects the prepared result', async () => {
  let currentOwner = { ...ownerScope };
  class ChangedEngine extends core.RagEngine {
    search(...args) { const result = super.search(...args); currentOwner = { ...ownerScope, personaId: 'other-persona' }; return result; }
  }
  const { index, append } = setup({ core: { ...core, RagEngine: ChangedEngine }, getOwnerScope: () => currentOwner }); append('Copper compass');
  await assert.rejects(index.search({ query: 'copper' }), error => error.code === 'CONVERSATION_INDEX_SCOPE_CHANGED');
});

test('policy, active scope and transcript changes at hash boundaries release no stale hits', async () => {
  for (const change of ['blocked', 'protected', 'active', 'append']) {
    let blocked = [], protectedIds = [], activeScope = 'all', store;
    class ChangedEngine extends core.RagEngine {
      search(...args) {
        const result = super.search(...args);
        if (change === 'blocked') blocked = ['t-0001'];
        if (change === 'protected') protectedIds = ['t-0001'];
        if (change === 'active') activeScope = 'global';
        if (change === 'append') store.append({ role: 'user', content: 'A later message.' });
        return result;
      }
    }
    const { conversation, index, append } = setup({ core: { ...core, RagEngine: ChangedEngine }, getBlockedTurnIds: () => blocked,
      getProtectedTurnIds: () => protectedIds, getActiveScope: () => activeScope });
    store = conversation; append('Copper compass');
    const result = await index.search({ query: 'copper' }); assert.deepEqual(result.hits, []); assert.equal(result.status.state, 'stale');
  }
});

test('512-turn and 512KiB overflow is explicit and never returns silently partial history', async () => {
  const turnLimited = setup();
  for (let n = 0; n < 512; n++) turnLimited.append('Copper ' + n);
  assert.equal(turnLimited.index.snapshot().status.state, 'ready'); turnLimited.append('Copper overflow');
  assert.deepEqual(turnLimited.index.snapshot().nodes, []); assert.equal(turnLimited.index.snapshot().status.reason, 'turn-scan-limit');
  assert.deepEqual((await turnLimited.index.search({ query: 'Copper' })).hits, []);
  const byteLimited = setup();
  for (let n = 0; n < 6; n++) byteLimited.append('a'.repeat(99_990) + ' copper');
  const view = byteLimited.index.snapshot(); assert.deepEqual(view.nodes, []); assert.equal(view.status.reason, 'byte-scan-limit');
  assert.ok(view.status.scanBytes > 512 * 1024); assert.deepEqual((await byteLimited.index.search({ query: 'Copper' })).hits, []);
});

test('invalid source envelopes, forged core hits and unbounded inputs are rejected', async () => {
  const { conversation, append } = setup(); append('Copper compass');
  const bad = structuredClone(conversation.snapshot()); bad.turns[0].actorId = 'other';
  const index = createConversationIndex({ conversation: { snapshot: () => bad }, core, ownerScope });
  assert.throws(() => index.snapshot(), /Invalid canonical/);
  const valid = setup(); valid.append('Copper compass');
  await assert.rejects(valid.index.search({ query: 'x'.repeat(4001) }), /bounded query/);
  await assert.rejects(valid.index.search({ query: 'copper', purpose: 'admit' }), /display\/prompt/);
  assert.throws(() => valid.index.snapshot({ limit: 13 }), /between 1 and 12/);
  class ForgedEngine { search() { return { results: [{ record: { id: 'turn:invented' }, has_retrieval_signal: true, keyword_micro: 1 }] }; } }
  const forged = setup({ core: { ...core, RagEngine: ForgedEngine } }); forged.append('Copper compass');
  await assert.rejects(forged.index.search({ query: 'copper' }), /unknown or unsignaled/);
});
