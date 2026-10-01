import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../../src/worker/rag.worker.js";
import { MAX_BROWSER_EXCERPT_SCALARS, WorkerProtocolError, validateOperationResult } from "../../src/worker/protocol.js";

test("operation result validators reject malformed results before callers can use them", async () => {
  assert.throws(() => validateOperationResult("cancel", { cancelled: "bad id" }), WorkerProtocolError);
  assert.throws(() => validateOperationResult("dispose", { disposed: false }), WorkerProtocolError);
  assert.throws(() => validateOperationResult("search", { ordered_ids: [] }), WorkerProtocolError);
  assert.throws(() => validateOperationResult("get-graph", { view: "evidence", nodes: [], links: [{ id: "orphan", source: "missing", target: "missing", kind: "reference" }], truncated: false, omitted_reference_links: 0 }), WorkerProtocolError);
  const initialized = await handleRequest({ version: 1, request_id: "conformance-result-init", operation: "initialize", payload: undefined });
  assert.equal(initialized.status, "ok");
  if (initialized.status !== "ok") throw new Error("initialization did not succeed");
  const valid = validateOperationResult("initialize", initialized.result);
  assert.equal(valid.status, "initialized");

  const loaded = await handleRequest({
    version: 1,
    request_id: "conformance-result-load",
    operation: "load-documents",
    payload: { documents: [{ path: "local.md", format: "markdown", content: "# Local\nBounded excerpt." }] },
  });
  assert.equal(loaded.status, "ok");
  if (loaded.status !== "ok") throw new Error("local document load did not succeed");
  const loadResult = validateOperationResult("load-documents", loaded.result);
  const chunk = loadResult.chunks[0];
  if (!chunk) throw new Error("local document result did not contain a chunk");
  assert.equal(chunk.excerpt, "# Local Bounded excerpt.");
  assert.throws(() => validateOperationResult("load-documents", {
    ...loadResult,
    chunks: [{ ...chunk, excerpt: "x".repeat(MAX_BROWSER_EXCERPT_SCALARS + 2) }],
  }), WorkerProtocolError);
  const graphResponse = await handleRequest({ version: 1, request_id: "conformance-result-graph", operation: "get-graph", payload: { view: "evidence" } });
  assert.equal(graphResponse.status, "ok");
  if (graphResponse.status !== "ok") throw new Error("graph projection did not succeed");
  const graph = validateOperationResult("get-graph", graphResponse.result);
  assert.equal(graph.nodes.some((node) => node.record_id === chunk.id && node.source_id !== null), true);
});
