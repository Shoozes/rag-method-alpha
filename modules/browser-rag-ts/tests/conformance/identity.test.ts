import test from "node:test";
import assert from "node:assert/strict";
import { contentId, embeddingId, sourceChunkId, sourceId } from "../../src/core/shared/identity.js";

test("full casefold applies only to identity pocket values", async () => {
  const street = await sourceId("file", "Straße", "Folder/Key.txt");
  const ascii = await sourceId("file", "STRASSE", "Folder/Key.txt");
  assert.equal(street, ascii);
  const source = await sourceId("\u00A0FILE\u2028", "  Ｄｏｃｓ\t", " Folder\\A.TXT ");
  const content = await contentId("Cafe\u0301 🧭");
  const chunk = await sourceChunkId(source, 12, null, null, content);
  assert.equal(await embeddingId(chunk, "profile:v2"), "c871a6269b78c977ce85d3e417b2aaaec5d9421499ea7836eb02cde82be1f86e");
});

test("source identity lowercase stays on the owning Python Unicode version", async () => {
  assert.equal(
    await sourceId("\u1C89", "pocket", "Folder/\uA7CB.txt"),
    "5cd5d8141dfb258393c430076511aa430b34667a568a545a4509b1a09501a838",
  );
  assert.equal(
    await sourceId("\u001CFILE\u001C", "\u001Cpocket\u001C", "\u001CFolder/A.txt\u001C"),
    await sourceId("FILE", "pocket", "Folder/A.txt"),
  );
});
