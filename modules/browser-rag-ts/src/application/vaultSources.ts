import { MAX_BROWSER_DOCUMENTS, MAX_BROWSER_DOCUMENT_UTF8_BYTES, MAX_BROWSER_SOURCE_UTF8_BYTES } from "../worker/protocol.js";
import type { BrowserDocumentPayload } from "../worker/protocol.js";
import { cooperativeScheduler } from "./cooperativeScheduler.js";

// JSON escaping can expand source bytes by six; metadata has a separate bounded allowance.
export const MAX_VAULT_PACK_BYTES = MAX_BROWSER_SOURCE_UTF8_BYTES * 6 + MAX_BROWSER_DOCUMENTS * 4096;

export function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }

/** Abort the consumer promptly even when a browser File read/digest cannot be stopped. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function readBoundedResponse(response: Response, maximum: number, signal?: AbortSignal): Promise<unknown> {
  checkAbort(signal);
  const declared = Number(response.headers.get("content-length"));
  if (declared > maximum) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Demo vault download exceeds its packed-input budget.");
  }
  if (!response.body) throw new Error("Demo vault response has no readable body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      checkAbort(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error("Demo vault download exceeds its packed-input budget.");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    checkAbort(signal);
    return JSON.parse(parts.join("")) as unknown;
  } finally {
    // Cancelling releases an unfinished fetch on overflow, decode error, or user cancellation.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const BLOCKED_SEGMENTS = new Set([".git", ".obsidian", ".trash", ".secrets", "node_modules", "runtime-data"]);

export interface VaultReadProgress {
  readonly phase: "fetching" | "validating" | "reading";
  readonly completed: number;
  readonly total: number;
}

export interface BrowserVaultPack {
  readonly schema: "rag-method-browser-vault-pack-v1";
  readonly manifest: {
    readonly corpus_id: string;
    readonly identity_sha256: string;
    readonly counts: { readonly documents: number; readonly source_utf8_bytes: number };
    readonly upstream: { readonly repository: string; readonly commit: string; readonly license: string };
  };
  readonly documents: readonly BrowserDocumentPayload[];
}

function pathFor(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
}

function supported(path: string): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(path);
}

export function isSafeVaultPath(path: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length > 0 && !parts.some((part) => BLOCKED_SEGMENTS.has(part.toLowerCase()) || part.startsWith("."));
}

export function selectVaultFiles(files: readonly File[]): { readonly accepted: readonly File[]; readonly excluded: number; readonly bytes: number } {
  const accepted = files.filter((file) => supported(pathFor(file)) && isSafeVaultPath(pathFor(file)));
  const bytes = accepted.reduce((total, file) => total + file.size, 0);
  if (!accepted.length) throw new Error("No supported Markdown or text files remain after safety filtering.");
  if (accepted.length > MAX_BROWSER_DOCUMENTS) throw new Error(`Choose at most ${MAX_BROWSER_DOCUMENTS} supported files.`);
  if (bytes > MAX_BROWSER_SOURCE_UTF8_BYTES) throw new Error(`Selected files exceed the ${MAX_BROWSER_SOURCE_UTF8_BYTES} byte browser limit.`);
  const oversized = accepted.find((file) => file.size > MAX_BROWSER_DOCUMENT_UTF8_BYTES);
  if (oversized) throw new Error(`${pathFor(oversized)} exceeds the ${MAX_BROWSER_DOCUMENT_UTF8_BYTES} byte per-document limit.`);
  return Object.freeze({ accepted: Object.freeze(accepted), excluded: files.length - accepted.length, bytes });
}

export async function readVaultFiles(files: readonly File[], progress: (value: VaultReadProgress) => void, signal?: AbortSignal): Promise<readonly BrowserDocumentPayload[]> {
  checkAbort(signal);
  const selection = selectVaultFiles(files);
  const documents: BrowserDocumentPayload[] = [];
  const yieldControl = cooperativeScheduler(() => checkAbort(signal));
  for (let index = 0; index < selection.accepted.length; index += 1) {
    const file = selection.accepted[index]!;
    const path = pathFor(file);
    await yieldControl();
    const bytes = await abortable(file.arrayBuffer(), signal);
    checkAbort(signal);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(`${path} is not valid UTF-8 text.`); }
    documents.push(Object.freeze({ path, format: /\.(?:md|markdown)$/iu.test(path) ? "markdown" : "text", content }));
    progress({ phase: "reading", completed: index + 1, total: selection.accepted.length });
  }
  return Object.freeze(documents);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

async function digest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const value = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchVaultPack(url: URL, progress: (value: VaultReadProgress) => void, signal?: AbortSignal): Promise<BrowserVaultPack> {
  checkAbort(signal);
  progress({ phase: "fetching", completed: 0, total: 1 });
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...(signal === undefined ? {} : { signal }) });
  if (!response.ok) throw new Error(`Demo vault request failed with HTTP ${response.status}.`);
  const value = await readBoundedResponse(response, MAX_VAULT_PACK_BYTES, signal);
  progress({ phase: "fetching", completed: 1, total: 1 });
  if (!plainObject(value) || value.schema !== "rag-method-browser-vault-pack-v1" || !plainObject(value.manifest) || !Array.isArray(value.documents)) throw new Error("Demo vault pack is malformed.");
  const manifest = value.manifest;
  if (!plainObject(manifest.upstream) || typeof manifest.upstream.repository !== "string" || typeof manifest.upstream.commit !== "string" || typeof manifest.upstream.license !== "string") throw new Error("Demo vault upstream identity is malformed.");
  if (!plainObject(manifest.counts) || typeof manifest.corpus_id !== "string" || !/^[0-9a-f]{64}$/u.test(String(manifest.identity_sha256))) throw new Error("Demo vault manifest is malformed.");
  if (value.documents.length !== manifest.counts.documents || value.documents.length < 1 || value.documents.length > MAX_BROWSER_DOCUMENTS) throw new Error("Demo vault document count is outside the admitted budget.");
  const documents: BrowserDocumentPayload[] = [];
  const paths = new Set<string>();
  let bytes = 0;
  const yieldControl = cooperativeScheduler(() => checkAbort(signal));
  for (let index = 0; index < value.documents.length; index += 1) {
    await yieldControl();
    const raw = value.documents[index];
    if (!plainObject(raw) || typeof raw.path !== "string" || raw.format !== "markdown" || typeof raw.content !== "string" || !plainObject(raw.metadata)) throw new Error(`Demo vault document ${index} is malformed.`);
    if (!isSafeVaultPath(raw.path) || paths.has(raw.path)) throw new Error(`Demo vault path is unsafe or duplicated: ${raw.path}`);
    paths.add(raw.path);
    const size = new TextEncoder().encode(raw.content).byteLength;
    if (size > MAX_BROWSER_DOCUMENT_UTF8_BYTES) throw new Error(`Demo vault document exceeds its budget: ${raw.path}`);
    bytes += size;
    if (bytes > MAX_BROWSER_SOURCE_UTF8_BYTES) throw new Error("Demo vault byte count is outside the admitted budget.");
    const expected = raw.metadata.content_sha256;
    if (typeof expected !== "string" || await abortable(digest(raw.content), signal) !== expected) throw new Error(`Demo vault content hash failed: ${raw.path}`);
    checkAbort(signal);
    documents.push(raw as unknown as BrowserDocumentPayload);
    if ((index + 1) % 25 === 0 || index + 1 === value.documents.length) progress({ phase: "validating", completed: index + 1, total: value.documents.length });
  }
  if (bytes !== manifest.counts.source_utf8_bytes || bytes > MAX_BROWSER_SOURCE_UTF8_BYTES) throw new Error("Demo vault byte count is outside the admitted budget.");
  return Object.freeze({ schema: "rag-method-browser-vault-pack-v1", manifest: manifest as BrowserVaultPack["manifest"], documents: Object.freeze(documents) });
}
