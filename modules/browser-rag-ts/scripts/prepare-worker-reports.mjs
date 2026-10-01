import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";
import { contractFile, equalJson, proofSnapshot, repositoryState, runtimeSnapshot } from "./report-common.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(process.argv[index + 1]);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exact(value, fields, label) {
  const objectValue = object(value, label);
  const keys = Object.keys(objectValue).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`${label} has an invalid shape`);
  return objectValue;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function rawReport(value, kind, contract, snapshotDigest) {
  const report = exact(value, ["schema", "protocol_version", "kind", "identity", "contract", "summary", "results"], `worker ${kind} report`);
  if (report.schema !== "browser-rag-ts-worker-actual-report-v1" || report.protocol_version !== 1 || report.kind !== kind) throw new Error(`worker ${kind} report identity is invalid`);
  const identity = exact(report.identity, ["implementation", "language", "module_version"], `worker ${kind} identity`);
  if (identity.implementation !== "rag-method-browser-ts-worker" || identity.language !== "typescript") throw new Error(`worker ${kind} identity is invalid`);
  string(identity.module_version, `worker ${kind} module version`);
  const contractValue = exact(report.contract, ["id", "version", "runtime_snapshot_digest", "input_digests"], `worker ${kind} contract`);
  if (contractValue.id !== contract || contractValue.runtime_snapshot_digest !== snapshotDigest || !Number.isInteger(contractValue.version)) throw new Error(`worker ${kind} contract identity is invalid`);
  object(contractValue.input_digests, `worker ${kind} input digests`);
  const summary = exact(report.summary, ["cases", "errors"], `worker ${kind} summary`);
  if (!Number.isInteger(summary.cases) || !Number.isInteger(summary.errors) || !Array.isArray(report.results) || summary.cases !== report.results.length) throw new Error(`worker ${kind} summary is invalid`);
  const seen = new Set();
  for (const result of report.results) {
    const expectedKeys = kind === "indexing" ? ["id", "actual"] : ["id", "mode", "actual"];
    const entry = exact(result, expectedKeys, `worker ${kind} case`);
    const id = string(entry.id, `worker ${kind} case id`);
    if (seen.has(id)) throw new Error(`worker ${kind} report has duplicate case ID ${id}`);
    seen.add(id);
    object(entry.actual, `worker ${kind} actual observation`);
    if (kind === "retrieval") string(entry.mode, `worker retrieval case mode`);
  }
  const errors = report.results.filter((result) => result.actual.status === "error").length;
  if (errors !== summary.errors) throw new Error(`worker ${kind} error count is inconsistent`);
  return report;
}

function expectedIndexing(proof) {
  return contractFile(proof, "rag-indexing-v1", "expected.json").observations;
}

function expectedRetrieval(proof) {
  const manifest = contractFile(proof, "rag-behavior-v2", "manifest.json");
  const expected = new Map();
  for (const path of Object.values(manifest.files.expected)) {
    const payload = contractFile(proof, "rag-behavior-v2", path);
    for (const [id, actual] of Object.entries(payload.cases)) expected.set(id, actual);
  }
  return expected;
}

function projectIndexing(raw, expected, cases) {
  const actual = new Map(raw.results.map((result) => [result.id, result.actual]));
  const results = cases.map((fixture) => {
    const frozen = expected[fixture.id];
    const observed = actual.get(fixture.id);
    if (frozen === undefined || observed === undefined) throw new Error(`worker indexing case set does not match fixture ${fixture.id}`);
    return { id: fixture.id, passed: equalJson(observed, frozen), expected: frozen, actual: observed };
  });
  if (actual.size !== results.length) throw new Error("worker indexing report includes unknown fixture cases");
  const passed = results.filter((result) => result.passed).length;
  return {
    contract: "rag-indexing-v1-report",
    profile_id: "rag-indexing-v1-portable",
    runner: { implementation: "rag-method-browser-ts-worker", language: "typescript", version: 1 },
    repository: repositoryState(),
    summary: { cases: results.length, passed, failed: results.length - passed },
    results,
  };
}

function projectRetrieval(raw, expected, cases) {
  const actual = new Map(raw.results.map((result) => [result.id, result]));
  const results = cases.map((fixture) => {
    const reported = actual.get(fixture.id);
    const frozen = expected.get(fixture.id);
    if (!reported || frozen === undefined) throw new Error(`worker retrieval case set does not match fixture ${fixture.id}`);
    if (reported.mode !== fixture.mode) throw new Error(`worker retrieval mode differs for ${fixture.id}`);
    return { id: fixture.id, mode: fixture.mode, passed: equalJson(reported.actual, frozen), expected: frozen, actual: reported.actual };
  });
  if (actual.size !== results.length) throw new Error("worker retrieval report includes unknown fixture cases");
  const passed = results.filter((result) => result.passed).length;
  return {
    contract: "rag-behavior-v2-report",
    profile_id: "rag-behavior-v2-edge-derived",
    runner: { implementation: "rag-method-browser-ts-worker", language: "typescript", version: 1 },
    repository: repositoryState(),
    summary: { cases: results.length, passed, failed: results.length - passed },
    results,
  };
}

const indexingInput = argument("--indexing");
const retrievalInput = argument("--retrieval");
const output = resolve(process.argv.includes("--output-dir") ? argument("--output-dir") : join(MODULE_ROOT, "..", "..", ".artifacts", "proof", "browser-rag-ts"));
const [runtime, proof, rawIndexing, rawRetrieval] = await Promise.all([runtimeSnapshot(), proofSnapshot(), readJson(indexingInput), readJson(retrievalInput)]);
const indexing = rawReport(rawIndexing, "indexing", "rag-indexing-v1", runtime.snapshot_digest);
const retrieval = rawReport(rawRetrieval, "retrieval", "rag-behavior-v2", runtime.snapshot_digest);
const indexingCases = contractFile(runtime, "rag-indexing-v1", "fixture-documents.json").cases;
const retrievalCases = contractFile(runtime, "rag-behavior-v2", "cases.json").cases;
const indexingReport = projectIndexing(indexing, expectedIndexing(proof), indexingCases);
const retrievalReport = projectRetrieval(retrieval, expectedRetrieval(proof), retrievalCases);
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(join(output, "indexing-browser.json"), `${JSON.stringify(indexingReport, null, 2)}\n`, "utf8"),
  writeFile(join(output, "retrieval-browser.json"), `${JSON.stringify(retrievalReport, null, 2)}\n`, "utf8"),
]);
process.stdout.write(`${JSON.stringify({ indexing: join(output, "indexing-browser.json"), retrieval: join(output, "retrieval-browser.json") })}\n`);
