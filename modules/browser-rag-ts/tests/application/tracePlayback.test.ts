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


test("reentrant stop and replacement cannot leave an old timer behind", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const trace = new TracePlayback();
  const seen: string[] = [];
  const stopped = trace.play(["one", "two"], (_, id) => { seen.push(id); trace.stop(); }, false);
  assert.equal(await stopped, false);
  let replacement: Promise<boolean> | undefined;
  const old = trace.play(["old", "obsolete"], (_, id) => {
    seen.push(id);
    replacement = trace.play(["new"], (_, id) => { seen.push(id); trace.stop(); }, false);
  }, false);
  assert.equal(await old, false);
  assert.equal(await replacement, false);
  t.mock.timers.tick(5000);
  assert.deepEqual(seen, ["one", "old", "new"]);
});

test("replay snapshots accepted IDs and callback exceptions release ownership", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const trace = new TracePlayback();
  const input = ["first", "second"];
  const seen: string[] = [];
  const playing = trace.play(input, (_, id) => { seen.push(id); input[1] = "replaced"; }, false);
  t.mock.timers.tick(360);
  await Promise.resolve();
  t.mock.timers.tick(360);
  assert.equal(await playing, true);
  assert.deepEqual(seen, ["first", "second"]);
  await assert.rejects(trace.play(["error"], () => { throw new Error("callback failed"); }, false), /callback failed/u);
  assert.equal(await trace.play(["quiet"], () => { throw new Error("quiet replay emitted"); }, true), true);
});
