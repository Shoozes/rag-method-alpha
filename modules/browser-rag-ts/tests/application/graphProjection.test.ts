import test from "node:test";
import assert from "node:assert/strict";
import { layoutRagGraph, layoutRagGraphAsync, MAX_VISIBLE_GRAPH_NODES, selectRagGraphWindow } from "../../src/application/layoutGraph.js";
import { MAX_GRAPH_LABEL_SCALARS, projectRagGraph } from "../../src/application/graphProjection.js";
import { composeRagConstellations } from "../../src/application/constellationLayout.js";
import { recordFromMapping } from "../../src/core/shared/types.js";

const records = [
  recordFromMapping({ id: "chunk-a", text: "Alpha links [[Beta]]", source_id: "source-a", source_name: "Alpha.md", path: "notes/Alpha.md", scopes: ["browser:local"], authority: "workspace_record", references: ["chunk-b"], metadata: { heading: "Alpha", chunk_index: 0 } }),
  recordFromMapping({ id: "chunk-b", text: "Beta evidence", source_id: "source-b", source_name: "Beta.md", path: "notes/Beta.md", scopes: ["browser:local"], authority: "workspace_record", metadata: { heading: "Beta", chunk_index: 0 } }),
];

test("RAG graph projection preserves explicit source and chunk identity", () => {
  const projection = projectRagGraph(records);
  assert.equal(projection.view, "evidence");
  assert.equal(projection.nodes.filter((node) => node.kind === "source").length, 2);
  assert.equal(projection.nodes.filter((node) => node.kind === "chunk").length, 2);
  assert.equal(projection.links.filter((link) => link.kind === "contains").length, 2);
  assert.equal(projection.links.filter((link) => link.kind === "reference").length, 1);
  const alpha = projection.nodes.find((node) => node.record_id === "chunk-a");
  assert.equal(alpha?.source_id, "source-a");
  assert.equal(alpha?.path, "notes/Alpha.md");
});

test("folder projection is deterministic and application-owned", () => {
  const first = projectRagGraph(records, "folders");
  const second = projectRagGraph([...records].reverse(), "folders");
  assert.deepEqual(second, first);
  assert.equal(first.nodes.some((node) => node.kind === "folder" && node.path === "notes"), true);
  assert.equal(first.nodes.some((node) => node.kind === "chunk"), false);
});

test("display labels are scalar-safe and never change canonical headings", () => {
  const heading = `${"A".repeat(1_024)}😀`;
  const record = recordFromMapping({ id: "long-heading", text: "body", source_id: "source", source_name: "long.md", path: "long.md", scopes: ["browser:local"], authority: "workspace_record", metadata: { heading, chunk_index: 0 } });
  const projection = projectRagGraph([record]);
  const node = projection.nodes.find((candidate) => candidate.record_id === record.id);
  assert.equal(Array.from(node?.label ?? "").length, MAX_GRAPH_LABEL_SCALARS);
  assert.equal(node?.label.endsWith("…"), true);
  assert.equal(record.metadata.heading, heading);
});

test("the pinned force-graph archive lays out the projection without Three or DOM", () => {
  const projection = projectRagGraph(records);
  const layout = layoutRagGraph(projection);
  assert.equal(layout.nodes.length, projection.nodes.length);
  assert.equal(layout.links.length, projection.links.length);
  assert.equal(layout.clipped, false);
  assert.equal(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), true);
});

test("ranked evidence is admitted ahead of the bounded visual window", () => {
  const nodes = Array.from({ length: MAX_VISIBLE_GRAPH_NODES + 1 }, (_, index) => ({ id: `node-${index}`, kind: "chunk" as const, label: `Chunk ${index}`, path: "notes.md", source_id: "source", record_id: `record-${index}` }));
  const projection = { view: "evidence" as const, nodes, links: [], total_nodes: nodes.length, total_links: 0, omitted_nodes: 0, omitted_links: 0, truncated: false, omitted_reference_links: 0 };
  const selected = selectRagGraphWindow(projection, [`record-${MAX_VISIBLE_GRAPH_NODES}`]);
  assert.equal(selected.nodes.length, MAX_VISIBLE_GRAPH_NODES);
  assert.equal(selected.nodes[0]?.record_id, `record-${MAX_VISIBLE_GRAPH_NODES}`);
  assert.equal(selected.nodes.some((node) => node.record_id === "record-499"), false);
});

test("bounded evidence windows retain connected neighborhoods instead of isolated sources", () => {
  const many = Array.from({ length: 120 }, (_, source) => Array.from({ length: 6 }, (_, chunk) => recordFromMapping({ id: `record-${source}-${chunk}`, text: `Evidence ${source} ${chunk}`, source_id: `source-${source}`, source_name: `${source}.md`, path: `topic-${source % 6}/${source}.md`, scopes: ["browser:local"], authority: "workspace_record", metadata: { heading: "Evidence", chunk_index: chunk } }))).flat();
  const projection = projectRagGraph(many);
  const window = selectRagGraphWindow(projection, ["record-119-5"]);
  assert.equal(window.nodes.length, MAX_VISIBLE_GRAPH_NODES);
  assert.equal(window.nodes[0]?.record_id, "record-119-5");
  assert.ok(window.links.length > 350);
  assert.equal(new Set(window.nodes.map(({ path }) => path.split("/")[0])).size, 6);
  assert.ok(window.links.every((link) => projection.links.some(({ id }) => id === link.id)));
});

test("asynchronous layout yields and honors cancellation", async () => {
  const projection = projectRagGraph(records);
  let yields = 0;
  await assert.rejects(
    layoutRagGraphAsync(projection, [], 7, () => { if (yields >= 2) throw new Error("cancelled"); }, async () => { yields += 1; }),
    /cancelled/,
  );
  assert.equal(yields, 2);
});

test("showcase constellations spread path groups without changing graph identity", () => {
  const expanded = [
    ...records,
    recordFromMapping({ id: "chunk-c", text: "Gamma evidence", source_id: "source-c", source_name: "Gamma.md", path: "architecture/Gamma.md", scopes: ["browser:local"], authority: "workspace_record", metadata: { heading: "Gamma", chunk_index: 0 } }),
    recordFromMapping({ id: "chunk-d", text: "Delta evidence", source_id: "source-d", source_name: "Delta.md", path: "operations/Delta.md", scopes: ["browser:local"], authority: "workspace_record", metadata: { heading: "Delta", chunk_index: 0 } }),
  ];
  const laidOut = layoutRagGraph(projectRagGraph(expanded));
  const first = composeRagConstellations(laidOut);
  const second = composeRagConstellations(laidOut);
  assert.deepEqual(second, first);
  assert.deepEqual(first.links, laidOut.links);
  assert.deepEqual(first.nodes.map(({ id, kind, record_id }) => ({ id, kind, record_id })), laidOut.nodes.map(({ id, kind, record_id }) => ({ id, kind, record_id })));
  const groupCenters = new Map<string, { x: number; y: number }>();
  for (const node of first.nodes.filter((candidate) => candidate.kind === "source")) {
    groupCenters.set(node.path.split("/")[0] ?? "", { x: node.x, y: node.y });
  }
  assert.ok(groupCenters.size >= 3);
  assert.ok(Math.max(...[...groupCenters.values()].map(({ x }) => x)) - Math.min(...[...groupCenters.values()].map(({ x }) => x)) > 80);
});
