import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../../src/worker/rag.worker.js";
import { validateRequest, validateOperationResult, type GetContextResult } from "../../src/worker/protocol.js";
import { formatContextPacket, assertContextMatches } from "../../src/application/contextPacket.js";
import type { RetrievalObservation } from "../../src/reports/reportTypes.js";

let sequence = 0;
async function request(operation: string, payload?: unknown) {
  const request_id = `context-test-${++sequence}`;
  return { request_id, response: await handleRequest(validateRequest({ version: 1, request_id, operation, ...(payload === undefined ? {} : { payload }) })) };
}
test("context is verbatim, ordered, query-bound, and cleared on accepted replacement", async () => {
  const content = "# Context\nVerbatim marker <script>alert(1)</script> & café.\n\nSecond paragraph retains its newline.";
  await request("load-documents", { documents: [{ path: "notes/source.md", format: "markdown", content }] });
  const searched = await request("search", { query: "Verbatim marker", options: { mode: "keyword_only", top_k: 8 } });
  assert.equal(searched.response.status, "ok");
  if (searched.response.status !== "ok") return;
  const observation = searched.response.result as RetrievalObservation;
  const payload = { query_id: searched.request_id, expected_query: "Verbatim marker", expected_record_ids: observation.context_selected_ids };
  const result = (await request("get-context", payload)).response;
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const context = validateOperationResult("get-context", result.result) as GetContextResult;
  assertContextMatches(context, searched.request_id, "Verbatim marker", observation);
  assert.ok(context.chunks[0]?.text.includes("<script>alert(1)</script> & café."));
  for (const chunk of context.chunks) assert.ok(formatContextPacket(context).includes(chunk.text));
  assert.throws(() => assertContextMatches(context, "different-request", "Verbatim marker", observation));
  for (const mismatch of [{ query_id: "other" }, { expected_query: "other" }, { expected_record_ids: [] }]) {
    assert.equal((await request("get-context", { ...payload, ...mismatch })).response.status, "error");
  }
  const failed = await request("load-documents", { documents: [{ path: "empty.md", format: "markdown", content: "" }] });
  assert.equal(failed.response.status, "error");
  assert.equal((await request("get-context", payload)).response.status, "ok");
  await request("load-documents", { documents: [{ path: "new.md", format: "markdown", content: "New corpus" }] });
  assert.equal((await request("get-context", payload)).response.status, "error");
});
