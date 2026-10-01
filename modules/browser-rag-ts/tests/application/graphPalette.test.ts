import assert from "node:assert/strict";
import test from "node:test";
import { graphColorNumber, graphFamilyColor, graphFamilyColorNumber, graphFamilyKey, RAG_GRAPH_PALETTE } from "../../src/application/graphPalette.js";

test("the semantic graph palette is complete and converts to renderer colors", () => {
  assert.deepEqual(Object.keys(RAG_GRAPH_PALETTE).sort(), [
    "canvas", "chunk", "focus", "folder", "hit", "link", "reference", "selected", "source",
  ]);
  for (const [key, value] of Object.entries(RAG_GRAPH_PALETTE)) {
    assert.ok(/^#[0-9a-f]{6}$/u.test(value), key);
    assert.equal(graphColorNumber(key as keyof typeof RAG_GRAPH_PALETTE), Number.parseInt(value.slice(1), 16));
  }
});

test("Aurel semantics keep graph roles distinguishable", () => {
  assert.equal(new Set([RAG_GRAPH_PALETTE.source, RAG_GRAPH_PALETTE.folder, RAG_GRAPH_PALETTE.chunk]).size, 3);
  assert.equal(new Set([RAG_GRAPH_PALETTE.selected, RAG_GRAPH_PALETTE.hit]).size, 2);
});

test("vault neighborhoods receive stable non-navy presentation colors", () => {
  const methods = graphFamilyColor("Methods/Question Design.md");
  assert.equal(methods, graphFamilyColor("Methods/Retrieval Modes.md"));
  assert.ok(methods !== graphFamilyColor("Architecture/Browser Worker.md"));
  assert.ok(/^#[0-9a-f]{6}$/u.test(methods));
  assert.equal(graphFamilyColorNumber("Methods/Question Design.md"), Number.parseInt(methods.slice(1), 16));
  for (const path of ["Methods/A.md", "Architecture/A.md", "Operations/A.md", "Guides/A.md", "Field Notes/A.md", "Glossary.md"]) {
    assert.ok(graphFamilyColor(path).toLowerCase() !== "#000080");
  }
});

test("large documentation families split into meaningful stable neighborhoods", () => {
  assert.equal(graphFamilyKey("api/AfterImageNode.md"), "API A–D");
  assert.equal(graphFamilyKey("api/WebGLRenderer.md"), "API U–Z");
  assert.equal(graphFamilyKey("tsl/accessors/camera.md"), "TSL accessors");
  assert.equal(graphFamilyKey("manual/textures.md"), "Manual");
  assert.ok(graphFamilyColor("api/AfterImageNode.md") !== graphFamilyColor("api/WebGLRenderer.md"));
});
