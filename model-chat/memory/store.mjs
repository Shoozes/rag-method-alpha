const conversationSchema = 'conversation-store/v1';
const memorySchema = 'memory-store/v1';
const roles = new Set(['user', 'assistant']);
const statuses = new Set(['active', 'superseded', 'forgotten']);
const digestPattern = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const id = (prefix, number) => prefix + String(number).padStart(4, '0');
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function immutable(value) {
  const copy = clone(value);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  };
  return freeze(copy);
}

function parsed(serialized) {
  if (typeof serialized !== 'string') fail('Expected serialized JSON state.');
  try { return JSON.parse(serialized); } catch { fail('Invalid serialized JSON state.'); }
}

function keys(value, expected) {
  if (!object(value) || !same(Object.keys(value).sort(), [...expected].sort())) fail('Unexpected state fields.');
}

function identity(value) {
  if (!nonempty(value) || value.length > 200) fail('Invalid scope identity.');
  return value;
}

function content(value) {
  if (!nonempty(value) || value.length > 100_000) fail('Expected nonempty bounded text.');
  return value; // Preserve original whitespace and Unicode exactly.
}

async function hash(text) {
  if (!globalThis.crypto?.subtle) fail('WebCrypto SHA-256 is unavailable.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Append-only canonical transcript. Returned values never expose owned state. */
export function createConversationStore({ conversationId = 'local-chat', actorId = 'local-user' } = {}) {
  identity(conversationId); identity(actorId);
  let turns = [];
  const observers = new Set();
  const notify = () => { for (const observer of [...observers]) { try { observer(); } catch { /* Views cannot roll back canonical turns. */ } } };
  const snapshot = () => immutable({ schema: conversationSchema, conversationId, actorId, version: turns.length, turns });
  return Object.freeze({
    append({ role, content: text } = {}) {
      if (!roles.has(role)) fail('Only user and assistant transcript turns are supported.');
      content(text);
      const turn = { id: id('t-', turns.length + 1), role, content: text, actorId, conversationId };
      turns.push(turn);
      notify();
      return immutable(turn);
    },
    snapshot,
    subscribe(observer) {
      if (typeof observer !== 'function') fail('Conversation observer required.');
      observers.add(observer); return () => observers.delete(observer);
    },
    exportState: () => JSON.stringify(snapshot()),
    importState(serialized) {
      const state = parsed(serialized);
      keys(state, ['schema', 'conversationId', 'actorId', 'version', 'turns']);
      if (state.schema !== conversationSchema || state.conversationId !== conversationId || state.actorId !== actorId
        || !Array.isArray(state.turns) || state.version !== state.turns.length) fail('Invalid conversation state or scope.');
      const incoming = state.turns.map((turn, index) => {
        keys(turn, ['id', 'role', 'content', 'actorId', 'conversationId']);
        if (turn.id !== id('t-', index + 1) || !roles.has(turn.role) || turn.actorId !== actorId || turn.conversationId !== conversationId) fail('Invalid canonical turn.');
        content(turn.content);
        return { id: turn.id, role: turn.role, content: turn.content, actorId, conversationId };
      });
      if (incoming.length < turns.length || turns.some((turn, index) => !same(turn, incoming[index]))) fail('Original transcript turns cannot be removed or changed.');
      turns = incoming;
      notify();
      return snapshot();
    },
  });
}

/** User-approved extractive memories. No assistant output or generated summary admission. */
export function createMemoryStore({ conversation, onEvent = () => {} } = {}) {
  if (!conversation || typeof conversation.snapshot !== 'function' || typeof onEvent !== 'function') fail('A conversation and event observer are required.');
  const owner = conversation.snapshot();
  identity(owner.actorId); identity(owner.conversationId);
  let records = [], queue = Promise.resolve();
  const scope = { actorId: owner.actorId, conversationId: owner.conversationId };
  const snapshot = () => immutable({ schema: memorySchema, records });
  const latest = recordId => records.findLast(record => record.id === recordId);
  const transact = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  function emit(type, record) {
    const event = immutable({ type, recordId: record.id, version: record.version,
      sourceTurnIds: record.sourceTurnIds, contentHash: record.contentHash });
    try { Promise.resolve(onEvent(event)).catch(() => {}); } catch { /* Observers cannot roll back or fail committed writes. */ }
  }
  function requireScope(value) {
    keys(value, ['actorId', 'conversationId']);
    if (value.actorId !== scope.actorId || value.conversationId !== scope.conversationId) fail('Memory scope must match its author and conversation.');
  }
  async function sources(text, sourceTurnIds) {
    content(text);
    if (!Array.isArray(sourceTurnIds) || sourceTurnIds.length === 0 || sourceTurnIds.length > 100
      || new Set(sourceTurnIds).size !== sourceTurnIds.length || sourceTurnIds.some(value => typeof value !== 'string')) fail('Expected distinct cited source turn IDs.');
    const canonical = conversation.snapshot();
    if (canonical.actorId !== scope.actorId || canonical.conversationId !== scope.conversationId) fail('Conversation identity changed.');
    const sourceHashes = [];
    for (const turnId of sourceTurnIds) {
      const turn = canonical.turns.find(turn => turn.id === turnId);
      if (!turn || turn.role !== 'user' || turn.actorId !== scope.actorId || turn.conversationId !== scope.conversationId
        || !turn.content.includes(text)) fail('Memory must be an exact substring of every cited user-authored turn.');
      sourceHashes.push({ turnId, contentHash: await hash(turn.content) });
    }
    return { sourceTurnIds: [...sourceTurnIds], sourceHashes, contentHash: await hash(text) };
  }
  function supersede(record) {
    records = records.map(item => item === record ? { ...item, status: 'superseded' } : item);
  }
  return Object.freeze({
    save({ text, sourceTurnIds, scope: requestedScope, modelSafe } = {}) {
      return transact(async () => {
        requireScope(requestedScope);
        if (modelSafe !== true) fail('Only explicitly model-safe user text may be saved.');
        const source = await sources(text, sourceTurnIds);
        const record = { id: id('m-', new Set(records.map(item => item.id)).size + 1), version: 1, text,
          ...source, scope: { ...scope }, modelSafe: true, status: 'active' };
        records.push(record); emit('saved', record);
        return immutable(record);
      });
    },
    correct({ recordId, text, sourceTurnIds, expectedVersion } = {}) {
      return transact(async () => {
        const previous = latest(recordId);
        if (!previous || previous.status !== 'active') fail('Only an active memory may be corrected; forgotten records cannot revive.');
        if (expectedVersion !== previous.version) fail('Memory version conflict.');
        const source = await sources(text, sourceTurnIds);
        const record = { ...previous, version: previous.version + 1, text, ...source, status: 'active' };
        supersede(previous); records.push(record); emit('corrected', record);
        return immutable(record);
      });
    },
    forget({ recordId } = {}) {
      return transact(async () => {
        const previous = latest(recordId);
        if (!previous) fail('Unknown memory record.');
        if (previous.status === 'forgotten') return immutable(previous);
        const record = { ...previous, version: previous.version + 1, text: '', contentHash: await hash(''), status: 'forgotten' };
        supersede(previous); records.push(record); emit('forgotten', record);
        return immutable(record);
      });
    },
    active(requestedScope = {}) {
      if (requestedScope.actorId !== scope.actorId || requestedScope.conversationId !== scope.conversationId) return immutable([]);
      return immutable(records.filter(record => record.status === 'active' && record.modelSafe === true && latest(record.id) === record));
    },
    snapshot,
    exportState: () => JSON.stringify(snapshot()),
    importState(serialized) {
      return transact(async () => {
        const state = parsed(serialized);
        keys(state, ['schema', 'records']);
        if (state.schema !== memorySchema || !Array.isArray(state.records)) fail('Invalid memory state.');
        const incoming = [], histories = new Map();
        for (const value of state.records) {
          keys(value, ['id', 'version', 'text', 'sourceTurnIds', 'sourceHashes', 'contentHash', 'scope', 'modelSafe', 'status']);
          requireScope(value.scope);
          if (value.modelSafe !== true || !statuses.has(value.status) || !Number.isSafeInteger(value.version)
            || value.version < 1 || !digestPattern.test(value.contentHash)) fail('Invalid memory record.');
          const previous = histories.get(value.id);
          if (!previous && (value.id !== id('m-', histories.size + 1) || value.version !== 1)) fail('Invalid stable memory identity.');
          if (previous && (previous.status !== 'superseded' || value.version !== previous.version + 1)) fail('Invalid memory version or tombstone revival.');
          if (value.status === 'forgotten') {
            if (!previous || value.text !== '' || value.contentHash !== await hash('')
              || !same(value.sourceTurnIds, previous.sourceTurnIds) || !same(value.sourceHashes, previous.sourceHashes)) fail('Invalid forgotten memory tombstone.');
          } else {
            const verified = await sources(value.text, value.sourceTurnIds);
            if (verified.contentHash !== value.contentHash || !same(verified.sourceHashes, value.sourceHashes)) fail('Memory or source hash mismatch.');
          }
          const record = clone(value);
          incoming.push(record); histories.set(record.id, record);
        }
        if ([...histories.values()].some(record => record.status === 'superseded')) fail('A superseded memory needs a later version.');
        if (incoming.length < records.length || records.some((record, index) => {
          const next = incoming[index];
          return !next || !same({ ...record, status: next.status }, next)
            || !(record.status === next.status || record.status === 'active' && next.status === 'superseded');
        })) fail('Existing memory history cannot be removed or changed.');
        records = incoming;
        return snapshot(); // Restoring state is not a newly authored memory event.
      });
    },
  });
}
