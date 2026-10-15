import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeAdapter } from '../runtime-adapter.mjs';

// Transport-only fixture. No real Worker, WASM, network, cache or model is created.
function fixture(t, options = {}) {
  const workers = [], active = new Set();
  class FixtureWorker {
    constructor(url, options) { this.url = url; this.options = options; this.requests = []; this.terminations = 0; workers.push(this); active.add(this); }
    postMessage(message) { this.requests.push(structuredClone(message)); }
    terminate() { this.terminations++; active.delete(this); }
    emit(id, type, value, metadata = {}) { this.onmessage?.({ data: { id, type, value, ...metadata } }); }
    fail() { this.onerror?.({ message: 'Fixture worker crash' }); }
  }
  const adapter = createRuntimeAdapter({ WorkerClass: FixtureWorker, ...options });
  t.after(async () => { await adapter.dispose(); assert.equal(active.size, 0); });
  return { adapter, workers, active };
}
const aborted = error => error.name === 'AbortError';

test('fixture prepare forwards source/file and actual progress/result through an owned module worker', async t => {
  const { adapter, workers } = fixture(t), progress = [], file = { name: 'fixture.gguf', size: 4 };
  const loading = adapter.prepare({ source: 'file', file, onProgress: value => progress.push(value) });
  const worker = workers[0], request = worker.requests[0];
  assert.equal(worker.url.pathname.endsWith('/engine-worker.mjs'), true); assert.equal(worker.options.type, 'module');
  assert.equal(request.operation, 'prepare'); assert.deepEqual(request.payload, { source: 'file', file });
  const event = { phase: 'verifying', loaded: 4, total: 4 };
  worker.emit(request.id, 'progress', event); assert.deepEqual(progress, [event]);
  worker.emit(request.id, 'result', { cached: false, modelId: 'fixture-model' });
  assert.deepEqual(await loading, { cached: false, modelId: 'fixture-model' });
});

test('fixture reply forwards accumulated token text and final result without reinterpretation', async t => {
  const { adapter, workers } = fixture(t), tokens = [], messages = [{ role: 'user', content: 'Fixture question' }];
  const sending = adapter.reply(messages, { onToken: text => tokens.push(text) });
  const worker = workers[0], request = worker.requests[0];
  assert.equal(request.operation, 'reply'); assert.deepEqual(request.payload.messages, messages);
  worker.emit(request.id, 'token', 'Fixture'); worker.emit(request.id, 'token', 'Fixture reply');
  assert.deepEqual(tokens, ['Fixture', 'Fixture reply']);
  worker.emit(request.id, 'result', 'Fixture final reply'); assert.equal(await sending, 'Fixture final reply');
});

test('aborting an owned worker rejects every pending request and removes its active lifetime', async t => {
  const { adapter, workers, active } = fixture(t), stop = new AbortController();
  const loading = adapter.prepare({ source: 'remote', signal: stop.signal });
  const sending = adapter.reply([], {}), failedLoad = assert.rejects(loading, aborted), failedReply = assert.rejects(sending, aborted);
  stop.abort(); await Promise.all([failedLoad, failedReply]);
  assert.equal(workers[0].terminations, 1); assert.equal(active.size, 0);
});

test('disposed worker messages and errors cannot affect a fresh retry worker', async t => {
  const { adapter, workers, active } = fixture(t), progress = [];
  const first = adapter.prepare({ source: 'remote', onProgress: value => progress.push(value) });
  const old = workers[0], oldId = old.requests[0].id, stopped = assert.rejects(first, aborted);
  await adapter.dispose(); await stopped;
  const retry = adapter.prepare({ source: 'remote', onProgress: value => progress.push(value) });
  const next = workers[1], request = next.requests[0];
  assert.notEqual(next, old); assert.equal(active.size, 1);
  old.emit(oldId, 'progress', { phase: 'initializing' }); old.emit(oldId, 'result', { cached: true, modelId: 'stale' }); old.fail();
  assert.deepEqual(progress, []); assert.equal(next.terminations, 0); assert.equal(active.size, 1);
  next.emit(request.id, 'result', { cached: true, modelId: 'retry-fixture' });
  assert.deepEqual(await retry, { cached: true, modelId: 'retry-fixture' });
});

test('worker failures tear down the lifetime and reject pending work with useful recovery text', async t => {
  const { adapter, workers, active } = fixture(t);
  const loading = adapter.prepare({ source: 'remote' }), sending = adapter.reply([], {});
  const failedLoad = assert.rejects(loading, /worker failed.*memory.*WASM.*retry/i);
  const failedReply = assert.rejects(sending, /worker failed/i);
  workers[0].fail(); await Promise.all([failedLoad, failedReply]);
  assert.equal(active.size, 0); assert.equal(workers[0].terminations, 1);
});

test('pre-aborted input creates no worker; repeated disposal leaves no active workers', async t => {
  const { adapter, workers, active } = fixture(t), stop = new AbortController(); stop.abort();
  await assert.rejects(adapter.prepare({ source: 'remote', signal: stop.signal }), aborted);
  assert.equal(workers.length, 0);
  const loading = adapter.prepare({ source: 'remote' }), stopped = assert.rejects(loading, aborted);
  await adapter.dispose(); await stopped; await adapter.dispose();
  assert.equal(workers.length, 1); assert.equal(workers[0].terminations, 1); assert.equal(active.size, 0);
});

test('explicit permanent capability refusal preserves safe metadata across Worker transport', async t => {
  const { adapter, workers } = fixture(t);
  const loading = adapter.prepare({ source: 'remote' }), worker = workers[0];
  const capabilities = [{ id: 'opfs', label: 'Browser storage (OPFS)', detail: 'The API is unavailable.', ignored: 'not UI data' }, null, { label: 'invalid' }];
  worker.emit(worker.requests[0].id, 'error', 'No model was downloaded. Browser storage is unavailable.', {
    code: 'UNSUPPORTED_BROWSER', retryable: false, capabilities,
  });
  await assert.rejects(loading, failure => {
    assert.equal(failure.code, 'UNSUPPORTED_BROWSER'); assert.equal(failure.retryable, false);
    assert.match(failure.message, /No model was downloaded/);
    assert.deepEqual(failure.capabilities, [{ id: 'opfs', label: 'Browser storage (OPFS)', detail: 'The API is unavailable.' }]);
    capabilities[0].label = 'Mutated outside the adapter';
    assert.equal(failure.capabilities[0].label, 'Browser storage (OPFS)');
    return true;
  });
});

test('unclassified errors and retryable capability failures do not acquire a permanent lock', async t => {
  const { adapter, workers } = fixture(t);
  for (const metadata of [{}, { code: 'UNSUPPORTED_BROWSER', retryable: true }, { retryable: false }]) {
    const loading = adapter.prepare({ source: 'remote' }), worker = workers.at(-1);
    worker.emit(worker.requests.at(-1).id, 'error', 'Fixture temporary failure', metadata);
    await assert.rejects(loading, failure => failure.message === 'Fixture temporary failure' && failure.retryable !== false && failure.code !== 'UNSUPPORTED_BROWSER');
  }
});

function clock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return { timers, setTimeoutFn(run, delay) { const id = serial++; timers.set(id, { at: now + delay, run }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.run(); } },
  };
}

test('initialization waiting is bounded from its first stage, not download time or later progress; retry uses a fresh Worker', async t => {
  const timers = clock(), { adapter, workers, active } = fixture(t, { ...timers, initWaitMs: 180_000 });
  const loading = adapter.prepare({ source: 'remote' }), worker = workers[0], id = worker.requests[0].id;
  worker.emit(id, 'progress', { phase: 'downloading', loaded: 1, total: 2 });
  timers.advance(600_000); assert.equal(active.size, 1); assert.equal(timers.timers.size, 0);
  worker.emit(id, 'progress', { phase: 'initializing', stage: 'runtime-start' });
  timers.advance(170_000);
  worker.emit(id, 'progress', { phase: 'initializing', stage: 'context-create' });
  assert.equal(timers.timers.size, 1, 'Later genuine progress does not extend the waiting budget');
  const refused = assert.rejects(loading, error => error.code === 'INIT_WAIT_LIMIT' && error.stage === 'context-create' && /waiting limit, not proof.*Cached bytes were not removed/.test(error.message));
  timers.advance(10_000); await refused;
  assert.equal(active.size, 0); assert.equal(worker.terminations, 1); assert.equal(timers.timers.size, 0);
  const retry = adapter.prepare({ source: 'remote' }), fresh = workers[1];
  worker.emit(id, 'progress', { phase: 'initializing', stage: 'ready' });
  fresh.emit(fresh.requests[0].id, 'result', { cached: true, modelId: 'cached-retry' });
  assert.deepEqual(await retry, { cached: true, modelId: 'cached-retry' });
});

test('readiness and cancellation clear initialization timers, including a zero-valued timer id', async t => {
  const timers = clock(), { adapter, workers } = fixture(t, timers);
  const loading = adapter.prepare({ source: 'file', file: { name: 'fixture.gguf' } }), worker = workers[0], id = worker.requests[0].id;
  worker.emit(id, 'progress', { phase: 'initializing' });
  worker.emit(id, 'progress', { phase: 'initializing' }); assert.equal(timers.timers.size, 1);
  worker.emit(id, 'result', { cached: false, modelId: 'ready-fixture' }); await loading;
  assert.equal(timers.timers.size, 0);
  const stop = new AbortController(), next = adapter.prepare({ source: 'remote', signal: stop.signal });
  const cancelled = assert.rejects(next, aborted);
  worker.emit(worker.requests.at(-1).id, 'progress', { phase: 'initializing' }); stop.abort(); await cancelled;
  assert.equal(timers.timers.size, 0); timers.advance(180_000); assert.equal(worker.terminations, 1);
});

test('Worker crash and unreadable message failures propagate a distinct code and terminate owned resources', async t => {
  for (const kind of ['error', 'messageerror']) {
    const { adapter, workers, active } = fixture(t), loading = adapter.prepare({ source: 'remote' });
    const refused = assert.rejects(loading, error => {
      assert.equal(error.code, kind === 'error' ? 'WORKER_ERROR' : 'WORKER_MESSAGE_ERROR');
      assert.match(error.message, /cached bytes were not removed/i);
      if (kind === 'error') assert.match(error.message, /Fixture precise allocation error/);
      return true;
    });
    if (kind === 'error') workers[0].onerror({ message: 'Fixture precise allocation error', preventDefault() {} });
    else workers[0].onmessageerror({});
    await refused; assert.equal(active.size, 0); assert.equal(workers[0].terminations, 1);
  }
});

test('structured engine failures retain only bounded diagnostic stage events and no arbitrary payload', async t => {
  const { adapter, workers } = fixture(t), loading = adapter.prepare({ source: 'remote' }), worker = workers[0];
  worker.emit(worker.requests[0].id, 'error', 'Fixture engine abort', { code: 'ENGINE_UNHANDLED_REJECTION',
    diagnostics: { stage: 'model-load', detail: 'Fixture abort', prompt: 'not diagnostic data', events: Array.from({ length: 12 }, () => ({ stage: 'model-load', detail: 'x'.repeat(500), atMs: 1, ignored: 'not diagnostic data' })) },
  });
  await assert.rejects(loading, error => {
    assert.equal(error.code, 'ENGINE_UNHANDLED_REJECTION'); assert.equal(error.diagnostics.events.length, 8);
    assert.equal(error.diagnostics.events[0].detail.length, 240); assert.equal(error.diagnostics.prompt, undefined);
    assert.equal(error.diagnostics.events[0].ignored, undefined); return true;
  });
});
