import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMemoryMap } from '../examples/browser-model-chat/memory/panel.mjs';
const turn = id => ({ id, role: 'user', content: 'Exact source ' + id });
const record = (id, source, text = 'Saved ' + id) => ({ id, version: 2, sourceTurnIds: [source], text });
function actual(active, turns) {
  return { nodes: [...active.map(item => ({ id: 'record:' + item.id })), ...turns.map(item => ({ id: 'turn:' + item.id }))],
    links: active.flatMap(item => [{ source: 'event:' + item.id, target: 'record:' + item.id },
      ...item.sourceTurnIds.map(id => ({ source: 'event:' + item.id, target: 'turn:' + id }))]) };
}
test('empty active memory does not fabricate nodes from old events or conversation text', () => {
  const turns = [turn('t1')], old = [record('old', 't1')];
  assert.deepEqual(projectMemoryMap({ active: [], turns, graphData: actual(old, turns) }), { nodes: [], links: [] });
});
test('admit bounded real nodes, prioritize older matching records and retain exact identities', () => {
  const turns = Array.from({ length: 12 }, (_, n) => turn('t' + n));
  const active = turns.map((source, n) => record('m' + n, source.id));
  const view = projectMemoryMap({ active, turns, graphData: actual(active, turns), preferredRecordIds: ['m0', 'unknown'] });
  assert.equal(view.nodes.filter(node => node.kind === 'record').length, 6);
  assert.ok(view.nodes.length <= 12); assert.equal(view.links.length, 6);
  assert.equal(view.nodes[0].id, 'record:m0'); assert.equal(view.nodes[0].version, 2);
  assert.ok(!view.nodes.some(node => node.id.includes('unknown')));
  assert.throws(() => projectMemoryMap({ active, turns, graphData: actual(active, turns), limit: 99 }), /at most six/);
});
test('shared sources remain one real node and only actual operation relationships become edges', () => {
  const turns = [turn('t1')], active = [record('m1', 't1'), record('m2', 't1')], graphData = actual(active, turns);
  const view = projectMemoryMap({ active, turns, graphData });
  assert.equal(view.nodes.length, 3); assert.equal(view.links.length, 2);
  graphData.links = graphData.links.filter(link => link.target !== 'record:m2');
  assert.equal(projectMemoryMap({ active, turns, graphData }).links.length, 1);
});
test('missing graph members and assistant-authored sources cannot become graph evidence', () => {
  const turns = [{ ...turn('t1'), role: 'assistant' }], active = [record('m1', 't1')];
  const data = actual(active, turns);
  assert.deepEqual(projectMemoryMap({ active, turns, graphData: data }).nodes.map(node => node.id), ['record:m1']);
  assert.deepEqual(projectMemoryMap({ active, turns, graphData: { nodes: [], links: [] } }), { nodes: [], links: [] });
});
