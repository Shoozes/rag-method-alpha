import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";
import { graphArchivePath, loadGraphReceipt } from "./vendor-receipt.mjs";
import { verifyInstalledGraph } from "./vendor-content.mjs";

const receipt = await loadGraphReceipt();
const ARCHIVE = receipt.archive.path;
const SPECIFIER = `file:${ARCHIVE}`;

const archivePath = graphArchivePath(receipt);
const [archive, metadata, packageJson, lockJson] = await Promise.all([
  readFile(archivePath),
  stat(archivePath),
  readFile(join(MODULE_ROOT, "package.json"), "utf8").then(JSON.parse),
  readFile(join(MODULE_ROOT, "package-lock.json"), "utf8").then(JSON.parse),
]);
const digest = createHash("sha256").update(archive).digest("hex");
if (metadata.size !== receipt.archive.bytes) throw new Error(`graph archive byte count drifted: ${metadata.size}`);
if (digest !== receipt.archive.sha256) throw new Error(`graph archive SHA-256 drifted: ${digest}`);
if (packageJson.dependencies?.["@ours/forcegraph-tsl"] !== SPECIFIER) throw new Error("package.json graph archive specifier drifted");
if (lockJson.packages?.[""]?.dependencies?.["@ours/forcegraph-tsl"] !== SPECIFIER) throw new Error("package-lock graph archive specifier drifted");
const installed = lockJson.packages?.["node_modules/@ours/forcegraph-tsl"];
if (installed?.version !== receipt.package.version || installed?.license !== receipt.package.license) throw new Error("locked graph package identity drifted");
const integrity = "sha512-" + createHash("sha512").update(archive).digest("base64");
if (installed?.integrity !== integrity) throw new Error("locked graph integrity differs from the exact archive");
const installedCount = await verifyInstalledGraph(archive, join(MODULE_ROOT, "node_modules", "@ours", "forcegraph-tsl"));
console.log(`browser-rag-ts graph archive: ${receipt.archive.bytes} bytes, sha256 ${receipt.archive.sha256}; ${installedCount} installed files match exactly`);
