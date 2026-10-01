import test from "node:test";
import assert from "node:assert/strict";
import { cooperativeScheduler } from "../../src/application/cooperativeScheduler.js";

test("cooperative work checks every checkpoint but only yields on budget or commit barrier", async () => {
  let time = 0, checks = 0, yields = 0;
  const step = cooperativeScheduler(() => { checks++; }, 8, () => time, async () => { yields++; });
  for (let i = 0; i < 100; i++) await step();
  assert.equal(checks, 100);
  assert.equal(yields, 0);
  time = 8;
  await step();
  await step(true);
  assert.equal(yields, 2);
});

test("cancellation delivered at a task boundary prevents commit", async () => {
  let cancelled = false;
  const step = cooperativeScheduler(() => { if (cancelled) throw new Error("cancelled"); }, 8, () => 0, async () => { cancelled = true; });
  await assert.rejects(step(true), /cancelled/u);
});
