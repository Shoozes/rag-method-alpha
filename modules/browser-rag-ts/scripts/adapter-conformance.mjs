import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULE_ROOT } from "./tool.mjs";

const ROOT = resolve(MODULE_ROOT, "../..");
const DIST = join(MODULE_ROOT, ".artifacts", "test-dist");
const FIXTURE = join(MODULE_ROOT, "tests", "fixtures", "unicode-conformance-v1.json");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const output = resolve(argument("--output", join(ROOT, ".artifacts", "proof", "browser-rag-ts", "adapter-conformance-node.json")));
const core = await import(pathToFileURL(join(DIST, "src", "core", "index.js")).href);
const generated = await import(pathToFileURL(join(DIST, "src", "core", "shared", "generated", "casefold-v1.js")).href);
const pythonUnicode = await import(pathToFileURL(join(DIST, "src", "core", "shared", "generated", "python-unicode-v1.js")).href);
const reports = await import(pathToFileURL(join(DIST, "src", "reports", "observations.js")).href);
const worker = await import(pathToFileURL(join(DIST, "src", "worker", "rag.worker.js")).href);
const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));

const unicodeCases = fixture.cases.map((entry) => ({
  id: entry.id,
  retrieval_lowercase: core.lowercaseContractText(entry.input),
  identity_casefold: core.fullContractCasefold(entry.input),
}));

function mappingEvidence(transform) {
  const hash = createHash("sha256");
  let mappings = 0;
  for (let codepoint = 0; codepoint <= 0x10ffff; codepoint += 1) {
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) continue;
    const input = String.fromCodePoint(codepoint);
    const output = transform(input);
    if (output === input) continue;
    hash.update(`${codepoint.toString(16).toUpperCase()}:${[...output].map((scalar) => scalar.codePointAt(0).toString(16).toUpperCase()).join(",")}\n`);
    mappings += 1;
  }
  return { mappings, sha256: hash.digest("hex") };
}

function setEvidence(predicate) {
  const hash = createHash("sha256");
  let scalars = 0;
  for (let codepoint = 0; codepoint <= 0x10ffff; codepoint += 1) {
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) continue;
    if (!predicate(codepoint)) continue;
    hash.update(`${codepoint.toString(16).toUpperCase()}\n`);
    scalars += 1;
  }
  return { scalars, sha256: hash.digest("hex") };
}

const unicodeExhaustive = {
  nfkc: mappingEvidence(core.normalizeNfkc),
  raw_lowercase: mappingEvidence(core.lowercasePythonUnicode),
  lowercase: mappingEvidence(core.lowercaseContractText),
  casefold: mappingEvidence(core.fullContractCasefold),
  alphanumeric: setEvidence(core.isPythonUnicodeAlphanumericCodepoint),
  whitespace: setEvidence(core.isPythonUnicodeWhitespaceCodepoint),
};
const record = (id, text, overrides = {}) => core.recordFromMapping({
  id,
  text,
  source_id: `source-${id}`,
  source_name: `${id}.md`,
  path: `${id}.md`,
  pocket: "conformance",
  scopes: ["global"],
  authority: "workspace_record",
  priority: 0,
  provenance: { file_source: true, chunk_source: true },
  references: [],
  embedding_profile_id: null,
  ...overrides,
});
const seed = "browser-rag-ts-adapter-conformance-v4";
const seededRecords = [
  record("duplicate-a", "shared 𐀀 signal", { source_id: "source-a", source_name: "A", priority: -10, scopes: ["global", "workspace:edge"] }),
  record("duplicate-b", "shared 𐀀 signal", { source_id: "source-b", source_name: "B", priority: 10, scopes: ["workspace:edge"] }),
  record("memory", "shared 𐀀 signal", { authority: "conversation_memory", scopes: ["memory"], references: ["duplicate-a"] }),
  record("reference", "unrelated reference", { source_id: "source-reference", references: ["duplicate-b"] }),
];
const engine = new core.RagEngine(seededRecords);
const seededResult = reports.retrievalObservation(engine.search("shared 𐀀 signal", {
  mode: "scoped_hybrid",
  top_k: 3,
  include_scopes: ["workspace:edge"],
  scope_priorities: { "workspace:edge": 25 },
}));

const initialized = await worker.handleRequest({ version: 1, request_id: "adapter-init", operation: "initialize", payload: undefined });
if (initialized.status !== "ok") throw new Error("representative Worker initialization failed");
const searched = await worker.handleRequest({ version: 1, request_id: "adapter-search", operation: "search", payload: { query: "release canary is amber", options: { mode: "exact_only", top_k: 1 } } });
if (searched.status !== "ok") throw new Error("representative Worker search failed");
const disposed = await worker.handleRequest({ version: 1, request_id: "adapter-dispose", operation: "dispose", payload: undefined });
if (disposed.status !== "ok") throw new Error("representative Worker disposal failed");

const report = {
  schema: "browser-rag-ts-adapter-conformance-node-v4",
  status: "pass",
  seed,
  node_version: process.version,
  unicode_metadata: generated.CASEFOLD_V1_METADATA,
  python_unicode_metadata: pythonUnicode.PYTHON_UNICODE_V1_METADATA,
  fixture_sha256: createHash("sha256").update(await readFile(FIXTURE)).digest("hex"),
  unicode_cases: unicodeCases,
  unicode_exhaustive: unicodeExhaustive,
  seeded_corpus: { records: seededRecords.length, result: seededResult, result_sha256: digest(seededResult) },
  worker: {
    initialized: initialized.result,
    search: searched.result,
    disposed: disposed.result,
    search_sha256: digest(searched.result),
  },
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`browser-rag-ts adapter conformance: ${output}`);
