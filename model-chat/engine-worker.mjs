import { Wllama } from './runtime/index.js';
import { MODEL, RUNTIME, COMPAT } from './model-contract.mjs';
import { inspectCapabilities } from './capabilities.mjs';
import { formatRuntimeError, formatRuntimeAbort, installRuntimeAbortGuard } from './runtime-errors.mjs';

// Pinned wllama 3.5.1 resolves asset URLs through document.baseURI, even
// for absolute URLs. It otherwise runs in this dedicated Worker. Supply only
// that URL base; do not modify the verified vendor bundle or emulate a DOM.
globalThis.document = Object.freeze({ baseURI: self.location.href });

let engine;
let active = false;
let rejectOperation;
let nativeAbortFailure;
const post = (id, type, value) => self.postMessage({ id, type, value });
const errorField = (value, key) => { try { return value?.[key]; } catch { return undefined; } };

// The pinned vendor sends a child Worker's ErrorEvent to logger.error without
// rejecting its pending task. Race that real failure with the owned operation;
// the main-thread adapter then terminates the whole Worker lifetime. No vendor
// bytes are patched, and ordinary native log lines do not become errors.
function safeError(value) {
  return formatRuntimeError(value);
}

function failOperation(code, value) {
  rejectOperation?.(Object.assign(new Error(safeError(value)), { code, retryable: true }));
}

self.addEventListener('unhandledrejection', event => {
  if (!rejectOperation) return;
  event.preventDefault();
  failOperation('ENGINE_UNHANDLED_REJECTION', event.reason);
});

function engineLogger(milestone) {
  const log = (...args) => {
    for (const value of args) {
      if (typeof value !== 'string') continue;
      // These are confirmations from this pinned runtime, not estimated tasks.
      if (value === 'Calling wllamaStart...') milestone('runtime-start', 'WASM module opened; starting the engine.');
      else if (value === 'Loading model...') milestone('model-load', 'Engine started; loading model tensors and context.');
      else if (/^(?:llama_context: constructing llama_context|llama_init_from_model:)/.test(value)) milestone('context-create', 'Runtime reported context construction.');
      else if (/warming up the model|running the model with an empty batch/.test(value)) milestone('warmup', 'Runtime reported model warmup.');
    }
  };
  return { debug: log, log, warn() {}, error(...args) {
    const workerError = args.find(value => { try { return typeof ErrorEvent !== 'undefined' && value instanceof ErrorEvent; } catch { return false; } });
    if (workerError) { workerError.preventDefault(); failOperation('ENGINE_WORKER_ERROR', workerError); return; }
    // An abort can carry any structured-clone value. Its explicit signal is
    // handled by the guard below; unknown console objects are never dumped.
    const error = args.find(value => { try { return value instanceof Error; } catch { return false; } });
    if (error) failOperation('ENGINE_INIT_ERROR', error);
  } };
}

function requireCapabilities(report) {
  if (report.supported) return;
  const missing = report.requirements.filter(item => !item.supported);
  const failure = new Error(`This browser cannot run this pinned runtime: ${missing.map(item => item.label).join(', ')}. No model was downloaded. ${missing.map(item => item.detail).join(' ')}`);
  // A blocked cache write can recover or use a File. A missing runtime feature
  // cannot be repaired by retrying the same input in this browser session.
  if (missing.some(item => item.id !== 'opfs-writable')) {
    failure.code = 'UNSUPPORTED_BROWSER'; failure.retryable = false;
    failure.capabilities = missing.map(({ id, label, detail }) => ({ id, label, detail }));
  }
  throw failure;
}

async function pinnedRuntimeFile(name, identity, javascript = false) {
  const response = await fetch(new URL('./runtime/' + name, import.meta.url));
  if (!response.ok) throw new Error(`Runtime WASM is unavailable (${response.status}). No model was downloaded. Check the static runtime setup.`);
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (javascript ? !['application/javascript', 'text/javascript'].includes(type) : type !== 'application/wasm') {
    throw new Error(`Runtime ${javascript ? 'JavaScript' : 'WASM'} has the wrong executable MIME type. No model was downloaded.`);
  }
  if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('Runtime WASM exceeds its size bound. No model was downloaded.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Runtime file exceeds its size bound. No model was downloaded.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== identity.sha256) throw new Error('Runtime file differs from the pinned build. No model was downloaded. Refresh the site assets.');
  return bytes;
}

async function validateRuntime(compat) {
  const name = compat ? 'compat/wllama.wasm' : 'wllama.wasm';
  const bytes = await pinnedRuntimeFile(name, (compat ? COMPAT : RUNTIME).files[name]);
  try { await WebAssembly.compile(bytes); }
  catch {
    throw Object.assign(new Error('This browser cannot compile the pinned WASM runtime. No model was downloaded.'), {
      code: 'UNSUPPORTED_BROWSER', retryable: false,
      capabilities: [{ id: 'pinned-wasm', label: 'Pinned WebAssembly runtime', detail: 'Compilation is unavailable for this runtime build or site policy.' }],
    });
  }
  // The runtime creates a blob-backed child Worker. Test the actual policy before
  // weights, rather than treating the exposed Worker constructor as permission.
  const url = URL.createObjectURL(new Blob(['postMessage("ready")'], { type: 'application/javascript' }));
  let child, timer;
  try {
    await new Promise((resolve, reject) => {
      child = new Worker(url, { type: 'module' });
      child.onmessage = () => resolve();
      child.onerror = event => { event.preventDefault(); reject(new Error('Worker blocked')); };
      timer = setTimeout(() => reject(new Error('Worker timeout')), 10000);
    });
  } catch {
    throw Object.assign(new Error('Site policy prevents the nested model Worker from starting. No model was downloaded.'), {
      code: 'UNSUPPORTED_BROWSER', retryable: false,
      capabilities: [{ id: 'module-worker-policy', label: 'Nested module Worker policy', detail: 'This site policy prevents the runtime Worker from starting.' }],
    });
  }
  finally { clearTimeout(timer); child?.terminate(); URL.revokeObjectURL(url); }
  // The compat worker glue is executable too. Verify it before weights and give
  // the vendor that exact code, rather than fetching a second unchecked copy.
  return compat ? new TextDecoder().decode(await pinnedRuntimeFile('compat/wllama.js', COMPAT.files['compat/wllama.js'], true)) : null;
}

async function verify(blob, progress) {
  if (blob.size !== MODEL.bytes) throw new Error(`Expected ${MODEL.bytes.toLocaleString()} bytes for ${MODEL.file}; received ${blob.size.toLocaleString()}. Choose the exact Q4_K_M file.`);
  progress({ phase: 'verifying', loaded: 0, total: blob.size });
  // WebCrypto validates the actual local/cache bytes before native initialization.
  // The temporary full-file buffer adds memory pressure; physical iOS remains unqualified.
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== MODEL.sha256) throw new Error('Model SHA-256 mismatch. The selected file or cached download is not the pinned Q4_K_M artifact.');
  progress({ phase: 'verifying', loaded: blob.size, total: blob.size });
}

async function prepare({ source, file }, progress) {
  progress({ phase: 'checking' });
  // Both inputs need the default cache manager's OPFS API, but a File or valid
  // existing cache does not require a new OPFS write. Probe writes only on a miss.
  const report = await inspectCapabilities(globalThis, { requireMemory64: false, requireWritableOPFS: false });
  requireCapabilities(report);
  const optional = id => report.optional.find(item => item.id === id)?.supported === true;
  const compat = !optional('memory64') || !optional('jspi');
  const runtimeProfile = compat ? 'memory32-asyncify' : 'memory64';
  progress({ phase: 'checking', runtimeProfile });
  const workerCode = await validateRuntime(compat);
  const events = [];
  let started;
  let initializing = false;
  const milestone = (stage, detail) => {
    if (!initializing || events.at(-1)?.detail === detail) return;
    events.push({ stage, detail, atMs: Math.round(performance.now() - started) });
    if (events.length > 8) events.shift();
    progress({ phase: 'initializing', cached, runtimeProfile, stage, detail });
  };
  // Native output is consumed only by this allowlist; no raw logs, model
  // metadata or prompt text are posted to the page or diagnostic report.
  engine = new Wllama({ default: new URL('./runtime/wllama.wasm', import.meta.url).href }, { logger: engineLogger(milestone), suppressNativeLog: false, allowOffline: true });
  installRuntimeAbortGuard(engine, identity => {
    nativeAbortFailure = Object.assign(new Error(formatRuntimeAbort(identity)), { code: 'ENGINE_NATIVE_ABORT', retryable: true });
    rejectOperation?.(nativeAbortFailure);
  });
  // Keep the exact model and API. Missing Memory64/JSPI selects the maintained,
  // self-hosted Memory32/Asyncify build; never use the vendor's default CDN.
  engine.setCompat(compat ? { wasm: new URL('./runtime/compat/wllama.wasm', import.meta.url).href, worker: { code: workerCode } } : null, 'firefox_safari');
  progress({ phase: 'checking' });
  let blobs, model, cached = false;
  if (source === 'file') {
    if (!(file instanceof Blob) || !/\.gguf$/i.test(file.name || '')) throw new Error('Choose the pinned .gguf model file from your device.');
    blobs = [file];
  } else {
    const models = await engine.modelManager.getModels({ includeInvalid: true });
    model = models.find(item => item.url === MODEL.url);
    cached = model?.validate() === 'valid' && model.size === MODEL.bytes;
    if (!cached) {
      requireCapabilities(await inspectCapabilities(globalThis, { requireMemory64: false, requireWritableOPFS: true }));
      if (model) await model.remove();
      progress({ phase: 'downloading', loaded: 0, total: MODEL.bytes, cached: false });
      model = await engine.modelManager.downloadModel(MODEL.url, {
        progressCallback: ({ loaded, total }) => progress({ phase: 'downloading', loaded, total, cached: false }),
      });
    }
    progress({ phase: 'checking', cached });
    blobs = await model.open();
  }
  try {
    if (blobs.length !== 1) throw new Error('Expected one pinned GGUF file.');
    await verify(blobs[0], progress);
  } catch (error) {
    if (model) await model.remove(); // only this exact artifact, never another app's cache
    throw error;
  }
  initializing = true;
  started = performance.now();
  milestone('runtime-start', 'Verified model bytes; opening the WASM module.');
  try {
    const failure = new Promise((_, reject) => { rejectOperation = reject; });
    await Promise.race([engine.loadModel(blobs, { n_ctx: 2048, n_batch: 128, n_threads: 1, n_gpu_layers: 0, seed: 42 }), failure]);
    if (!engine.isModelLoaded()) throw new Error('Runtime returned without a loaded model.');
    milestone('ready', 'Runtime confirmed the model is ready.');
  } catch (error) {
    const failure = nativeAbortFailure || Object.assign(new Error(safeError(error)),
      typeof errorField(error, 'code') === 'string' ? { code: errorField(error, 'code'), retryable: errorField(error, 'retryable') } : {});
    failure.diagnostics = { stage: events.at(-1)?.stage, detail: events.at(-1)?.detail, events };
    throw failure;
  } finally { rejectOperation = undefined; initializing = false; }
  return { cached, modelId: MODEL.file, libllama: Wllama.getLibllamaVersion(), runtimeProfile,
    backend: compat ? 'Memory32 / Asyncify; single-thread CPU/WASM' : 'Memory64; single-thread CPU/WASM' };
}

self.onmessage = async ({ data }) => {
  const { id, operation, payload } = data;
  if (active) return post(id, 'error', 'The model is already working.');
  active = true;
  nativeAbortFailure = undefined;
  try {
    if (operation === 'prepare') post(id, 'result', await prepare(payload, event => post(id, 'progress', event)));
    else if (operation === 'reply') {
      if (!engine?.isModelLoaded()) throw new Error('Load the model before sending a message.');
      const stream = await engine.createChatCompletion({ messages: payload.messages, stream: true, max_tokens: 160, temperature: 0 });
      let text = '';
      for await (const chunk of stream) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        text += token;
        if (token) post(id, 'token', text);
      }
      if (!text.trim()) throw new Error('The model returned an empty answer. Try a shorter message.');
      post(id, 'result', text);
    } else throw new Error('Unknown runtime operation.');
  } catch (error) {
    const failure = nativeAbortFailure || error;
    self.postMessage({ id, type: 'error', value: safeError(failure),
      ...(typeof errorField(failure, 'code') === 'string' ? { code: errorField(failure, 'code'), retryable: errorField(failure, 'retryable') !== false } : {}),
      ...(errorField(failure, 'capabilities') ? { capabilities: errorField(failure, 'capabilities') } : {}),
      ...(errorField(failure, 'diagnostics') ? { diagnostics: errorField(failure, 'diagnostics') } : {}),
    });
  }
  finally { active = false; }
};
