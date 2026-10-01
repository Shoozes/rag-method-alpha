import test from "node:test";
import assert from "node:assert/strict";
import { fullContractCasefold } from "../../src/core/shared/casefold.js";
import { CASEFOLD_V1_METADATA } from "../../src/core/shared/generated/casefold-v1.js";
import { PYTHON_UNICODE_V1_METADATA } from "../../src/core/shared/generated/python-unicode-v1.js";
import { lowercaseContractText } from "../../src/core/shared/lowercase.js";
import { recordFromMapping } from "../../src/core/shared/types.js";
import { isPythonUnicodeAlphanumericCodepoint, isPythonUnicodeWhitespaceCodepoint, normalizeNfkc } from "../../src/core/shared/unicode.js";

test("retrieval lowercase and identity full casefold stay deliberately distinct", () => {
  assert.equal(lowercaseContractText("Straße"), "straße");
  assert.equal(lowercaseContractText("STRASSE"), "strasse");
  assert.equal(fullContractCasefold("Straße"), "strasse");
  assert.equal(fullContractCasefold("STRASSE"), "strasse");
  assert.equal(lowercaseContractText("ΟΣ"), "ος");
  assert.equal(fullContractCasefold("ΟΣ"), "οσ");
  assert.equal(lowercaseContractText("\u0085Alpha\u00A0Beta\u2028Gamma\u2029"), "alpha beta gamma");
  assert.equal(fullContractCasefold("Cafe\u0301"), "café");
});

test("generated casefold metadata is pinned and malformed scalar input fails", () => {
  assert.equal(CASEFOLD_V1_METADATA.generator, "scripts/browser_rag_unicode_conformance.py");
  assert.equal(CASEFOLD_V1_METADATA.mapping_entries > 1_000, true);
  assert.equal(/^[0-9a-f]{64}$/.test(CASEFOLD_V1_METADATA.table_sha256), true);
  assert.throws(() => lowercaseContractText("bad\uD800"));
  assert.throws(() => fullContractCasefold("bad\uDC00"));
  assert.equal(recordFromMapping({ id: "scope", text: "text", source_id: "source", scopes: ["\u00A0Persona:Private\u2029"] }).scope, "Persona:Private");
  assert.throws(() => recordFromMapping({ id: "scope", text: "text", source_id: "source", scopes: ["bad\uD800"] }));
});

test("Python Unicode assignment boundaries override newer JavaScript normalization data", () => {
  assert.equal(PYTHON_UNICODE_V1_METADATA.generator, "scripts/browser_rag_nfkc_conformance.py");
  assert.equal(PYTHON_UNICODE_V1_METADATA.unicode_version, "15.0.0");
  assert.equal(PYTHON_UNICODE_V1_METADATA.assigned_ranges, 707);
  assert.equal(PYTHON_UNICODE_V1_METADATA.alphanumeric_ranges, 747);
  assert.equal(PYTHON_UNICODE_V1_METADATA.whitespace_scalars, 29);
  assert.equal(normalizeNfkc("\uA7F1"), "\uA7F1");
  assert.equal(lowercaseContractText("\u1C89"), "\u1C89");
  assert.equal(isPythonUnicodeAlphanumericCodepoint(0x1c89), false);
  assert.equal(isPythonUnicodeWhitespaceCodepoint(0x1c), true);
  assert.equal(lowercaseContractText("A\u001CB"), "a b");
  assert.equal(fullContractCasefold("A\u001CB"), "a b");
  assert.equal(normalizeNfkc("A\u1ACF\u0301"), "A\u1ACF\u0301");
  assert.equal(normalizeNfkc("A\u0301\u1ACF"), "Á\u1ACF");
});
