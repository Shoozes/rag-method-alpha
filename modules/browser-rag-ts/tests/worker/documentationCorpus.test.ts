import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleRequest } from "../../src/worker/rag.worker.js";
import type { GetContextResult, GetSourceResult, LoadDocumentsResult, WorkerResponse } from "../../src/worker/protocol.js";
import { documentationPresets } from "../../src/application/documentationPrompts.js";
import { assertContextMatches, formatContextPacket } from "../../src/application/contextPacket.js";
import type { RetrievalObservation } from "../../src/reports/reportTypes.js";

function ok(response: WorkerResponse): unknown {
  assert.equal(response.status, "ok");
  if (response.status !== "ok") throw new Error("worker response failed");
  return response.result;
}

test("the pinned documentation pack loads through the real importer and meets its independent lexical evaluation", async () => {
  const pack = JSON.parse(await readFile(`${process.cwd()}/demo/public/corpora/threejs-docs.pack.json`, "utf8")) as { documents: Array<{ path: string; format: "markdown"; content: string; metadata: Record<string, string> }> };
  const evaluation = JSON.parse(await readFile(`${process.cwd()}/../../corpora/threejs-docs/evaluation.json`, "utf8")) as { cases: Array<{ id: string; query: string; relevant_paths: string[] }> };
  for (const preset of documentationPresets) {
    assert.ok(evaluation.cases.some((entry) => entry.query === preset.query && entry.relevant_paths.length > 0), `Independent judgment missing for displayed prompt ${preset.id}`);
    assert.equal(preset.mode, "keyword_only");
    assert.equal(preset.topK, 8);
    assert.equal(preset.scopes, "browser:local");
  }
  ok(await handleRequest({ version: 1, request_id: "docs-init", operation: "initialize", payload: undefined }));
  const loaded = ok(await handleRequest({ version: 1, request_id: "docs-load", operation: "load-documents", payload: { documents: pack.documents } })) as LoadDocumentsResult;
  assert.equal(loaded.documents, 921);
  // V2 link labels split one paragraph in primitives and one in textures.
  assert.equal(loaded.records, 10_967);
  const pathByRecord = new Map(loaded.chunks.map((chunk) => [chunk.id, chunk.path]));
  for (const [index, evaluationCase] of evaluation.cases.entries()) {
    const observation = ok(await handleRequest({
      version: 1,
      request_id: `docs-query-${index}`,
      operation: "search",
      payload: { query: evaluationCase.query, options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 8, expand: true } },
    })) as { ordered_ids: string[] };
    const paths = new Set(observation.ordered_ids.map((id) => pathByRecord.get(id)).filter((path): path is string => path !== undefined));
    if (!evaluationCase.relevant_paths.length) assert.equal(observation.ordered_ids.length, 0, evaluationCase.id);
    else assert.equal(evaluationCase.relevant_paths.some((path) => paths.has(path)), true, `${evaluationCase.id}: ${[...paths].join(", ")}`);
  }
  const uniformChunk = loaded.chunks.find((chunk) => chunk.path === "api/UniformsGroup.md");
  if (!uniformChunk) throw new Error("Expected the bundled UniformsGroup source");
  const source = ok(await handleRequest({ version: 1, request_id: "docs-fixed-source", operation: "get-source", payload: { record_id: uniformChunk.id } })) as GetSourceResult;
  const original = pack.documents.find((document) => document.path === source.path);
  if (!original) throw new Error("Expected exact source text in the documentation pack");
  assert.equal(source.content, original.content);
  assert.equal(source.source_url, original.metadata.source_url);
  assert.equal(source.content_sha256, original.metadata.content_sha256);
  const fixedUrl = "https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/common/UniformBuffer.js";
  assert.ok(source.content.includes(fixedUrl));
  assert.ok(source.content.includes("(upstream; outside the offline vault)"));
  const query = "UniformBuffer";
  const queryId = "docs-fixed-links-query";
  const observation = ok(await handleRequest({ version: 1, request_id: queryId, operation: "search", payload: { query, options: { mode: "keyword_only", include_scopes: ["browser:local"], top_k: 8, expand: true } } })) as RetrievalObservation;
  const context = ok(await handleRequest({ version: 1, request_id: "docs-fixed-links-context", operation: "get-context", payload: { query_id: queryId, expected_query: query, expected_record_ids: observation.context_selected_ids } })) as GetContextResult;
  assertContextMatches(context, queryId, query, observation);
  const copied = formatContextPacket(context);
  assert.ok(copied.includes(fixedUrl));
  assert.ok(copied.includes("(upstream; outside the offline vault)"));
  for (const chunk of context.chunks) assert.ok(copied.includes(chunk.text));
});
