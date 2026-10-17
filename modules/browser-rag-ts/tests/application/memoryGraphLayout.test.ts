import test from "node:test";
import assert from "node:assert/strict";
import { layoutMemoryGraph } from "../../src/application/memoryGraphLayout.js";
import { layoutRagGraph, MAX_VISIBLE_GRAPH_LINKS, MAX_VISIBLE_GRAPH_NODES } from "../../src/application/layoutGraph.js";
import type { PositionedMemoryGraph } from "../../src/application/memoryGraphLayout.js";
import type { RagGraphNode, RagGraphProjection } from "../../src/application/graphProjection.js";

function fixture(count = 24): RagGraphProjection {
  const nodes = Array.from({ length: count }, (_, index) => Object.freeze({
    id: `node-${String(index).padStart(4, "0")}`,
    kind: index % 4 === 0 ? "source" as const : "chunk" as const,
    label: `Real fragment ${index}`,
    path: `scope-${index % 3}/source-${Math.floor(index / 4)}.md`,
    source_id: `source-${Math.floor(index / 4)}`,
    record_id: `record-${index}`,
  }));
  const links = nodes.slice(1).map((node, index) => Object.freeze({
    id: `link-${String(index).padStart(4, "0")}`,
    source: nodes[Math.floor(index / 2)]!.id, target: node.id, kind: "contains" as const,
  }));
  return Object.freeze({ view: "evidence", nodes: Object.freeze(nodes), links: Object.freeze(links),
    total_nodes: nodes.length, total_links: links.length, omitted_nodes: 0, omitted_links: 0,
    truncated: false, omitted_reference_links: 0 });
}

const coordinates = (layout: PositionedMemoryGraph) => layout.nodes.map(node => ({ id: node.id, x: node.x, y: node.y, z: node.z }));
const span = (layout: PositionedMemoryGraph, axis: "x" | "y" | "z") => Math.max(...layout.nodes.map(node => node[axis])) - Math.min(...layout.nodes.map(node => node[axis]));
const semantic = (node: RagGraphNode) => ({ id: node.id, kind: node.kind, label: node.label,
  path: node.path, source_id: node.source_id, record_id: node.record_id });

test("memory layout uses deterministic real 3D positions regardless of node/link input order", () => {
  const projection = fixture();
  const first = layoutMemoryGraph(projection), repeated = layoutMemoryGraph(projection);
  const reordered = layoutMemoryGraph({ ...projection, nodes: [...projection.nodes].reverse(), links: [...projection.links].reverse() });
  assert.deepEqual(coordinates(repeated), coordinates(first));
  assert.deepEqual(coordinates(reordered), coordinates(first));
  assert.deepEqual(reordered.links, first.links);
  assert.equal(first.layout_steps, 160);
  assert.equal(first.nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite)), true);
  assert.ok(span(first, "z") > 10, "depth is materially more than a node-kind layer");
  const depthRatio = span(first, "z") / Math.max(span(first, "x"), span(first, "y"));
  assert.ok(depthRatio >= 0.3 - 1e-12 && depthRatio <= 0.5 + 1e-12);
});

test("spatial layout preserves canonical identity, relationships, metadata and frozen inputs", () => {
  const projection = fixture(), before = JSON.stringify(projection);
  const result = layoutMemoryGraph(projection, ["record-23"]);
  assert.equal(JSON.stringify(projection), before);
  assert.deepEqual(result.nodes.map(semantic), projection.nodes.map(semantic));
  assert.deepEqual(result.links, projection.links);
  assert.equal(result.total_nodes, projection.total_nodes); assert.equal(result.total_links, projection.total_links);
  assert.equal(result.omitted_nodes, 0); assert.equal(result.omitted_links, 0); assert.equal(result.clipped, false);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.nodes), true);
  assert.equal(result.nodes.every(Object.isFrozen), true);
  assert.equal(projection.nodes.some(node => Object.hasOwn(node, "x") || Object.hasOwn(node, "z")), false);
});

test("portrait and landscape adapt XY framing while preserving actual depth and topology", () => {
  const projection = fixture();
  const portrait = layoutMemoryGraph(projection, [], { aspect: 0.5 });
  const landscape = layoutMemoryGraph(projection, [], { aspect: 2 });
  assert.ok(span(portrait, "x") < span(landscape, "x"));
  assert.ok(span(portrait, "y") > span(landscape, "y"));
  assert.deepEqual(portrait.nodes.map(semantic), landscape.nodes.map(semantic));
  assert.deepEqual(portrait.links, landscape.links);
  for (const result of [portrait, landscape]) {
    const ratio = span(result, "z") / Math.max(span(result, "x"), span(result, "y"));
    assert.ok(ratio >= 0.3 - 1e-12 && ratio <= 0.5 + 1e-12);
    assert.ok(result.nodes.every(node => [node.x, node.y, node.z].every(value => Number.isFinite(value) && Math.abs(value) <= 210)));
  }
});

test("clipped 3D windows remain deterministic, finite and bounded, retaining preferred records", () => {
  const base = fixture(MAX_VISIBLE_GRAPH_NODES + 5), preferred = [`record-${MAX_VISIBLE_GRAPH_NODES + 4}`];
  const references = Array.from({ length: MAX_VISIBLE_GRAPH_LINKS + 100 }, (_, index) => ({
    id: `reference-${index}`, source: base.nodes[index % 400]!.id,
    target: base.nodes[(index + 13) % 400]!.id, kind: "reference" as const,
  }));
  const projection = { ...base, links: [...base.links, ...references], total_links: base.links.length + references.length };
  const result = layoutMemoryGraph(projection, preferred);
  const reordered = layoutMemoryGraph({ ...projection, nodes: [...projection.nodes].reverse(), links: [...projection.links].reverse() }, preferred);
  assert.deepEqual(coordinates(reordered), coordinates(result));
  assert.deepEqual(reordered.links, result.links);
  assert.equal(result.nodes.length, MAX_VISIBLE_GRAPH_NODES);
  assert.equal(result.links.length, MAX_VISIBLE_GRAPH_LINKS);
  assert.ok(result.nodes.some(node => node.record_id === preferred[0]));
  assert.equal(result.layout_steps, 80); assert.equal(result.clipped, true);
  assert.equal(result.omitted_nodes, 5);
  assert.equal(result.omitted_links, projection.links.length - result.links.length);
  assert.ok(Number.isFinite(result.layout_ms) && result.layout_ms >= 0);
  assert.ok(result.nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite)));
  const ids = new Set(result.nodes.map(node => node.id));
  assert.ok(result.links.every(link => ids.has(link.source) && ids.has(link.target)));
});

test("empty and singleton layouts need zero simulation steps and invalid aspects fail before layout", () => {
  const empty = layoutMemoryGraph(fixture(0)), single = layoutMemoryGraph(fixture(1));
  assert.equal(empty.layout_steps, 0); assert.deepEqual(empty.nodes, []);
  assert.equal(single.layout_steps, 0); assert.deepEqual(coordinates(single), [{ id: "node-0000", x: 0, y: 0, z: 0 }]);
  for (const aspect of [0, -1, NaN, Infinity]) assert.throws(() => layoutMemoryGraph(fixture(), [], { aspect }), /aspect/);
  const extreme = layoutMemoryGraph(fixture(), [], { aspect: 1e30 });
  assert.ok(extreme.nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite)));
});

test("opting into memory spatial layout leaves the shared RAG layout planar", () => {
  const projection = fixture(), before = layoutRagGraph(projection);
  layoutMemoryGraph(projection);
  const after = layoutRagGraph(projection);
  assert.deepEqual(after.nodes, before.nodes);
  assert.deepEqual(after.links, before.links);
  assert.equal(after.nodes.some(node => Object.hasOwn(node, "z")), false);
});
