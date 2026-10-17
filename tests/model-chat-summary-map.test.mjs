import test from 'node:test';
import assert from 'node:assert/strict';
import { projectConversationSummary, submittedSummaryNodeIds } from '../examples/browser-model-chat/memory/panel.mjs';

const summary = { id: 'summary:e-2', eventId: 'e-2', kind: 'summary', scope: 'conversation', derived: true,
  sourceTurnIds: ['t-0001', 't-0003'], text: 'Exact retained excerpt body.' };

test('summary display prioritizes actual authored source nodes, stays bounded and never mutates originals', () => {
  const base = { nodes: Array.from({ length: 12 }, (_, index) => ({ id: 'turn:t-' + String(index + 1).padStart(4, '0') })), links: [], status: { state: 'ready' } };
  const original = structuredClone(base), map = projectConversationSummary(base, summary);
  assert.equal(map.nodes.length, 12); assert.equal(map.nodes[0], summary);
  assert.deepEqual(map.links.map(link => [link.source, link.target]), [['turn:t-0001', summary.id], ['turn:t-0003', summary.id]]);
  assert.deepEqual(base, original);
  assert.ok(map.nodes.some(node => node.id === 'turn:t-0001'));
});

test('a ledger event or missing retained body cannot invent a summary node or missing source endpoints', () => {
  const base = { nodes: [{ id: 'turn:t-0001' }], links: [] };
  for (const value of [null, { ...summary, derived: false }, { ...summary, kind: 'message' }, { ...summary, id: 'invented' }, { ...summary, sourceTurnIds: [] }]) assert.equal(projectConversationSummary(base, value), base);
  assert.equal(projectConversationSummary(base, summary).links.length, 1);
});

test('only exact retained summary text in the same dispatched request and conversation authorizes a summary-use cue', () => {
  const owner = { actorId: 'owner', conversationId: 'chat' };
  const record = { scope: owner, requestSha256: 'actual', exactMessages: [{ role: 'system', content: summary.text }] };
  const snapshot = { lastSubmitted: record };
  assert.deepEqual(submittedSummaryNodeIds(snapshot, 'actual', owner, summary), [summary.id]);
  assert.deepEqual(submittedSummaryNodeIds(snapshot, 'prepared', owner, summary), []);
  assert.deepEqual(submittedSummaryNodeIds({ latestPrepared: record }, 'actual', owner, summary), []);
  assert.deepEqual(submittedSummaryNodeIds(snapshot, 'actual', { ...owner, conversationId: 'foreign' }, summary), []);
  for (const messages of [null, [{ role: 'user', content: summary.text }], [{ role: 'system', content: summary.text + ' additional text' }]]) {
    assert.deepEqual(submittedSummaryNodeIds({ lastSubmitted: { ...record, exactMessages: messages } }, 'actual', owner, summary), []);
  }
});
