// Inspect memory declarations without compiling WASM or allocating its memory.
// This is a narrow binary contract check, not a general WASM validator. The
// selected engine must still compile the complete, hash-verified runtime.
export function inspectWasmMemories(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : null;
  if (!bytes) throw new TypeError('Expected WASM bytes.');
  let position = 0, limit = bytes.length;
  const fail = () => { throw new Error(`Invalid WASM memory declaration at byte ${position}.`); };
  const byte = () => { if (position >= limit) fail(); return bytes[position++]; };
  const unsigned = (bits = 32) => {
    let value = 0n;
    for (let index = 0; index < Math.ceil(bits / 7); index++) {
      const item = byte(); value |= BigInt(item & 127) << BigInt(index * 7);
      if (!(item & 128)) { if (value >= (1n << BigInt(bits))) fail(); return value; }
    }
    fail();
  };
  const count = () => Number(unsigned());
  const name = () => {
    const length = count();
    if (length > limit - position) fail();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position, position + length));
    position += length; return value;
  };
  const valueType = () => {
    const code = byte();
    // Typed references carry a signed heap-type LEB. Only its encoded extent
    // matters here; full reference/type validation belongs to the engine.
    if (code === 0x63 || code === 0x64) {
      for (let index = 0; index < 5; index++) { if (!(byte() & 128)) return; }
      fail();
    }
  };
  const limits = () => {
    const offset = position, flags = count();
    if (flags & ~7 || (flags & 2 && !(flags & 1))) fail();
    const minimumPages = unsigned(flags & 4 ? 64 : 32);
    const maximumPages = flags & 1 ? unsigned(flags & 4 ? 64 : 32) : null;
    if (maximumPages !== null && maximumPages < minimumPages) fail();
    return { offset, flags, address: flags & 4 ? 'i64' : 'i32', shared: !!(flags & 2),
      minimumPages: minimumPages.toString(), maximumPages: maximumPages?.toString() ?? null };
  };
  for (const expected of [0, 97, 115, 109, 1, 0, 0, 0]) if (byte() !== expected) fail();
  const memories = [];
  while (position < bytes.length) {
    limit = bytes.length;
    const id = byte(), length = count(), end = position + length;
    if (end > bytes.length) fail();
    limit = end;
    if (id === 2) {
      const entries = count();
      for (let index = 0; index < entries; index++) {
        const module = name(), importedName = name(), kind = byte();
        if (kind === 0) count();
        else if (kind === 1) { valueType(); limits(); }
        else if (kind === 2) memories.push({ kind: 'imported', module, name: importedName, ...limits() });
        else if (kind === 3) { valueType(); byte(); }
        else if (kind === 4) { byte(); count(); }
        else fail();
      }
      if (position !== end) fail();
    } else if (id === 5) {
      const entries = count();
      for (let index = 0; index < entries; index++) memories.push({ kind: 'defined', ...limits() });
      if (position !== end) fail();
    }
    position = end;
  }
  return { memories, requiresMemory64: memories.some(memory => memory.address === 'i64') };
}
