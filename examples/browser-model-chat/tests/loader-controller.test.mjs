import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoaderController } from '../loader-controller.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => Promise.resolve();
const prepared = { cached: false, modelId: 'fixture-model' };
const messages = [{ role: 'user', content: 'Fixture question' }];
const code = value => error => error.code === value;
const cancelled = error => error.name === 'AbortError' && error.code === 'CANCELLED';

/** Explicit fixture: this does not model any real runtime, download, cache or device. */
function fixtureAdapter() {
  const loads = [], replies = [];
  let disposals = 0, disposeImpl = async () => {};
  return {
    loads, replies,
    get disposals() { return disposals; },
    setDispose(handler) { disposeImpl = handler; },
    prepare(options) { const result = deferred(); loads.push({ ...options, ...result }); return result.promise; },
    reply(input, options) { const result = deferred(); replies.push({ messages: input, ...options, ...result }); return result.promise; },
    async dispose() { disposals++; await disposeImpl(); },
  };
}

async function loadReady(controller, adapter, result = prepared) {
  const loading = controller.load({ source: 'remote' });
  adapter.loads.at(-1).resolve(result);
  await loading;
}

test('cold fixture load reports real bytes and becomes ready only after prepare resolves', async () => {
  const adapter = fixtureAdapter(), states = [], controller = createLoaderController(adapter, state => states.push(state));
  assert.equal(controller.getState().phase, 'idle');
  const loading = controller.load({ source: 'remote' }), load = adapter.loads[0];
  assert.equal(controller.getState().phase, 'checking');
  load.onProgress({ phase: 'downloading', loaded: 25, total: 100 });
  assert.equal(controller.getState().determinate, true); assert.equal(controller.getState().progress, 0.25);
  load.onProgress({ phase: 'verifying', loaded: 100, total: 100 });
  assert.equal(controller.getState().phase, 'verifying');
  load.onProgress({ phase: 'initializing', loaded: 2, total: 4 });
  assert.equal(controller.getState().determinate, false); assert.equal(controller.getState().progress, null);
  load.onProgress({ phase: 'ready' });
  assert.equal(controller.getState().phase, 'initializing', 'Progress cannot announce readiness');
  load.resolve(prepared); assert.deepEqual(await loading, prepared);
  assert.equal(controller.getState().phase, 'ready'); assert.equal(controller.getState().modelId, 'fixture-model');
  assert.deepEqual(states.map(state => state.phase), ['checking', 'downloading', 'verifying', 'initializing', 'ready']);
});

test('cached and local-file fixtures keep truthful cache/source identity without fabricated percentages', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter), file = { name: 'fixture.gguf' };
  const loading = controller.load({ source: 'file', file }), load = adapter.loads[0];
  assert.equal(load.file, file); assert.equal(load.source, 'file');
  load.onProgress({ phase: 'checking', cached: true, loaded: 1, total: 1 });
  assert.equal(controller.getState().cached, true); assert.equal(controller.getState().determinate, false);
  load.onProgress({ phase: 'initializing' });
  assert.equal(controller.getState().progress, null);
  load.resolve({ ...prepared, cached: true }); await loading;
  assert.equal(controller.getState().cached, true); assert.equal(controller.getState().source, 'file');
});

test('unknown or contradictory byte totals remain indeterminate', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter), loading = controller.load({ source: 'remote' });
  for (const data of [{ loaded: 1 }, { loaded: 0, total: 0 }, { loaded: 5, total: 4 }, { loaded: -1, total: 4 }, { loaded: 1.5, total: 4 }]) {
    adapter.loads[0].onProgress({ phase: 'downloading', ...data });
    assert.equal(controller.getState().determinate, false); assert.equal(controller.getState().progress, null);
  }
  adapter.loads[0].resolve(prepared); await loading;
});

test('runtime profile metadata accepts only known profiles, rejects stale progress and resets on a new load', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  assert.equal(controller.getState().runtimeProfile, null);
  const first = controller.load({ source: 'remote' }), old = adapter.loads[0];
  old.onProgress({ phase: 'checking', runtimeProfile: '<untrusted-profile>' });
  assert.equal(controller.getState().runtimeProfile, null);
  old.onProgress({ phase: 'checking', runtimeProfile: 'memory32-asyncify' });
  old.onProgress({ phase: 'initializing', runtimeProfile: { id: 'memory64' } });
  assert.equal(controller.getState().runtimeProfile, 'memory32-asyncify');
  old.resolve({ ...prepared, runtimeProfile: 'memory64' });
  assert.deepEqual(await first, { ...prepared, runtimeProfile: 'memory64' });
  assert.equal(controller.getState().runtimeProfile, 'memory64'); await controller.cancel();
  const next = controller.load({ source: 'remote' });
  assert.equal(controller.getState().runtimeProfile, null);
  old.onProgress({ phase: 'checking', runtimeProfile: 'memory32-asyncify' });
  assert.equal(controller.getState().runtimeProfile, null, 'Old Worker progress cannot select a new runtime');
  adapter.loads[1].resolve({ ...prepared, runtimeProfile: 'unknown-runtime' });
  assert.deepEqual(await next, prepared); assert.equal(controller.getState().runtimeProfile, null);
  await controller.cancel();
  const compatible = controller.load({ source: 'remote' });
  adapter.loads[2].resolve({ ...prepared, runtimeProfile: 'memory32-asyncify' });
  assert.deepEqual(await compatible, { ...prepared, runtimeProfile: 'memory32-asyncify' });
  await controller.dispose(); assert.equal(controller.getState().runtimeProfile, null);
});

test('load errors dispose partial resources and permit an explicit retry', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  const loading = controller.load({ source: 'remote' }); adapter.loads[0].reject(new Error('Fixture checksum mismatch'));
  await assert.rejects(loading, /Model loading failed: Fixture checksum mismatch/);
  assert.equal(controller.getState().phase, 'error'); assert.match(controller.getState().error, /checksum mismatch/);
  assert.equal(controller.getState().retryable, true); assert.equal(controller.getState().errorCode, 'LOAD_FAILED');
  assert.equal(adapter.disposals, 1); await loadReady(controller, adapter, { ...prepared, cached: true });
  assert.equal(controller.getState().phase, 'ready'); assert.equal(controller.getState().error, null);
});

test('permanent secure-context, SIMD and OPFS refusals persist without futile retries or File loading', async () => {
  for (const capability of [
    { id: 'secure-context', label: 'Secure context', detail: 'HTTPS or loopback is required.' },
    { id: 'simd', label: 'WebAssembly SIMD', detail: 'Required WASM instructions are unavailable.' },
    { id: 'opfs', label: 'Browser storage (OPFS)', detail: 'The API is unavailable.' },
  ]) {
    const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
    const loading = controller.load({ source: 'remote' });
    const cause = Object.assign(new Error(`${capability.label} is unavailable. No model was downloaded.`), {
      code: 'UNSUPPORTED_BROWSER', retryable: false, capabilities: [capability],
    });
    adapter.loads[0].reject(cause);
    await assert.rejects(loading, failure => failure.code === 'UNSUPPORTED_BROWSER' && failure.retryable === false);
    const state = controller.getState();
    assert.equal(state.phase, 'unsupported'); assert.equal(state.retryable, false);
    assert.equal(state.errorCode, 'UNSUPPORTED_BROWSER'); assert.deepEqual(state.capabilities, [capability]);
    assert.equal(adapter.disposals, 1);
    state.capabilities[0].label = 'Mutated snapshot';
    cause.capabilities[0] = { id: 'other', label: 'Mutated cause' };
    assert.equal(controller.getState().capabilities[0].label, capability.label);
    await assert.rejects(controller.load({ source: 'remote' }), code('UNSUPPORTED_BROWSER'));
    await assert.rejects(controller.load({ source: 'file', file: { name: 'fixture.gguf' } }), code('UNSUPPORTED_BROWSER'));
    await controller.cancel(); assert.equal(controller.getState().phase, 'unsupported');
    await assert.rejects(controller.load({ source: 'remote' }), code('UNSUPPORTED_BROWSER'));
    assert.equal(adapter.loads.length, 1, 'No further preparation can start');
    await controller.dispose(); await assert.rejects(controller.load({ source: 'remote' }), code('DISPOSED'));
  }
});

test('only an explicit non-retryable unsupported error permanently blocks preparation', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  const loading = controller.load({ source: 'remote' });
  adapter.loads[0].reject(Object.assign(new Error('Fixture storage temporarily busy'), { code: 'UNSUPPORTED_BROWSER', retryable: true }));
  await assert.rejects(loading, code('LOAD_FAILED')); assert.equal(controller.getState().retryable, true);
  assert.equal(controller.getState().phase, 'error'); await loadReady(controller, adapter);
});

test('active loads refuse overlap; cancel aborts and awaits disposal before a retry', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter), cleanup = deferred();
  adapter.setDispose(() => cleanup.promise);
  const loading = controller.load({ source: 'remote' });
  await assert.rejects(controller.load({ source: 'remote' }), code('BUSY'));
  const rejected = assert.rejects(loading, cancelled), cancelling = controller.cancel();
  assert.equal(adapter.loads[0].signal.aborted, true);
  await assert.rejects(controller.load({ source: 'remote' }), code('BUSY'));
  await rejected;
  assert.notEqual(controller.getState().phase, 'cancelled', 'Cleanup has not completed');
  cleanup.resolve(); await cancelling;
  assert.equal(controller.getState().phase, 'cancelled'); assert.equal(adapter.disposals, 1);
  adapter.setDispose(async () => {}); await loadReady(controller, adapter);
});

test('cancelled prepare progress, late readiness and late errors cannot affect a newer load', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  const loading = controller.load({ source: 'remote' }), old = adapter.loads[0], rejected = assert.rejects(loading, cancelled);
  await controller.cancel(); await rejected;
  const retry = controller.load({ source: 'file', file: { name: 'retry.gguf' } });
  old.onProgress({ phase: 'initializing', cached: true }); old.resolve({ cached: true, modelId: 'stale-model' });
  await tick(); assert.equal(controller.getState().phase, 'checking'); assert.equal(controller.getState().modelId, null);
  adapter.loads[1].resolve(prepared); await retry;
  old.onProgress({ phase: 'downloading', loaded: 9, total: 10 }); await tick();
  assert.equal(controller.getState().phase, 'ready'); assert.equal(controller.getState().modelId, 'fixture-model');
  const other = fixtureAdapter(), loader = createLoaderController(other), pending = loader.load({ source: 'remote' });
  const failed = assert.rejects(pending, cancelled); await loader.cancel(); await failed;
  other.loads[0].reject(new Error('Late adapter rejection')); await tick();
  assert.equal(loader.getState().phase, 'cancelled');
});

test('fixture generation publishes accumulated text then the actual returned reply; overlap is refused', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter); await loadReady(controller, adapter);
  const sending = controller.send(messages), reply = adapter.replies[0];
  assert.equal(reply.messages, messages); assert.equal(controller.getState().phase, 'generating');
  reply.onToken('Fixture '); reply.onToken('Fixture tokens'); assert.equal(controller.getState().text, 'Fixture tokens');
  await assert.rejects(controller.send(messages), code('BUSY')); await assert.rejects(controller.load({ source: 'remote' }), code('BUSY'));
  reply.resolve('Actual fixture reply'); assert.equal(await sending, 'Actual fixture reply');
  assert.equal(controller.getState().phase, 'ready'); assert.equal(controller.getState().text, 'Actual fixture reply');
});

test('generation cancellation unloads the model, ignores late tokens and requires a fresh load', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter); await loadReady(controller, adapter);
  const sending = controller.send(messages), reply = adapter.replies[0], rejected = assert.rejects(sending, cancelled);
  reply.onToken('Partial fixture'); await controller.cancel(); await rejected;
  assert.equal(reply.signal.aborted, true); assert.equal(adapter.disposals, 1); assert.equal(controller.getState().modelId, null);
  reply.onToken(' stale'); reply.resolve('Stale final text'); await tick();
  assert.equal(controller.getState().phase, 'cancelled'); assert.equal(controller.getState().text, 'Partial fixture');
  await assert.rejects(controller.send(messages), code('NOT_READY'));
  await loadReady(controller, adapter); assert.equal(controller.getState().phase, 'ready');
});

test('reply failures unload, report useful errors and allow a fresh preparation', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter); await loadReady(controller, adapter);
  const sending = controller.send(messages); adapter.replies[0].reject(new Error('Fixture memory exhausted'));
  await assert.rejects(sending, /Reply failed: Fixture memory exhausted/);
  assert.equal(controller.getState().phase, 'error'); assert.equal(adapter.disposals, 1);
  await assert.rejects(controller.send(messages), code('NOT_READY')); await loadReady(controller, adapter);
});

test('dispose invalidates in-flight work and permanently refuses new operations', async () => {
  const adapter = fixtureAdapter(), states = [], controller = createLoaderController(adapter, state => states.push(state));
  const loading = controller.load({ source: 'remote' }), old = adapter.loads[0], rejected = assert.rejects(loading, cancelled);
  await controller.dispose(); await rejected;
  const count = states.length; old.onProgress({ phase: 'downloading', loaded: 1, total: 1 }); old.resolve(prepared); await tick();
  assert.equal(states.length, count); assert.equal(controller.getState().phase, 'idle'); assert.equal(adapter.disposals, 1);
  await assert.rejects(controller.load({ source: 'remote' }), code('DISPOSED')); await assert.rejects(controller.send(messages), code('DISPOSED'));
  await controller.dispose(); assert.equal(adapter.disposals, 1);
});

test('invalid sources/results and cleanup failures never claim readiness or successful cancellation', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  await assert.rejects(controller.load({ source: 'invented' }), code('INVALID_SOURCE'));
  await assert.rejects(controller.load({ source: 'file' }), code('FILE_REQUIRED'));
  await assert.rejects(controller.send(messages), code('NOT_READY')); assert.equal(adapter.loads.length, 0);
  const loading = controller.load({ source: 'remote' }); adapter.loads[0].resolve({ cached: true });
  await assert.rejects(loading, /did not confirm a valid prepared model/); assert.equal(controller.getState().phase, 'error');
  adapter.setDispose(async () => { throw new Error('Fixture worker did not close'); });
  await assert.rejects(controller.cancel(), /Model cleanup failed: Fixture worker did not close/);
  assert.equal(controller.getState().phase, 'error'); assert.equal(controller.getState().modelId, null);
});

test('state snapshots and observer mutation cannot change lifecycle ownership', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter, state => { state.phase = 'invented'; });
  const snapshot = controller.getState(); snapshot.modelId = 'invented';
  assert.equal(controller.getState().modelId, null); await loadReady(controller, adapter);
  assert.equal(controller.getState().phase, 'ready');
});

test('observer cancellation before generation starts does not invoke the adapter reply', async () => {
  const adapter = fixtureAdapter(); let stop, controller;
  controller = createLoaderController(adapter, state => { if (state.phase === 'generating') stop = controller.cancel(); });
  await loadReady(controller, adapter);
  await assert.rejects(controller.send(messages), cancelled); await stop;
  assert.equal(adapter.replies.length, 0); assert.equal(controller.getState().phase, 'cancelled');
});

test('synchronous abort listeners cannot start another load inside cancellation', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter);
  const loading = controller.load({ source: 'remote' }), rejected = assert.rejects(loading, cancelled);
  let attempted;
  adapter.loads[0].signal.addEventListener('abort', () => { attempted = assert.rejects(controller.load({ source: 'remote' }), code('BUSY')); });
  await controller.cancel(); await rejected; await attempted;
  assert.equal(adapter.loads.length, 1); assert.equal(controller.getState().phase, 'cancelled');
});

test('failed disposal must be retried successfully before another model can prepare', async () => {
  const adapter = fixtureAdapter(), controller = createLoaderController(adapter); await loadReady(controller, adapter);
  adapter.setDispose(async () => { throw new Error('Fixture cleanup blocked'); });
  await assert.rejects(controller.cancel(), code('CLEANUP_FAILED'));
  await assert.rejects(controller.load({ source: 'remote' }), /Fixture cleanup blocked/);
  assert.equal(adapter.loads.length, 1, 'New preparation cannot overlap failed cleanup');
  const cleanup = deferred(); adapter.setDispose(() => cleanup.promise);
  const retry = controller.load({ source: 'remote' }); await tick();
  assert.equal(adapter.loads.length, 1); cleanup.resolve();
  for (let attempts = 0; attempts < 10 && adapter.loads.length === 1; attempts++) await tick();
  assert.equal(adapter.loads.length, 2); adapter.loads[1].resolve(prepared); await retry;
  assert.equal(controller.getState().phase, 'ready');
});
