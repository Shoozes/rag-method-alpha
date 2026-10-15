import { Wllama } from './runtime/index.js';
import { MODEL, RUNTIME } from './model-contract.mjs';
import { inspectCapabilities } from './capabilities.mjs';

// Pinned wllama 3.5.1 resolves asset URLs through document.baseURI, even
// for absolute URLs. It otherwise runs in this dedicated Worker. Supply only
// that URL base; do not modify the verified vendor bundle or emulate a DOM.
globalThis.document = Object.freeze({ baseURI: self.location.href });

let engine;
let active = false;
const quiet = { debug() {}, log() {}, warn() {}, error() {} };
const post = (id, type, value) => self.postMessage({ id, type, value });

function requireCapabilities(report) {
  if (report.supported) return;
  const missing = report.requirements.filter(item => !item.supported);
  throw new Error(`This browser cannot run this pinned runtime: ${missing.map(item => item.label).join(', ')}. No model was downloaded. ${missing.map(item => item.detail).join(' ')}`);
}

async function validateRuntime() {
  const response = await fetch(new URL('./runtime/wllama.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Runtime WASM is unavailable (${response.status}). No model was downloaded. Check the static runtime setup.`);
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/wasm') {
    throw new Error('Runtime WASM must be served as application/wasm. No model was downloaded.');
  }
  if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('Runtime WASM exceeds its size bound. No model was downloaded.');
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== RUNTIME.files['wllama.wasm'].sha256) throw new Error('Runtime WASM differs from the pinned build. No model was downloaded. Refresh the site assets.');
  try { await WebAssembly.compile(bytes); }
  catch { throw new Error('This browser cannot compile the pinned Memory64 WASM runtime. No model was downloaded.'); }
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
  } catch { throw new Error('Site policy prevents the nested model Worker from starting. No model was downloaded.'); }
  finally { clearTimeout(timer); child?.terminate(); URL.revokeObjectURL(url); }
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
  requireCapabilities(await inspectCapabilities(globalThis, { requireWritableOPFS: false }));
  await validateRuntime();
  engine = new Wllama({ default: new URL('./runtime/wllama.wasm', import.meta.url).href }, { logger: quiet, suppressNativeLog: true, allowOffline: true });
  // One CPU thread avoids pthread transfers. The unified binary still requires
  // Memory64 and shared-memory features; only desktop Chrome is qualified here.
  engine.setCompat(null);
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
      requireCapabilities(await inspectCapabilities(globalThis, { requireWritableOPFS: true }));
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
  progress({ phase: 'initializing', cached });
  await engine.loadModel(blobs, { n_ctx: 2048, n_batch: 128, n_threads: 1, n_gpu_layers: 0, seed: 42 });
  if (!engine.isModelLoaded()) throw new Error('Runtime returned without a loaded model.');
  return { cached, modelId: MODEL.file, libllama: Wllama.getLibllamaVersion(), backend: 'single-thread CPU/WASM' };
}

self.onmessage = async ({ data }) => {
  const { id, operation, payload } = data;
  if (active) return post(id, 'error', 'The model is already working.');
  active = true;
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
  } catch (error) { post(id, 'error', error?.message || String(error)); }
  finally { active = false; }
};
