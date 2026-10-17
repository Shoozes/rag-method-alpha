import { normalizeRuntimeError, formatRuntimeError } from './runtime-errors.mjs';

/** Generic lifecycle only. The injected adapter owns model bytes, runtime and cache. */
export function createLoaderController(adapter, onState = () => {}, {
  now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval,
} = {}) {
  for (const method of ['prepare', 'reply', 'dispose']) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Loader adapter needs ${method}().`);
  }
  if (typeof onState !== 'function') throw new TypeError('onState must be a function.');

  let state = {
    phase: 'idle', source: null, modelId: null, cached: false, runtimeProfile: null,
    loaded: null, total: null, determinate: false, progress: null,
    text: '', completion: null, error: null, errorCode: null, retryable: true, capabilities: [],
    initStage: null, initDetail: null, initElapsedMs: 0, lastProgressAgeMs: 0, initEvents: [],
  };
  let generation = 0, active = null, ready = false, disposed = false, needsCleanup = false;
  let teardown = null, cancelling = null, disposing = null, unsupported = null;
  let initStarted = null, lastProgressAt = null, initTick = null;

  const getState = () => ({ ...state, completion: state.completion ? { ...state.completion } : null,
    capabilities: state.capabilities.map(item => ({ ...item })), initEvents: state.initEvents.map(item => ({ ...item })) });
  const current = operation => !disposed && active === operation && generation === operation.id;
  const clearProgress = { loaded: null, total: null, determinate: false, progress: null };
  const isRuntimeProfile = value => value === 'memory64' || value === 'memory32-asyncify';
  const stages = new Set(['runtime-start', 'model-read', 'model-load', 'context-create', 'warmup', 'ready']);
  const clearInit = { initStage: null, initDetail: null, initElapsedMs: 0, lastProgressAgeMs: 0, initEvents: [] };
  const error = (message, code) => Object.assign(new Error(message), { code });
  const aborted = () => Object.assign(error('The operation was cancelled. Load the model again to continue.', 'CANCELLED'), { name: 'AbortError' });
  const messageOf = formatRuntimeError;
  const read = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
  const diagnosticText = value => typeof value === 'string' ? normalizeRuntimeError(value).message.slice(0, 240) : null;
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

  function stopInitClock() {
    if (initTick !== null) clearIntervalFn(initTick);
    initTick = null;
  }
  function initTiming() {
    return { initElapsedMs: Math.max(0, now() - initStarted), lastProgressAgeMs: Math.max(0, now() - lastProgressAt) };
  }

  function available() {
    if (disposed) throw error('This loader has been disposed. Create a new loader to continue.', 'DISPOSED');
    if (active || teardown || cancelling) throw error('A model operation is already active. Cancel it or wait for it to finish.', 'BUSY');
    if (unsupported) throw Object.assign(error(unsupported.message, 'UNSUPPORTED_BROWSER'), { retryable: false, capabilities: unsupported.capabilities.map(item => ({ ...item })) });
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
    if (initStarted !== null && event.phase !== 'initializing') return;
    let initialization = {};
    if (event.phase === 'initializing') {
      if (initStarted === null) initStarted = now();
      lastProgressAt = now();
      initialization = { ...initTiming(),
        ...(stages.has(event.stage) ? { initStage: event.stage } : {}),
        ...(typeof event.detail === 'string' ? { initDetail: diagnosticText(event.detail) } : {}),
      };
      if (stages.has(event.stage) && (event.stage !== state.initStage || initialization.initDetail !== state.initDetail)) {
        initialization.initEvents = [...state.initEvents, { stage: event.stage, detail: initialization.initDetail || null, atMs: Math.max(0, now() - initStarted) }].slice(-8);
      }
      if (initTick === null) initTick = setIntervalFn(() => {
        if (current(operation) && state.phase === 'initializing') publish(initTiming());
      }, 1000);
    }
    const measured = ['downloading', 'verifying'].includes(event.phase)
      && Number.isSafeInteger(event.loaded) && event.loaded >= 0
      && Number.isSafeInteger(event.total) && event.total > 0 && event.loaded <= event.total;
    publish({ phase: event.phase, ...clearProgress,
      ...initialization,
      ...(measured ? { loaded: event.loaded, total: event.total, determinate: true, progress: event.loaded / event.total } : {}),
      ...(typeof event.cached === 'boolean' ? { cached: event.cached } : {}),
      ...(isRuntimeProfile(event.runtimeProfile) ? { runtimeProfile: event.runtimeProfile } : {}),
    });
  }

  async function fail(operation, cause, label, cleanup = true) {
    if (!current(operation)) throw aborted();
    stopInitClock();
    active = null; ready = false;
    let detail = messageOf(cause);
    if (cleanup) try { await unload(); } catch (failure) { detail += ` Cleanup also failed: ${messageOf(failure)}`; }
    if (disposed || generation !== operation.id) throw aborted();
    const causeCode = read(cause, 'code');
    const blocked = causeCode === 'UNSUPPORTED_BROWSER' && read(cause, 'retryable') === false;
    const causeCapabilities = read(cause, 'capabilities');
    const capabilities = blocked && Array.isArray(causeCapabilities) ? causeCapabilities
      .filter(item => item && typeof item.id === 'string' && typeof item.label === 'string')
      .map(({ id, label, detail }) => ({ id, label, ...(typeof detail === 'string' ? { detail } : {}) })) : [];
    const diagnosticCode = typeof causeCode === 'string' && /^(?:INIT_WAIT_LIMIT|WORKER_ERROR|WORKER_MESSAGE_ERROR|ENGINE_[A-Z_]+|UNHANDLED_REJECTION)$/.test(causeCode) ? causeCode : null;
    const failure = error(`${label}: ${detail}`, blocked ? 'UNSUPPORTED_BROWSER' : diagnosticCode || (operation.kind === 'load' ? 'LOAD_FAILED' : 'REPLY_FAILED'));
    failure.retryable = !blocked; failure.capabilities = capabilities.map(item => ({ ...item }));
    if (blocked) unsupported = { message: failure.message, capabilities };
    const diagnostic = read(cause, 'diagnostics'), diagnosticEvents = read(diagnostic, 'events');
    const diagnosticStage = read(diagnostic, 'stage'), detailText = diagnosticText(read(diagnostic, 'detail'));
    const events = Array.isArray(diagnosticEvents) ? diagnosticEvents.filter(event => stages.has(read(event, 'stage'))).slice(-8).map(event => ({
      stage: read(event, 'stage'), detail: diagnosticText(read(event, 'detail')),
      atMs: Number.isFinite(event.atMs) && event.atMs >= 0 ? Math.floor(event.atMs) : null,
    })) : [];
    publish({ phase: blocked ? 'unsupported' : 'error', modelId: null, completion: null, ...clearProgress,
      ...(initStarted !== null ? initTiming() : {}),
      ...(stages.has(diagnosticStage) ? { initStage: diagnosticStage } : {}),
      ...(detailText !== null ? { initDetail: detailText } : {}),
      ...(events.length ? { initEvents: events } : {}),
      error: failure.message, errorCode: failure.code, retryable: !blocked, capabilities });
    throw failure;
  }

  async function load({ source, file } = {}) {
    available();
    if (source !== 'remote' && source !== 'file') throw error('Choose a remote model or a local model file.', 'INVALID_SOURCE');
    if (source === 'file' && !file) throw error('Choose a local model file before loading.', 'FILE_REQUIRED');
    const replaceReadyModel = ready || needsCleanup, operation = begin('load');
    stopInitClock(); initStarted = null; lastProgressAt = null;
    ready = false;
    publish({ phase: 'checking', source, modelId: null, cached: false, runtimeProfile: null, ...clearProgress, ...clearInit, text: '', completion: null, error: null, errorCode: null, retryable: true, capabilities: [] });
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
    stopInitClock(); active = null; ready = true;
    const runtimeProfile = isRuntimeProfile(prepared.runtimeProfile) ? prepared.runtimeProfile : state.runtimeProfile;
    const finishedTiming = initStarted !== null ? initTiming() : {};
    initStarted = null; lastProgressAt = null;
    publish({ phase: 'ready', modelId: prepared.modelId, cached: prepared.cached, runtimeProfile, ...clearProgress,
      ...finishedTiming, error: null });
    return { cached: prepared.cached, modelId: prepared.modelId, ...(runtimeProfile ? { runtimeProfile } : {}) };
  }

  async function send(messages) {
    available();
    if (!ready) throw error('Load a model successfully before sending a message.', 'NOT_READY');
    if (!Array.isArray(messages)) throw error('Messages must be an array.', 'INVALID_MESSAGES');
    const operation = begin('reply');
    publish({ phase: 'generating', ...clearProgress, ...clearInit, text: '', completion: null, error: null });
    let reply, completionSeen = false, completion = { finishReason: 'unknown', maxTokens: null };
    try {
      if (!current(operation)) throw aborted();
      reply = await abortable(adapter.reply(messages, { signal: operation.controller.signal,
        onToken: text => { if (current(operation) && typeof text === 'string') publish({ text }); },
        onCompletion: value => {
          if (!current(operation) || completionSeen) return;
          completionSeen = true;
          const reason = read(value, 'finishReason'), maxTokens = read(value, 'maxTokens');
          completion = { finishReason: maxTokens === 160 && (reason === 'length' || reason === 'stop') ? reason : 'unknown',
            maxTokens: maxTokens === 160 ? 160 : null };
        },
      }), operation.controller.signal);
      if (!current(operation)) throw aborted();
      if (typeof reply !== 'string') throw new Error('The adapter returned an invalid reply.');
    } catch (cause) { return fail(operation, cause, 'Reply failed'); }
    active = null;
    publish({ phase: 'ready', text: reply, completion, ...clearProgress, error: null });
    return reply;
  }

  async function cancel() {
    if (disposed) return getState();
    if (unsupported && !active && !needsCleanup) return getState();
    if (cancelling) return cancelling;
    const completion = deferred(), pending = completion.promise;
    cancelling = pending;
    const operation = active, cancellation = ++generation;
    stopInitClock();
    active = null; ready = false;
    publish({ completion: null });
    operation?.controller.abort();
    (async () => {
      try { await unload(); }
      catch (cause) {
        if (!disposed && generation === cancellation) publish({ phase: unsupported ? 'unsupported' : 'error', modelId: null, cached: false, ...clearProgress,
          error: `${unsupported ? unsupported.message + ' ' : ''}Model cleanup failed: ${messageOf(cause)}`,
          errorCode: unsupported ? 'UNSUPPORTED_BROWSER' : 'CLEANUP_FAILED', retryable: !unsupported,
          capabilities: unsupported?.capabilities || [] });
        throw error(`Model cleanup failed: ${messageOf(cause)}`, 'CLEANUP_FAILED');
      }
      if (!disposed && generation === cancellation) publish(unsupported
        ? { phase: 'unsupported', modelId: null, cached: false, ...clearProgress, error: unsupported.message, errorCode: 'UNSUPPORTED_BROWSER', retryable: false, capabilities: unsupported.capabilities }
        : { phase: 'cancelled', modelId: null, cached: false, ...clearProgress, error: null, errorCode: null, retryable: true, capabilities: [] });
      return getState();
    })().then(completion.resolve, completion.reject);
    try { return await pending; } finally { if (cancelling === pending) cancelling = null; }
  }

  async function dispose() {
    if (disposing) return disposing;
    const completion = deferred();
    disposing = completion.promise;
    disposed = true; ready = false; ++generation;
    stopInitClock();
    const operation = active; active = null; operation?.controller.abort();
    publish({ completion: null });
    (async () => {
      try { await unload(); }
      catch (cause) {
        publish({ phase: 'error', source: null, modelId: null, cached: false, completion: null, ...clearProgress, error: `Model cleanup failed: ${messageOf(cause)}` });
        throw error(`Model cleanup failed: ${messageOf(cause)}`, 'CLEANUP_FAILED');
      }
      publish({ phase: 'idle', source: null, modelId: null, cached: false, runtimeProfile: null, ...clearProgress, ...clearInit, text: '', completion: null, error: null, errorCode: null, retryable: true, capabilities: [] });
      return getState();
    })().then(completion.resolve, completion.reject);
    return disposing;
  }

  return Object.freeze({ load, cancel, send, dispose, getState });
}
