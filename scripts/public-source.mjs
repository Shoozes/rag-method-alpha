import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const DIGEST = /^[0-9a-f]{64}$/;
const SELF_MANIFEST = "PUBLIC_MANIFEST.json";
const LIMITS = Object.freeze({ files: 20000, entries: 30000, fileBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });
const GENERATED_NAMES = new Set([
  "node_modules", ".artifacts", "dist", "build", "target", "__pycache__",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv", "coverage",
]);
const PRIVATE_NAMES = new Set([
  ".git", ".tools", ".agents", ".workspace", ".codex", ".aws", ".ssh", ".gnupg", ".kube", ".azure",
  ".runtime", ".secrets", "secrets", "runtime-data", "private-state", ".local-state",
]);
// Exact project-generated directories used only when no review manifest exists.
const DEFAULT_GENERATED_ROOTS = Object.freeze([
  ".artifacts", "modules/browser-rag-ts/.artifacts", "modules/browser-rag-ts/node_modules",
  "source/frontend/node_modules", "source/frontend/dist", "source/backend/.venv",
  "scripts/__pycache__", "source/backend/mirrorlight_backend/__pycache__",
  "source/backend/mirrorlight_backend/rag_core/__pycache__", "source/backend/tests/__pycache__",
  "source/backend/scripts/__pycache__",
]);

function portablePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024
    && !/^[\\/]|[\\<>:"|?*!\x00-\x1f\x7f]/u.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}

function excludedPrivatePath(name) {
  const parts = name.toLowerCase().split("/");
  const leaf = parts.at(-1);
  return parts.some((part) => PRIVATE_NAMES.has(part))
    || (/^\.env(?:\.|$)/u.test(leaf) && !/^\.env\.(?:example|template)$/u.test(leaf))
    || /^(?:\.npmrc|\.pypirc|\.netrc|_netrc|gt\.txt|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|credentials(?:\.json)?|secrets?\.json)$/u.test(leaf);
}

function fingerprint(files) {
  return sha256(JSON.stringify({ schema: "public-source-content/v1", files }) + "\n");
}

function readManifest(root, required) {
  const path = join(root, SELF_MANIFEST);
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === "ENOENT" && !required) return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.fileBytes) throw new Error("public source manifest is not a bounded ordinary file");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.schema !== "public-release-manifest/v1" || manifest.project !== "rag-method"
      || manifest.fingerprint_algorithm !== "sha256-json-file-table-v1"
      || !DIGEST.test(manifest.source_fingerprint_sha256 ?? "")
      || manifest.self_manifest_exclusion !== SELF_MANIFEST
      || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > LIMITS.files) {
    throw new Error("public source manifest is invalid");
  }
  const exclusions = manifest.verification_exclusions ?? [];
  if (!Array.isArray(exclusions) || exclusions.length > 100
      || new Set(exclusions.map((name) => typeof name === "string" ? name.toLowerCase() : name)).size !== exclusions.length
      || exclusions.some((name) => !portablePath(name) || !GENERATED_NAMES.has(name.split("/").at(-1).toLowerCase()) || excludedPrivatePath(name))) {
    throw new Error("public source verification exclusions must be exact generated directory roots");
  }
  let previous = "";
  const names = new Set();
  for (const file of manifest.files) {
    const name = file?.path;
    if (!portablePath(name) || name <= previous || names.has(name.toLowerCase()) || excludedPrivatePath(name)
        || name === SELF_MANIFEST || !Number.isSafeInteger(file.bytes) || file.bytes < 0
        || file.bytes > LIMITS.fileBytes || !DIGEST.test(file.sha256 ?? "")
        || exclusions.some((excluded) => name === excluded || name.startsWith(`${excluded}/`))
        || Object.keys(file).sort().join(",") !== "bytes,path,sha256") {
      throw new Error("public source file table contains an invalid or duplicate entry");
    }
    previous = name;
    names.add(name.toLowerCase());
  }
  if (fingerprint(manifest.files) !== manifest.source_fingerprint_sha256) throw new Error("public source fingerprint differs from its file table");
  return manifest;
}

function sourceFiles(root, exclusions) {
  const sourceRoot = resolve(root);
  const rootStat = lstatSync(sourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("public source root must be an ordinary directory");
  const excluded = new Set(exclusions);
  const files = [];
  let totalBytes = 0;
  let entries = 0;
  function visit(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > LIMITS.entries) throw new Error("public source exceeds the bounded inventory limit");
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!portablePath(name)) throw new Error("public source contains a nonportable path");
      if (name === SELF_MANIFEST || excludedPrivatePath(name)) continue;
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (excluded.has(name)) {
        if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error(`public source generated exclusion is not a directory: ${name}`);
        continue;
      }
      if (stat.isSymbolicLink()) throw new Error(`public source contains a symlink: ${name}`);
      if (stat.isDirectory()) { visit(path, name); continue; }
      if (!stat.isFile()) throw new Error(`public source contains an unsupported filesystem entry: ${name}`);
      if (files.length >= LIMITS.files || stat.size > LIMITS.fileBytes || totalBytes + stat.size > LIMITS.totalBytes) {
        throw new Error("public source exceeds the bounded byte or file limit");
      }
      const bytes = readFileSync(path);
      if (bytes.byteLength !== stat.size) throw new Error(`public source changed during inventory: ${name}`);
      totalBytes += bytes.byteLength;
      files.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  visit(sourceRoot, "");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

function reviewedMatch(manifest, files) {
  return manifest?.status === "pass" && manifest.manifest_complete === true
    && JSON.stringify(manifest.files) === JSON.stringify(files);
}

export function readPublicAncestry(root) {
  const value = JSON.parse(readFileSync(join(root, "public-source.json"), "utf8"));
  if (value.schema !== "public-source-ancestry/v1" || value.project !== "rag-method"
      || !/^[0-9a-f]{40}$/.test(value.base_commit ?? "")
      || value.prepared_from_modified_worktree !== true
      || value.identity_manifest !== "PUBLIC_MANIFEST.json") {
    throw new Error("public source ancestry is invalid");
  }
  return value;
}

export function readPublicSnapshot(root) {
  const manifest = readManifest(root, true);
  if (manifest.status !== "pass" || manifest.manifest_complete !== true) throw new Error("public source review has not passed with a complete manifest");
  const files = sourceFiles(root, manifest.verification_exclusions ?? []);
  if (!reviewedMatch(manifest, files)) throw new Error("public source changed after review: its current complete file inventory differs");
  return Object.freeze({ kind: "source-snapshot", fingerprint_sha256: fingerprint(files) });
}

// Build identity only: this does not perform disclosure review or grant release acceptance.
// Never updates PUBLIC_MANIFEST.json, including after ordinary edits or newly added files.
export function resolveBuildSource(root) {
  const manifest = readManifest(root, false);
  const files = sourceFiles(root, manifest?.verification_exclusions ?? DEFAULT_GENERATED_ROOTS);
  const currentFingerprint = fingerprint(files);
  return reviewedMatch(manifest, files)
    ? Object.freeze({ kind: "source-snapshot", fingerprint_sha256: currentFingerprint })
    : Object.freeze({ kind: "working-source", review_status: "unreviewed", fingerprint_sha256: currentFingerprint });
}
