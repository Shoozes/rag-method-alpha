import test from "node:test";
import assert from "node:assert/strict";
import { canonicalHash } from "../../src/core/shared/sha256.js";
import { contentId, embeddingId, sourceChunkId, sourceId } from "../../src/core/shared/identity.js";
import { assertValidUnicodeScalars, compareUnicodeScalars, sliceByScalars, unicodeScalarCount } from "../../src/core/shared/unicode.js";
import { quantizeCosine, truncateTowardZero } from "../../src/core/shared/fixedPoint.js";
import { recordFromMapping } from "../../src/core/shared/types.js";

test("identity vectors match rag-behavior-v2", async () => {
  assert.equal(await canonicalHash(["", "é", "🧭"]), "328ebac536f33028ea6b8879ecb70450374c408872c2ef2302f7e2e02c199360");
  const content = await contentId("Café 🧭");
  assert.equal(content, "64d52a724725f19a89c6e135eda4d57e27cefbb0709a50b42687cfa6dd3a249c");
  const source = await sourceId(" FILE ", "  Ｄｏｃｓ \t", " Folder\\A.TXT ");
  assert.equal(source, "338300efd243f481b5fa7556e26134cd1f0bf9c255e98b133cde799bbddb669d");
  const chunk = await sourceChunkId(source, 12, null, null, content);
  assert.equal(chunk, "7ec598b2f164701ebd406ce881da482b3c5e45149be4db50bf7341552f2eede7");
  assert.equal(await embeddingId(chunk, "profile:v2"), "c871a6269b78c977ce85d3e417b2aaaec5d9421499ea7836eb02cde82be1f86e");
});

test("Unicode scalar boundaries reject malformed UTF-16", () => {
  assert.equal(unicodeScalarCount("🧭界𐀀"), 3);
  assert.equal(sliceByScalars("🧭界𐀀", 1, 3), "界𐀀");
  assert.equal(compareUnicodeScalars("", "𐀀") < 0, true);
  assert.throws(() => assertValidUnicodeScalars("bad\uD800", "query"));
  assert.throws(() => assertValidUnicodeScalars("bad\uDC00", "query"));
});

test("fixed point boundaries are explicit", () => {
  assert.equal(quantizeCosine(0.20000049), 200000);
  assert.equal(quantizeCosine(0.2000005), 200001);
  assert.equal(truncateTowardZero(-1.9), -1);
});

test("record mappings reject malformed Unicode before ranking", () => {
  assert.throws(() => recordFromMapping({ id: "bad\uD800", text: "text", source_id: "source" }));
  assert.throws(() => recordFromMapping({ id: "id", text: "bad\uDC00", source_id: "source" }));
});
