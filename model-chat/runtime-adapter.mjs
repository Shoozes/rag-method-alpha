// All model work lives in an owned Worker. Cancel terminates that lifetime,
// including an initialization with no native progress/abort API; retry starts fresh.
export function createRuntimeAdapter({ WorkerClass = Worker } = {}) {
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
        if (data.type === 'progress') item.onProgress?.(data.value);
        else if (data.type === 'token') item.onToken?.(data.value);
        else {
          pending.delete(data.id); item.cleanup();
          if (data.type === 'error') {
            const failure = new Error(typeof data.value === 'string' ? data.value : 'Browser model operation failed.');
            // Only an explicit capability refusal locks loading. Network, cache,
            // initialization and unknown Worker failures retain ordinary recovery.
            if (data.code === 'UNSUPPORTED_BROWSER' && data.retryable === false) {
              failure.code = data.code; failure.retryable = false;
              failure.capabilities = Array.isArray(data.capabilities) ? data.capabilities
                .filter(item => item && typeof item.id === 'string' && typeof item.label === 'string')
                .map(({ id, label, detail }) => ({ id, label, ...(typeof detail === 'string' ? { detail } : {}) })) : [];
            }
            item.reject(failure);
          }
          else item.resolve(data.value);
        }
      };
      owner.onerror = () => { if (worker === owner) terminate(new Error('Browser model worker failed. Check runtime setup, browser memory and WASM support before retrying.')); };
    }
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const abort = () => terminate();
      signal?.addEventListener('abort', abort, { once: true });
      pending.set(id, { resolve, reject, onProgress, onToken, cleanup: () => signal?.removeEventListener('abort', abort) });
      worker.postMessage({ id, operation, payload });
    });
  }
  return {
    prepare: ({ source, file, ...options }) => request('prepare', { source, file }, options),
    reply: (messages, options) => request('reply', { messages }, options),
    dispose: async () => terminate(),
  };
}
