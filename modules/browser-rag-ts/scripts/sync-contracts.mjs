import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";

const REPO_ROOT = resolve(MODULE_ROOT, "../..");
const OUTPUT_DIR = join(MODULE_ROOT, "src", "contracts", "generated");
const OUTPUTS = Object.freeze({
  runtime: join(OUTPUT_DIR, "runtime.json"),
  proof: join(OUTPUT_DIR, "proof.json"),
  loader: join(OUTPUT_DIR, "runtime.ts"),
});

const RUNTIME_FILES = Object.freeze({
  "rag-behavior-v2": ["retrieval-profile.json", "fixture-records.json", "fixture-vectors.json", "cases.json"],
  "rag-indexing-v1": ["indexing-profile.json", "fixture-documents.json"],
});

const PROOF_FILES = Object.freeze({
  "rag-behavior-v2": [
    "manifest.json",
    "record.schema.json",
    "query.schema.json",
    "response.schema.json",
    "report.schema.json",
    "expected/exact-only.json",
    "expected/keyword-only.json",
    "expected/semantic-only.json",
    "expected/hybrid.json",
    "expected/scoped-hybrid.json",
    "adapters/python.md",
    "adapters/rust.md",
    "adapters/javascript.md",
  ],
  "rag-indexing-v1": [
    "manifest.json",
    "document.schema.json",
    "observation.schema.json",
    "report.schema.json",
    "expected.json",
    "adapters/python.md",
    "adapters/rust.md",
    "adapters/javascript.md",
  ],
});

function comparePath(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(comparePath).map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalContractText(raw) {
  return raw.replace(/\r\n?/g, "\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readContractFile(contractId, path) {
  const absolute = join(REPO_ROOT, "contracts", contractId, path);
  const raw = canonicalContractText(await readFile(absolute, "utf8"));
  const bytes = Buffer.from(raw, "utf8");
  return {
    path: `${contractId}/${path}`,
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    data: path.endsWith(".json") ? stable(JSON.parse(raw)) : raw,
  };
}

async function contractPayload(contractId, selectedPaths) {
  const manifest = await readJson(join(REPO_ROOT, "contracts", contractId, "manifest.json"));
  const files = {};
  for (const path of [...selectedPaths].sort(comparePath)) {
    files[path] = await readContractFile(contractId, path);
  }
  const sourceManifest = await readContractFile(contractId, "manifest.json");
  return {
    contract: contractId,
    version: manifest.version,
    input_digests: Object.fromEntries(
      Object.entries(files).map(([path, entry]) => [path, entry.sha256]).sort(([left], [right]) => comparePath(left, right)),
    ),
    source_manifest_sha256: sourceManifest.sha256,
    files,
  };
}

function product(schema, contracts) {
  const base = stable({ schema, generated_from: "contracts/", contracts });
  const snapshotDigest = digest(Buffer.from(JSON.stringify(base)));
  return `${JSON.stringify(stable({ ...base, snapshot_digest: snapshotDigest }), null, 2)}\n`;
}

async function createProducts() {
  const runtimeContracts = {};
  const proofContracts = {};
  for (const contractId of Object.keys(RUNTIME_FILES).sort(comparePath)) {
    runtimeContracts[contractId] = await contractPayload(contractId, RUNTIME_FILES[contractId]);
    proofContracts[contractId] = await contractPayload(contractId, PROOF_FILES[contractId]);
  }
  return {
    runtime: product("browser-rag-ts-runtime-contract-v2", runtimeContracts),
    proof: product("browser-rag-ts-proof-contract-v2", proofContracts),
    loader: [
      "// Generated contract runtime loader. Do not edit.",
      'import snapshot from "./runtime.json" with { type: "json" };',
      "export const CONTRACT_RUNTIME = snapshot;",
      "",
    ].join("\n"),
  };
}

async function expectedOutputNames() {
  return Object.values(OUTPUTS).map((path) => relative(OUTPUT_DIR, path)).sort(comparePath);
}

async function assertDirectoryExact(products) {
  const expected = await expectedOutputNames();
  let actual = [];
  try {
    actual = (await readdir(OUTPUT_DIR, { withFileTypes: true }))
      .map((entry) => {
        if (!entry.isFile()) throw new Error(`generated contract directory contains a non-file entry: ${entry.name}`);
        return entry.name;
      })
      .sort(comparePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("generated contract directory is missing");
    }
    throw error;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`generated contract files are not exact: expected ${expected.join(", ")}; found ${actual.join(", ") || "none"}`);
  }
  for (const [name, expectedContents] of Object.entries(products)) {
    const output = OUTPUTS[name];
    const actualContents = await readFile(output, "utf8");
    if (actualContents !== expectedContents) {
      throw new Error(`generated contract drift: ${relative(MODULE_ROOT, output)}`);
    }
  }
}

async function writeProducts(products) {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all(Object.entries(products).map(([name, contents]) => writeFile(OUTPUTS[name], contents, "utf8")));
}

async function main() {
  const check = process.argv.includes("--check");
  const products = await createProducts();
  if (check) {
    await assertDirectoryExact(products);
    console.log("browser-rag-ts contracts: check passed");
    return;
  }
  await writeProducts(products);
  console.log(`browser-rag-ts contracts: synced ${relative(MODULE_ROOT, OUTPUT_DIR)}`);
}

await main();
