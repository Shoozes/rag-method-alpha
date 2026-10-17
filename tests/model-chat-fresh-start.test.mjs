// Disposable storage and lexical/token fixtures only. No model, native meter,
// OPFS mutation, network, browser profile or inference is used by this suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createWorkspace, clearWorkspaceStorage, storageKey, workspaceStorageKey } from '../examples/browser-model-chat/memory/workspace.mjs';
import { clearWorkspaceStorage as clearBasicStorage } from '../examples/browser-model-chat/session-storage.mjs';

const owner = { actorId: 'local-user', personaId: 'local-assistant', conversationId: 'local-chat' };
const personaKey = 'private-persona-memory-v1:' + JSON.stringify([owner.actorId, owner.personaId]);
const globalKey = 'private-global-memory-v1:' + JSON.stringify([owner.actorId]);
const storageFixture = () => {
  const values = new Map(), writes = [];
  let failSet = false, failRemove;
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (failSet) throw Error('Fixture storage quota denied'); writes.push(['set', key]); values.set(key, value); },
    removeItem(key) { if (key === failRemove) throw Error('Fixture storage removal denied'); writes.push(['remove', key]); values.delete(key); },
    failSet: value => { failSet = value; }, failRemove: value => { failRemove = value; } };
};
const core = { recordFromMapping: value => value, assertContextMatches() {}, formatContextPacket: () => '',
  RagEngine: class {
    constructor(records) { this.records = records; }
    search(_query, options) { return { results: this.records.slice(0, options.top_k).map(record => ({ record, has_retrieval_signal: true, keyword_micro: 1 })) }; }
  } };
async function fixture(storage = storageFixture(), options = {}) {
  let measurements = 0, replies = 0;
  const workspace = await createWorkspace({ core, storage, getControllerState: () => ({ phase: 'ready' }),
    adapter: { measure: async () => ({ promptTokens: ++measurements % 2 ? 1100 : 400,
      contextTokens: 2048, overflow: false, actualNativeTokenization: false, meter: 'fresh-start-unit-fixture' }),
    reply() { ++replies; throw Error('No model call is allowed'); } }, ...options });
  return { workspace, storage, calls: () => ({ measurements, replies }) };
}
function history(workspace) {
  for (let index = 0; index < 4; ++index) {
    workspace.conversation.append({ role: 'user', content: `Private delivery parcel ${index + 1} belongs to Fred.` });
    workspace.conversation.append({ role: 'assistant', content: `Generated private fixture answer ${index + 1}.` });
  }
}
const pendingMarker = epoch => JSON.stringify({ schema: 'private-one-chat-memory-reset/v1', owner, epoch, pending: true });
async function holdActorLock(operation) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let release, enter;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { enter = resolve; });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name, callback) => {
    assert.equal(name, 'rag-local-memory:' + owner.actorId); enter(); await held; return callback();
  } } });
  try { await operation({ started, release }); }
  finally { release(); if (previous) Object.defineProperty(navigator, 'locks', previous); else delete navigator.locks; }
}

test('pending reset recovery waits for the actor lock and only then completes the same pending epoch', async () => {
  const storage = storageFixture(), epoch = 'held-recovery-epoch';
  storage.values.set(storageKey, pendingMarker(epoch)); storage.values.set(personaKey, 'old private persona');
  storage.values.set(globalKey, 'old starter exclusions'); storage.values.set('other-app', 'keep');
  await holdActorLock(async ({ started, release }) => {
    const opening = fixture(storage); await started;
    assert.equal(JSON.parse(storage.getItem(storageKey)).pending, true);
    assert.equal(storage.getItem(personaKey), 'old private persona'); assert.deepEqual(storage.writes, []);
    release(); const reopened = (await opening).workspace;
    try {
      assert.deepEqual(reopened.conversation.snapshot().turns, []);
      assert.equal(storage.getItem(personaKey), null); assert.equal(storage.getItem(globalKey), null);
      assert.equal(JSON.parse(storage.getItem(storageKey)).epoch, epoch); assert.equal(JSON.parse(storage.getItem(storageKey)).pending, false);
      assert.equal(storage.getItem('other-app'), 'keep');
      assert.equal((await reopened.persist()).durable, true);
      assert.equal(JSON.parse(storage.getItem(storageKey)).resetEpoch, epoch);
    } finally { reopened.dispose(); }
  });
});

test('recovery never replays deletion after another tab completed the marker and saved fresh shared memories', async () => {
  const fresh = await fixture(undefined, { conversationId: 'fresh-other-chat' });
  try {
    const turn = fresh.workspace.conversation.append({ role: 'user', content: 'Fresh shared preference is mint tea.' });
    await fresh.workspace.automaticMemory.pinPersona({ turnId: turn.id, text: turn.content });
    await fresh.workspace.automaticMemory.forget(fresh.workspace.automaticMemory.snapshot().nodes.find(node => node.kind === 'global'));
    const persona = fresh.storage.getItem(personaKey), global = fresh.storage.getItem(globalKey);
    const storage = storageFixture(), epoch = 'completed-while-waiting'; storage.values.set(storageKey, pendingMarker(epoch));
    await holdActorLock(async ({ started, release }) => {
      const opening = fixture(storage); await started;
      storage.values.set(storageKey, JSON.stringify({ schema: 'private-one-chat-memory-reset/v1', owner, epoch, pending: false }));
      storage.values.set(personaKey, persona); storage.values.set(globalKey, global);
      release(); const reopened = (await opening).workspace;
      try {
        assert.deepEqual(storage.writes, [], 'completed marker must cause no storage deletion or rewrite');
        assert.equal(reopened.automaticMemory.exportPersona(), persona); assert.equal(reopened.automaticMemory.exportGlobal(), global);
        assert.equal((await reopened.persist()).durable, true);
        assert.equal(JSON.parse(storage.getItem(storageKey)).resetEpoch, epoch);
      } finally { reopened.dispose(); }
    });
  } finally { fresh.workspace.dispose(); }
});

test('recovery adopts a fresh saved chat replacing the pending marker without deleting its new Persona state', async () => {
  const epoch = 'fresh-chat-after-recovery', freshStorage = storageFixture();
  freshStorage.values.set(storageKey, JSON.stringify({ schema: 'private-one-chat-memory-reset/v1', owner, epoch, pending: false }));
  const fresh = await fixture(freshStorage);
  try {
    const turn = fresh.workspace.conversation.append({ role: 'user', content: 'New conversation after reset stays here.' });
    await fresh.workspace.automaticMemory.pinPersona({ turnId: turn.id, text: turn.content });
    const storage = storageFixture(); storage.values.set(storageKey, pendingMarker(epoch));
    await holdActorLock(async ({ started, release }) => {
      const opening = fixture(storage); await started;
      for (const [key, value] of freshStorage.values) storage.values.set(key, value);
      release(); const reopened = (await opening).workspace;
      try {
        assert.deepEqual(storage.writes, []); assert.equal(reopened.conversation.exportState(), fresh.workspace.conversation.exportState());
        assert.equal(reopened.automaticMemory.exportPersona(), fresh.workspace.automaticMemory.exportPersona());
        assert.equal((await reopened.persist()).durable, true);
        assert.equal(JSON.parse(storage.getItem(storageKey)).resetEpoch, epoch);
      } finally { reopened.dispose(); }
    });
  } finally { fresh.workspace.dispose(); }
});

test('a different pending reset epoch encountered under lock is refused without stale deletion', async () => {
  const storage = storageFixture(); storage.values.set(storageKey, pendingMarker('old-epoch'));
  await holdActorLock(async ({ started, release }) => {
    const opening = fixture(storage); await started;
    storage.values.set(storageKey, pendingMarker('newer-pending-epoch')); storage.values.set(personaKey, 'newer-reset-owned-state');
    release(); await assert.rejects(opening, /Local reset changed while waiting/);
    assert.deepEqual(storage.writes, []); assert.equal(storage.getItem(personaKey), 'newer-reset-owned-state');
    assert.equal(JSON.parse(storage.getItem(storageKey)).epoch, 'newer-pending-epoch');
  });
});

test('clear invalidates queued saves and old provider work; reload has only the explicit public starter baseline', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace);
    await f.workspace.context.compactNow();
    assert.ok(f.workspace.context.summarySnapshot());
    await f.workspace.automaticMemory.pinPersona({ turnId: 't-0001', text: 'Private delivery parcel 1 belongs to Fred.' });
    await f.workspace.memory.save({ text: 'Private delivery parcel 2 belongs to Fred.', sourceTurnIds: ['t-0003'],
      scope: { actorId: owner.actorId, conversationId: owner.conversationId }, modelSafe: true });
    await f.workspace.persist();
    const protectedKeys = new Map([['other-app-session', 'other private data'], ['model-cache-metadata', 'cached model sentinel'],
      [workspaceStorageKey({ ...owner, actorId: 'other-user' }), 'other owner bytes'],
      ['private-persona-memory-v1:' + JSON.stringify(['other-user', owner.personaId]), 'other persona bytes']]);
    for (const [key, value] of protectedKeys) f.storage.values.set(key, value);
    let disposed = 0;
    f.workspace.attachPanel({ refresh() {}, dispose() { ++disposed; } });
    const queued = [f.workspace.persist(), f.workspace.persist()];
    const cleared = await f.workspace.clear();
    assert.deepEqual(cleared, { cleared: true, durable: true });
    assert.equal(disposed, 1); assert.ok((await Promise.all(queued)).every(result => result.stale));
    f.workspace.conversation.append({ role: 'assistant', content: 'Late old reply must never return.' });
    assert.equal((await f.workspace.persist()).stale, true);
    assert.throws(() => f.workspace.prepare(), /closed or cleared/);
    assert.throws(() => f.workspace.provider.reply([]), /closed or cleared/);
    await assert.rejects(f.workspace.captureAnswerSources({ answerTurnId: 't-0009' }), /closed or cleared/);
    assert.equal(f.storage.getItem(personaKey), null); assert.equal(f.storage.getItem(globalKey), null);
    for (const [key, value] of protectedKeys) assert.equal(f.storage.getItem(key), value);
    const marker = JSON.parse(f.storage.getItem(storageKey));
    assert.equal(marker.schema, 'private-one-chat-memory-reset/v1'); assert.equal(marker.pending, false);
    assert.doesNotMatch(JSON.stringify(marker), /Fred|parcel|Late old reply/);
    reopened = (await fixture(f.storage)).workspace;
    assert.deepEqual(reopened.conversation.snapshot().turns, []); assert.deepEqual(reopened.memory.snapshot().records, []);
    assert.deepEqual(reopened.events.list(), []); assert.deepEqual(reopened.graph.snapshot().nodes, []);
    assert.equal(reopened.context.summarySnapshot(), null); assert.equal(reopened.context.inspectionSnapshot().lastSubmitted, null);
    assert.deepEqual(JSON.parse(reopened.automaticMemory.exportPersona()).records, []);
    assert.deepEqual(JSON.parse(reopened.automaticMemory.exportGlobal()).disabledIds, []);
    const nodes = reopened.automaticMemory.snapshot().nodes;
    assert.equal(nodes.length, 3); assert.ok(nodes.every(node => node.kind === 'global' && node.id.startsWith('global:')));
    reopened.conversation.append({ role: 'user', content: 'A fresh baseline question.' });
    const prepared = await reopened.prepare();
    assert.doesNotMatch(JSON.stringify(prepared.messages), /Private delivery|Fred|Generated private|Late old/);
    assert.equal(f.calls().replies, 0);
  } finally { f.workspace.dispose(); reopened?.dispose(); }
});

test('a previously empty sibling tab cannot restore pre-reset history or dispatch after the reset marker changes', async () => {
  const storage = storageFixture(), a = await fixture(storage), b = await fixture(storage);
  try {
    b.workspace.conversation.append({ role: 'user', content: 'Unpersisted old private source.' });
    await a.workspace.clear();
    assert.match((await b.workspace.persist()).error, /changed or was cleared/);
    assert.throws(() => b.workspace.prepare(), /changed or was cleared/);
    assert.throws(() => b.workspace.provider.reply([]), /changed or was cleared/);
    assert.doesNotMatch(storage.getItem(storageKey), /private source/);
  } finally { a.workspace.dispose(); b.workspace.dispose(); }
});

test('settings scope reset is independent from history, saved/Persona memories and the restored starter exclusions', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace);
    await f.workspace.automaticMemory.pinPersona({ turnId: 't-0001', text: 'Private delivery parcel 1 belongs to Fred.' });
    const starter = f.workspace.automaticMemory.snapshot().nodes.find(node => node.kind === 'global');
    await f.workspace.automaticMemory.forget(starter);
    await f.workspace.automaticMemory.setScope('persona');
    const transcript = f.workspace.conversation.exportState(), persona = f.workspace.automaticMemory.exportPersona(), global = f.workspace.automaticMemory.exportGlobal();
    await f.workspace.automaticMemory.setScope('all');
    assert.equal(f.workspace.conversation.exportState(), transcript);
    assert.equal(f.workspace.automaticMemory.exportPersona(), persona); assert.equal(f.workspace.automaticMemory.exportGlobal(), global);
    reopened = (await fixture(f.storage)).workspace;
    assert.equal(reopened.automaticMemory.getScope(), 'all'); assert.equal(reopened.conversation.exportState(), transcript);
    assert.equal(reopened.automaticMemory.exportPersona(), persona); assert.equal(reopened.automaticMemory.exportGlobal(), global);
    assert.deepEqual(f.calls(), { measurements: 0, replies: 0 });
  } finally { f.workspace.dispose(); reopened?.dispose(); }
});

test('partial deletion is explicit, cannot persist old data, and a pending reset completes safely before reload', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace); await f.workspace.persist();
    f.storage.failRemove(globalKey);
    const failure = await f.workspace.clear();
    assert.equal(failure.cleared, false); assert.match(failure.error, /removal denied/);
    assert.equal(JSON.parse(f.storage.getItem(storageKey)).pending, true);
    assert.equal((await f.workspace.persist()).stale, true);
    await assert.rejects(fixture(f.storage), /Local reset could not finish/);
    f.storage.failRemove(undefined);
    reopened = (await fixture(f.storage)).workspace;
    assert.deepEqual(reopened.conversation.snapshot().turns, []);
    assert.equal(JSON.parse(f.storage.getItem(storageKey)).pending, false);
    assert.deepEqual(await f.workspace.clear(), { cleared: true, durable: true });
  } finally { f.workspace.dispose(); reopened?.dispose(); }
});

test('storage refusal never claims a durable clear, and scoped recovery does not require valid prior chat JSON', () => {
  const storage = storageFixture(); storage.values.set(storageKey, 'broken old JSON'); storage.values.set('unrelated', 'keep');
  storage.failSet(true);
  const failed = clearWorkspaceStorage({ storage });
  assert.equal(failed.cleared, false); assert.equal(failed.durable, false); assert.match(failed.error, /quota denied/);
  assert.equal(storage.getItem(storageKey), 'broken old JSON');
  storage.failSet(false);
  assert.deepEqual(clearWorkspaceStorage({ storage }), { cleared: true, durable: true });
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.deepEqual(clearWorkspaceStorage(), { cleared: true, durable: false });
});

test('basic clear uses the same standalone storage boundary without importing optional memory modules', async () => {
  assert.equal(clearBasicStorage, clearWorkspaceStorage);
  const module = await readFile(new URL('../examples/browser-model-chat/session-storage.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /(?:^|\n)\s*import\s|import\s*\(/u);
  const bootstrap = await readFile(new URL('../examples/browser-model-chat/bootstrap.mjs', import.meta.url), 'utf8');
  assert.match(bootstrap, /import \{ clearWorkspaceStorage, defaultWorkspaceOwner \} from '\.\/session-storage\.mjs'/);
  const basicClear = bootstrap.slice(bootstrap.indexOf('const clearStoredMemory'), bootstrap.indexOf("if (new URL(location.href)"));
  assert.doesNotMatch(basicClear, /import\s*\(/u);
  assert.match(basicClear, /navigator\.locks\.request\('rag-local-memory:' \+ defaultWorkspaceOwner\.actorId, clear\)/u);
  const storage = storageFixture(); storage.values.set(storageKey, 'corrupt optional memory state');
  storage.values.set(personaKey, 'private persona state'); storage.values.set('unrelated-app', 'keep');
  assert.deepEqual(clearBasicStorage({ storage }), { cleared: true, durable: true });
  assert.equal(storage.getItem(personaKey), null); assert.equal(storage.getItem('unrelated-app'), 'keep');
});

test('a refused storage lock reports failure and allows an explicit clear retry', async () => {
  const f = await fixture();
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  try {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async () => { throw Error('Fixture lock refused'); } } });
    const refused = await f.workspace.clear();
    assert.equal(refused.cleared, false); assert.match(refused.error, /lock refused/);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name, callback) => callback() } });
    assert.deepEqual(await f.workspace.clear(), { cleared: true, durable: true });
  } finally {
    if (previous) Object.defineProperty(navigator, 'locks', previous); else delete navigator.locks;
    f.workspace.dispose();
  }
});
