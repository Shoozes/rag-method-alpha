// Historical data bindings, not authentication of execution or factual truth.
const hashPattern = /^[a-f0-9]{64}$/;
const declaration = /^(Fact|Constraint|Correction)\[([A-Za-z][A-Za-z0-9_.-]{0,39})\]:[ \t]*(.*)$/;
const fail = detail => { throw new Error(`Answer citation binding is invalid: ${detail}.`); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function utf16Boundary(content, offset) {
  const before = content.charCodeAt(offset - 1), after = content.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function fields(value, expected) {
  if (!plain(value) || Reflect.ownKeys(value).length !== expected.length || expected.some(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return !property || !property.enumerable || !('value' in property);
  })) fail('unexpected fields');
}
function list(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail(label);
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !('value' in property)) fail(label);
  }
}
function immutable(value) {
  const result = structuredClone(value);
  const freeze = item => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(result); return result;
}
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
function exact(value, expected) {
  fields(value, Object.keys(expected));
  for (const [key, item] of Object.entries(expected)) {
    if (plain(item)) exact(value[key], item);
    else if (value[key] !== item) fail('source identity or ordering');
  }
}
function canonical(conversation, records) {
  if (!plain(conversation) || !identity(conversation.actorId) || !identity(conversation.conversationId)
    || !Array.isArray(conversation.turns) || conversation.version !== conversation.turns.length || !Array.isArray(records)) fail('canonical inputs');
  const turns = new Map(), retained = new Map(), hashes = new Map();
  conversation.turns.forEach((turn, index) => {
    if (!plain(turn) || !identity(turn.id) || turns.has(turn.id) || !['user', 'assistant'].includes(turn.role)
      || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > 100000
      || turn.actorId !== conversation.actorId || turn.conversationId !== conversation.conversationId) fail('canonical turn or scope');
    turns.set(turn.id, { ...turn, position: index + 1 });
  });
  for (const record of records) {
    if (!plain(record) || !identity(record.id) || !positive(record.version)) fail('record identity');
    const key = JSON.stringify([record.id, record.version]);
    if (retained.has(key)) fail('duplicate record version'); retained.set(key, record);
  }
  return { conversation, turns, retained, async source(turnId, version) {
    const turn = turns.get(turnId);
    if (!turn || turn.role !== 'user' || turn.position > version) fail('unknown, assistant or future source');
    if (!hashes.has(turnId)) hashes.set(turnId, await hashText(turn.content));
    return { turn, hash: hashes.get(turnId) };
  } };
}
function dispatch(event, view) {
  if (!plain(event) || event.type !== 'context-dispatched' || !identity(event.id) || !positive(event.seq)
    || !identity(event.queryId) || !hashPattern.test(event.requestSha256 || '') || !positive(event.promptTokens)
    || !positive(event.conversationVersion) || event.conversationVersion > view.conversation.version
    || view.conversation.turns[event.conversationVersion - 1]?.role !== 'user') fail('dispatch or latest authored query');
  if ('scope' in event) {
    fields(event.scope, ['actorId', 'conversationId']);
    if (event.scope.actorId !== view.conversation.actorId || event.scope.conversationId !== view.conversation.conversationId) fail('dispatch scope');
  }
  list(event.recordIds, 256, 'dispatch records'); list(event.versions, 256, 'dispatch versions');
  list(event.sourceTurnIds, 256, 'dispatch source turns');
  if (event.recordIds.length !== event.versions.length || new Set(event.recordIds).size !== event.recordIds.length
    || event.recordIds.some(id => !identity(id)) || event.versions.some(value => !positive(value))) fail('dispatch record selection');
}
async function sourcesFor(event, view) {
  dispatch(event, view);
  const sources = [], selectedTurns = [];
  for (let index = 0; index < event.recordIds.length; index++) {
    const record = view.retained.get(JSON.stringify([event.recordIds[index], event.versions[index]]));
    if (!record || !['active', 'superseded'].includes(record.status) || record.modelSafe !== true
      || typeof record.text !== 'string' || !record.text.trim() || !hashPattern.test(record.contentHash || '')
      || await hashText(record.text) !== record.contentHash) fail('historical selected record');
    fields(record.scope, ['actorId', 'conversationId']);
    if (record.scope.actorId !== view.conversation.actorId || record.scope.conversationId !== view.conversation.conversationId) fail('record scope');
    list(record.sourceTurnIds, 100, 'record source turns'); list(record.sourceHashes, 100, 'record source hashes');
    if (!record.sourceTurnIds.length || record.sourceTurnIds.length !== record.sourceHashes.length
      || new Set(record.sourceTurnIds).size !== record.sourceTurnIds.length) fail('record provenance');
    for (let sourceIndex = 0; sourceIndex < record.sourceTurnIds.length; sourceIndex++) {
      const turnId = record.sourceTurnIds[sourceIndex], reference = record.sourceHashes[sourceIndex];
      fields(reference, ['turnId', 'contentHash']);
      const source = await view.source(turnId, event.conversationVersion);
      if (reference.turnId !== turnId || reference.contentHash !== source.hash || !source.turn.content.includes(record.text)) fail('record source hash or quote');
      sources.push({ kind: 'saved-record', recordId: record.id, version: record.version, turnId, turnHash: source.hash });
      if (!selectedTurns.includes(turnId)) selectedTurns.push(turnId);
    }
  }
  if (event.sourceTurnIds.length !== selectedTurns.length || event.sourceTurnIds.some((id, index) => id !== selectedTurns[index])) fail('dispatch saved source selection');
  const contextSources = event.contextSources === undefined ? [] : event.contextSources;
  list(contextSources, 24, 'structured context source limit');
  const keys = new Set();
  for (const reference of contextSources) {
    fields(reference, ['key', 'turnId', 'turnHash', 'offsets', 'lineHash']);
    fields(reference.offsets, ['start', 'end', 'unit']);
    const { start, end, unit } = reference.offsets;
    if (typeof reference.key !== 'string' || !/^[a-z][a-z0-9_.-]{0,39}$/.test(reference.key) || keys.has(reference.key)
      || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || unit !== 'utf16') fail('structured key or offsets');
    keys.add(reference.key);
    const source = await view.source(reference.turnId, event.conversationVersion), content = source.turn.content;
    if (end > content.length || start > 0 && !/[\r\n]/.test(content[start - 1]) || end < content.length && !/[\r\n]/.test(content[end])) fail('structured whole-line offsets');
    const quote = content.slice(start, end), match = declaration.exec(quote);
    if (!match || !match[3].trim() || match[2].toLowerCase() !== reference.key || /[\r\n]/.test(quote)
      || reference.turnHash !== source.hash || reference.lineHash !== await hashText(quote)) fail('structured declaration or hash');
    sources.push({ kind: 'structured', key: reference.key, turnId: reference.turnId, turnHash: source.hash,
      offsets: { start, end, unit }, lineHash: reference.lineHash });
  }
  const extractiveSources = event.extractiveSources === undefined ? [] : event.extractiveSources;
  list(extractiveSources, 8, 'extractive context source limit');
  for (const reference of extractiveSources) {
    fields(reference, ['key', 'turnId', 'turnHash', 'offsets', 'lineHash']);
    fields(reference.offsets, ['start', 'end', 'unit']);
    const { start, end, unit } = reference.offsets;
    if (typeof reference.key !== 'string' || !/^[a-z][a-z0-9_.-]{0,39}$/.test(reference.key) || keys.has(reference.key)
      || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 4096
      || unit !== 'utf16') fail('extractive key or offsets');
    keys.add(reference.key);
    const source = await view.source(reference.turnId, event.conversationVersion), content = source.turn.content;
    if (end > content.length || !utf16Boundary(content, start) || !utf16Boundary(content, end)) fail('extractive UTF16 boundaries');
    const quote = content.slice(start, end);
    if (!quote.trim() || reference.turnHash !== source.hash || reference.lineHash !== await hashText(quote)) fail('extractive quote or hash');
    sources.push({ kind: 'extractive', key: reference.key, turnId: reference.turnId, turnHash: source.hash,
      offsets: { start, end, unit }, lineHash: reference.lineHash });
  }
  return sources;
}

/** Shared validation for the dispatch ledger and its answer annotations. */
export async function dispatchSources({ event, conversation, records } = {}) {
  return immutable(await sourcesFor(event, canonical(conversation, records)));
}
function eventIndex(events) {
  list(events, 4096, 'event ledger'); const index = new Map();
  for (const event of events) {
    if (!plain(event) || !identity(event.id) || index.has(event.id)) fail('event identity'); index.set(event.id, event);
  }
  return index;
}
async function annotation(citation, view, events) {
  fields(citation, ['answerTurnId', 'answerHash', 'dispatchEventId', 'sources']);
  const answer = view.turns.get(citation.answerTurnId), event = events.get(citation.dispatchEventId);
  if (!answer || answer.role !== 'assistant' || !hashPattern.test(citation.answerHash || '')
    || citation.answerHash !== await hashText(answer.content)) fail('assistant answer or hash');
  const sources = await sourcesFor(event, view);
  if (answer.position !== event.conversationVersion + 1) fail('answer order');
  // Ledger/store limits: 256 records * 100 sources + 24 declarations + 8 passages.
  list(citation.sources, 25632, 'annotation sources');
  if (!sources.length || citation.sources.length !== sources.length) fail('missing or fabricated answer sources');
  citation.sources.forEach((source, index) => exact(source, sources[index]));
  return { answerTurnId: answer.id, answerHash: citation.answerHash, dispatchEventId: event.id, sources };
}

export async function validateAnswerCitations({ citations = [], conversation, records, events } = {}) {
  list(citations, 2000, 'answer citation limit');
  const view = canonical(conversation, records), indexedEvents = eventIndex(events), answers = new Set(), validated = [];
  for (const citation of citations) {
    const value = await annotation(citation, view, indexedEvents);
    if (answers.has(value.answerTurnId)) fail('duplicate answer citation');
    validated.push(value); answers.add(value.answerTurnId);
  }
  return immutable(validated);
}

export async function captureAnswerCitation({ answerTurnId, requestSha256, conversation, records, events } = {}) {
  const view = canonical(conversation, records), indexedEvents = eventIndex(events), answer = view.turns.get(answerTurnId);
  if (!answer || answer.role !== 'assistant' || !hashPattern.test(requestSha256 || '')) fail('capture answer or request hash');
  const candidates = [...indexedEvents.values()].filter(event => event.type === 'context-dispatched'
    && event.conversationVersion + 1 === answer.position && event.requestSha256 === requestSha256);
  if (candidates.length !== 1) fail('missing or ambiguous answer dispatch');
  const event = candidates[0], sources = await sourcesFor(event, view);
  if (!sources.length) return null;
  return immutable(await annotation({ answerTurnId, answerHash: await hashText(answer.content), dispatchEventId: event.id, sources }, view, indexedEvents));
}
