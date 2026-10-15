import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWasmMemories } from '../wasm-memory.mjs';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const wasm = (...sections) => Uint8Array.from([...header, ...sections.flat()]);
const section = (id, body) => [id, body.length, ...body];
const text = value => [value.length, ...new TextEncoder().encode(value)];

test('distinguishes imported shared Memory32 and Memory64 flags with exact offsets', () => {
  for (const flags of [3, 7]) {
    const bytes = wasm(section(2, [1, ...text('env'), ...text('memory'), 2, flags, 1, 2]));
    const result = inspectWasmMemories(bytes);
    assert.deepEqual(result, { requiresMemory64: flags === 7, memories: [{ kind: 'imported', module: 'env', name: 'memory',
      offset: 23, flags, address: flags === 7 ? 'i64' : 'i32', shared: true, minimumPages: '1', maximumPages: '2' }] });
  }
});

test('reads defined memories and 64-bit page limits without precision loss', () => {
  const bytes = wasm(section(5, [1, 5, 0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10]));
  const result = inspectWasmMemories(bytes);
  assert.equal(result.requiresMemory64, true);
  assert.equal(result.memories[0].maximumPages, '9007199254740992');
});

test('ignores unrelated sections and skips other supported imports', () => {
  const imported = [5,
    ...text('m'), ...text('f'), 0, 0,
    ...text('m'), ...text('t'), 1, 0x70, 1, 0, 1,
    ...text('m'), ...text('g'), 3, 0x7f, 0,
    ...text('m'), ...text('e'), 4, 0, 0,
    ...text('m'), ...text('memory'), 2, 0, 0];
  const result = inspectWasmMemories(wasm(section(0, [0, 9, 9]), section(2, imported)));
  assert.equal(result.requiresMemory64, false);
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].address, 'i32');
});

test('accepts ArrayBuffer and bounded typed-array views without scanning adjacent bytes', () => {
  const bytes = wasm(section(5, [1, 0, 0]));
  assert.equal(inspectWasmMemories(bytes.buffer).memories.length, 1);
  const padded = Uint8Array.from([9, ...bytes, 9]);
  assert.equal(inspectWasmMemories(new DataView(padded.buffer, 1, bytes.length)).memories.length, 1);
  assert.deepEqual(inspectWasmMemories(wasm()), { memories: [], requiresMemory64: false });
});

test('fails closed for bad magic/version, truncated boundaries, overflowing LEBs and invalid limits', () => {
  const invalid = [
    new Uint8Array(), Uint8Array.from([9, ...header.slice(1)]), Uint8Array.from([...header.slice(0, 7), 1]),
    wasm([5, 10, 1, 0, 0]), wasm(section(5, [1, 0])), wasm(section(5, [1, 8, 0])),
    wasm(section(5, [1, 2, 0])), wasm(section(5, [1, 1, 2, 1])),
    wasm([5, 0x80, 0x80, 0x80, 0x80, 0x10]), wasm(section(5, [1, 0, 0x80, 0x80, 0x80, 0x80, 0x10])),
    wasm(section(2, [1, 9, 65])), wasm(section(2, [1, ...text('m'), ...text('x'), 9])),
    wasm(section(5, [0, 9])),
  ];
  for (const bytes of invalid) assert.throws(() => inspectWasmMemories(bytes), /Invalid WASM/);
  assert.throws(() => inspectWasmMemories('wasm'), TypeError);
});
