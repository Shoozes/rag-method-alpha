import { normalizeRuntimeError, formatRuntimeError } from './runtime-errors.mjs';

// All model work lives in an owned Worker. Cancel terminates that lifetime,
// including an initialization with no native progress/abort API; retry starts fresh.
export function createRuntimeAdapter({ WorkerClass = Worker, initWaitMs = 180_000,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (!Number.isFinite(initWaitMs) || initWaitMs <= 0) throw new TypeError('Initialization wait must be a positive number of milliseconds.');
  let worker, serial = 0;
  const pending = new Map();
  function terminate(reason = new DOMException('Model stopped. Load it again to continue.', 'AbortError')) {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) { request.cleanup(); request.reject(reason); }
    pending.clear();
  }
  function request(operation, payload, { signal, onProgress, onToken } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    if (!worker) {
      worker = new WorkerClass(new URL('./engine-worker.mjs', import.meta.url), { type: 'module', name: 'rag-local-model' });
      const owner = worker;
      owner.onmessage = ({ data }) => {
        if (worker !== owner) return;
        const item = pending.get(data.id);
        if (!item) return;
        if (data.type === 'progress') {
          if (item.operation === 'prepare' && data.value?.phase === 'initializing') {
            item.lastStage = typeof data.value.stage === 'string' ? data.value.stage.slice(0, 64) : item.lastStage;
            if (item.initTimer === null) item.initTimer = setTimeoutFn(() => {
              if (worker !== owner || !pending.has(data.id)) return;
              const failure = Object.assign(new Error(`Initialization waiting stopped after the ${Math.round(initWaitMs / 1000)}-second limit. This is a waiting limit, not proof that the model failed. Cached bytes were not removed. Retry the cached load when ready.`), {
                code: 'INIT_WAIT_LIMIT', retryable: true, stage: item.lastStage,
              });
              terminate(failure);
            }, initWaitMs);
          }
          item.onProgress?.(data.value);
        }
        else if (data.type === 'token') item.onToken?.(data.value);
        else {
          pending.delete(data.id); item.cleanup();
          if (data.type === 'error') {
            const identity = normalizeRuntimeError(data.value);
            const failure = Object.assign(new Error(identity.message), { name: identity.name || 'Error' });
            if (typeof data.code === 'string' && /^(?:INIT_WAIT_LIMIT|WORKER_ERROR|WORKER_MESSAGE_ERROR|ENGINE_[A-Z_]+|UNHANDLED_REJECTION)$/.test(data.code)) failure.code = data.code;
            if (typeof data.stage === 'string') failure.stage = data.stage.slice(0, 64);
            if (data.diagnostics && typeof data.diagnostics === 'object') {
              failure.diagnostics = {
                stage: typeof data.diagnostics.stage === 'string' ? data.diagnostics.stage.slice(0, 64) : null,
                detail: typeof data.diagnostics.detail === 'string' ? normalizeRuntimeError(data.diagnostics.detail).message.slice(0, 240) : null,
                events: Array.isArray(data.diagnostics.events) ? data.diagnostics.events.slice(-8).map(event => ({
                  stage: typeof event?.stage === 'string' ? event.stage.slice(0, 64) : null,
                  detail: typeof event?.detail === 'string' ? normalizeRuntimeError(event.detail).message.slice(0, 240) : null,
                  atMs: Number.isFinite(event?.atMs) && event.atMs >= 0 ? Math.floor(event.atMs) : null,
                })) : [],
              };
            }
            // Only an explicit capability refusal locks loading. Network, cache,
            // initialization and unknown Worker failures retain ordinary recovery.
            if (data.code === 'UNSUPPORTED_BROWSER' && data.retryable === false) {
              failure.code = data.code; failure.retryable = false;
              failure.capabilities = Array.isArray(data.capabilities) ? data.capabilities
                .filter(item => item && typeof item.id === 'string' && typeof item.label === 'string')
                .map(({ id, label, detail }) => ({ id, label, ...(typeof detail === 'string' ? { detail } : {}) })) : [];
            }
            terminate(failure);
            item.reject(failure);
          }
          else item.resolve(data.value);
        }
      };
      owner.onerror = event => {
        if (worker !== owner) return;
        try { event?.preventDefault?.(); } catch { /* Browser event access must not hide the original failure. */ }
        const detail = formatRuntimeError(event).slice(0, 240);
        terminate(Object.assign(new Error(`Browser model worker failed: ${detail} Check runtime setup, browser memory and WASM support before retrying. Cached bytes were not removed.`), { code: 'WORKER_ERROR' }));
      };
      owner.onmessageerror = () => {
        if (worker === owner) terminate(Object.assign(new Error('The browser could not read a model Worker message. The Worker was stopped; cached bytes were not removed. Retry the cached load.'), { code: 'WORKER_MESSAGE_ERROR' }));
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const abort = () => terminate();
      signal?.addEventListener('abort', abort, { once: true });
      const item = { operation, resolve, reject, onProgress, onToken, initTimer: null, lastStage: null,
        cleanup: () => { signal?.removeEventListener('abort', abort); if (item.initTimer !== null) clearTimeoutFn(item.initTimer); item.initTimer = null; } };
      pending.set(id, item);
      try { worker.postMessage({ id, operation, payload }); }
      catch { terminate(Object.assign(new Error('The browser could not send model data to its Worker. Cached bytes were not removed. Retry the cached load.'), { code: 'WORKER_MESSAGE_ERROR' })); }
    });
  }
  return {
    prepare: ({ source, file, ...options }) => request('prepare', { source, file }, options),
    reply: (messages, options) => request('reply', { messages }, options),
    dispose: async () => terminate(),
  };
}
