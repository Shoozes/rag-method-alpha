import { access, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(MODULE_ROOT, "../..");
const MODULE_NODE_MODULES = join(MODULE_ROOT, "node_modules");
const SHARED_FRONTEND_NODE_MODULES = join(REPO_ROOT, "source", "frontend", "node_modules");

function toolRoots() {
  const roots = [{ root: MODULE_NODE_MODULES, source: "module" }];
  if (process.env.BROWSER_RAG_ALLOW_SHARED_TOOL_CACHE === "1") {
    roots.push({ root: SHARED_FRONTEND_NODE_MODULES, source: "shared_frontend" });
  }
  return roots;
}

export async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Probe the next prepared runtime without hiding the final error.
    }
  }
  return null;
}

export async function packageBinary(packageName, relativePath) {
  return (await packageBinaryInfo(packageName, relativePath)).path;
}

export async function packageBinaryInfo(packageName, relativePath) {
  for (const candidate of toolRoots()) {
    const path = join(candidate.root, packageName, relativePath);
    try {
      await access(path);
      const metadata = JSON.parse(await readFile(join(candidate.root, packageName, "package.json"), "utf8"));
      if (!metadata || typeof metadata.version !== "string") throw new Error(`${packageName} package metadata is invalid`);
      return { path, source: candidate.source, version: metadata.version };
    } catch (error) {
      if (error instanceof Error && error.message.includes("package metadata is invalid")) throw error;
    }
  }
  throw new Error(
    `${packageName} is not prepared for browser-rag-ts; run 'npm --prefix modules/browser-rag-ts ci' and retry (automatic installation is disabled)`,
  );
}

export async function cleanDirectory(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}
