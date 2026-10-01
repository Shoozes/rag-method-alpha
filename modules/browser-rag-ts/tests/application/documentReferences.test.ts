import assert from "node:assert/strict";
import test from "node:test";
import { resolveDocumentReferences } from "../../src/application/documentReferences.js";
import { indexDocument } from "../../src/core/indexing/indexDocument.js";

test("standard relative Markdown links resolve to the requested source section", async () => {
  const owner = await indexDocument("# TextureLoader\nUses [Loader.load](Loader.md#load).", { format: "markdown", path: "api/TextureLoader.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record" });
  const target = await indexDocument("# Loader\n## load\nLoads a resource.\n## parse\nParses it.", { format: "markdown", path: "api/Loader.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record" });
  const records = resolveDocumentReferences([...owner.records, ...target.records]);
  const linked = records.find((record) => record.source_id === owner.source_id);
  const load = records.find((record) => record.source_id === target.source_id && record.metadata.heading === "load");
  if (!linked || !load) throw new Error("expected linked records were not indexed");
  assert.deepEqual(linked.references, [load.id]);
});

test("external Markdown links remain prose and do not create graph edges", async () => {
  const source = await indexDocument("# Links\nRead [upstream](https://threejs.org).", { format: "markdown", path: "manual/links.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record" });
  assert.deepEqual(resolveDocumentReferences(source.records)[0]?.references, []);
});

test("fragment-only Markdown links resolve within the owning document", async () => {
  const source = await indexDocument("# Guide\nSee [cleanup](#cleanup).\n## cleanup\nDispose every owned resource.", { format: "markdown", path: "manual/guide.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record" });
  const records = resolveDocumentReferences(source.records);
  const guide = records.find((record) => record.metadata.heading === "Guide");
  const cleanup = records.find((record) => record.metadata.heading === "cleanup");
  if (!guide || !cleanup) throw new Error("expected same-document sections were not indexed");
  assert.deepEqual(guide.references, [cleanup.id]);
});

test("malformed link escapes do not reject a vault or hide valid references", async () => {
  const source = await indexDocument("# Guide\nSee [bad path](bad%ZZ.md), [bad fragment](#bad%ZZ), and [progress](#100%25-ready).\n## 100% ready\nProgress is complete.", { format: "markdown", path: "guide.md", pocket: "browser", scopes: ["browser:local"], authority: "workspace_record" });
  const records = resolveDocumentReferences(source.records);
  const guide = records.find((record) => record.metadata.heading === "Guide");
  const progress = records.find((record) => record.metadata.heading === "100% ready");
  if (!guide || !progress) throw new Error("expected percent-bearing heading was not indexed");
  assert.deepEqual(guide.references, [progress.id]);
});
