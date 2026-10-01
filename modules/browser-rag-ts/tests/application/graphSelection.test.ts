import assert from "node:assert/strict";
import test from "node:test";
import { resolveGraphInteraction, resolveSelectedGraphNode } from "../../src/application/graphSelection.js";
import type { PositionedGraphNode } from "../../src/application/layoutGraph.js";

const source: PositionedGraphNode = { id: "source-node", kind: "source", label: "Source", path: "notes/source.md", source_id: "source", record_id: null, x: 0, y: 0 };
const chunk: PositionedGraphNode = { id: "chunk-node", kind: "chunk", label: "Chunk", path: "notes/source.md", source_id: "source", record_id: "chunk", x: 1, y: 1 };
const folder: PositionedGraphNode = { id: "folder-node", kind: "folder", label: "notes", path: "notes", source_id: null, record_id: null, x: 2, y: 2 };
const selection = { selectedRecordId: "chunk", selectedSourceId: "source", selectedFolderPath: null };

test("exact selected record wins regardless of graph node order", () => {
  assert.equal(resolveSelectedGraphNode([source, chunk], selection)?.id, "chunk-node");
  assert.equal(resolveSelectedGraphNode([chunk, source], selection)?.id, "chunk-node");
});

test("source is a deliberate fallback when the selected record is outside the current view", () => {
  assert.equal(resolveSelectedGraphNode([folder, source], selection)?.id, "source-node");
  assert.equal(resolveSelectedGraphNode([folder], selection), null);
});

test("folder selection and hit state remain independent from the selected node", () => {
  assert.equal(resolveSelectedGraphNode([folder], { selectedRecordId: null, selectedSourceId: null, selectedFolderPath: "notes" })?.id, "folder-node");
  assert.deepEqual(
    resolveGraphInteraction([source, chunk], selection, ["chunk"], new Map([["chunk", "source"]])),
    { selectedNodeId: "chunk-node", hitNodeIds: ["source-node", "chunk-node"] },
  );
});
