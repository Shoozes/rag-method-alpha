import test from "node:test";
import assert from "node:assert/strict";
import { TracePlayback } from "../../src/application/tracePlayback.js";

test("stopping presentation releases its timer and never emits another step", async () => {
  const trace = new TracePlayback();
  const seen: string[] = [];
  const playing = trace.play(["real-1", "real-2"], (_, id) => seen.push(id), false);
  trace.stop();
  assert.equal(await playing, false);
  assert.deepEqual(seen, ["real-1"]);
  assert.equal(await trace.play(["real-2"], (_, id) => seen.push(id), true), true);
  assert.deepEqual(seen, ["real-1"]);
});

test("a new trace supersedes the old trace", async () => {
  const trace = new TracePlayback();
  const seen: string[] = [];
  const old = trace.play(["old-1", "old-2"], (_, id) => seen.push(id), false);
  const next = trace.play(["new"], (_, id) => seen.push(id), false);
  trace.stop();
  assert.equal(await old, false);
  assert.equal(await next, false);
  assert.deepEqual(seen, ["old-1", "new"]);
});
