import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileCore, contractFile, equalJson, proofSnapshot, repositoryState, retrievalObservation, runtimeSnapshot, ROOT } from "./report-common.mjs";

const runtime = await runtimeSnapshot();
const proof = await proofSnapshot();
const core = await compileCore();
const recordsPayload = contractFile(runtime, "rag-behavior-v2", "fixture-records.json");
const vectorsPayload = contractFile(runtime, "rag-behavior-v2", "fixture-vectors.json");
const casesPayload = contractFile(runtime, "rag-behavior-v2", "cases.json");
core.assertFrozenRetrievalProfile(contractFile(runtime, "rag-behavior-v2", "retrieval-profile.json"));
const records = recordsPayload.records.map((record) => core.recordFromMapping(record));
const vectors = vectorsPayload.record_vectors;
const expectedByCase = new Map();
const expectedFiles = proof.contracts["rag-behavior-v2"].files["manifest.json"].data.files.expected;
for (const path of Object.values(expectedFiles)) {
  const payload = contractFile(proof, "rag-behavior-v2", path);
  for (const [id, value] of Object.entries(payload.cases)) expectedByCase.set(id, value);
}
const engine = new core.RagEngine(records);
const results = [];
for (const fixture of casesPayload.cases) {
  const response = engine.search(fixture.query, {
    mode: fixture.mode,
    top_k: fixture.top_k,
    include_scopes: fixture.include_scopes,
    exclude_scopes: fixture.exclude_scopes,
    scope_priorities: fixture.scope_priorities,
    authority_policy: fixture.authority_policy,
    vectors: fixture.query_vector_id ? vectors : undefined,
    query_vector: fixture.query_vector_id ? vectorsPayload.query_vectors[fixture.query_vector_id] : undefined,
    query_embedding_profile_id: fixture.query_vector_id ? vectorsPayload.profile_id : undefined,
    semantic_enabled: fixture.semantic_enabled,
    semantic_fallback_reason: fixture.semantic_fallback_reason,
    expand: fixture.expand,
    max_context_tokens: fixture.max_context_tokens,
  });
  const actual = retrievalObservation(response);
  const frozen = expectedByCase.get(fixture.id);
  results.push({ id: fixture.id, mode: fixture.mode, passed: equalJson(actual, frozen), expected: frozen, actual });
}
const passed = results.filter((result) => result.passed).length;
const report = {
  contract: "rag-behavior-v2-report",
  profile_id: "rag-behavior-v2-edge-derived",
  runner: { implementation: "rag-method-browser-ts-node", language: "typescript", version: 1 },
  repository: repositoryState(),
  summary: { cases: results.length, passed, failed: results.length - passed },
  results,
};
const outputFlag = process.argv.indexOf("--output");
const output = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : join(ROOT, ".artifacts", "proof", "browser-rag-ts", "retrieval-node.json"));
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`rag-behavior-v2 TypeScript: ${passed}/${results.length} cases passed`);
console.log(`Report: ${output}`);
process.exitCode = passed === results.length ? 0 : 1;
