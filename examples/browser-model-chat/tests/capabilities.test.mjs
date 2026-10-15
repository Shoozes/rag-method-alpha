import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { inspectCapabilities } from '../capabilities.mjs';

// Injected feature/storage ports only. No runtime, real Worker, model or network.
function fixture({ failAt, unsupported, compileFailure, collisions = false } = {}) {
  const events = [], validated = [], compiled = [], memories = [];
  const files = new Map([['unrelated.gguf', new Uint8Array([9, 8, 7])]]);
  const fail = phase => { if (failAt === phase) throw new Error(`Fixture ${phase} failure`); };
  const directory = {
    async getFileHandle(name, options) {
      events.push(['file', name, options?.create === true]);
      if (!options?.create) {
        if (collisions || files.has(name)) return {};
        throw Object.assign(new Error('Fixture absent file'), { name: 'NotFoundError' });
      }
      fail('create');
      files.set(name, new Uint8Array());
      return {
        async createSyncAccessHandle() {
          events.push(['access', name]); fail('access');
          return {
            truncate(size) { events.push(['truncate', size]); fail('truncate'); files.set(name, new Uint8Array()); },
            write(bytes) { events.push(['write', [...bytes]]); fail('write'); files.set(name, bytes.slice()); return failAt === 'short-write' ? 0 : bytes.length; },
            flush() { events.push(['flush']); fail('flush'); },
            close() { events.push(['close']); fail('close'); },
          };
        },
      };
    },
    async removeEntry(name, options) { events.push(['remove', name, options]); fail('remove'); files.delete(name); },
  };
  const identify = bytes => bytes.length === 8 ? 'base' : bytes.length === 13 ? 'memory64' : bytes.includes(253) ? 'simd' : 'exceptions';
  const environment = {
    isSecureContext: true,
    WebAssembly: {
      validate(bytes) { validated.push(bytes.slice()); return identify(bytes) !== unsupported; },
      async compile(bytes) { compiled.push(bytes.slice()); if (identify(bytes) === compileFailure) throw new Error('Fixture compiler refusal'); return {}; },
      Memory: class { constructor(options) { memories.push(options); fail('memory64-constructor'); } },
      Suspending() {}, promising() {},
    },
    Worker: class { constructor() { throw new Error('A capability probe must not launch a Worker'); } },
    crypto: { subtle: webcrypto.subtle, randomUUID: () => 'fixture-unique' },
    navigator: { storage: { async getDirectory() {
      events.push(['root']); fail('root');
      return { async getDirectoryHandle(name, options) { events.push(['directory', name, options]); fail('directory'); return directory; } };
    } } },
    get fetch() { throw new Error('A capability probe must not request network access'); },
  };
  return { environment, events, files, validated, compiled, memories };
}
const requirement = (report, id) => report.requirements.find(item => item.id === id);
const expectedKeys = ['secure-context', 'webassembly', 'memory64', 'wasm-simd', 'wasm-exceptions', 'worker', 'sha256', 'opfs', 'opfs-writable'];

test('supported fixture compiles actual feature binaries and closes/removes only its owned tiny OPFS file', async () => {
  const f = fixture(), report = await inspectCapabilities(f.environment);
  assert.equal(report.supported, true);
  assert.deepEqual(report.requirements.map(item => item.id), expectedKeys);
  assert.deepEqual(report.warnings, []);
  assert.equal(f.validated.length, 4); assert.equal(f.compiled.length, 4);
  assert.deepEqual(f.memories, [{ address: 'i64', initial: 1n }]);
  assert.deepEqual(f.compiled.map(bytes => [...bytes]), f.validated.map(bytes => [...bytes]));
  assert.deepEqual([...f.compiled[1]], [0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 0]);
  assert.deepEqual([...f.compiled[2]], [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  assert.deepEqual([...f.compiled[3]], [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11]);
  // Validate with the actual host when it implements a feature; tests do not require
  // the Node host to support every browser feature accepted by the injected fixture.
  for (const bytes of f.compiled) if (WebAssembly.validate(bytes)) await WebAssembly.compile(bytes);
  assert.deepEqual([...f.files], [['unrelated.gguf', new Uint8Array([9, 8, 7])]]);
  assert.deepEqual(f.events.find(event => event[0] === 'directory'), ['directory', 'browser-model-chat-capability-probes', { create: true }]);
  assert.deepEqual(f.events.filter(event => ['truncate', 'write', 'flush', 'close'].includes(event[0])), [['truncate', 0], ['write', [1]], ['flush'], ['close']]);
  const created = f.events.find(event => event[0] === 'file' && event[2]);
  assert.deepEqual(f.events.at(-1), ['remove', created[1], undefined]);
});

test('WASM feature support does not depend on JS Tag/Exception, GPU, shared-memory or isolation globals', async () => {
  const f = fixture();
  assert.equal(f.environment.WebAssembly.Tag, undefined); assert.equal(f.environment.WebAssembly.Exception, undefined);
  assert.equal(f.environment.SharedArrayBuffer, undefined); assert.equal(f.environment.crossOriginIsolated, undefined);
  assert.equal(f.environment.navigator.gpu, undefined);
  assert.equal((await inspectCapabilities(f.environment)).supported, true);
});

test('Memory64 rejection is required by default and can be optional only for a build choosing another runtime', async () => {
  const f = fixture({ unsupported: 'memory64' }), report = await inspectCapabilities(f.environment);
  assert.equal(report.supported, false); assert.equal(requirement(report, 'memory64').supported, false);
  assert.equal(f.compiled.some(bytes => bytes.length === 13), false);
  assert.deepEqual(f.memories, [], 'A rejected binary must not attempt a constructor allocation');
  const otherBuild = await inspectCapabilities(f.environment, { requireMemory64: false });
  assert.equal(otherBuild.supported, true);
  assert.equal(requirement(otherBuild, 'memory64'), undefined);
  assert.equal(otherBuild.optional.find(item => item.id === 'memory64').supported, false);
});

test('compiled Memory64 with a failing or absent Memory constructor is rejected before model loading', async () => {
  for (const missingConstructor of [false, true]) {
    const f = fixture({ failAt: 'memory64-constructor' });
    if (missingConstructor) delete f.environment.WebAssembly.Memory;
    const report = await inspectCapabilities(f.environment);
    assert.equal(f.compiled.some(bytes => bytes.length === 13), true);
    assert.equal(report.supported, false); assert.equal(requirement(report, 'memory64').supported, false);
    assert.match(requirement(report, 'memory64').detail, /could not construct/);
    assert.equal(f.memories.length, missingConstructor ? 0 : 1);
    const otherBuild = await inspectCapabilities(f.environment, { requireMemory64: false });
    assert.equal(otherBuild.supported, true); assert.equal(otherBuild.optional.find(item => item.id === 'memory64').supported, false);
  }
});

test('SIMD/exception byte validation and compilation failures fail the required feature independently', async () => {
  for (const [feature, id] of [['memory64', 'memory64'], ['simd', 'wasm-simd'], ['exceptions', 'wasm-exceptions']]) {
    for (const type of ['unsupported', 'compileFailure']) {
      const report = await inspectCapabilities(fixture({ [type]: feature }).environment);
      assert.equal(report.supported, false); assert.equal(requirement(report, id).supported, false);
    }
  }
});

test('missing or blocked base WebAssembly reports failure without pretending feature support', async () => {
  for (const replacement of [undefined, {}, { validate: () => true }, { validate() { throw new Error('Policy blocked'); }, compile: async () => ({}) }]) {
    const f = fixture(); f.environment.WebAssembly = replacement;
    const report = await inspectCapabilities(f.environment, { requireWritableOPFS: false });
    assert.equal(report.supported, false);
    for (const id of ['webassembly', 'memory64', 'wasm-simd', 'wasm-exceptions']) assert.equal(requirement(report, id).supported, false);
  }
  assert.equal((await inspectCapabilities(fixture({ compileFailure: 'base' }).environment)).supported, false);
});

test('secure context and nested Worker availability are required; insecure probes leave storage alone', async () => {
  const f = fixture(); f.environment.isSecureContext = false; delete f.environment.Worker;
  const report = await inspectCapabilities(f.environment);
  assert.equal(report.supported, false); assert.equal(requirement(report, 'secure-context').supported, false);
  assert.match(requirement(report, 'secure-context').detail, /HTTPS/);
  assert.equal(requirement(report, 'worker').supported, false); assert.equal(requirement(report, 'opfs-writable').supported, false);
  assert.deepEqual(f.events, []);
});

test('SHA-256 checks the actual known digest, not just a crypto API property', async () => {
  const f = fixture(), calls = [];
  f.environment.crypto.subtle = { async digest(algorithm, bytes) { calls.push([algorithm, [...bytes]]); return webcrypto.subtle.digest(algorithm, bytes); } };
  assert.equal(requirement(await inspectCapabilities(f.environment), 'sha256').supported, true);
  assert.deepEqual(calls, [['SHA-256', []]]);
  for (const subtle of [undefined, {}, { digest: async () => new Uint8Array(32).buffer }, { async digest() { throw new Error('Crypto blocked'); } }]) {
    const broken = fixture(); broken.environment.crypto.subtle = subtle;
    const report = await inspectCapabilities(broken.environment);
    assert.equal(report.supported, false); assert.equal(requirement(report, 'sha256').supported, false);
  }
});

test('OPFS API is required for both default runtime input paths; another build can explicitly omit it', async () => {
  const f = fixture(); delete f.environment.navigator.storage.getDirectory;
  for (const requireWritableOPFS of [true, false]) {
    const report = await inspectCapabilities(f.environment, { requireWritableOPFS });
    assert.equal(report.supported, false); assert.equal(requirement(report, 'opfs').supported, false);
  }
  const otherBuild = await inspectCapabilities(f.environment, { requireOPFS: false });
  assert.equal(otherBuild.supported, true); assert.equal(requirement(otherBuild, 'opfs'), undefined);
  assert.equal(requirement(otherBuild, 'opfs-writable'), undefined); assert.deepEqual(f.events, []);
});

test('File preflight skips writing; read-only storage refuses the fixture download contract before weights', async () => {
  const f = fixture({ failAt: 'root' }); let weightRequests = 0;
  const fileReport = await inspectCapabilities(f.environment, { requireWritableOPFS: false });
  assert.equal(fileReport.supported, true); assert.equal(requirement(fileReport, 'opfs-writable'), undefined);
  assert.deepEqual(f.events, []);
  // Integration contract fixture: parent engine enforces this before its model path.
  const remoteReport = await inspectCapabilities(f.environment);
  if (remoteReport.supported) weightRequests++;
  assert.equal(remoteReport.supported, false); assert.equal(weightRequests, 0);
  assert.deepEqual(f.events, [['root']]);
});

test('write/flush/short-write failures close the handle and remove only the owned probe file', async () => {
  for (const failAt of ['truncate', 'write', 'flush', 'short-write']) {
    const f = fixture({ failAt }), report = await inspectCapabilities(f.environment);
    assert.equal(report.supported, false); assert.equal(requirement(report, 'opfs-writable').supported, false);
    assert.match(requirement(report, 'opfs-writable').detail, /write and flush/);
    assert.equal(f.events.filter(event => event[0] === 'close').length, 1);
    assert.equal(f.events.filter(event => event[0] === 'remove').length, 1);
    assert.deepEqual([...f.files.keys()], ['unrelated.gguf']);
  }
});

test('failed sync access removes a created file; earlier directory failures mutate no files', async () => {
  for (const failAt of ['root', 'directory', 'create', 'access']) {
    const f = fixture({ failAt }), report = await inspectCapabilities(f.environment);
    assert.equal(report.supported, false); assert.deepEqual([...f.files.keys()], ['unrelated.gguf']);
    assert.equal(f.events.some(event => event[0] === 'remove'), failAt === 'access');
  }
});

test('close and cleanup failures remain unsupported rather than hiding failed probe recovery', async () => {
  for (const failAt of ['close', 'remove']) {
    const f = fixture({ failAt }), report = await inspectCapabilities(f.environment);
    assert.equal(report.supported, false); assert.match(requirement(report, 'opfs-writable').detail, new RegExp(failAt));
    assert.equal(f.events.filter(event => event[0] === 'close').length, 1);
    assert.equal(f.events.filter(event => event[0] === 'remove').length, 1);
    assert.deepEqual([...f.files.get('unrelated.gguf')], [9, 8, 7]);
  }
});

test('probe name collisions never create, truncate or remove an existing file', async () => {
  const f = fixture({ collisions: true }), report = await inspectCapabilities(f.environment);
  assert.equal(report.supported, false);
  assert.equal(f.events.filter(event => event[0] === 'file').length, 3);
  assert.equal(f.events.some(event => event[0] === 'file' && event[2]), false);
  assert.equal(f.events.some(event => ['access', 'truncate', 'remove'].includes(event[0])), false);
  assert.deepEqual([...f.files.keys()], ['unrelated.gguf']);
});

test('fully absent JSPI or absent Suspending uses the optional bundled fallback', async () => {
  for (const removePromising of [true, false]) {
    const f = fixture(); delete f.environment.WebAssembly.Suspending;
    if (removePromising) delete f.environment.WebAssembly.promising;
    const report = await inspectCapabilities(f.environment);
    assert.equal(report.supported, true); assert.equal(report.optional.find(item => item.id === 'jspi').supported, false);
    assert.equal(report.warnings.length, 1); assert.match(report.warnings[0], /memory-copy fallback/);
  }
});

test('truthy incomplete JSPI is rejected because the bundled fallback does not replace it', async () => {
  for (const promising of [undefined, null, true, {}]) {
    const f = fixture(); f.environment.WebAssembly.promising = promising;
    const report = await inspectCapabilities(f.environment);
    assert.equal(report.supported, false);
    assert.equal(requirement(report, 'jspi-compatible').supported, false);
    assert.match(requirement(report, 'jspi-compatible').detail, /incomplete JSPI/);
    assert.doesNotMatch(report.warnings[0], /uses its synchronous memory-copy fallback/);
  }
  const f = fixture(); f.environment.WebAssembly.Suspending = {};
  assert.equal((await inspectCapabilities(f.environment)).supported, false);
});
