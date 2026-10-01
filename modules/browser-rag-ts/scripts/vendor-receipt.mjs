import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";

export async function loadGraphReceipt() {
  const receipt = JSON.parse(await readFile(join(MODULE_ROOT, "vendor", "graph-package.json"), "utf8"));
  const expectedArchive = `vendor/ours-forcegraph-tsl-${receipt.package?.version}.tgz`;
  const legacy = receipt.schema === "browser-rag-ts-vendored-graph-v1"
    && receipt.source?.repository === "https://github.com/Shoozes/tsl-smooth-graph.git"
    && /^[0-9a-f]{40}$/.test(receipt.source?.commit ?? "");
  const snapshot = receipt.schema === "browser-rag-ts-vendored-graph-v2"
    && receipt.source?.kind === "source-snapshot"
    && /^[0-9a-f]{64}$/.test(receipt.source?.fingerprint_sha256 ?? "")
    && (receipt.source.base_commit === undefined || /^[0-9a-f]{40}$/.test(receipt.source.base_commit));
  if ((!legacy && !snapshot)
    || receipt.package?.name !== "@ours/forcegraph-tsl"
    || typeof receipt.package?.version !== "string"
    || receipt.package?.license !== "MIT"
    || receipt.archive?.path !== expectedArchive
    || !Number.isSafeInteger(receipt.archive?.bytes)
    || receipt.archive.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(receipt.archive?.sha256 ?? "")
    || receipt.peer_dependencies?.three !== "^0.185.0") {
    throw new Error("vendored graph receipt is invalid");
  }
  return receipt;
}

export function graphArchivePath(receipt) {
  return resolve(MODULE_ROOT, ...receipt.archive.path.split("/"));
}
