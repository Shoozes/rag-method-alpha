// Explicit, origin-bound excerpts and public starter sources. Imported proofs
// establish internal source binding, not authenticated conversation history.
import { inspectRetrievalResults } from './rag-adapter.mjs';
const PERSONA_SCHEMA = 'scoped-persona-pockets/v1', GLOBAL_SCHEMA = 'scoped-global-pockets/v1';
const MAX_PERSONA = 32, MAX_BYTES = 256 * 1024, MAX_GLOBAL = 128;
const encoder = new TextEncoder(), scopes = new Set(['all', 'global', 'persona', 'conversation']);
const words = new Set(('what which when where why how is are was were be been being the a an of to for '
  + 'does do did it its you your i my me we our us and or in on at by as with from that this these those '
  + 'can could would should will has have had please tell about').split(' '));
const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => [...word].length >= 2 && !words.has(word)));
const fail = message => { throw Object.assign(new Error('Invalid scoped pocket: ' + message), { code: 'SCOPED_POCKETS_INVALID' }); };
const changed = () => { throw Object.assign(new Error('Scoped pocket selection changed; search again.'), { code: 'SCOPED_POCKETS_CHANGED' }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => { if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('scope identity'); return value; };
const recordId = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) fail('record identity'); return value; };
const exactKeys = (value, expected) => { if (!object(value) || !same(Object.keys(value).sort(), [...expected].sort())) fail('unexpected fields'); };
const boundedText = (value, maximum = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /\p{Cs}/u.test(value)) fail('bounded well-formed text');
  return value;
};
const frozen = value => {
  const copy = structuredClone(value);
  const freeze = item => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } return item; };
  return freeze(copy);
};
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const serialize = value => { const json = JSON.stringify(value); if (encoder.encode(json).length > MAX_BYTES) fail('encoded state exceeds 256 KiB'); return json; };
const parse = value => {
  if (typeof value !== 'string' || encoder.encode(value).length > MAX_BYTES) fail('serialized state exceeds 256 KiB');
  try { return JSON.parse(value); } catch { fail('serialized JSON state'); }
};
function offsets(value, content, text) {
  exactKeys(value, ['start', 'end', 'unit']);
  if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || value.start < 0 || value.end <= value.start
    || value.end > content.length || value.unit !== 'utf16' || content.slice(value.start, value.end) !== text) fail('exact UTF16 source offsets');
  return { start: value.start, end: value.end, unit: 'utf16' };
}
function nasaURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('NASA source URL'); }
  if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:' || url.username || url.password
    || !(url.hostname === 'nasa.gov' || url.hostname.endsWith('.nasa.gov'))) fail('NASA HTTPS source URL');
  return value;
}

export async function createScopedPockets({ ownerScope, conversation, core, starterFacts = [], personaState, globalState,
  getActiveScope = () => 'all', getProtectedTurnIds = () => [] } = {}) {
  exactKeys(ownerScope, ['actorId', 'personaId', 'conversationId']);
  const owner = frozen({ actorId: identity(ownerScope.actorId), personaId: identity(ownerScope.personaId), conversationId: identity(ownerScope.conversationId) });
  if (typeof conversation?.snapshot !== 'function' || typeof getActiveScope !== 'function' || typeof getProtectedTurnIds !== 'function'
    || typeof core?.RagEngine !== 'function' || typeof core?.recordFromMapping !== 'function') fail('conversation, core and scope readers required');
  const canonical = () => {
    const value = conversation.snapshot();
    if (value?.actorId !== owner.actorId || value?.conversationId !== owner.conversationId
      || ('personaId' in value && value.personaId !== owner.personaId) || !Array.isArray(value.turns)) fail('conversation owner changed');
    return value;
  };
  const activeScope = () => { canonical(); const value = getActiveScope(); if (!scopes.has(value)) fail('active scope'); return value; };
  const protectedIds = () => {
    const value = getProtectedTurnIds();
    if (!Array.isArray(value) || value.length > 4096 || value.some(id => typeof id !== 'string' || !id || id.length > 200)) fail('protected turn identities');
    return [...new Set(value)].sort();
  };
  activeScope();
  if (!Array.isArray(starterFacts) || starterFacts.length > MAX_GLOBAL) fail('starter source count');
  const facts = structuredClone(starterFacts), globalIds = new Set();
  for (const fact of facts) {
    exactKeys(fact, ['id', 'text', 'sourceURL']); recordId(fact.id); boundedText(fact.text); nasaURL(fact.sourceURL);
    if (globalIds.has(fact.id)) fail('duplicate starter source'); globalIds.add(fact.id);
  }
  let records = [], disabled = new Set(), revision = 0, queue = Promise.resolve();
  const sourceBindings = new Map();
  const personaOwner = { actorId: owner.actorId, personaId: owner.personaId };
  const personaEnvelope = incoming => ({ schema: PERSONA_SCHEMA, owner: personaOwner, records: incoming });
  const globalEnvelope = incoming => ({ schema: GLOBAL_SCHEMA, actorId: owner.actorId, disabledIds: [...incoming].sort() });
  const ensureBudget = (incomingRecords = records, incomingDisabled = disabled) => {
    if (incomingRecords.length > 512) fail('persona version history limit');
    // One combined bound includes retained source proofs and version history.
    if (encoder.encode(serialize(personaEnvelope(incomingRecords))).length + encoder.encode(serialize(globalEnvelope(incomingDisabled))).length > MAX_BYTES) fail('encoded state exceeds 256 KiB');
  };
  const latest = id => records.findLast(record => record.id === id);
  async function proof(origin, source) {
    exactKeys(origin, ['actorId', 'personaId', 'conversationId', 'turnId', 'turnHash', 'offsets', 'lineHash']);
    exactKeys(source, ['id', 'role', 'content', 'actorId', 'conversationId']);
    source = { id: source.id, role: source.role, content: source.content, actorId: source.actorId, conversationId: source.conversationId };
    if (origin.actorId !== owner.actorId || origin.personaId !== owner.personaId || source.actorId !== owner.actorId || source.role !== 'user'
      || source.conversationId !== origin.conversationId || source.id !== origin.turnId) fail('user origin owner');
    identity(origin.conversationId); identity(origin.turnId); boundedText(source.content, 100_000);
    const quote = source.content.slice(origin.offsets?.start, origin.offsets?.end); boundedText(quote);
    const span = offsets(origin.offsets, source.content, quote);
    if (await hashText(source.content) !== origin.turnHash || await hashText(quote) !== origin.lineHash) fail('source proof hash');
    const current = canonical();
    if (origin.conversationId === owner.conversationId) {
      const turn = current.turns.find(turn => turn.id === origin.turnId);
      if (!turn || !same({ id: turn.id, role: turn.role, content: turn.content, actorId: turn.actorId, conversationId: turn.conversationId }, source)) fail('source differs from canonical user turn');
    }
    const sourceKey = JSON.stringify([origin.conversationId, origin.turnId]);
    if (sourceBindings.has(sourceKey) && sourceBindings.get(sourceKey) !== origin.turnHash) fail('inconsistent retained source proof');
    sourceBindings.set(sourceKey, origin.turnHash);
    return { quote, origin: { actorId: origin.actorId, personaId: origin.personaId, conversationId: origin.conversationId,
      turnId: origin.turnId, turnHash: origin.turnHash, offsets: span, lineHash: origin.lineHash }, source: { ...source } };
  }
  async function currentSource(request) {
    const turn = canonical().turns.find(turn => turn.id === request.turnId);
    if (!turn || turn.role !== 'user' || turn.actorId !== owner.actorId || turn.conversationId !== owner.conversationId) fail('current authored user source required');
    const source = { id: turn.id, role: turn.role, content: turn.content, actorId: turn.actorId, conversationId: turn.conversationId };
    boundedText(request.text); const start = source.content.indexOf(request.text);
    const span = offsets(request.offsets ?? { start, end: start + request.text.length, unit: 'utf16' }, source.content, request.text);
    const origin = { ...owner, turnId: source.id, turnHash: await hashText(source.content), offsets: span, lineHash: await hashText(request.text) };
    return proof(origin, source);
  }
  if (personaState !== undefined) {
    const incoming = parse(personaState); exactKeys(incoming, ['schema', 'owner', 'records']); exactKeys(incoming.owner, ['actorId', 'personaId']);
    if (incoming.schema !== PERSONA_SCHEMA || incoming.owner.actorId !== owner.actorId || incoming.owner.personaId !== owner.personaId
      || !Array.isArray(incoming.records) || incoming.records.length > 512) fail('persona import owner or records');
    const last = new Map(); let nextId = 1;
    for (const value of incoming.records) {
      exactKeys(value, ['id', 'version', 'status', 'text', 'contentHash', 'origin', 'source']);
      const previous = last.get(value.id);
      if (!previous && value.id !== 'p-' + String(nextId++).padStart(4, '0')) fail('persona record sequence');
      if (nextId - 1 > MAX_PERSONA || value.version !== (previous?.version ?? 0) + 1 || !['active', 'superseded', 'forgotten'].includes(value.status)
        || previous?.status === 'forgotten' || (previous && previous.status !== 'superseded')) fail('persona version or tombstone');
      const verified = await proof(value.origin, value.source);
      if (value.status === 'forgotten') {
        if (!previous || value.text !== '' || !same(previous.origin, verified.origin) || !same(previous.source, verified.source)) fail('persona tombstone source');
      } else if (value.text !== verified.quote) fail('persona exact quote');
      if (await hashText(value.text) !== value.contentHash) fail('persona content hash');
      const record = { id: value.id, version: value.version, status: value.status, text: value.text, contentHash: value.contentHash,
        origin: verified.origin, source: verified.source };
      records.push(record); last.set(record.id, record);
    }
    if ([...last.values()].some(record => record.status === 'superseded')) fail('incomplete persona version history');
  }
  if (globalState !== undefined) {
    const incoming = parse(globalState); exactKeys(incoming, ['schema', 'actorId', 'disabledIds']);
    if (incoming.schema !== GLOBAL_SCHEMA || incoming.actorId !== owner.actorId || !Array.isArray(incoming.disabledIds)
      || incoming.disabledIds.length > MAX_GLOBAL || new Set(incoming.disabledIds).size !== incoming.disabledIds.length) fail('global import owner or tombstones');
    incoming.disabledIds.forEach(recordId); disabled = new Set(incoming.disabledIds);
  }
  ensureBudget();
  const globals = [];
  for (const fact of facts) globals.push({ id: 'global:' + fact.id, kind: 'record', recordId: fact.id, scope: 'global', role: 'source', version: 1,
    text: fact.text, contentHash: await hashText(fact.text), provenance: { sourceURL: fact.sourceURL } });
  activeScope();
  const personaNode = record => ({ id: 'persona:' + record.id, kind: 'record', recordId: record.id, scope: 'persona', role: 'user', version: record.version,
    text: record.text, contentHash: record.contentHash, provenance: { origin: record.origin } });
  function eligible(scope, purpose = 'display', protectedTurns = []) {
    const nodes = [];
    if (scope === 'all' || scope === 'global') nodes.push(...globals.filter(node => !disabled.has(node.recordId)));
    if (scope === 'all' || scope === 'persona') {
      const latestRecords = new Map(records.map(record => [record.id, record]));
      nodes.push(...[...latestRecords.values()].filter(record => record.status === 'active'
        && !(purpose === 'prompt' && record.origin.conversationId === owner.conversationId && protectedTurns.includes(record.origin.turnId))).map(personaNode));
    }
    return nodes;
  }
  const transact = operation => { const pending = queue.then(() => { canonical(); return operation(); }); queue = pending.catch(() => {}); return pending; };
  async function changePersona(request, correcting) {
    const previous = correcting ? latest(request.recordId) : null;
    if (correcting && (!previous || previous.status !== 'active' || previous.version !== request.expectedVersion)) fail('active persona version conflict');
    const count = new Set(records.map(record => record.id)).size;
    if (!correcting && count >= MAX_PERSONA) fail('32 persona excerpts limit');
    const source = await currentSource(request); canonical();
    const record = { id: previous?.id ?? 'p-' + String(count + 1).padStart(4, '0'), version: (previous?.version ?? 0) + 1,
      status: 'active', text: source.quote, contentHash: source.origin.lineHash, origin: source.origin, source: source.source };
    const incoming = [...records.map(item => item === previous ? { ...item, status: 'superseded' } : item), record];
    ensureBudget(incoming); records = incoming; revision++; return frozen(record);
  }
  return Object.freeze({
    ownerScope: owner,
    snapshot({ preferredIds = [], limit = 12 } = {}) {
      if (!Array.isArray(preferredIds) || preferredIds.length > MAX_GLOBAL + MAX_PERSONA || preferredIds.some(id => typeof id !== 'string')
        || !Number.isSafeInteger(limit) || limit < 0 || limit > 30) fail('snapshot window');
      const scope = activeScope(), nodes = eligible(scope), byId = new Map(nodes.map(node => [node.id, node]));
      const ordered = [...new Set([...preferredIds.filter(id => byId.has(id)), ...nodes.map(node => node.id)])].slice(0, limit).map(id => byId.get(id));
      return frozen({ ownerScope: owner, activeScope: scope, nodes: ordered, totalNodes: nodes.length });
    },
    async search({ query, purpose = 'display' } = {}) {
      if (!['display', 'prompt'].includes(purpose)) fail('search purpose'); boundedText(query, purpose === 'prompt' ? 4000 : 1024);
      const scope = activeScope(), stamp = revision, protectedTurns = purpose === 'prompt' ? protectedIds() : [];
      const candidates = eligible(scope, purpose, protectedTurns), queryTerms = terms(query), origins = new Map();
      const selected = candidates.filter(node => [...terms(node.text)].some(term => queryTerms.has(term)));
      const mapped = selected.map(node => {
        origins.set(node.id, node);
        return core.recordFromMapping({ id: node.id, text: node.text, source_id: node.id, source_name: node.scope,
          path: node.scope + '/' + node.recordId, pocket: node.scope, scopes: [node.scope], authority: node.scope === 'global' ? 'global_record' : 'persona_vault', priority: 0,
          provenance: { file_source: false, chunk_source: true }, references: [], metadata: { record_id: node.recordId, version: node.version } });
      });
      const queryHash = await hashText(query);
      const check = () => { if (activeScope() !== scope || revision !== stamp || (purpose === 'prompt' && !same(protectedTurns, protectedIds()))) changed(); };
      check();
      // This selects candidates, not a model prompt. The caller bounds and
      // measures quoted evidence; a 4000-unit excerpt must remain retrievable.
      const response = new core.RagEngine(mapped).search(query, { mode: 'keyword_only', include_scopes: ['global', 'persona'],
        top_k: purpose === 'prompt' ? 3 : 12, max_context_tokens: 1800, expand: false });
      if (!Array.isArray(response.results) || response.results.some(result => !result.has_retrieval_signal || result.keyword_micro <= 0 || !origins.has(result.record.id))) fail('core retrieval signal');
      check();
      const inspection = inspectRetrievalResults(response.results, result => {
        const node = origins.get(result.record.id);
        return { nodeId: node.id, recordId: node.recordId, version: node.version, kind: node.scope, scope: node.scope,
          role: node.role, sourceTurnIds: node.provenance?.origin ? [node.provenance.origin.turnId] : [] };
      }, purpose === 'prompt' ? 3 : 12);
      return frozen({ activeScope: scope, purpose, queryHash, hits: response.results.map(result => origins.get(result.record.id)), inspection });
    },
    pin(request = {}) { const copied = structuredClone(request); return transact(() => changePersona(copied, false)); },
    correct(request = {}) { const copied = structuredClone(request); return transact(() => changePersona(copied, true)); },
    forgetPersona({ recordId: id, expectedVersion } = {}) {
      return transact(async () => {
        const previous = latest(id); if (!previous) fail('unknown persona record');
        if (expectedVersion !== undefined && expectedVersion !== previous.version) fail('active persona version conflict');
        if (previous.status === 'forgotten') return frozen(previous);
        const record = { ...previous, version: previous.version + 1, status: 'forgotten', text: '', contentHash: await hashText('') };
        canonical(); const incoming = [...records.map(item => item === previous ? { ...item, status: 'superseded' } : item), record];
        ensureBudget(incoming); records = incoming; revision++; return frozen(record);
      });
    },
    removeGlobal({ recordId: id } = {}) {
      return transact(() => {
        if (!globalIds.has(id)) fail('unknown global source'); const incoming = new Set([...disabled, id]);
        ensureBudget(records, incoming); disabled = incoming; revision++; return frozen({ recordId: id, disabled: true });
      });
    },
    exportPersona() { canonical(); return serialize(personaEnvelope(records)); },
    exportGlobal() { canonical(); return serialize(globalEnvelope(disabled)); },
  });
}
