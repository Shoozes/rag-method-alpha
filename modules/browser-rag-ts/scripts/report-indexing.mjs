import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";
import { compileCore, contractFile, equalJson, indexingObservation, proofSnapshot, repositoryState, runtimeSnapshot, ROOT } from "./report-common.mjs";

const runtime = await runtimeSnapshot();
const proof = await proofSnapshot();
const core = await compileCore();
const fixtures = contractFile(runtime, "rag-indexing-v1", "fixture-documents.json");
const expected = contractFile(proof, "rag-indexing-v1", "expected.json");
const results = [];
for (const fixture of fixtures.cases) {
  let actual;
  try {
    const document = await core.indexDocument(fixture.content, {
      format: fixture.format,
      path: fixture.path,
      pocket: fixture.pocket,
      scopes: fixture.scopes,
      authority: fixture.authority,
      priority: fixture.priority,
      limits: fixture.limits,
    });
    actual = { status: "ok", document: indexingObservation(document) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    actual = { status: "error", error: { code: typeof code === "string" ? code : "unknown" } };
  }
  const frozen = expected.observations[fixture.id];
  results.push({ id: fixture.id, passed: equalJson(actual, frozen), expected: frozen, actual });
}
const passed = results.filter((result) => result.passed).length;
const report = {
  contract: "rag-indexing-v1-report",
  profile_id: "rag-indexing-v1-portable",
  runner: { implementation: "rag-method-browser-ts-node", language: "typescript", version: 1 },
  repository: repositoryState(),
  summary: { cases: results.length, passed, failed: results.length - passed },
  results,
};
const outputFlag = process.argv.indexOf("--output");
const output = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : join(ROOT, ".artifacts", "proof", "browser-rag-ts", "indexing-node.json"));
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`rag-indexing-v1 TypeScript: ${passed}/${results.length} cases passed`);
console.log(`Report: ${output}`);
process.exitCode = passed === results.length ? 0 : 1;
