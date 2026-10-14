import test from "node:test";
import assert from "node:assert/strict";
import { evidenceCurve } from "../../src/presentation/evidenceCurve.js";

test("evidence curves preserve accepted endpoints and deterministically bend", () => {
  const from = Object.freeze({ x: 10, y: 20 });
  const to = Object.freeze({ x: 410, y: 220 });
  const first = evidenceCurve(from, to, "source:1:chunk:2");
  assert.equal(first, evidenceCurve(from, to, "source:1:chunk:2"));
  assert.ok(first?.startsWith("M 10 20 Q "));
  assert.ok(first?.endsWith(" 410 220"));
  assert.deepEqual(from, { x: 10, y: 20 });
  assert.deepEqual(to, { x: 410, y: 220 });
});

test("coincident endpoints stay finite and invalid projections cannot create SVG paths", () => {
  assert.equal(evidenceCurve({ x: 1, y: 2 }, { x: 1, y: 2 }, "same"), "M 1 2 L 1 2");
  for (const invalid of [Infinity, -Infinity, NaN]) {
    assert.equal(evidenceCurve({ x: invalid, y: 2 }, { x: 1, y: 2 }, "bad"), null);
    assert.equal(evidenceCurve({ x: 1, y: 2 }, { x: 1, y: invalid }, "bad"), null);
  }
  assert.equal(evidenceCurve({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }, "overflow"), null);
});
