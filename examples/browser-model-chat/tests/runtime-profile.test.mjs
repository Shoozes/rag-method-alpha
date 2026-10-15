import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeResources, bindRuntimeResources } from '../runtime-profile.mjs';

const baseURL = 'https://example.invalid/model-chat/engine-worker.mjs';
const boundary = error => error.code === 'ENGINE_BOUNDARY_ERROR';

test('explicit compatibility binds matching verified glue and WASM without consulting the vendor predicate', () => {
  let vendorCalls = 0;
  const engine = { getWorkerResources() { vendorCalls++; return { wasmPath: 'https://example.invalid/runtime/wllama.wasm', compat: false }; } };
  const resources = runtimeResources('memory32-asyncify', 'verified compatibility glue', baseURL);
  assert.equal(bindRuntimeResources(engine, resources), resources);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(engine.getWorkerResources(), resources);
  assert.equal(vendorCalls, 0);
  assert.deepEqual(resources, { wasmPath: 'https://example.invalid/model-chat/runtime/compat/wllama.wasm', compat: true, jsPath: { code: 'verified compatibility glue' } });
  assert.ok(Object.isFrozen(resources)); assert.ok(Object.isFrozen(resources.jsPath));
  assert.throws(() => { resources.jsPath.code = 'different glue'; }, TypeError);
  assert.throws(() => { engine.getWorkerResources = () => ({ compat: false }); }, TypeError);
});

test('Memory64 binds the main WASM with embedded glue, including an inherited vendor method', () => {
  const engine = Object.create({ getWorkerResources() { throw Error('Vendor predicate must not run'); } });
  const resources = runtimeResources('memory64', null, baseURL);
  assert.deepEqual(resources, { wasmPath: 'https://example.invalid/model-chat/runtime/wllama.wasm', compat: false });
  assert.equal(bindRuntimeResources(engine, resources), resources);
  assert.equal(engine.getWorkerResources(), resources);
  assert.equal(Object.getOwnPropertyDescriptor(engine, 'getWorkerResources').configurable, false);
});

test('invalid profiles, missing compatibility code and unresolved bases fail before binding', () => {
  for (const profile of [null, undefined, '', 'memory32', 'automatic', {}]) assert.throws(() => runtimeResources(profile, 'glue', baseURL), boundary);
  for (const code of [null, undefined, '', '  ', {}, 1]) assert.throws(() => runtimeResources('memory32-asyncify', code, baseURL), boundary);
  for (const base of [null, undefined, '', 'relative/path', 'data:text/plain,']) assert.throws(() => runtimeResources('memory64', null, base), boundary);
});

test('changed or locked engine boundaries refuse explicitly and leave the original method untouched', () => {
  const resources = runtimeResources('memory64', null, baseURL);
  const original = () => ({ compat: false });
  const locked = Object.defineProperty({}, 'getWorkerResources', { value: original, configurable: false, writable: true });
  const accessor = Object.defineProperty({}, 'getWorkerResources', { get: () => original, configurable: true });
  for (const engine of [null, {}, { getWorkerResources: 1 }, locked, accessor, Object.preventExtensions(Object.create({ getWorkerResources: original }))]) {
    assert.throws(() => bindRuntimeResources(engine, resources), boundary);
  }
  assert.equal(locked.getWorkerResources, original); assert.equal(accessor.getWorkerResources, original);
});

test('invalid or mutable resource shapes cannot weaken the fixed selection', () => {
  const invalid = [null, {}, { wasmPath: new URL('./runtime/wllama.wasm', baseURL).href, compat: false },
    Object.freeze({ wasmPath: 'relative.wasm', compat: false }),
    Object.freeze({ wasmPath: 'https://example.invalid/other.wasm', compat: false }),
    Object.freeze({ wasmPath: 'https://example.invalid/runtime/wllama.wasm?override', compat: false }),
    Object.freeze({ wasmPath: 'https://example.invalid/runtime/wllama.wasm', compat: true, jsPath: Object.freeze({ code: 'glue' }) }),
    Object.freeze({ wasmPath: 'https://example.invalid/runtime/compat/wllama.wasm', compat: true, jsPath: { code: 'mutable glue' } }),
    Object.freeze({ wasmPath: 'https://example.invalid/runtime/compat/wllama.wasm', compat: true }),
    Object.freeze({ wasmPath: 'https://example.invalid/runtime/wllama.wasm', compat: false, jsPath: Object.freeze({ code: 'wrong glue' }) })];
  for (const resources of invalid) {
    const original = () => ({ compat: false }); const engine = { getWorkerResources: original };
    assert.throws(() => bindRuntimeResources(engine, resources), boundary);
    assert.equal(engine.getWorkerResources, original);
  }
});
