import test from "node:test";
import assert from "node:assert/strict";
import { indexDocument, indexDocumentBytes } from "../../src/core/indexing/indexDocument.js";
import { resolveApplicationReferences } from "../../src/core/indexing/references.js";

const options = { format: "text" as const, path: "unicode/scalars.txt", pocket: "workspace", scopes: ["workspace:demo"], authority: "workspace_record", priority: 0, limits: { max_chars: 4, max_tokens: 10 } };

test("indexing splits on Unicode scalars and emits canonical offsets", async () => {
  const document = await indexDocument("🧭界𐀀abcdef", options);
  assert.deepEqual(document.records.map((record) => record.text), ["🧭界𐀀a", "bcde", "f"]);
  assert.deepEqual(document.records.map((record) => [record.metadata.text_start, record.metadata.text_end]), [[0, 4], [4, 8], [8, 9]]);
});

test("indexing rejects invalid UTF-8 before replacement characters can enter identity", async () => {
  await assert.rejects(indexDocumentBytes(new Uint8Array([0xff]), { ...options, path: "bad.txt" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_utf8");
});

test("raw indexing retains its explicit whitespace boundary", async () => {
  const document = await indexDocument("\u001CAlpha\u001C", {
    format: "text", path: "control.txt", pocket: "test", scopes: ["test"], authority: "workspace_record",
  });
  assert.equal(document.canonical_text, "\u001CAlpha\u001C");
  assert.equal(document.records[0]?.text, "\u001CAlpha\u001C");
});

test("local application references connect indexed documents", async () => {
  const source = await indexDocument("# Source\nstable marker [[Beta\u1C89]]", {
    format: "markdown", path: "Alpha.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record",
  });
  const target = await indexDocument("# Target\nsilver sextant", {
    format: "markdown", path: "folder/Beta.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record",
  });
  const records = resolveApplicationReferences([...source.records, ...target.records]);
  assert.deepEqual(records[0]?.references, [target.records[0]?.id]);
  assert.deepEqual(records[1]?.references, []);
});
