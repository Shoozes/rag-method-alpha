import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULE_ROOT } from "./tool.mjs";
import { existsSync } from "node:fs";
import { readPublicAncestry } from "../../../scripts/public-source.mjs";

export const ROOT = resolve(MODULE_ROOT, "../..");
export const RUNTIME_SNAPSHOT_PATH = join(MODULE_ROOT, "src", "contracts", "generated", "runtime.json");
export const PROOF_SNAPSHOT_PATH = join(MODULE_ROOT, "src", "contracts", "generated", "proof.json");

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function equalJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export async function runtimeSnapshot() {
  return JSON.parse(await readFile(RUNTIME_SNAPSHOT_PATH, "utf8"));
}

export async function proofSnapshot() {
  return JSON.parse(await readFile(PROOF_SNAPSHOT_PATH, "utf8"));
}

export function contractFile(bundle, contractId, path) {
  const file = bundle.contracts[contractId]?.files[path];
  if (!file) throw new Error(`generated contract file is missing: ${contractId}/${path}`);
  return file.data;
}

export function repositoryState() {
  const override = process.env.RAG_METHOD_PROOF_REPOSITORY_STATE;
  if (override !== undefined) {
    let value;
    try { value = JSON.parse(override); }
    catch { throw new Error("RAG_METHOD_PROOF_REPOSITORY_STATE must be valid JSON"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["commit", "dirty"]) || typeof value.commit !== "string" || !/^[0-9a-f]{40}$/.test(value.commit) || typeof value.dirty !== "boolean") {
      throw new Error("RAG_METHOD_PROOF_REPOSITORY_STATE is invalid");
    }
    return { commit: value.commit, dirty: value.dirty };
  }
  if (existsSync(join(ROOT, "public-source.json"))) {
    const ancestry = readPublicAncestry(ROOT);
    // Frozen adapter envelopes retain ancestry, not a clean snapshot identity.
    return { commit: ancestry.base_commit, dirty: true };
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain=v1"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0;
  return { commit, dirty };
}

export async function compiledCore() {
  const path = join(MODULE_ROOT, ".artifacts", "tsc", "index.js");
  return import(pathToFileURL(path).href);
}

export async function compileCore() {
  const { spawn } = await import("node:child_process");
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(MODULE_ROOT, "scripts", "compile.mjs")], { cwd: MODULE_ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`core compilation failed (${code})`)));
  });
  return compiledCore();
}

export function indexingObservation(document) {
  return {
    format: document.format,
    path: document.path,
    pocket: document.pocket,
    scopes: [...document.scopes],
    authority: document.authority,
    priority: document.priority,
    source_id: document.source_id,
    source_content_id: document.source_content_id,
    source_utf8_bytes: document.source_utf8_bytes,
    canonical_content_id: document.canonical_content_id,
    canonical_scalar_count: Array.from(document.canonical_text).length,
    normalization: { bom_removed: document.bom_removed, line_endings_changed: document.line_endings_changed, frontmatter_removed: document.frontmatter_removed },
    limits: { max_chars: document.limits.max_chars, max_tokens: document.limits.max_tokens },
    records: document.records.map((record) => ({
      id: record.id, text: record.text, source_id: record.source_id, source_name: record.source_name, path: record.path,
      pocket: record.pocket, scope: record.scope, scopes: [...record.scopes], authority: record.authority, priority: record.priority,
      provenance: { ...record.provenance }, references: [...record.references], embedding_profile_id: record.embedding_profile_id, metadata: { ...record.metadata },
    })),
  };
}

export function retrievalObservation(response) {
  return {
    eligible_ids: [...response.eligible_ids],
    candidate_ids: [...response.candidate_ids],
    ordered_ids: response.results.map((result) => result.record.id),
    scores: response.results.map((result) => ({ id: result.record.id, score_micro: result.score_micro, components: {
      exact_micro: result.exact_micro, semantic_micro: result.semantic_micro, keyword_micro: result.keyword_micro,
      scope_micro: result.scope_micro, provenance_micro: result.provenance_micro, authority_micro: result.authority_micro,
      priority_micro: result.priority_micro, aspect_coverage_micro: result.aspect_coverage_micro, cross_reference_micro: result.cross_reference_micro,
    }, cross_reference_from_id: result.cross_reference_from_id })),
    context_selected_ids: response.results.map((result) => result.record.id),
    context_tokens: response.context_tokens, truncated: response.truncated,
    semantic_state: response.semantic_state, semantic_fallback_reason: response.semantic_fallback_reason, errors: [...response.errors],
  };
}
