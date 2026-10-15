import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRuntimeError, formatRuntimeError, formatRuntimeAbort, installRuntimeAbortGuard } from '../runtime-errors.mjs';

test('unknown runtime values become bounded primitives without dumping objects or arrays', () => {
  const cases = [
    ['WASM compilation failed', /WASM compilation failed/],
    [new RangeError('Memory allocation failed'), /RangeError: Memory allocation failed/],
    [{ name: 'LinkError', message: 'Invalid imported memory', prompt: 'PRIVATE', logs: ['PRIVATE'] }, /LinkError: Invalid imported memory/],
    [null, /no readable error detail/], [undefined, /no readable error detail/],
    [['PRIVATE', new Error('PRIVATE')], /array without readable error detail/],
    [42, /number value/], [true, /boolean value/], [Symbol('PRIVATE'), /symbol value/],
    [5n, /bigint value/], [{ message: { message: 'Nested readable error' } }, /Nested readable error/],
  ];
  for (const [value, expected] of cases) {
    const identity = normalizeRuntimeError(value), text = formatRuntimeError(value);
    assert.match(text, expected); assert.doesNotMatch(text, /PRIVATE|\[object Object\]/);
    assert.equal(typeof identity.message, 'string'); assert.ok(text.length <= 320);
    assert.deepEqual(Object.keys(identity).sort(), ['kind', 'message', 'name']);
  }
});

test('ErrorEvent, rejection and abort envelopes retain readable identity, excluding stack and unrelated fields', () => {
  const cases = [
    { error: new TypeError('Bad WASM import'), message: null },
    { reason: { name: 'TypeError', message: 'Bad WASM import' } },
    { data: { verb: 'signal.abort', args: ['abort', { name: 'TypeError', message: 'Bad WASM import' }, 'PRIVATE STACK', { prompt: 'PRIVATE' }] } },
  ];
  for (const value of cases) {
    assert.equal(formatRuntimeError(value), 'TypeError: Bad WASM import');
    assert.doesNotMatch(JSON.stringify(normalizeRuntimeError(value)), /PRIVATE/);
  }
  assert.equal(formatRuntimeError(new TypeError('TypeError: already named')), 'TypeError: already named');
});

test('hostile accessors, cyclic objects and revoked proxies cannot replace the original failure with a formatter error', () => {
  const hostile = { get message() { throw new Error('PRIVATE'); }, toString() { throw new Error('PRIVATE'); }, cause: { message: 'Readable underlying cause' } };
  const cycle = {}; cycle.message = cycle; cycle.reason = cycle;
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const value of [hostile, cycle, proxy, Object.create(null)]) {
    assert.doesNotThrow(() => normalizeRuntimeError(value)); assert.doesNotThrow(() => formatRuntimeError(value));
    assert.doesNotThrow(() => formatRuntimeAbort(value));
    assert.doesNotMatch(formatRuntimeError(value), /PRIVATE|replace is not a function/);
  }
  assert.equal(formatRuntimeError(hostile), 'Readable underlying cause');
});

test('diagnostic strings drop stacks, controls and host locations and cap large errors', () => {
  const value = new Error('Compile failed https://example.invalid/private/model C:\\Users\\private\\file /Users/private/file\u0000' + 'x'.repeat(1000) + '\nPRIVATE STACK');
  const text = formatRuntimeError(value);
  assert.doesNotMatch(text, /example|Users|PRIVATE STACK|\u0000/); assert.ok(text.length <= 240);
  assert.match(text, /Compile failed \[URL\] \[path\] \[path\]/);
});

function setup(onAbort = () => {}) {
  const engine = { proxy: undefined };
  installRuntimeAbortGuard(engine, onAbort);
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const observed = [];
  const proxy = {
    onRecvMsg(event) { observed.push({ event, receiver: this }); if (event.data?.verb === 'signal.abort') throw new Error('Unsafe vendor formatter was reached'); },
    abort(message, stack) { assert.equal(typeof message, 'string'); assert.equal(stack, ''); reject(new Error(message)); },
  };
  engine.proxy = proxy;
  return { engine, proxy, pending, observed };
}

test('pinned instance guard rejects typed abort payloads before vendor string operations or stack decoding', async () => {
  const inputs = ['Underlying failure', new RangeError('Memory failed'), { name: 'LinkError', message: 'WASM import failed', prompt: 'PRIVATE' }, null, ['PRIVATE'], { reason: new TypeError('Nested failure') }];
  for (const input of inputs) {
    let identity;
    const { proxy, pending, observed } = setup(value => { identity = value; });
    const refused = assert.rejects(pending, error => {
      assert.match(error.message, /^Runtime abort /); assert.doesNotMatch(error.message, /PRIVATE|replace is not a function/); return true;
    });
    assert.doesNotThrow(() => proxy.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', input, { PRIVATE: 'rawStack' }, null] } }));
    await refused; assert.equal(identity.signalType, 'abort'); assert.equal(observed.length, 0);
    assert.deepEqual(Object.keys(identity).sort(), ['kind', 'message', 'name', 'signalType']);
  }
});

test('the guard preserves ordinary messages/receiver and contains observer failure while rejecting pending work', async () => {
  const { engine, proxy, pending, observed } = setup(() => { throw new Error('Broken observer'); });
  const event = { data: { verb: 'console.log', args: ['ordinary vendor message'] } };
  proxy.onRecvMsg(event); assert.deepEqual(observed, [{ event, receiver: proxy }]);
  assert.equal(Object.getOwnPropertyDescriptor(engine, 'proxy').value, proxy);
  const refused = assert.rejects(pending, /Runtime exception \(LinkError\): Original failure/);
  proxy.onRecvMsg({ data: { verb: 'signal.abort', args: ['exception', null, ['PRIVATE'], new WebAssembly.LinkError('Original failure')] } });
  await refused;
});

test('a changed pinned proxy interface fails explicitly instead of silently skipping the abort guard', () => {
  for (const engine of [{}, { proxy: {} }, Object.defineProperty({}, 'proxy', { value: undefined, configurable: false })]) {
    assert.throws(() => installRuntimeAbortGuard(engine, () => {}), error => error.code === 'ENGINE_BOUNDARY_ERROR');
  }
  const engine = { proxy: undefined }; installRuntimeAbortGuard(engine, () => {});
  assert.throws(() => { engine.proxy = {}; }, error => error.code === 'ENGINE_BOUNDARY_ERROR');
});
