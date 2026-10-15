// Feature probes only: no runtime import, model fetch, Worker launch or cache clearing.
const EMPTY_WASM = [0, 97, 115, 109, 1, 0, 0, 0];
// One zero-page i64 memory. Validation/compilation does not allocate model memory.
const MEMORY64_WASM = [...EMPTY_WASM, 5, 3, 1, 4, 0];
// The SIMD and exception probes used by the pinned wllama 3.5.1 distribution.
const SIMD_WASM = [...EMPTY_WASM, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
const EXCEPTIONS_WASM = [...EMPTY_WASM, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11];
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const PROBE_DIRECTORY = 'browser-model-chat-capability-probes';
let probeSequence = 0;

async function canCompile(wasm, bytes) {
  if (typeof wasm?.validate !== 'function' || typeof wasm?.compile !== 'function') return false;
  try {
    const binary = new Uint8Array(bytes);
    if (!wasm.validate(binary)) return false;
    await wasm.compile(binary);
    return true;
  } catch { return false; }
}

function canCreateMemory64(wasm) {
  try {
    // Match the pinned vendor's isSupportMem64 check, with one 64 KiB page.
    new wasm.Memory({ address: 'i64', initial: BigInt('1') });
    return true;
  } catch { return false; }
}

async function canHash(crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') return false;
  try {
    const result = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array()));
    return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('') === EMPTY_SHA256;
  } catch { return false; }
}

function probeName(crypto) {
  const unique = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `probe-${unique}-${++probeSequence}.tmp`;
}

async function writableOPFS(environment) {
  let directory, name, access, created = false, failure = null;
  let stage = 'open';
  try {
    const root = await environment.navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(PROBE_DIRECTORY, { create: true });
    // Check before creating: even an improbable name collision must not truncate another file.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = probeName(environment.crypto);
      try { await directory.getFileHandle(candidate); }
      catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
        name = candidate;
        break;
      }
    }
    if (!name) throw new Error('Probe name unavailable');
    const file = await directory.getFileHandle(name, { create: true });
    created = true;
    // The vendor's download cache writes through a nested Worker's sync access handle.
    access = await file.createSyncAccessHandle();
    stage = 'write';
    access.truncate(0);
    if (access.write(new Uint8Array([1])) !== 1) throw new Error('Incomplete probe write');
    access.flush();
  } catch {
    failure = stage === 'write'
      ? 'Browser storage could not write and flush a tiny test file. Free storage space or select a local model File.'
      : 'Writable OPFS sync access is unavailable in this Worker. Allow site storage or select a local model File.';
  } finally {
    if (access) {
      try { access.close(); }
      catch { failure ||= 'Browser storage could not close its test file. Retry after closing other tabs for this site.'; }
    }
    if (created) {
      try { await directory.removeEntry(name); }
      catch { failure ||= 'Browser storage could not remove its tiny test file. Check site storage permissions before downloading.'; }
    }
  }
  return { supported: !failure, detail: failure || 'Created, wrote, flushed, closed and removed one owned byte-sized OPFS file.' };
}

/**
 * Inspect the actual Worker environment before model bytes are requested.
 * Build-owned flags describe the selected runtime; they are not user overrides.
 * wllama 3.5.1 needs OPFS API presence even for File input, but only downloads need
 * a writable cache. Call with requireWritableOPFS:false for the File path.
 * A passing report still requires compiling the pinned runtime WASM before weights.
 */
export async function inspectCapabilities(environment = globalThis, {
  requireMemory64 = true,
  requireOPFS = true,
  requireWritableOPFS = requireOPFS,
} = {}) {
  const requirements = [], optional = [], warnings = [];
  const record = (required, id, label, supported, detail) => {
    (required ? requirements : optional).push({ id, label, supported, detail });
  };
  const secure = environment.isSecureContext === true;
  record(true, 'secure-context', 'Secure context', secure,
    secure ? 'HTTPS or a trusted loopback origin is active.' : 'Open this example over HTTPS or trusted localhost before loading a model.');

  const wasm = environment.WebAssembly;
  const wasmReady = await canCompile(wasm, EMPTY_WASM);
  record(true, 'webassembly', 'WebAssembly compilation', wasmReady,
    wasmReady ? 'A minimal WebAssembly module validated and compiled.' : 'WebAssembly validation or compilation is unavailable or blocked by site policy.');
  for (const [id, label, binary, required] of [
    ['memory64', 'Memory64 WebAssembly', MEMORY64_WASM, requireMemory64],
    ['wasm-simd', 'WebAssembly SIMD', SIMD_WASM, true],
    ['wasm-exceptions', 'WebAssembly exception handling', EXCEPTIONS_WASM, true],
  ]) {
    const compiled = wasmReady && await canCompile(wasm, binary);
    const supported = compiled && (id !== 'memory64' || canCreateMemory64(wasm));
    record(required, id, label, supported, supported
      ? id === 'memory64'
        ? 'Memory64 validated, compiled and constructed a one-page (64 KiB) test memory.'
        : `${label} validated and compiled without instantiating model memory.`
      : id === 'memory64' && compiled
        ? 'This browser compiled Memory64 but could not construct its required one-page test memory. The selected runtime needs both capabilities.'
        : `${label} is unavailable. The selected runtime must support this feature when it is required.`);
  }

  const worker = typeof environment.Worker === 'function';
  record(true, 'worker', 'Nested Web Workers', worker,
    worker ? 'Worker construction is exposed in this environment.' : 'This environment cannot create the nested Worker required by the browser runtime.');
  const hash = await canHash(environment.crypto);
  record(true, 'sha256', 'SHA-256 integrity verification', hash,
    hash ? 'Web Crypto produced the known SHA-256 digest of an empty input.' : 'Web Crypto SHA-256 is unavailable or blocked. Model integrity cannot be verified.');

  const opfs = typeof environment.navigator?.storage?.getDirectory === 'function';
  record(requireOPFS || requireWritableOPFS, 'opfs', 'Origin private file system', opfs,
    opfs ? 'The OPFS directory API is exposed.' : 'OPFS is unavailable. This runtime requires its storage API even for a selected local File.');
  if (requireWritableOPFS) {
    const writable = opfs && secure
      ? await writableOPFS(environment)
      : { supported: false, detail: 'A secure context and OPFS API are required before writable cache access can be checked.' };
    record(true, 'opfs-writable', 'Writable model cache', writable.supported, writable.detail);
  }

  const jspi = typeof wasm?.Suspending === 'function' && typeof wasm?.promising === 'function';
  // The bundled stub replaces both entry points only when Suspending is falsy.
  // Full absence is supported; a truthy but incomplete native interface is not.
  const jspiCompatible = !wasm?.Suspending || jspi;
  if (!jspiCompatible) record(true, 'jspi-compatible', 'Runtime JSPI compatibility', false,
    'This browser exposes incomplete JSPI entry points. The selected runtime cannot install its fallback; use a browser with complete JSPI or with JSPI absent.');
  record(false, 'jspi', 'WebAssembly JS Promise Integration', jspi,
    jspi ? 'JSPI entry points are exposed.' : jspiCompatible
      ? 'JSPI is unavailable; the runtime uses its synchronous memory-copy fallback, increasing memory pressure.'
      : 'JSPI entry points are incomplete and the bundled fallback cannot replace them.');
  if (!jspi) warnings.push(optional.find(item => item.id === 'jspi').detail);
  return { supported: requirements.every(item => item.supported), requirements, optional, warnings };
}
