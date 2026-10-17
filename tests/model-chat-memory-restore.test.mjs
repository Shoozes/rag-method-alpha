// Relationship fixtures only: these do not authenticate historical execution
// or claim that the fixture compaction counts came from a native model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { validateRetainedEvents } from '../examples/browser-model-chat/memory/restore-events.mjs';
import { createWorkspace, storageKey } from '../examples/browser-model-chat/memory/workspace.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = value => structuredClone(value);
const core = { RagEngine: class {}, recordFromMapping() {}, assertContextMatches() {}, formatContextPacket() {} };
const adapter = { measure() {} };
async function fixture() {
  const conversation = createConversationStore(), events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const scope = { actorId: 'local-user', conversationId: 'local-chat' };
  const one = conversation.append({ role: 'user', content: 'My delivery day is Tuesday.' });
  const saved = await memory.save({ text: one.content, sourceTurnIds: [one.id], scope, modelSafe: true });
  conversation.append({ role: 'assistant', content: 'An earlier answer.' });
  const correction = conversation.append({ role: 'user', content: 'My delivery day is Friday.' });
  const corrected = await memory.correct({ recordId: saved.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  conversation.append({ role: 'assistant', content: 'An updated answer.' });
  conversation.append({ role: 'user', content: 'What is my delivery day?' });
  events.append({ type: 'recalled', queryId: 'fixture-query', recordIds: [saved.id], versions: [2], sourceTurnIds: [correction.id], scope });
  events.append({ type: 'context-dispatched', queryId: 'fixture-query', recordIds: [saved.id], versions: [2], sourceTurnIds: [correction.id],
    promptTokens: 400, conversationVersion: 5, requestSha256: sha('fixture request') });
  const prefix = conversation.snapshot().turns.slice(0, 4);
  events.append({ type: 'compacted', cycle: 1, strategy: 'source-linked-extractive-window-v1',
    sourceTurnIds: prefix.map(turn => turn.id), sourceHashes: prefix.map(turn => sha(turn.content)),
    beforePromptTokens: 2100, afterPromptTokens: 400, capacity: 2048, reserve: 160,
    summaryHash: sha('fixture projection'), requestBeforeSha256: sha('fixture before'), requestAfterSha256: sha('fixture after'), conversationVersion: 5 });
  events.append({ type: 'summary-rejected', sourceTurnIds: ['t-0004'], reason: 'Fixture proposal was not admitted.' });
  await memory.forget({ recordId: corrected.id });
  events.append({ type: 'recalled', queryId: 'fixture-after-forget', recordIds: [], versions: [], sourceTurnIds: [], scope });
  return { events: clone(events.list()), conversation: conversation.snapshot(), records: memory.snapshot().records,
    serialized: JSON.stringify({ schema: 'private-one-chat-memory/v1', conversation: conversation.exportState(), memory: memory.exportState(), events: events.list() }) };
}
const input = data => ({ events: data.events, conversation: data.conversation, records: data.records });

test('valid historical write/selection/compaction bindings restore with originals and tombstones intact', async () => {
  const data = await fixture(); const result = await validateRetainedEvents(input(data));
  assert.equal(result.eventCount, 8); assert.equal(result.writeCount, 3);
  assert.match(result.verification, /not authentication/);
  const workspace = await createWorkspace({ adapter, core, storage: { getItem: key => key === storageKey ? data.serialized : null } });
  try {
    assert.deepEqual(workspace.events.list(), data.events);
    assert.deepEqual(workspace.conversation.snapshot(), data.conversation);
    assert.deepEqual(workspace.memory.snapshot().records, data.records);
    assert.ok(workspace.graph.snapshot().nodes.length > 0);
  } finally { workspace.dispose(); }
});

test('unknown turns, fabricated records, stale versions, changed hashes and scope/source cross-links fail', async () => {
  const base = await fixture();
  const mutations = [
    data => { data.events[0].sourceTurnIds = ['t-9999']; },
    data => { data.events[0].recordId = 'missing-record'; },
    data => { data.events[1].version = 99; },
    data => { data.events[0].contentHash = '0'.repeat(64); },
    data => { data.events[2].versions = [1]; },
    data => { data.events[2].sourceTurnIds = ['t-0001']; },
    data => { data.events[2].scope.actorId = 'another-user'; },
    data => { data.events[2].scope = null; },
    data => { data.events[5].sourceTurnIds = ['t-9999']; },
    data => { data.events[3].conversationVersion = 2; },
  ];
  for (const mutate of mutations) {
    const data = clone(base); mutate(data);
    await assert.rejects(validateRetainedEvents(input(data)), /Retained memory event binding is invalid/);
  }
});

test('write histories cannot be partial, duplicated, revived after forgetting or selected before writing', async () => {
  const base = await fixture();
  const mutations = [
    data => { data.events.splice(0, 1); },
    data => { data.events.splice(6, 1); },
    data => { data.events.splice(1, 0, clone(data.events[0])); },
    data => { data.events[7].recordIds = ['m-0001']; data.events[7].versions = [3]; data.events[7].sourceTurnIds = ['t-0003']; },
    data => { data.events.unshift(clone(data.events[2])); },
    data => { data.events[6].type = 'corrected'; },
  ];
  for (const mutate of mutations) {
    const data = clone(base); mutate(data);
    await assert.rejects(validateRetainedEvents(input(data)), /Retained memory event binding is invalid/);
  }
});

test('compaction hashes/order/capacity claims and the original empty-store fake graph restore fail closed', async () => {
  const base = await fixture();
  for (const mutate of [
    data => { data.events[4].sourceHashes[0] = sha('wrong source'); },
    data => { data.events[4].sourceHashes.reverse(); },
    data => { data.events[4].beforePromptTokens = 100; },
    data => { data.events[4].afterPromptTokens = 2048; },
    data => { data.events[4].reserve = 2048; },
    data => { data.events[4].conversationVersion = 2; },
    data => { data.events[4].sourceHashes.pop(); },
  ]) {
    const data = clone(base); mutate(data);
    await assert.rejects(validateRetainedEvents(input(data)), /Retained memory event binding is invalid/);
  }
  const conversation = createConversationStore(), memory = createMemoryStore({ conversation });
  const serialized = JSON.stringify({ schema: 'private-one-chat-memory/v1', conversation: conversation.exportState(), memory: memory.exportState(),
    events: [{ id: 'e-1', seq: 1, type: 'saved', recordId: 'missing-record', version: 1, sourceTurnIds: ['t-9999'], contentHash: '0'.repeat(64) }] });
  await assert.rejects(createWorkspace({ adapter, core, storage: { getItem: () => serialized } }), /event binding is invalid/);
});

test('explicit manual under-budget events restore while invalid tags and unsuccessful manual claims fail', async () => {
  const base = await fixture();
  const event = base.events.find(event => event.type === 'compacted');
  event.trigger = 'manual'; event.beforePromptTokens = 1100;
  await validateRetainedEvents(input(base));
  for (const patch of [{ trigger: null }, { trigger: '' }, { trigger: 'automatic' }, { trigger: false },
    { afterPromptTokens: 1100 }, { afterPromptTokens: 1900 }, { requestAfterSha256: event.requestBeforeSha256 },
    { sourceHashes: [] }, { summaryHash: '' }]) {
    const changed = clone(base); Object.assign(changed.events.find(event => event.type === 'compacted'), patch);
    await assert.rejects(validateRetainedEvents(input(changed)), /Retained memory event binding is invalid/);
  }
  const untagged = clone(base); delete untagged.events.find(event => event.type === 'compacted').trigger;
  await assert.rejects(validateRetainedEvents(input(untagged)), /compaction budget/);
});
