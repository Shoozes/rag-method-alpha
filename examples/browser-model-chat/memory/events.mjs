/** A bounded, append-only record of actual memory operations. No model or DOM dependency. */
export const MEMORY_EVENT_TYPES = Object.freeze([
  'saved', 'corrected', 'forgotten', 'recalled', 'context-dispatched', 'compacted', 'summary-rejected',
]);

const types = new Set(MEMORY_EVENT_TYPES);
const MAX_EVENTS = 4096;
const MAX_EVENT_BYTES = 16384;
const MAX_DEPTH = 8;
const MAX_VALUES = 2048;
const encoder = new TextEncoder();

function cloneData(value, depth = 0, state = { seen: new Set(), values: 0 }) {
  if (++state.values > MAX_VALUES || depth > MAX_DEPTH) throw new RangeError('Memory event data exceeds its structural limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || state.seen.has(value)) throw new TypeError('Memory event data must be finite, acyclic JSON values.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Memory event data must contain only plain objects and arrays.');
  state.seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new TypeError('Memory event arrays must be dense and have no extra properties.');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError('Memory event data cannot contain symbol keys.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Memory event data cannot contain accessors or hidden properties.');
    Object.defineProperty(result, key, { value: cloneData(descriptor.value, depth + 1, state), enumerable: true, writable: true, configurable: true });
  }
  state.seen.delete(value);
  return Object.freeze(result);
}

function identity(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError(`${field} must be a nonempty string of at most 256 characters.`);
}

function references(event, field) {
  if (!(field in event)) return [];
  if (!Array.isArray(event[field]) || event[field].length > 256) throw new TypeError(`${field} must be an array of at most 256 identities.`);
  for (const value of event[field]) identity(value, field);
  if (new Set(event[field]).size !== event[field].length) throw new TypeError(`${field} cannot contain duplicate identities.`);
  return event[field];
}

/**
 * append({ type, recordId?, recordIds?, sourceTurnIds?, priorEventIds?, ...data })
 * returns an immutable event with store-owned id and seq. Observers are optional.
 */
export function createEventStore() {
  const events = [];
  const eventIds = new Set();
  const observers = new Set();
  const pending = [];
  let dispatching = false;
  return Object.freeze({
    append(actualEvent) {
      if (events.length >= MAX_EVENTS) throw new RangeError('Memory event store is full.');
      if (!actualEvent || Array.isArray(actualEvent) || typeof actualEvent !== 'object') throw new TypeError('A memory event must be an object.');
      const data = cloneData(actualEvent);
      if (!types.has(data.type)) throw new TypeError('Unknown memory event type.');
      if ('id' in data || 'seq' in data) throw new TypeError('Memory event identity belongs to the store.');
      if ('recordId' in data) identity(data.recordId, 'recordId');
      references(data, 'recordIds');
      references(data, 'sourceTurnIds');
      for (const priorId of references(data, 'priorEventIds')) {
        if (!eventIds.has(priorId)) throw new TypeError('priorEventIds must reference actual earlier events.');
      }
      const seq = events.length + 1;
      const event = Object.freeze({ ...data, id: `e-${seq}`, seq });
      if (encoder.encode(JSON.stringify(event)).byteLength > MAX_EVENT_BYTES) throw new RangeError('Memory event exceeds 16384 encoded bytes.');
      events.push(event);
      eventIds.add(event.id);
      pending.push(event);
      // A failing optional view must never roll back the committed operation or stop other views.
      // Queue nested appends so every observer sees the same committed sequence.
      if (!dispatching) {
        dispatching = true;
        try {
          while (pending.length) {
            const committed = pending.shift();
            for (const observer of [...observers]) {
              try {
                const result = observer(committed);
                if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
              } catch { /* Observer failures do not own the ledger. */ }
            }
          }
        } finally { dispatching = false; }
      }
      return event;
    },
    list() { return Object.freeze([...events]); },
    subscribe(observer) {
      if (typeof observer !== 'function') throw new TypeError('An event observer must be a function.');
      observers.add(observer);
      return () => observers.delete(observer);
    },
  });
}

/** Read-only projection. Every node and link is backed by an explicit actual event field. */
export function createMemoryGraph(eventStore) {
  if (!eventStore || typeof eventStore.list !== 'function' || typeof eventStore.subscribe !== 'function') throw new TypeError('A memory graph needs an event store.');
  const nodes = new Map();
  const links = new Map();
  const priorEvents = new Set();
  let disposed = false;
  const project = event => {
    if (disposed || priorEvents.has(event.id)) return;
    nodes.set(event.id, Object.freeze({ id: event.id, kind: 'event', type: event.type, seq: event.seq }));
    const link = (target, kind) => {
      const id = JSON.stringify([event.id, kind, target]);
      links.set(id, Object.freeze({ id, source: event.id, target, kind }));
    };
    for (const recordId of new Set([...(event.recordId ? [event.recordId] : []), ...(event.recordIds ?? [])])) {
      const id = `record:${recordId}`;
      nodes.set(id, Object.freeze({ id, kind: 'record', recordId }));
      link(id, 'record');
    }
    for (const sourceTurnId of event.sourceTurnIds ?? []) {
      const id = `turn:${sourceTurnId}`;
      nodes.set(id, Object.freeze({ id, kind: 'source', sourceTurnId }));
      link(id, 'source');
    }
    for (const priorEventId of event.priorEventIds ?? []) {
      if (priorEvents.has(priorEventId)) link(priorEventId, 'prior');
    }
    priorEvents.add(event.id);
  };
  for (const event of eventStore.list()) project(event);
  const unsubscribe = eventStore.subscribe(project);
  return Object.freeze({
    snapshot() { return Object.freeze({ nodes: Object.freeze([...nodes.values()]), links: Object.freeze([...links.values()]) }); },
    dispose() { if (!disposed) { disposed = true; unsubscribe(); } },
  });
}
