import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeAdapter } from '../runtime-adapter.mjs';

// Transport-only fixture. No real Worker, WASM, network, cache or model is created.
function fixture(t) {
  const workers = [], active = new Set();
  class FixtureWorker {
    constructor(url, options) { this.url = url; this.options = options; this.requests = []; this.terminations = 0; workers.push(this); active.add(this); }
    postMessage(message) { this.requests.push(structuredClone(message)); }
    terminate() { this.terminations++; active.delete(this); }
    emit(id, type, value) { this.onmessage?.({ data: { id, type, value } }); }
    fail() { this.onerror?.({ message: 'Fixture worker crash' }); }
  }
  const adapter = createRuntimeAdapter({ WorkerClass: FixtureWorker });
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
