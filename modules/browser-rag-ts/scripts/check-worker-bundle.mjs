import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";

const WORKER_SOURCE = join(MODULE_ROOT, "src", "worker", "rag.worker.ts");
const ASSETS = join(MODULE_ROOT, ".artifacts", "dist", "assets");
const FORBIDDEN_SOURCE_IMPORTS = ["generated/proof", "proof.json"];
const FORBIDDEN_BUNDLE_MARKERS = [
  "browser-rag-ts-proof-contract-v2",
  "expected.json",
  "expected/exact-only.json",
  "expected/keyword-only.json",
  "expected/semantic-only.json",
  "expected/hybrid.json",
  "expected/scoped-hybrid.json",
  "adapters/python.md",
  "adapters/rust.md",
  "adapters/javascript.md",
];

const source = await readFile(WORKER_SOURCE, "utf8");
for (const marker of FORBIDDEN_SOURCE_IMPORTS) {
  if (source.includes(marker)) throw new Error(`Worker source imports proof-only data: ${marker}`);
}

const workerAssets = (await readdir(ASSETS, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^rag\.worker-[A-Za-z0-9_-]+\.js$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (workerAssets.length !== 1) throw new Error(`expected exactly one Worker bundle, found ${workerAssets.length}`);

const bundle = await readFile(join(ASSETS, workerAssets[0]), "utf8");
for (const marker of FORBIDDEN_BUNDLE_MARKERS) {
  if (bundle.includes(marker)) throw new Error(`Worker bundle contains proof-only data: ${marker}`);
}

console.log(`browser-rag-ts Worker bundle boundary: ${workerAssets[0]} contains runtime data only`);
