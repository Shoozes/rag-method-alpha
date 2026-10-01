import test from "node:test";
import assert from "node:assert/strict";
import { RagEngine } from "../../src/core/retrieval/engine.js";
import { FROZEN_RETRIEVAL_POLICY } from "../../src/core/retrieval/profile.js";
import { conformanceRecord } from "./fixtures.js";

test("sync and async paths share results while exposing only frozen public checkpoints", async () => {
  const engine = new RagEngine([
    conformanceRecord("one", "release canary alpha", { references: ["two"] }),
    conformanceRecord("two", "release canary beta"),
  ]);
  const checkpoints: string[] = [];
  const steps: string[] = [];
  const options = { mode: "exact_only" as const, top_k: 2, checkpoint: (phase: string) => checkpoints.push(phase) };
  const sync = engine.search("release canary", options);
  const asyncResult = await engine.searchAsync("release canary", options, async (step) => { steps.push(step); });
  assert.deepEqual(sync, asyncResult);
  assert.deepEqual(checkpoints, [...FROZEN_RETRIEVAL_POLICY.cancellation_checkpoints, ...FROZEN_RETRIEVAL_POLICY.cancellation_checkpoints]);
  assert.equal(steps.includes("cross_reference.batch"), true);
  assert.equal(steps.includes("cross_reference.scan"), false);
});
