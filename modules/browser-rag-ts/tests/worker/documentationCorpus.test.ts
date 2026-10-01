import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleRequest } from "../../src/worker/rag.worker.js";
import type { WorkerResponse } from "../../src/worker/protocol.js";
import { documentationPresets } from "../../src/application/documentationPrompts.js";

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
  const loaded = ok(await handleRequest({ version: 1, request_id: "docs-load", operation: "load-documents", payload: { documents: pack.documents } })) as { documents: number; records: number; chunks: Array<{ id: string; path: string }> };
  assert.equal(loaded.documents, 921);
  assert.equal(loaded.records, 10_965);
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
});
