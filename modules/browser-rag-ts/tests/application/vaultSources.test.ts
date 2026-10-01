import assert from "node:assert/strict";
import test from "node:test";
import { fetchVaultPack, isSafeVaultPath, readBoundedResponse, readVaultFiles, selectVaultFiles } from "../../src/application/vaultSources.js";

function file(name: string, size: number, relativePath = ""): File {
  const value = new File([new Uint8Array(size)], name, { type: "text/plain" });
  Object.defineProperty(value, "webkitRelativePath", { value: relativePath });
  return value;
}

test("vault path filtering excludes hidden configuration and application state", () => {
  assert.equal(isSafeVaultPath("notes/rendering.md"), true);
  assert.equal(isSafeVaultPath("vault/.obsidian/workspace.json"), false);
  assert.equal(isSafeVaultPath("vault/runtime-data/query.txt"), false);
  const selection = selectVaultFiles([
    file("rendering.md", 10, "vault/rendering.md"),
    file("workspace.md", 10, "vault/.obsidian/workspace.md"),
    file("image.png", 10, "vault/image.png"),
  ]);
  assert.equal(selection.accepted.length, 1);
  assert.equal(selection.excluded, 2);
  assert.equal(selection.bytes, 10);
});

test("packed input is bounded before parsing, with and without Content-Length", async () => {
  let cancelled = false;
  const stream = () => new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedResponse(new Response(stream()), 8), /packed-input budget/u);
  assert.equal(cancelled, true);
  cancelled = false;
  await assert.rejects(readBoundedResponse(new Response(stream(), { headers: { 'content-length': '1000' } }), 8), /packed-input budget/u);
  assert.equal(cancelled, true);
});

test("downloading a response can be cancelled before the next byte arrives", async () => {
  const controller = new AbortController();
  let released = false;
  const response = new Response(new ReadableStream({ cancel() { released = true; } }));
  const pending = readBoundedResponse(response, 100, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(released, true);
});

test("file reads cancel promptly and late completion cannot publish progress", async () => {
  const controller = new AbortController();
  let finish: (bytes: ArrayBuffer) => void = () => undefined;
  const input = file("note.md", 5);
  Object.defineProperty(input, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }) });
  const progress: unknown[] = [];
  const pending = readVaultFiles([input], (value) => progress.push(value), controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  finish(new ArrayBuffer(5));
  await Promise.resolve();
  assert.deepEqual(progress, []);
});

test("file I/O errors are not mislabeled as invalid UTF-8", async () => {
  const input = file("note.md", 5);
  Object.defineProperty(input, "arrayBuffer", { value: () => Promise.reject(new Error("read denied")) });
  await assert.rejects(readVaultFiles([input], () => undefined), /read denied/u);
  await assert.rejects(readVaultFiles([new File([new Uint8Array([255])], "bad.md")], () => undefined), /not valid UTF-8/u);
});

test("pack verification cancels between documents and suppresses late progress", async () => {
  const content = "# Note\nA real source.";
  const bytes = new TextEncoder().encode(content);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("");
  const pack = { schema: "rag-method-browser-vault-pack-v1", manifest: { corpus_id: "test", identity_sha256: "a".repeat(64), counts: { documents: 30, source_utf8_bytes: bytes.length * 30 }, upstream: { repository: "test", commit: "test", license: "MIT" } }, documents: Array.from({ length: 30 }, (_, i) => ({ path: `${i}.md`, format: "markdown", content, metadata: { content_sha256: sha } })) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(pack));
  const controller = new AbortController();
  const phases: string[] = [];
  try { await assert.rejects(fetchVaultPack(new URL("http://localhost/pack"), (value) => {
    phases.push(`${value.phase}:${value.completed}`);
    if (value.phase === "validating") controller.abort();
  }, controller.signal), { name: "AbortError" }); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(phases.at(-1), "validating:25");
});
