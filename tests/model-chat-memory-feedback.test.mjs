import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { submittedMemoryNodeIds } from '../examples/browser-model-chat/memory/panel.mjs';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';
import * as core from '../.artifacts/memory/rag-core.mjs';

test('graph searches and prepared, stale or manual previews cannot authorize a sent-source cue', () => {
  for (const purpose of [undefined, 'manual-compaction']) {
    const record = { purpose, requestSha256: 'prepared', admitted: [{ nodeId: 'turn:t-0001' }] };
    assert.deepEqual(submittedMemoryNodeIds({ latestPrepared: record }, 'prepared'), []);
  }
  assert.deepEqual(submittedMemoryNodeIds({ lastSubmitted: { requestSha256: 'old', admitted: [{ nodeId: 'turn:t-0001' }] } }, 'new'), []);
  assert.deepEqual(submittedMemoryNodeIds({}, undefined), []);
});

test('a submitted base instruction without admitted memory cannot light up remembered nodes', () => {
  assert.deepEqual(submittedMemoryNodeIds({ lastSubmitted: { requestSha256: 'actual', exactMemoryContext: '[{"role":"system","content":"Base instruction"}]', admitted: [] } }, 'actual'), []);
});

test('only supplied admitted rows bind source nodes; candidates and omitted metadata do not invent IDs', () => {
  const record = { requestSha256: 'actual', scope: { actorId: 'owner', conversationId: 'chat' }, admittedCount: 4, admittedComplete: false,
    admitted: [{ nodeId: 'record:m-0001', scope: 'conversation', kind: 'saved', sourceTurnIds: ['t-0001', 't-0001'] }, { nodeId: 'turn:t-0002', admitted: false }],
    candidates: [{ nodeId: 'turn:t-0003' }] };
  assert.deepEqual(submittedMemoryNodeIds({ lastSubmitted: record }, 'actual'), ['record:m-0001', 'turn:t-0001']);
  assert.deepEqual(submittedMemoryNodeIds({ lastSubmitted: { requestSha256: 'actual', admittedCount: 4 } }, 'actual'), []);
});

test('foreign Persona turn IDs cannot cue a colliding current-conversation source', () => {
  const owner = { actorId: 'owner', conversationId: 'current-chat' };
  const persona = { nodeId: 'persona:p-0001', scope: 'persona', kind: 'persona', sourceTurnIds: ['t-0001'],
    provenance: { origin: { actorId: owner.actorId, conversationId: 'other-chat', turnId: 't-0001' } } };
  const snapshot = { lastSubmitted: { requestSha256: 'actual', scope: owner, admitted: [persona] } };
  assert.deepEqual(submittedMemoryNodeIds(snapshot, 'actual', owner), ['persona:p-0001']);
  persona.provenance.origin.conversationId = owner.conversationId;
  assert.deepEqual(submittedMemoryNodeIds(snapshot, 'actual', owner), ['persona:p-0001', 'turn:t-0001']);
  persona.provenance.origin.actorId = 'another-owner';
  assert.deepEqual(submittedMemoryNodeIds(snapshot, 'actual', owner), ['persona:p-0001']);
  assert.deepEqual(submittedMemoryNodeIds(snapshot, 'actual', { ...owner, conversationId: 'different-chat' }), []);
  delete persona.provenance;
  assert.deepEqual(submittedMemoryNodeIds(snapshot, 'actual', owner), ['persona:p-0001']);
});

test('raw recent dialogue is sent once without a recalled-source cue, while display search stays unsent', async () => {
  let measures = 0;
  const workspace = await createWorkspace({ core, adapter: {
    async measure() { measures++; return { promptTokens: 300, contextTokens: 2048, overflow: false }; },
    async reply() { throw Error('No provider or native model may run in this labeled request-binding fixture.'); }, async dispose() {},
  } });
  try {
    const source = workspace.conversation.append({ role: 'user', content: 'hello from the copper lighthouse' });
    workspace.conversation.append({ role: 'assistant', content: 'Generated fixture text, not source authority.' });
    const preview = await workspace.automaticMemory.search({ query: 'hello' });
    assert.ok(preview.hits.some(hit => hit.nodeId === 'turn:' + source.id));
    assert.equal(measures, 0);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), 'invented'), []);
    workspace.conversation.append({ role: 'user', content: 'Where did hello come from?' });
    const prepared = await workspace.prepare();
    assert.equal(prepared.messages.filter(message => message.role === 'user' && message.content === source.content).length, 1);
    assert.equal(prepared.memorySources.some(hit => hit.turnId === source.id), false);
    assert.equal(prepared.extractiveSources.some(hit => hit.turnId === source.id), false);
    assert.equal(prepared.measurement.requestSha256, createHash('sha256').update(JSON.stringify(prepared.messages)).digest('hex'));
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), prepared.measurement.requestSha256), []);
    workspace.context.validateDispatch(prepared.messages);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), prepared.measurement.requestSha256), []);
    workspace.context.dispatched(prepared.messages);
    const ids = submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), prepared.measurement.requestSha256);
    assert.deepEqual(ids, [], 'A sent direct turn does not become a recalled-memory admission');
    assert.equal(workspace.context.inspectionSnapshot().lastSubmitted.admittedCount, 0);
    await workspace.automaticMemory.search({ query: 'unmatchedvioletwhale' });
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), prepared.measurement.requestSha256), ids);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), 'another-request'), []);
    assert.equal(workspace.events.list().filter(event => event.type === 'context-dispatched').length, 1);
  } finally { workspace.dispose(); }
});

test('an actually admitted older derived excerpt cues only its source at the matching dispatch boundary', async () => {
  let measures = 0;
  const workspace = await createWorkspace({ core, adapter: {
    async measure() { return { promptTokens: ++measures === 1 ? 2100 : 300, contextTokens: 2048, overflow: measures === 1,
      meter: 'NONNATIVE forced-overflow feedback fixture', actualNativeTokenization: false }; },
    async reply() { throw Error('No provider or native model may run in this labeled request-binding fixture.'); },
  } });
  try {
    const source = workspace.conversation.append({ role: 'user', content: 'hello from the copper lighthouse' });
    workspace.conversation.append({ role: 'assistant', content: 'Generated old fixture reply, not source authority.' });
    for (const content of ['An unrelated middle exchange.', 'A protected recent exchange.']) {
      workspace.conversation.append({ role: 'user', content });
      workspace.conversation.append({ role: 'assistant', content: 'Generated fixture response.' });
    }
    workspace.conversation.append({ role: 'user', content: 'Where did hello come from?' });
    const prepared = await workspace.prepare(), hash = prepared.measurement.requestSha256;
    assert.equal(hash, createHash('sha256').update(JSON.stringify(prepared.messages)).digest('hex'));
    assert.equal(prepared.messages.some(message => message.role === 'user' && message.content === source.content), false);
    assert.equal(prepared.messages.filter(message => message.role === 'system' && message.content.includes(source.content)).length, 1);
    assert.ok(prepared.extractiveSources.some(hit => hit.turnId === source.id));
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), hash), []);
    workspace.context.validateDispatch(prepared.messages);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), hash), []);
    workspace.context.dispatched(prepared.messages);
    const owner = { actorId: workspace.ownerScope.actorId, conversationId: workspace.ownerScope.conversationId };
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), hash, owner), ['turn:' + source.id]);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), 'another-request', owner), []);
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), hash, { ...owner, conversationId: 'foreign' }), []);
    await workspace.automaticMemory.search({ query: 'unmatchedvioletwhale' });
    assert.deepEqual(submittedMemoryNodeIds(workspace.context.inspectionSnapshot(), hash, owner), ['turn:' + source.id]);
    assert.equal(workspace.events.list().filter(event => event.type === 'context-dispatched').length, 1);
  } finally { workspace.dispose(); }
});
