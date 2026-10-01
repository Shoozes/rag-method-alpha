import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationOperationCoordinator } from "../../src/application/operationCoordinator.js";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("foreground work cancels and settles graph presentation before starting", async () => {
  const graph = deferred();
  const events: string[] = [];
  const coordinator = new ApplicationOperationCoordinator({
    cancelGraph: async () => { events.push("cancel"); graph.resolve(); await graph.promise; events.push("settled"); },
  });
  const graphRun = coordinator.requestGraph(async () => { events.push("graph"); await graph.promise; });
  await Promise.resolve();
  await coordinator.runForeground("query", async () => { events.push("query"); });
  assert.equal(await graphRun, "completed");
  assert.deepEqual(events, ["graph", "cancel", "settled", "query"]);
});

test("graph requests made during foreground work coalesce to the latest intent", async () => {
  const foreground = deferred();
  const events: string[] = [];
  const coordinator = new ApplicationOperationCoordinator({ cancelGraph: async () => undefined });
  const running = coordinator.runForeground("import", async () => { events.push("import"); await foreground.promise; });
  const first = coordinator.requestGraph(async () => { events.push("old-graph"); });
  const latest = coordinator.requestGraph(async () => { events.push("latest-graph"); });
  assert.equal(await first, "superseded");
  foreground.resolve();
  await running;
  assert.equal(await latest, "completed");
  assert.deepEqual(events, ["import", "latest-graph"]);
});

test("a second foreground command cannot create duplicate exclusive work", async () => {
  const barrier = deferred();
  let duplicateRan = false;
  const coordinator = new ApplicationOperationCoordinator({ cancelGraph: async () => undefined });
  const running = coordinator.runForeground("restore", () => barrier.promise);
  await assert.rejects(
    coordinator.runForeground("query", async () => { duplicateRan = true; }),
    /restore is already in progress/u,
  );
  barrier.resolve();
  await running;
  assert.equal(duplicateRan, false);
});
