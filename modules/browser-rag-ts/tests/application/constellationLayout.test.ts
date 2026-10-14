import test from "node:test";
import assert from "node:assert/strict";
import { composeRagConstellations } from "../../src/application/constellationLayout.js";
import { layoutRagGraph } from "../../src/application/layoutGraph.js";
import { projectRagGraph } from "../../src/application/graphProjection.js";
import { recordFromMapping } from "../../src/core/shared/types.js";

test("uneven constellations have separate bounds and preserve every semantic field", () => {
  const input = Array.from({ length: 180 }, (_, index) => recordFromMapping({
    id: `packing-${index}`, text: `Source ${index}`, source_id: `source-${index}`,
    source_name: `${index}.md`, path: `${index < 160 ? "large" : index < 179 ? "medium" : "tiny"}/${index}.md`,
    scopes: ["browser:local"], authority: "workspace_record", metadata: { heading: `Source ${index}`, chunk_index: 0 },
  }));
  const projected = layoutRagGraph(projectRagGraph(input));
  const composed = composeRagConstellations(projected);
  const reversed = composeRagConstellations({ ...projected, nodes: [...projected.nodes].reverse() });
  const byId = new Map(reversed.nodes.map(node => [node.id, node]));
  for (const [index, node] of composed.nodes.entries()) {
    const { x: _x, y: _y, ...before } = projected.nodes[index]!;
    const { x, y, ...after } = node;
    assert.deepEqual(after, before);
    assert.deepEqual(node, byId.get(node.id));
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
  assert.equal(composed.links, projected.links);
  const bounds = ["large", "medium", "tiny"].map(family => {
    const nodes = composed.nodes.filter(node => node.path.startsWith(`${family}/`));
    return { minX: Math.min(...nodes.map(n => n.x)), maxX: Math.max(...nodes.map(n => n.x)),
      minY: Math.min(...nodes.map(n => n.y)), maxY: Math.max(...nodes.map(n => n.y)) };
  });
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i]!, b = bounds[j]!;
    assert.ok(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY,
      "families must not collapse into the same neighborhood");
  }
});
