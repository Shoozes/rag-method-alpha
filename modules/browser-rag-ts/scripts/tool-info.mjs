import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { MODULE_ROOT, packageBinaryInfo } from "./tool.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativeTool(info) {
  return {
    relative_path: relative(MODULE_ROOT, info.path).replaceAll("\\", "/"),
    source: info.source,
    version: info.version,
  };
}

const [typescript, vite, packageLock] = await Promise.all([
  packageBinaryInfo("typescript", "bin/tsc"),
  packageBinaryInfo("vite", "bin/vite.js"),
  readFile(join(MODULE_ROOT, "package-lock.json")),
]);

process.stdout.write(`${JSON.stringify({
  node_version: process.version,
  package_lock_sha256: sha256(packageLock),
  shared_tool_cache_allowed: process.env.BROWSER_RAG_ALLOW_SHARED_TOOL_CACHE === "1",
  tools: { typescript: relativeTool(typescript), vite: relativeTool(vite) },
})}\n`);
