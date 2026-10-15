// Only recognized error fields cross the runtime boundary. Never serialize an
// unknown object, invoke its toString(), copy a stack, or traverse array items.
const names = new Set(['Error', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'RuntimeError', 'LinkError',
  'CompileError', 'DOMException', 'AbortError', 'DataCloneError',
  'QuotaExceededError', 'SecurityError', 'NotSupportedError', 'NetworkError',
  'InvalidStateError', 'OperationError', 'UnknownError', 'OutOfMemoryError']);
const signals = new Set(['abort', 'exception', 'exit']);
const kinds = new Set(['string', 'object', 'error', 'event', 'array', 'null',
  'undefined', 'number', 'boolean', 'bigint', 'symbol', 'function', 'unknown']);
const read = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
const clean = value => value.slice(0, 2048).split(/[\r\n]/, 1)[0]
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/(?:https?|blob|file):\S+/gi, '[URL]')
  .replace(/[A-Za-z]:[\\/][^\s]*/g, '[path]')
  .replace(/\/(?:Users|home|private|var\/folders)\/[^\s]*/g, '[path]')
  .trim().slice(0, 240);

export function normalizeRuntimeError(value) {
  const seen = new Set();
  function inspect(input, depth = 0) {
    const type = input === null ? 'null' : typeof input;
    if (type === 'string' && clean(input)) return { kind: 'string', name: null, message: clean(input) };
    if ((type !== 'object' && type !== 'function') || input === null) {
      return { kind: type, name: null, message: `Runtime supplied ${type === 'null' || type === 'undefined' ? 'no' : 'a ' + type + ' value without'} readable error detail.` };
    }
    if (Array.isArray(input)) return { kind: 'array', name: null, message: 'Runtime supplied an array without readable error detail.' };
    if (depth >= 3 || seen.has(input)) return { kind: 'object', name: null, message: 'Runtime supplied a nested error without readable detail.' };
    seen.add(input);
    let kind = 'object';
    try { if (input instanceof Error) kind = 'error'; } catch { /* A revoked Proxy is an unknown object. */ }
    const candidateName = read(input, 'name');
    const name = typeof candidateName === 'string' && names.has(candidateName) ? candidateName : null;
    const message = read(input, 'message');
    if (typeof message === 'string' && clean(message)) return { kind, name: name || 'Error', message: clean(message) };
    // ErrorEvent / PromiseRejectionEvent / structured abort envelopes. Read only
    // these known fields, with bounded depth and cycle protection.
    const data = read(input, 'data');
    const event = read(input, 'verb') === 'signal.abort' ? input : read(data, 'verb') === 'signal.abort' ? data : null;
    if (event) {
      const args = read(event, 'args');
      if (Array.isArray(args)) {
        const detail = inspect(read(args, 1), depth + 1);
        const original = inspect(read(args, 3), depth + 1);
        return { ...(['string', 'error'].includes(detail.kind) || detail.name ? detail : original), kind: 'event' };
      }
    }
    for (const field of ['error', 'reason', 'cause', 'message']) {
      const child = read(input, field);
      if (child === undefined || child === null || child === input) continue;
      const detail = inspect(child, depth + 1);
      if (detail.name || ['string', 'error', 'event'].includes(detail.kind)) return { ...detail, kind };
    }
    return { kind, name, message: 'Runtime supplied an object without readable error detail.' };
  }
  try { return inspect(value); }
  catch { return { kind: 'unknown', name: null, message: 'Runtime supplied an unreadable error value.' }; }
}

export function formatRuntimeError(value) {
  const detail = normalizeRuntimeError(value);
  const prefix = detail.name && detail.name !== 'Error' ? detail.name + ': ' : '';
  return prefix && !detail.message.startsWith(prefix) ? prefix + detail.message : detail.message;
}

export function formatRuntimeAbort(detail) {
  const safe = normalizeRuntimeError(detail);
  const signal = read(detail, 'signalType'), kind = read(detail, 'kind');
  return `Runtime ${signals.has(signal) ? signal : 'unknown'} (${safe.name || (kinds.has(kind) ? kind : safe.kind)}): ${safe.message}`;
}

// Exact, hash-pinned wllama 3.5.1 creates this configurable instance property
// after an async feature check, then binds proxy.onRecvMsg in moduleInit. Guard
// that assignment once; do not race a timer or patch a global Worker/prototype.
// signal.abort bypasses the vendor's message.replace/rawStack.replace and async
// stack decoder entirely. Reject its owned queues with safe strings instead.
export function installRuntimeAbortGuard(engine, onAbort) {
  const descriptor = Object.getOwnPropertyDescriptor(engine, 'proxy');
  if (!descriptor?.configurable || !('value' in descriptor) || descriptor.value != null || typeof onAbort !== 'function') {
    throw Object.assign(new Error('The pinned runtime error boundary has changed. No model was opened.'), { code: 'ENGINE_BOUNDARY_ERROR' });
  }
  let pendingProxy = descriptor.value;
  Object.defineProperty(engine, 'proxy', { configurable: true, enumerable: descriptor.enumerable,
    get: () => pendingProxy,
    set(proxy) {
      if (proxy == null) { pendingProxy = proxy; return; }
      if (typeof proxy.onRecvMsg !== 'function' || typeof proxy.abort !== 'function') {
        throw Object.assign(new Error('The pinned runtime abort interface has changed.'), { code: 'ENGINE_BOUNDARY_ERROR' });
      }
      const receive = proxy.onRecvMsg;
      proxy.onRecvMsg = function (event) {
        const data = read(event, 'data');
        if (read(data, 'verb') !== 'signal.abort') return Reflect.apply(receive, this, [event]);
        const args = read(data, 'args');
        const message = normalizeRuntimeError(read(args, 1));
        const original = normalizeRuntimeError(read(args, 3));
        const useful = message.name || ['string', 'error', 'event'].includes(message.kind) ? message : original.name || ['string', 'error'].includes(original.kind) ? original : message;
        const type = read(args, 0);
        const detail = { ...useful, signalType: typeof type === 'string' && signals.has(type) ? type : 'unknown' };
        // The observer reports the structured failure before queue rejection.
        // A broken observer cannot strand the vendor's pending operation.
        try { onAbort(detail); } catch { /* Queue rejection below still runs. */ }
        return proxy.abort(formatRuntimeAbort(detail), '');
      };
      // Restore ordinary data-property semantics for the rest of this instance.
      Object.defineProperty(engine, 'proxy', { ...descriptor, value: proxy });
    },
  });
}
