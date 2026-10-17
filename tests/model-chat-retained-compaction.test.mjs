// Labeled lexical-core and token-meter fixtures. No model, provider, runtime,
// network, native tokenizer or Worker runs in this suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspace, storageKey } from '../examples/browser-model-chat/memory/workspace.mjs';
import { compactionPolicyHash, RETAINED_COMPACTION_BYTES, validateRetainedCompaction } from '../examples/browser-model-chat/memory/retained-compaction.mjs';

const core = {
  recordFromMapping: value => value,
  assertContextMatches() {},
  formatContextPacket: () => '',
  RagEngine: class {
    constructor(records) { this.records = records; }
    search(_query, options) { return { results: this.records.slice(0, options.top_k).map(record => ({ record, has_retrieval_signal: true, keyword_micro: 1 })) }; }
  },
};
const store = () => {
  const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const measurement = promptTokens => ({ promptTokens, contextTokens: 2048, overflow: promptTokens > 2048,
  actualNativeTokenization: false, meter: 'retained-compaction-unit-fixture' });
async function fixture({ storage = store(), automaticMemoryEnabled = true, meter } = {}) {
  const calls = [], state = { phase: 'ready' };
  const workspace = await createWorkspace({ storage, core, automaticMemoryEnabled, getControllerState: () => state,
    adapter: { measure: async (messages, options) => {
      calls.push(structuredClone(messages)); return meter ? meter(messages, options, calls.length) : measurement(calls.length % 2 ? 1100 : 400);
    }, reply() { throw Error('No fixture request may run a provider.'); } } });
  return { workspace, storage, calls, state };
}
function history(workspace, exchanges = 4) {
  for (let index = 0; index < exchanges; index++) {
    workspace.conversation.append({ role: 'user', content: `Delivery parcel ${index + 1} has a Friday collection label.` });
    workspace.conversation.append({ role: 'assistant', content: `Generated fixture delivery response ${index + 1}.` });
  }
}
const retainedInput = async (workspace, retained = workspace.context.exportCompaction()) => ({ retained,
  conversation: workspace.conversation.snapshot(), events: workspace.events.list(), owner: workspace.ownerScope,
  protectedTurnIds: [...workspace.memory.snapshot().records.flatMap(record => record.sourceTurnIds), ...(workspace.automaticMemory?.getBlockedTurnIds() ?? [])],
  policyHash: await compactionPolicyHash(JSON.stringify(workspace.memory.snapshot().records), workspace.automaticMemory?.retentionIdentity()) });

test('only a committed actual extractive output creates a bounded conversation node; observers see the committed node', async () => {
  const f = await fixture();
  try {
    assert.equal(f.workspace.context.summarySnapshot(), null);
    assert.deepEqual(f.workspace.context.summaryStatus(), { available: false, reason: 'no-retained-summary' });
    history(f.workspace); const original = f.workspace.conversation.exportState();
    const persona = f.workspace.automaticMemory.exportPersona(), observed = [];
    f.workspace.events.subscribe(event => { if (event.type === 'compacted') observed.push(f.workspace.context.summarySnapshot()); });
    await f.workspace.context.compactNow();
    const node = f.workspace.context.summarySnapshot(), event = f.workspace.events.list().find(item => item.type === 'compacted');
    assert.equal(node.id, 'summary:' + event.id); assert.equal(node.scope, 'conversation'); assert.equal(node.kind, 'summary');
    assert.equal(node.role, 'source'); assert.equal(node.retainedOutput, true); assert.equal(node.semanticSummary, false);
    assert.deepEqual(observed, [node]); assert.equal(node.summaryHash, event.summaryHash);
    assert.ok(node.sourceTurnIds.length > 0);
    assert.ok(node.sourceTurnIds.every(id => f.workspace.conversation.snapshot().turns.find(turn => turn.id === id)?.role === 'user'));
    assert.ok(event.sourceTurnIds.some(id => !node.sourceTurnIds.includes(id)), 'assistant/unselected prefix is not presented as retained authored words');
    assert.equal(f.workspace.conversation.exportState(), original); assert.equal(f.workspace.automaticMemory.exportPersona(), persona);
    assert.ok(Buffer.byteLength(JSON.stringify(f.workspace.context.exportCompaction())) < RETAINED_COMPACTION_BYTES);
    assert.throws(() => { node.sourceTurnIds.push('invented'); }, TypeError);
    assert.equal((await f.workspace.persist()).durable, true);
  } finally { f.workspace.dispose(); }
});

test('latest output, cutoff and max committed cycle reopen without retrieving, measuring, dispatching or replaying work', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace); await f.workspace.context.compactNow(); await f.workspace.persist();
    const before = f.workspace.context.summarySnapshot();
    reopened = await createWorkspace({ storage: f.storage, getControllerState: () => ({ phase: 'ready' }),
      core: { ...core, RagEngine: class { constructor() { throw Error('Reopening must not retrieve.'); } } },
      adapter: { measure() { throw Error('Reopening must not measure.'); }, reply() { throw Error('Reopening must not dispatch.'); } } });
    assert.deepEqual(reopened.context.summarySnapshot(), before);
    assert.equal(reopened.context.snapshot().cutoff, 4); assert.equal(reopened.context.snapshot().cycle, 1);
    assert.equal(reopened.context.usageSnapshot().phase, 'unmeasured');
    assert.equal(reopened.context.inspectionSnapshot().lastSubmitted, null);
    assert.deepEqual(reopened.context.manualCompactionStatus(), { eligible: false, busy: false, reason: 'insufficient-history' });
    const serialized = JSON.parse(f.storage.getItem(storageKey)); delete serialized.contextCompaction;
    f.storage.setItem(storageKey, JSON.stringify(serialized));
    const legacy = await fixture({ storage: f.storage });
    try {
      assert.equal(legacy.workspace.context.summarySnapshot(), null); assert.equal(legacy.workspace.context.snapshot().cutoff, 0);
      assert.equal(legacy.workspace.context.snapshot().cycle, 1, 'legacy committed cycles do not restart at one');
      await legacy.workspace.context.compactNow(); assert.equal(legacy.workspace.context.snapshot().cycle, 2);
    } finally { legacy.workspace.dispose(); }
  } finally { reopened?.dispose(); f.workspace.dispose(); }
});

test('newly committed and subsequent request context exclude originals already represented by summary quotes', async () => {
  const f = await fixture();
  try {
    history(f.workspace); const result = await f.workspace.context.compactNow();
    const represented = new Set(f.workspace.context.summarySnapshot().sourceTurnIds);
    assert.ok(result.memorySources.every(hit => hit.kind !== 'conversation' || !represented.has(hit.turnId)));
    assert.ok(f.workspace.context.inspectionSnapshot().latestPrepared.admitted.filter(row => row.kind === 'conversation').every(row => !represented.has(row.turnId)));
    f.workspace.conversation.append({ role: 'user', content: 'Which Friday delivery parcel label?' });
    const prepared = await f.workspace.prepare();
    assert.ok(prepared.memorySources.every(hit => hit.kind !== 'conversation' || !represented.has(hit.turnId)));
    assert.equal(f.workspace.context.inspectionSnapshot().lastSubmitted, null);
    f.workspace.context.dispatched(prepared.messages);
    assert.ok(f.workspace.context.inspectionSnapshot().lastSubmitted.admitted.some(row => row.kind === 'derived-context'));
    assert.deepEqual(f.workspace.context.summarySnapshot().sourceTurnIds, [...represented]);
  } finally { f.workspace.dispose(); }
});

test('policy changes hide retained output immediately, persist no stale body and prevent forgotten-source resurrection on reload', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace); await f.workspace.context.compactNow();
    const node = f.workspace.context.summarySnapshot(), forgotten = node.sourceTurnIds[0];
    await f.workspace.automaticMemory.forget({ kind: 'message', scope: 'conversation', turnId: forgotten });
    assert.equal(f.workspace.context.summarySnapshot(), null);
    assert.deepEqual(f.workspace.context.summaryStatus(), { available: false, reason: 'policy-changed' });
    assert.equal(f.workspace.context.exportCompaction(), null); assert.equal(JSON.parse(f.storage.getItem(storageKey)).contextCompaction, null);
    reopened = (await fixture({ storage: f.storage })).workspace;
    assert.equal(reopened.context.summarySnapshot(), null);
    reopened.conversation.append({ role: 'user', content: 'Which Friday delivery parcel label?' });
    const prepared = await reopened.prepare();
    assert.ok(!prepared.extractiveSources.some(source => source.turnId === forgotten));
    assert.ok(!prepared.memorySources.some(source => source.turnId === forgotten));
    assert.ok(reopened.conversation.snapshot().turns.some(turn => turn.id === forgotten));
  } finally { reopened?.dispose(); f.workspace.dispose(); }
});

test('All and Conversation show the same retained output; Persona and Global hide it without deleting it on save or reload', async () => {
  const f = await fixture(); let reopened;
  try {
    history(f.workspace); await f.workspace.context.compactNow(); const original = f.workspace.context.summarySnapshot();
    const body = f.workspace.context.exportCompaction(), events = f.workspace.events.list();
    await f.workspace.automaticMemory.setScope('conversation');
    assert.deepEqual(f.workspace.context.summarySnapshot(), original);
    assert.deepEqual(f.workspace.context.exportCompaction(), body);
    assert.equal(f.workspace.context.manualCompactionStatus().eligible, false, 'main context policy gates remain conservative');
    for (const scope of ['persona', 'global']) {
      await f.workspace.automaticMemory.setScope(scope);
      assert.equal(f.workspace.context.summarySnapshot(), null);
      assert.deepEqual(f.workspace.context.summaryStatus(), { available: false, reason: 'scope-disabled' });
      assert.deepEqual(f.workspace.context.exportCompaction(), body);
      assert.deepEqual(JSON.parse(f.storage.getItem(storageKey)).contextCompaction, body);
    }
    reopened = (await fixture({ storage: f.storage })).workspace;
    assert.equal(reopened.automaticMemory.getScope(), 'global'); assert.equal(reopened.context.summarySnapshot(), null);
    assert.deepEqual(reopened.context.exportCompaction(), body);
    await reopened.automaticMemory.setScope('all');
    assert.deepEqual(reopened.context.summarySnapshot(), original);
    assert.deepEqual(reopened.events.list(), events, 'filter changes do not emit another completion event');
    await f.workspace.automaticMemory.setScope('all');
    assert.deepEqual(f.workspace.context.summarySnapshot(), original);
    assert.deepEqual(f.workspace.events.list(), events);
  } finally { reopened?.dispose(); f.workspace.dispose(); }
});

test('saved evidence and Persona pins still invalidate retained output rather than inheriting filter-only validity', async () => {
  for (const operation of ['save', 'pin']) {
    const f = await fixture();
    try {
      history(f.workspace); await f.workspace.context.compactNow();
      const turn = f.workspace.conversation.snapshot().turns[0];
      if (operation === 'pin') await f.workspace.automaticMemory.pinPersona({ turnId: turn.id, text: turn.content });
      else await f.workspace.memory.save({ sourceTurnIds: [turn.id], text: turn.content, modelSafe: true,
        scope: { actorId: f.workspace.ownerScope.actorId, conversationId: f.workspace.ownerScope.conversationId } });
      assert.equal(f.workspace.context.summarySnapshot(), null);
      assert.deepEqual(f.workspace.context.summaryStatus(), { available: false, reason: 'policy-changed' });
      assert.equal(f.workspace.context.exportCompaction(), null);
      await f.workspace.automaticMemory.setScope('conversation');
      assert.equal(f.workspace.context.summarySnapshot(), null);
    } finally { f.workspace.dispose(); }
  }
});

test('tampered body, event, owner, cutoff, canonical source, quote and lineage fail closed before restoring a node', async () => {
  const f = await fixture();
  try {
    history(f.workspace); await f.workspace.context.compactNow(); const original = f.workspace.context.exportCompaction();
    for (const mutate of [
      retained => { retained.summary.text += ' invented'; },
      retained => { retained.eventId = 'e-999'; },
      retained => { retained.owner.conversationId = 'other-chat'; },
      retained => { retained.cutoff--; },
      retained => { retained.summary.sources[0].contentHash = '0'.repeat(64); },
      retained => { retained.summary.items[0].quote = 'invented'; },
      retained => { retained.summary.items[0].sourceRefs[0].offsets.end--; },
      retained => { retained.summary.items[0].turnId = 't-0002'; },
      retained => { retained.summary.coverage.retainedItemCount++; },
      retained => { retained.summary.text = 'oversized'.repeat(20_000); },
    ]) {
      const retained = structuredClone(original); mutate(retained);
      await assert.rejects(validateRetainedCompaction(await retainedInput(f.workspace, retained)), /Retained conversation compaction is invalid/);
    }
    const stale = await retainedInput(f.workspace, original); stale.policyHash = '0'.repeat(64);
    assert.equal(await validateRetainedCompaction(stale), null, 'policy mismatch discards rather than reauthorizing a retained output');
    const changed = structuredClone(await retainedInput(f.workspace, original)); changed.conversation.turns[0].content += ' tampered';
    await assert.rejects(validateRetainedCompaction(changed), /canonical source hash/);
  } finally { f.workspace.dispose(); }
});

test('only the latest success is retained; a later cancelled or failed attempt cannot replace its body or identity', async () => {
  let failAfterFirst = false;
  const f = await fixture({ meter: (_messages, _options, count) => {
    if (failAfterFirst && count === 4) throw Error('Later fixture measurement failed.');
    return measurement(count % 2 ? 1100 : 400);
  } });
  try {
    history(f.workspace); await f.workspace.context.compactNow(); const first = f.workspace.context.exportCompaction();
    history(f.workspace); const abort = new AbortController(); abort.abort();
    await assert.rejects(f.workspace.context.compactNow({ signal: abort.signal }), { name: 'AbortError' });
    assert.deepEqual(f.workspace.context.exportCompaction(), first);
    failAfterFirst = true;
    await assert.rejects(f.workspace.context.compactNow(), /Later fixture measurement failed/);
    assert.deepEqual(f.workspace.context.exportCompaction(), first);
    failAfterFirst = false;
    await f.workspace.context.compactNow(); const latest = f.workspace.context.exportCompaction();
    assert.equal(latest.cycle, 2); assert.notEqual(latest.eventId, first.eventId);
    await assert.rejects(validateRetainedCompaction(await retainedInput(f.workspace, first)), /committed event/,
      'an earlier valid body cannot replace the latest committed output');
    await f.workspace.persist();
    assert.deepEqual(JSON.parse(f.storage.getItem(storageKey)).contextCompaction, latest);
    assert.equal(Array.isArray(JSON.parse(f.storage.getItem(storageKey)).contextCompaction), false);
    assert.equal(f.workspace.events.list().filter(event => event.type === 'compacted').length, 2);
  } finally { f.workspace.dispose(); }
});

test('structured output retains original correction lineage without treating assistant text as authored memory', async () => {
  const f = await fixture({ automaticMemoryEnabled: false });
  try {
    history(f.workspace); f.workspace.conversation.append({ role: 'user', content: 'Fact[delivery]: Friday.' });
    f.workspace.conversation.append({ role: 'assistant', content: 'Generated delivery answer.' });
    f.workspace.conversation.append({ role: 'user', content: 'Correction[delivery]: Monday.' });
    f.workspace.conversation.append({ role: 'assistant', content: 'Generated delivery answer.' });
    await f.workspace.context.compactNow(); const retained = f.workspace.context.exportCompaction();
    assert.equal(retained.summary.items[0].lineage.length, 2);
    assert.deepEqual(f.workspace.context.summarySnapshot().sourceTurnIds, ['t-0011', 't-0009']);
    await validateRetainedCompaction(await retainedInput(f.workspace));
    retained.summary.items[0].lineage[0].marker = 'Correction';
    await assert.rejects(validateRetainedCompaction(await retainedInput(f.workspace, retained)), /structured lineage/);
    for (const mutate of [
      value => { value.summary.items[0].lineage.shift(); },
      value => { value.summary.items[0].lineage.reverse(); },
      value => { value.summary.items[0].kind = 'constraint'; },
      value => { value.summary.coverage.allActiveDeclaredItemsRetained = false; },
    ]) {
      const altered = f.workspace.context.exportCompaction(); mutate(altered);
      await assert.rejects(validateRetainedCompaction(await retainedInput(f.workspace, altered)), /canonical structured selection or lineage/);
    }
  } finally { f.workspace.dispose(); }
});

test('automatic overflow also retains a real output, while refused, failed and cancelled attempts retain none', async () => {
  const f = await fixture({ meter: (_messages, _options, count) => measurement(count === 1 ? 2100 : 400) });
  try {
    history(f.workspace); f.workspace.conversation.append({ role: 'user', content: 'Which Friday delivery parcel?' });
    const prepared = await f.workspace.prepare();
    assert.equal(f.workspace.context.summarySnapshot().summaryHash, f.workspace.context.snapshot().compacted.contentHash);
    assert.equal(prepared.compaction.cycle, 1); assert.equal(f.workspace.context.inspectionSnapshot().lastSubmitted, null);
  } finally { f.workspace.dispose(); }
  for (const variant of ['short', 'unloaded', 'generating', 'failed', 'cancelled']) {
    const item = await fixture({ meter: () => { throw Error('Controlled fixture meter failure.'); } });
    try {
      history(item.workspace, variant === 'short' ? 1 : 4);
      if (variant === 'unloaded') item.state.phase = 'idle';
      if (variant === 'generating') item.state.phase = 'generating';
      const abort = new AbortController(); if (variant === 'cancelled') abort.abort();
      await assert.rejects(item.workspace.context.compactNow({ signal: abort.signal }));
      assert.equal(item.workspace.context.summarySnapshot(), null); assert.equal(item.workspace.context.exportCompaction(), null);
      assert.equal(item.workspace.events.list().some(event => event.type === 'compacted'), false);
    } finally { item.workspace.dispose(); }
  }
});
