/** Generic lifecycle only. The injected adapter owns model bytes, runtime and cache. */
export function createLoaderController(adapter, onState = () => {}) {
  for (const method of ['prepare', 'reply', 'dispose']) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Loader adapter needs ${method}().`);
  }
  if (typeof onState !== 'function') throw new TypeError('onState must be a function.');

  let state = {
    phase: 'idle', source: null, modelId: null, cached: false,
    loaded: null, total: null, determinate: false, progress: null,
    text: '', error: null,
  };
  let generation = 0, active = null, ready = false, disposed = false, needsCleanup = false;
  let teardown = null, cancelling = null, disposing = null;

  const getState = () => ({ ...state });
  const current = operation => !disposed && active === operation && generation === operation.id;
  const clearProgress = { loaded: null, total: null, determinate: false, progress: null };
  const error = (message, code) => Object.assign(new Error(message), { code });
  const aborted = () => Object.assign(error('The operation was cancelled. Load the model again to continue.', 'CANCELLED'), { name: 'AbortError' });
  const messageOf = cause => cause instanceof Error && cause.message ? cause.message : String(cause || 'Unknown adapter failure');
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };

  function publish(patch) {
    state = { ...state, ...patch };
    // Rendering is an observer, not permission to interrupt adapter cleanup or ownership.
    try { onState(getState()); } catch { /* The caller owns observer error reporting. */ }
  }

  function available() {
    if (disposed) throw error('This loader has been disposed. Create a new loader to continue.', 'DISPOSED');
    if (active || teardown || cancelling) throw error('A model operation is already active. Cancel it or wait for it to finish.', 'BUSY');
  }

  function begin(kind) {
    const operation = { id: ++generation, kind, controller: new AbortController() };
    active = operation;
    return operation;
  }

  function abortable(result, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (complete, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        complete(value);
      };
      const cancel = () => finish(reject, aborted());
      signal.addEventListener('abort', cancel, { once: true });
      // Keep handlers attached even after cancellation; late adapter failures are consumed.
      Promise.resolve(result).then(value => finish(resolve, value), cause => finish(reject, cause));
      if (signal.aborted) cancel();
    });
  }

  function unload() {
    if (teardown) return teardown;
    const pending = Promise.resolve().then(() => adapter.dispose()).then(
      () => { needsCleanup = false; },
      cause => { needsCleanup = true; throw cause; },
    );
    const tracked = pending.finally(() => { if (teardown === tracked) teardown = null; });
    teardown = tracked;
    return tracked;
  }

  function progress(operation, event) {
    if (!current(operation) || !event || !['checking', 'downloading', 'verifying', 'initializing'].includes(event.phase)) return;
    const measured = ['downloading', 'verifying'].includes(event.phase)
      && Number.isSafeInteger(event.loaded) && event.loaded >= 0
      && Number.isSafeInteger(event.total) && event.total > 0 && event.loaded <= event.total;
    publish({ phase: event.phase, ...clearProgress,
      ...(measured ? { loaded: event.loaded, total: event.total, determinate: true, progress: event.loaded / event.total } : {}),
      ...(typeof event.cached === 'boolean' ? { cached: event.cached } : {}),
    });
  }

  async function fail(operation, cause, label, cleanup = true) {
    if (!current(operation)) throw aborted();
    active = null; ready = false;
    let detail = messageOf(cause);
    if (cleanup) try { await unload(); } catch (failure) { detail += ` Cleanup also failed: ${messageOf(failure)}`; }
    if (disposed || generation !== operation.id) throw aborted();
    const failure = error(`${label}: ${detail}`, operation.kind === 'load' ? 'LOAD_FAILED' : 'REPLY_FAILED');
    publish({ phase: 'error', modelId: null, cached: false, ...clearProgress, error: failure.message });
    throw failure;
  }

  async function load({ source, file } = {}) {
    available();
    if (source !== 'remote' && source !== 'file') throw error('Choose a remote model or a local model file.', 'INVALID_SOURCE');
    if (source === 'file' && !file) throw error('Choose a local model file before loading.', 'FILE_REQUIRED');
    const replaceReadyModel = ready || needsCleanup, operation = begin('load');
    ready = false;
    publish({ phase: 'checking', source, modelId: null, cached: false, ...clearProgress, text: '', error: null });
    let prepared, preparationStarted = false;
    try {
      if (replaceReadyModel) await unload();
      if (!current(operation)) throw aborted();
      preparationStarted = true; needsCleanup = true;
      prepared = await abortable(adapter.prepare({ source, ...(source === 'file' ? { file } : {}),
        signal: operation.controller.signal, onProgress: event => progress(operation, event) }), operation.controller.signal);
      if (!current(operation)) throw aborted();
      if (!prepared || typeof prepared.cached !== 'boolean' || typeof prepared.modelId !== 'string' || !prepared.modelId.trim()) {
        throw new Error('The adapter did not confirm a valid prepared model.');
      }
    } catch (cause) { return fail(operation, cause, 'Model loading failed', preparationStarted); }
    active = null; ready = true;
    publish({ phase: 'ready', modelId: prepared.modelId, cached: prepared.cached, ...clearProgress, error: null });
    return { cached: prepared.cached, modelId: prepared.modelId };
  }

  async function send(messages) {
    available();
    if (!ready) throw error('Load a model successfully before sending a message.', 'NOT_READY');
    if (!Array.isArray(messages)) throw error('Messages must be an array.', 'INVALID_MESSAGES');
    const operation = begin('reply');
    publish({ phase: 'generating', ...clearProgress, text: '', error: null });
    let reply;
    try {
      if (!current(operation)) throw aborted();
      reply = await abortable(adapter.reply(messages, { signal: operation.controller.signal,
        onToken: text => { if (current(operation) && typeof text === 'string') publish({ text }); },
      }), operation.controller.signal);
      if (!current(operation)) throw aborted();
      if (typeof reply !== 'string') throw new Error('The adapter returned an invalid reply.');
    } catch (cause) { return fail(operation, cause, 'Reply failed'); }
    active = null;
    publish({ phase: 'ready', text: reply, ...clearProgress, error: null });
    return reply;
  }

  async function cancel() {
    if (disposed) return getState();
    if (cancelling) return cancelling;
    const completion = deferred(), pending = completion.promise;
    cancelling = pending;
    const operation = active, cancellation = ++generation;
    active = null; ready = false;
    operation?.controller.abort();
    (async () => {
      try { await unload(); }
      catch (cause) {
        if (!disposed && generation === cancellation) publish({ phase: 'error', modelId: null, cached: false, ...clearProgress, error: `Model cleanup failed: ${messageOf(cause)}` });
        throw error(`Model cleanup failed: ${messageOf(cause)}`, 'CLEANUP_FAILED');
      }
      if (!disposed && generation === cancellation) publish({ phase: 'cancelled', modelId: null, cached: false, ...clearProgress, error: null });
      return getState();
    })().then(completion.resolve, completion.reject);
    try { return await pending; } finally { if (cancelling === pending) cancelling = null; }
  }

  async function dispose() {
    if (disposing) return disposing;
    const completion = deferred();
    disposing = completion.promise;
    disposed = true; ready = false; ++generation;
    const operation = active; active = null; operation?.controller.abort();
    (async () => {
      try { await unload(); }
      catch (cause) {
        publish({ phase: 'error', source: null, modelId: null, cached: false, ...clearProgress, error: `Model cleanup failed: ${messageOf(cause)}` });
        throw error(`Model cleanup failed: ${messageOf(cause)}`, 'CLEANUP_FAILED');
      }
      publish({ phase: 'idle', source: null, modelId: null, cached: false, ...clearProgress, text: '', error: null });
      return getState();
    })().then(completion.resolve, completion.reject);
    return disposing;
  }

  return Object.freeze({ load, cancel, send, dispose, getState });
}
