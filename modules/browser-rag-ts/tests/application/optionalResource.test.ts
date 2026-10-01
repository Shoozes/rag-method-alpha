import assert from "node:assert/strict";
import test from "node:test";
import { initializeOptionalResource } from "../../src/application/optionalResource.js";

test("a renderer that resolves after session invalidation disposes itself", async () => {
  let current = true;
  let accepted = false;
  let disposed = false;
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const running = initializeOptionalResource({
    load: async () => { await delayed; return async () => ({ dispose: () => { disposed = true; } }); },
    isCurrent: () => current,
    accept: () => { accepted = true; },
    reject: (error) => { throw error; },
  });
  current = false;
  release?.();
  await running;
  assert.equal(accepted, false);
  assert.equal(disposed, true);
});

test("renderer import and initialization failures stay optional", async () => {
  const failures: string[] = [];
  await initializeOptionalResource({
    load: async () => { throw new Error("import failed"); },
    isCurrent: () => true,
    accept: () => { throw new Error("failed renderer import was accepted"); },
    reject: (error) => failures.push((error as Error).message),
  });
  await initializeOptionalResource({
    load: async () => async () => { throw new Error("initialization failed"); },
    isCurrent: () => true,
    accept: () => { throw new Error("failed renderer initialization was accepted"); },
    reject: (error) => failures.push((error as Error).message),
  });
  assert.deepEqual(failures, ["import failed", "initialization failed"]);
});
