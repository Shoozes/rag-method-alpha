// Real local workspace + keyword RAG. The provider/meter below are NONNATIVE
// deterministic fixtures; these tests make no inference or token-accuracy claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace, storageKey, workspaceStorageKey } from '../examples/browser-model-chat/memory/workspace.mjs';
import { SPACE_STARTER_FACTS } from '../examples/browser-model-chat/memory/starter-facts.mjs';

const core = await import(pathToFileURL(resolve(process.env.BROWSER_MEMORY_CORE_MODULE?.trim() || '.artifacts/memory/rag-core.mjs')).href);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const scope = workspace => ({ actorId: workspace.ownerScope.actorId, conversationId: workspace.ownerScope.conversationId });
const append = (workspace, content, role = 'user') => workspace.conversation.append({ role, content });
const messagesText = prepared => prepared.messages.map(message => message.content).join('\n');
const conversationNodes = workspace => workspace.automaticMemory.snapshot().nodes.filter(node => node.scope === 'conversation');
function localStorageFixture() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
async function fixture(t, options = {}) {
  const calls = { measures: [], sends: [], order: [] };
  const adapter = {
    fixture: 'NONNATIVE: fixed meter and fixed reply; no model execution',
    async measure(messages) {
      calls.order.push('fixture-measure'); calls.measures.push(structuredClone(messages));
      return { promptTokens: 300, contextTokens: 2048, overflow: false };
    },
    async reply(messages, request = {}) {
      calls.order.push('fixture-beforeDispatch'); await request.beforeDispatch?.();
      calls.order.push('fixture-send'); calls.sends.push(structuredClone(messages));
      await request.onDispatch?.(); calls.order.push('fixture-onDispatch');
      return 'NONNATIVE FIXTURE response';
    },
  };
  const storage = options.storage ?? localStorageFixture();
  const workspace = await createWorkspace({ adapter, core, storage, ...options });
  t.after(() => workspace.dispose());
  return { workspace, storage, calls };
}
function sourceProof(hit, workspace) {
  const turn = workspace.conversation.snapshot().turns.find(turn => turn.id === hit.turnId);
  assert.ok(turn); assert.equal(turn.role, 'user'); assert.equal(hit.role, 'user');
  assert.equal(hit.turnHash, sha(turn.content)); assert.equal(hit.text, turn.content.slice(hit.offsets.start, hit.offsets.end));
  assert.equal(hit.lineHash, sha(hit.text)); assert.equal(hit.offsets.unit, 'utf16');
}

test('unmarked older Fred is retrieved with exact sources before any capacity crossing', async t => {
  const { workspace, calls } = await fixture(t);
  const authored = append(workspace, 'My name is Fred.');
  append(workspace, 'Acknowledged.', 'assistant'); append(workspace, 'What is my name?');
  const prepared = await workspace.prepare();
  assert.equal(prepared.compaction, null); assert.equal(calls.measures.length, 1); assert.equal(calls.sends.length, 0);
  const hit = prepared.memorySources.find(hit => hit.turnId === authored.id);
  assert.ok(hit); sourceProof(hit, workspace); assert.match(hit.text, /Fred/);
  assert.match(prepared.messages[0].content, /Source-linked memory excerpts/);
  assert.match(prepared.messages[0].content, /quoted user words/); assert.match(prepared.messages[0].content, /Fred/);
  assert.equal(workspace.memory.snapshot().records.length, 0, 'automatic retrieval does not admit a saved fact');
});

test('a late unmarked fact remains in the selected prompt excerpt instead of an unrelated prefix', async t => {
  const { workspace } = await fixture(t);
  const authored = append(workspace, 'Ordinary notebook entry. '.repeat(80) + '\nMy name is Fred.');
  append(workspace, 'What is my name?');
  assert.equal(conversationNodes(workspace).find(node => node.turnId === authored.id).text, authored.content, 'contextual details expose the full canonical message');
  const prepared = await workspace.prepare();
  const hit = prepared.memorySources.find(hit => hit.turnId === authored.id);
  assert.ok(hit); sourceProof(hit, workspace); assert.match(hit.text, /My name is Fred\./);
  assert.match(prepared.messages[0].content, /Fred/); assert.equal(prepared.compaction, null);
});

test('assistant messages are display-searchable and role labelled but never automatic prompt evidence', async t => {
  const { workspace } = await fixture(t);
  const model = append(workspace, 'The unique response code is violetcapybara.', 'assistant');
  const latest = append(workspace, 'What is the violetcapybara response code?');
  const display = await workspace.automaticMemory.search({ query: 'violetcapybara' });
  assert.ok(display.hits.some(hit => hit.turnId === model.id && hit.role === 'assistant'));
  const prepared = await workspace.prepare();
  assert.equal(prepared.memorySources.some(hit => hit.turnId === model.id || hit.turnId === latest.id), false);
  assert.equal(prepared.extractiveSources.some(source => source.turnId === model.id || source.turnId === latest.id), false);
  assert.ok(prepared.messages.some(message => message.role === 'assistant' && /violetcapybara/.test(message.content)), 'ordinary recent transcript retains its assistant role');
});

test('graph nodes and links derive only from accepted messages; prompt query is excluded from retrieval', async t => {
  const { workspace } = await fixture(t);
  const first = append(workspace, 'Fred collects copper compasses.');
  const second = append(workspace, 'Understood.', 'assistant');
  const query = append(workspace, 'What does Fred collect?');
  const view = workspace.automaticMemory.snapshot(), canonical = workspace.conversation.snapshot().turns;
  assert.deepEqual(new Set(conversationNodes(workspace).map(node => node.turnId)), new Set(canonical.map(turn => turn.id)));
  assert.ok(view.links.every(link => [first.id, second.id, query.id].includes(link.source.slice(5)) && canonical.some(turn => 'turn:' + turn.id === link.target)));
  const prepared = await workspace.prepare();
  assert.ok(prepared.memorySources.some(hit => hit.turnId === first.id));
  assert.equal(prepared.memorySources.some(hit => hit.turnId === query.id), false);
  assert.deepEqual(workspace.automaticMemory.snapshot().usedNodeIds, []);
});

test('Global starts with exactly three sourced NASA facts and inserts no conversation turns', async t => {
  const { workspace } = await fixture(t);
  await workspace.automaticMemory.setScope('global');
  const nodes = workspace.automaticMemory.snapshot().nodes;
  assert.equal(nodes.length, 3); assert.deepEqual(nodes.map(node => node.text).sort(), SPACE_STARTER_FACTS.map(fact => fact.text).sort());
  assert.ok(nodes.every(node => node.scope === 'global' && node.role === 'source' && new URL(node.sourceURL).hostname.endsWith('nasa.gov')));
  assert.deepEqual(workspace.conversation.snapshot().turns, []); assert.deepEqual(workspace.events.list(), []);
});

test('Global/Persona/Conversation selection strictly filters actual sources', async t => {
  const { workspace } = await fixture(t);
  const authored = append(workspace, 'Fred studies the moons of Mars.');
  await workspace.automaticMemory.pinPersona({ turnId: authored.id, text: authored.content });
  const independent = append(workspace, 'A separate unpinned observation: Fred sketches the moons of Mars.');
  for (const selected of ['global', 'persona', 'conversation']) {
    await workspace.automaticMemory.setScope(selected);
    assert.ok(workspace.automaticMemory.snapshot().nodes.every(node => node.scope === selected));
    const result = await workspace.automaticMemory.search({ query: 'Mars moons Fred' });
    assert.ok(result.hits.length > 0); assert.ok(result.hits.every(hit => hit.scope === selected));
    if (selected === 'conversation') {
      assert.deepEqual(result.hits.map(hit => hit.turnId), [independent.id]);
      assert.equal(result.hits.some(hit => hit.turnId === authored.id), false, 'Persona-owned origin is protected from derived conversation search');
      assert.ok(conversationNodes(workspace).some(node => node.turnId === authored.id), 'the original canonical graph node remains visible');
    }
    if (selected === 'persona') assert.deepEqual(result.hits.map(hit => hit.provenance.origin.turnId), [authored.id]);
  }
  await workspace.automaticMemory.setScope('all');
  assert.deepEqual(new Set(workspace.automaticMemory.snapshot().nodes.map(node => node.scope)), new Set(['global', 'persona', 'conversation']));
});

test('same-persona pins reopen in another chat with origin proof and a separate canonical transcript', async t => {
  const storage = localStorageFixture();
  const { workspace } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'first-chat' });
  const origin = append(workspace, 'My name is Fred.');
  assert.equal((await workspace.automaticMemory.pinPersona({ turnId: origin.id, text: origin.content })).durable, true);
  const { workspace: next } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'second-chat' });
  assert.deepEqual(next.conversation.snapshot().turns, []);
  await next.automaticMemory.setScope('persona');
  const pin = next.automaticMemory.snapshot().nodes[0];
  assert.equal(pin.text, origin.content); assert.equal(pin.provenance.origin.conversationId, 'first-chat');
  assert.equal(pin.provenance.origin.turnHash, sha(origin.content)); assert.equal(pin.provenance.origin.lineHash, sha(origin.content));
  assert.equal('turnId' in pin, false, 'an external origin is not a current-chat anchor');
  append(next, 'What is my name?');
  const prepared = await next.prepare(); assert.ok(prepared.memorySources.some(hit => hit.scope === 'persona' && hit.text.includes('Fred')));
  assert.deepEqual(next.conversation.snapshot().turns.map(turn => turn.content), ['What is my name?']);
});

test('Persona correction retains exact versioned source proof and reopens only the active version', async t => {
  const storage = localStorageFixture();
  const { workspace } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'first-chat' });
  const first = append(workspace, 'My name is Fred.');
  await workspace.automaticMemory.pinPersona({ turnId: first.id, text: first.content });
  const corrected = append(workspace, 'My name is Ada.');
  await workspace.automaticMemory.correctPersona({ recordId: 'p-0001', expectedVersion: 1, turnId: corrected.id, text: corrected.content });
  await assert.rejects(workspace.automaticMemory.correctPersona({ recordId: 'p-0001', expectedVersion: 1, turnId: first.id, text: first.content }), /version conflict/);
  const retained = JSON.parse(workspace.automaticMemory.exportPersona()).records;
  assert.deepEqual(retained.map(record => [record.version, record.status]), [[1, 'superseded'], [2, 'active']]);
  const { workspace: restored } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'second-chat' });
  await restored.automaticMemory.setScope('persona');
  const result = await restored.automaticMemory.search({ query: 'name' });
  assert.deepEqual(result.hits.map(hit => hit.text), [corrected.content]); assert.equal(result.hits[0].version, 2);
  assert.equal(result.hits[0].provenance.origin.turnId, corrected.id);
  assert.equal(result.hits[0].provenance.origin.turnHash, sha(corrected.content));
  append(restored, 'What is my name?');
  const prepared = await restored.prepare(); assert.match(messagesText(prepared), /Ada/); assert.doesNotMatch(messagesText(prepared), /Fred/);
});

test('other personas/actors cannot read pins and other conversations cannot read unpinned transcript', async t => {
  const storage = localStorageFixture();
  const { workspace } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'first-chat' });
  const source = append(workspace, 'Fred keeps a copper compass.');
  await workspace.automaticMemory.pinPersona({ turnId: source.id, text: source.content });
  for (const changed of [{ personaId: 'birch', conversationId: 'first-chat' }, { actorId: 'other-user', personaId: 'cedar', conversationId: 'first-chat' }]) {
    const { workspace: other } = await fixture(t, { storage, ...changed });
    assert.deepEqual(other.conversation.snapshot().turns, []);
    assert.deepEqual((await other.automaticMemory.search({ query: 'Fred compass' })).hits, []);
    assert.equal(other.automaticMemory.snapshot().nodes.some(node => node.scope === 'persona'), false);
  }
  const { workspace: otherChat } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'another-chat' });
  await otherChat.automaticMemory.setScope('conversation');
  assert.deepEqual(otherChat.automaticMemory.snapshot().nodes, []);
  assert.deepEqual((await otherChat.automaticMemory.search({ query: 'Fred compass' })).hits, []);
  const wrongOwner = { actorId: 'local-user', personaId: 'birch', conversationId: 'first-chat' };
  storage.setItem(workspaceStorageKey(wrongOwner), storage.getItem(workspaceStorageKey(workspace.ownerScope)));
  await assert.rejects(createWorkspace({ adapter: {}, core, storage, ...wrongOwner }), /another memory scope/);
});

test('default legacy v1 snapshots migrate without inventing events or source turns', async t => {
  const storage = localStorageFixture();
  const { workspace: old } = await fixture(t, { storage, automaticMemoryEnabled: false });
  const source = append(old, 'My name is Fred.');
  await old.memory.save({ text: source.content, sourceTurnIds: [source.id], scope: scope(old), modelSafe: true });
  await old.persist();
  const legacy = JSON.parse(storage.getItem(storageKey)); delete legacy.owner; delete legacy.answerCitations; delete legacy.automaticMemoryPolicy;
  storage.setItem(storageKey, JSON.stringify(legacy));
  const { workspace: restored } = await fixture(t, { storage });
  assert.ok(restored.automaticMemory); assert.deepEqual(restored.events.list(), old.events.list());
  assert.deepEqual(restored.conversation.snapshot(), old.conversation.snapshot());
  assert.deepEqual(restored.memory.snapshot(), old.memory.snapshot()); assert.equal(restored.automaticMemory.getScope(), 'all');
  await restored.persist(); assert.deepEqual(JSON.parse(storage.getItem(storageKey)).owner, restored.ownerScope);
});

test('message Forget, persona Forget and Global removal persist without source resurrection', async t => {
  const storage = localStorageFixture();
  const { workspace } = await fixture(t, { storage });
  const pinned = append(workspace, 'Fred owns a copper compass.');
  const separate = append(workspace, 'The expedition code is amberotter.');
  await workspace.automaticMemory.pinPersona({ turnId: pinned.id, text: pinned.content });
  await workspace.automaticMemory.forget(workspace.automaticMemory.snapshot().nodes.find(node => node.scope === 'persona'));
  await workspace.automaticMemory.forget(conversationNodes(workspace).find(node => node.turnId === separate.id));
  await workspace.automaticMemory.setScope('global');
  const mars = workspace.automaticMemory.snapshot().nodes.find(node => /Mars/.test(node.text));
  await workspace.automaticMemory.forget(mars); await workspace.automaticMemory.setScope('all');
  const { workspace: restored } = await fixture(t, { storage });
  assert.equal(restored.automaticMemory.snapshot().nodes.some(node => node.scope === 'persona' || node.turnId === pinned.id || node.turnId === separate.id), false);
  assert.deepEqual((await restored.automaticMemory.search({ query: 'Fred compass amberotter Mars' })).hits, []);
  assert.equal(restored.automaticMemory.snapshot().nodes.filter(node => node.scope === 'global').length, 2);
  append(restored, 'What were Fred and amberotter?');
  const prepared = await restored.prepare(); assert.equal(prepared.memorySources.length, 0);
  assert.doesNotMatch(prepared.messages[0].content, /copper compass|expedition code|Phobos/);
  assert.deepEqual(restored.conversation.snapshot().turns.slice(0, 2).map(turn => turn.content), [pinned.content, separate.content]);
});

test('saved-record correction/forget protects every manual source from automatic search and compaction', async t => {
  const { workspace, storage } = await fixture(t);
  const first = append(workspace, 'My name is Fred.');
  const saved = await workspace.memory.save({ text: first.content, sourceTurnIds: [first.id], scope: scope(workspace), modelSafe: true });
  append(workspace, 'Your name is Fred.', 'assistant');
  const correction = append(workspace, 'My name is Ada.');
  await workspace.memory.correct({ recordId: saved.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  append(workspace, 'What is my name?');
  let prepared = await workspace.prepare();
  assert.deepEqual(prepared.evidence.map(hit => hit.text), [correction.content]); assert.doesNotMatch(messagesText(prepared), /Fred/);
  assert.equal(prepared.memorySources.some(hit => [first.id, correction.id].includes(hit.turnId)), false);
  await workspace.memory.forget({ recordId: saved.id }); append(workspace, 'Please tell me my name.');
  prepared = await workspace.prepare(); assert.deepEqual(prepared.evidence, []); assert.doesNotMatch(messagesText(prepared), /Fred|Ada/);
  await workspace.persist(); const { workspace: restored } = await fixture(t, { storage });
  assert.equal((await restored.automaticMemory.search({ query: 'Fred Ada name' })).hits.some(hit => [first.id, correction.id].includes(hit.turnId)), false);
});

test('scope/forget mutations invalidate a prepared dispatch and used glow changes only at the fixture send boundary', async t => {
  const { workspace, calls } = await fixture(t);
  const source = append(workspace, 'Fred owns a copper compass.'); append(workspace, 'What does Fred own?');
  let prepared = await workspace.prepare(); assert.deepEqual(workspace.automaticMemory.snapshot().usedNodeIds, []);
  workspace.context.validateDispatch(prepared.messages); assert.deepEqual(workspace.automaticMemory.snapshot().usedNodeIds, []);
  await workspace.automaticMemory.setScope('conversation');
  await assert.rejects(workspace.provider.reply(prepared.messages), /no longer matches/); assert.equal(calls.sends.length, 0);
  prepared = await workspace.prepare();
  await workspace.automaticMemory.forget(conversationNodes(workspace).find(node => node.turnId === source.id));
  await assert.rejects(workspace.provider.reply(prepared.messages), /no longer matches/); assert.equal(calls.sends.length, 0);
  const fresh = append(workspace, 'Fred now owns a silver compass.'); append(workspace, 'What does Fred own now?');
  prepared = await workspace.prepare(); await workspace.provider.reply(prepared.messages);
  assert.equal(calls.sends.length, 1); assert.ok(workspace.automaticMemory.snapshot().usedNodeIds.includes('turn:' + fresh.id));
  assert.equal(workspace.events.list().filter(event => event.type === 'context-dispatched').length, 1);
  assert.deepEqual(calls.order.slice(-3), ['fixture-beforeDispatch', 'fixture-send', 'fixture-onDispatch']);
  await assert.rejects(workspace.provider.reply(prepared.messages), /no longer matches/); assert.equal(calls.sends.length, 1);
});

test('storage failure and local scan/persona caps report honestly without dropping canonical messages', async t => {
  const quota = { getItem: () => null, setItem() { throw Error('FIXTURE storage quota exceeded'); } };
  const { workspace } = await fixture(t, { storage: quota });
  append(workspace, 'Fred owns a compass.');
  const persistence = await workspace.persist(); assert.equal(persistence.durable, false); assert.match(persistence.error, /quota/);
  assert.equal((await workspace.automaticMemory.setScope('conversation')).durable, false);
  for (let n = 1; n < 513; n++) append(workspace, 'Accepted message ' + n);
  assert.equal(workspace.automaticMemory.snapshot().status.state, 'limit');
  await assert.rejects(workspace.prepare(), /limit|bound/); assert.equal(workspace.conversation.snapshot().turns.length, 513);
  const { workspace: capped } = await fixture(t);
  for (let n = 0; n < 32; n++) {
    const source = append(capped, 'A pin with source number ' + n + '.');
    await capped.automaticMemory.pinPersona({ turnId: source.id, text: source.content });
  }
  const extra = append(capped, 'The 33rd pin must not be silently admitted.');
  await assert.rejects(capped.automaticMemory.pinPersona({ turnId: extra.id, text: extra.content }), /32 persona/);
  assert.equal(JSON.parse(capped.automaticMemory.exportPersona()).records.length, 32);
  assert.equal(capped.conversation.snapshot().turns.length, 33);
});

test('restore, display search, pinning and scope changes never call the fixture provider or meter automatically', async t => {
  const { workspace, calls, storage } = await fixture(t);
  const source = append(workspace, 'Fred owns a copper compass.');
  await workspace.automaticMemory.search({ query: 'compass' });
  await workspace.automaticMemory.pinPersona({ turnId: source.id, text: source.content });
  await workspace.automaticMemory.setScope('persona'); await workspace.persist();
  assert.deepEqual(calls.measures, []); assert.deepEqual(calls.sends, []);
  const { workspace: restored, calls: restoredCalls } = await fixture(t, { storage });
  assert.deepEqual(restored.conversation.snapshot(), workspace.conversation.snapshot());
  assert.deepEqual(restoredCalls.measures, []); assert.deepEqual(restoredCalls.sends, []);
  append(restored, 'What does Fred own?'); await restored.prepare();
  assert.equal(restoredCalls.measures.length, 1); assert.deepEqual(restoredCalls.sends, []);
});

test('forgetting corrected Persona history excludes every Amber/Copper origin from All search and first reload prompt', async t => {
  const { workspace, storage } = await fixture(t);
  const first = append(workspace, 'The expedition codename is Amber.');
  await workspace.automaticMemory.pinPersona({ turnId: first.id, text: first.content });
  const correction = append(workspace, 'The expedition codename is Copper.');
  await workspace.automaticMemory.correctPersona({ recordId: 'p-0001', expectedVersion: 1, turnId: correction.id, text: correction.content });
  const correctedSearch = await workspace.automaticMemory.search({ query: 'expedition codename' });
  assert.deepEqual(correctedSearch.hits.map(hit => [hit.scope, hit.text]), [['persona', correction.content]]);
  const pin = workspace.automaticMemory.snapshot().nodes.find(node => node.scope === 'persona');
  await workspace.automaticMemory.forget(pin);
  append(workspace, 'What is the expedition codename?'); await workspace.persist();
  const { workspace: restored } = await fixture(t, { storage });
  assert.equal(restored.automaticMemory.getScope(), 'all');
  const hits = (await restored.automaticMemory.search({ query: 'expedition codename Amber Copper' })).hits;
  assert.equal(hits.some(hit => [first.id, correction.id].includes(hit.turnId) || hit.scope === 'persona' || /Amber|Copper/.test(hit.text)), false);
  const prepared = await restored.prepare();
  assert.doesNotMatch(messagesText(prepared), /Amber|Copper/);
  assert.equal(prepared.memorySources.some(hit => [first.id, correction.id].includes(hit.turnId)), false);
  assert.equal([...prepared.contextSources, ...prepared.extractiveSources].some(source => [first.id, correction.id].includes(source.turnId)), false);
  assert.equal((restored.context.snapshot().compacted?.items ?? []).some(item => [first.id, correction.id].includes(item.turnId)), false);
  assert.deepEqual(restored.conversation.snapshot().turns.slice(0, 2).map(turn => turn.content), [first.content, correction.content]);
});

test('first prepare after message Forget reload excludes the original and its old assistant echo from the raw tail', async t => {
  const { workspace, storage } = await fixture(t);
  const source = append(workspace, 'The access phrase is cobalt heron.');
  const echo = append(workspace, 'I will remember that the access phrase is cobalt heron.', 'assistant');
  append(workspace, 'What is the access phrase?');
  await workspace.automaticMemory.forget(conversationNodes(workspace).find(node => node.turnId === source.id));
  await workspace.persist();
  const { workspace: restored, calls } = await fixture(t, { storage });
  assert.equal(calls.measures.length, 0);
  const prepared = await restored.prepare();
  assert.equal(calls.measures.length, 1); assert.equal(prepared.compaction, null, 'the fixed meter did not cause a capacity crossing');
  assert.doesNotMatch(messagesText(prepared), /cobalt heron/);
  assert.equal(prepared.messages.some(message => message.content === source.content || message.content === echo.content), false);
  assert.equal(prepared.memorySources.some(hit => hit.turnId === source.id || hit.turnId === echo.id), false);
  assert.equal(prepared.extractiveSources.some(item => item.turnId === source.id || item.turnId === echo.id), false);
  assert.deepEqual(restored.conversation.snapshot().turns.slice(0, 2).map(turn => turn.content), [source.content, echo.content]);
});

test('a stale workspace cannot overwrite shared Persona/Global tombstones or retrieve/dispatch their old contents', async t => {
  const storage = localStorageFixture();
  const { workspace: a } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'chat-a' });
  const source = append(a, 'Fred owns a copper compass.');
  await a.automaticMemory.pinPersona({ turnId: source.id, text: source.content });
  const { workspace: b, calls } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'chat-b' });
  append(b, 'What does Fred own?'); const before = await b.prepare();
  const oldPin = a.automaticMemory.snapshot().nodes.find(node => node.scope === 'persona');
  await a.automaticMemory.setScope('global');
  await a.automaticMemory.forget(a.automaticMemory.snapshot().nodes.find(node => /Mars/.test(node.text)));
  await a.automaticMemory.setScope('all'); await a.automaticMemory.forget(oldPin);
  const personaKey = 'private-persona-memory-v1:' + JSON.stringify(['local-user', 'cedar']);
  const globalKey = 'private-global-memory-v1:' + JSON.stringify(['local-user']);
  const retainedPersona = storage.getItem(personaKey), retainedGlobal = storage.getItem(globalKey);
  assert.equal(JSON.parse(retainedPersona).records.at(-1).status, 'forgotten');
  assert.ok(JSON.parse(retainedGlobal).disabledIds.includes('starter-space-mars-moons'));
  await assert.rejects(b.provider.reply(before.messages), /Shared memory changed|Reload/); assert.deepEqual(calls.sends, []);
  append(b, 'An unrelated new note that must not overwrite shared history.');
  const result = await b.persist(); assert.equal(result.durable, false); assert.match(result.error, /Shared memory changed|Reload/);
  assert.equal(storage.getItem(personaKey), retainedPersona); assert.equal(storage.getItem(globalKey), retainedGlobal);
  await assert.rejects(b.automaticMemory.search({ query: 'Fred compass Mars' }), /Shared memory changed|Reload/);
  const measureCount = calls.measures.length; await assert.rejects(b.prepare(), /Shared memory changed|Reload/);
  assert.equal(calls.measures.length, measureCount); assert.deepEqual(calls.sends, []);
  assert.deepEqual(b.automaticMemory.snapshot().nodes, []);
  const { workspace: reopened } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'chat-b' });
  assert.deepEqual((await reopened.automaticMemory.search({ query: 'Fred compass Mars' })).hits, []);
  assert.equal(reopened.automaticMemory.snapshot().nodes.filter(node => node.scope === 'global').length, 2);
  assert.equal(reopened.automaticMemory.snapshot().nodes.some(node => node.scope === 'persona'), false);
});

test('a clipped long Persona prompt quote carries offsets/hash for the exact quote, separate from its full origin proof', async t => {
  const { workspace, storage } = await fixture(t, { personaId: 'cedar', conversationId: 'source-chat' });
  const quote = 'Notebook 😀\r\n'.repeat(80) + 'The mission codename is copperotter. ' + 'Ordinary final note. '.repeat(70);
  const source = append(workspace, 'Unpinned prefix 😀\r\n' + quote + '\r\nUnpinned suffix.');
  await workspace.automaticMemory.pinPersona({ turnId: source.id, text: quote });
  const { workspace: next } = await fixture(t, { storage, personaId: 'cedar', conversationId: 'next-chat' });
  await next.automaticMemory.setScope('persona'); append(next, 'What is the mission codename?');
  const prepared = await next.prepare(), hit = prepared.memorySources.find(hit => hit.scope === 'persona');
  assert.ok(hit); assert.match(hit.text, /copperotter/); assert.equal([...hit.text].length, 360); assert.equal(hit.text.isWellFormed(), true);
  assert.ok(hit.quoteSource.offsets.start > hit.provenance.origin.offsets.start);
  assert.equal(hit.quoteSource.turnId, source.id); assert.equal(hit.quoteSource.conversationId, 'source-chat');
  assert.equal(hit.quoteSource.turnHash, sha(source.content)); assert.equal(hit.quoteSource.lineHash, sha(hit.text));
  assert.equal(hit.quoteSource.offsets.unit, 'utf16');
  assert.equal(source.content.slice(hit.quoteSource.offsets.start, hit.quoteSource.offsets.end), hit.text);
  assert.equal(hit.provenance.origin.lineHash, sha(quote));
  assert.notDeepEqual(hit.quoteSource.offsets, hit.provenance.origin.offsets);
  assert.match(prepared.messages[0].content, /copperotter/); assert.deepEqual(next.conversation.snapshot().turns.map(turn => turn.content), ['What is the mission codename?']);
});
