// A disposable view of canonical messages, never an admission to saved memory.
import { inspectRetrievalResults } from './rag-adapter.mjs';
const limits = Object.freeze({ maxTurns: 512, maxScanBytes: 512 * 1024, maxTextUnits: 4000, maxNodes: 12 });
const activeScopes = new Set(['all', 'global', 'persona', 'conversation']);
const functionWords = new Set(('what which when where why how is are was were be been being the a an of to for does do did it its you your i my me we our us and or in on at by as with from that this these those can could would should will has have had please tell about explain again more continue above earlier').split(' '));
const encoder = new TextEncoder();
const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(term => term.length >= 2 && !functionWords.has(term)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message, code = 'CONVERSATION_INDEX_INVALID') => { throw Object.assign(new Error(message), { code }); };
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function scalarText(value) {
  if (typeof value !== 'string') return false;
  for (const point of value) if (point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff) return false;
  return true;
}
function owner(value) {
  const fields = ['actorId', 'conversationId', 'kind', 'personaId'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || !same(Object.keys(value).sort(), fields)
    || value.kind !== 'conversation' || fields.filter(key => key !== 'kind').some(key => !scalarText(value[key]) || !value[key].trim() || value[key].length > 200)) {
    fail('An explicit bounded conversation owner scope is required.');
  }
  return Object.freeze({ kind: 'conversation', actorId: value.actorId, personaId: value.personaId, conversationId: value.conversationId });
}
function ids(value, field) {
  if (!(Array.isArray(value) || value instanceof Set) || value.size > limits.maxTurns || value.length > limits.maxTurns
    || [...value].some(id => !scalarText(id) || !id || id.length > 200)) fail(field + ' must contain bounded explicit turn IDs.');
  return new Set(value);
}
// Avoid cutting either half of a Unicode scalar at an exact UTF-16 boundary.
function excerpt(text, start, maximum) {
  if (start > 0 && /[\udc00-\udfff]/u.test(text[start])) start--;
  let end = Math.min(text.length, start + maximum);
  if (end < text.length && /[\udc00-\udfff]/u.test(text[end])) end--;
  return { text: text.slice(start, end), offsets: { start, end, unit: 'utf16' } };
}
function searchExcerpt(text, queryTerms) {
  const match = [...text.matchAll(/[\p{L}\p{N}]+/gu)].find(match => queryTerms.has(match[0].toLowerCase()));
  if (!match) return null;
  return excerpt(text, Math.max(0, match.index - 800), limits.maxTextUnits);
}
async function hash(text) {
  if (!globalThis.crypto?.subtle) fail('WebCrypto SHA-256 is unavailable.');
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Local derived transcript search. Persona ownership is supplied by the workspace. */
export function createConversationIndex({ conversation, core, ownerScope, getActiveScope = () => 'all', getOwnerScope,
  getBlockedTurnIds = () => [], getProtectedTurnIds = () => [] } = {}) {
  if (typeof conversation?.snapshot !== 'function' || typeof core?.RagEngine !== 'function' || typeof core?.recordFromMapping !== 'function'
    || [getActiveScope, getBlockedTurnIds, getProtectedTurnIds].some(value => typeof value !== 'function')
    || getOwnerScope !== undefined && typeof getOwnerScope !== 'function') fail('Canonical conversation, existing RAG core and policy callbacks are required.');
  const scope = owner(ownerScope), scopeKey = JSON.stringify(scope);
  function envelope() {
    if (getOwnerScope && !same(owner(getOwnerScope()), scope)) fail('Conversation index owner scope changed.', 'CONVERSATION_INDEX_SCOPE_CHANGED');
    const activeScope = getActiveScope();
    if (!activeScopes.has(activeScope)) fail('Unknown active memory scope.');
    const state = conversation.snapshot();
    if (state?.actorId !== scope.actorId || state?.conversationId !== scope.conversationId) fail('Canonical conversation is outside the bound owner scope.', 'CONVERSATION_INDEX_SCOPE_CHANGED');
    return { state, activeScope };
  }
  envelope(); // Reject an incorrectly bound store before exposing any method.
  function read() {
    const { state, activeScope } = envelope();
    const status = { state: 'ready', reason: null, activeScope, scannedTurnCount: 0, scanBytes: 0, eligibleTurnCount: 0, limits };
    if (!['all', 'conversation'].includes(activeScope)) return { status: { ...status, state: 'inactive', reason: 'conversation-scope-inactive' } };
    if (state.schema !== 'conversation-store/v1' || !Array.isArray(state.turns) || state.version !== state.turns.length) fail('Expected a canonical conversation snapshot.');
    if (state.turns.length > limits.maxTurns) return { status: { ...status, state: 'limit', reason: 'turn-scan-limit' } };
    const originals = [];
    for (const [index, turn] of state.turns.entries()) {
      if (turn?.id !== 't-' + String(index + 1).padStart(4, '0') || !['user', 'assistant'].includes(turn.role)
        || !scalarText(turn.content) || !turn.content.trim() || turn.content.length > 100_000
        || turn.actorId !== scope.actorId || turn.conversationId !== scope.conversationId) fail('Invalid canonical source turn.');
      status.scannedTurnCount++; status.scanBytes += encoder.encode(turn.content).byteLength;
      if (status.scanBytes > limits.maxScanBytes) return { status: { ...status, state: 'limit', reason: 'byte-scan-limit' } };
      originals.push({ id: turn.id, role: turn.role, content: turn.content });
    }
    const blocked = ids(getBlockedTurnIds(), 'Blocked sources'), protectedIds = ids(getProtectedTurnIds(), 'Protected sources');
    return { originals, blocked, protectedIds, status, signature: JSON.stringify({ originals, blocked: [...blocked].sort(), protectedIds: [...protectedIds].sort(), activeScope }) };
  }
  function snapshot({ preferredTurnIds = [], limit = limits.maxNodes } = {}) {
    const preferred = ids(preferredTurnIds, 'Preferred sources');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxNodes) fail('Graph limit must be between 1 and 12.');
    const current = read();
    if (!current.originals) return freeze({ nodes: [], status: current.status });
    const eligible = current.originals.filter(turn => !current.blocked.has(turn.id));
    // Preferred actual hits retain caller order; remaining nodes are newest first.
    const byId = new Map(eligible.map(turn => [turn.id, turn]));
    const ordered = [...preferred].map(id => byId.get(id)).filter(Boolean);
    ordered.push(...eligible.slice().reverse().filter(turn => !preferred.has(turn.id)));
    const nodes = ordered.slice(0, limit).map(turn => ({ nodeId: 'turn:' + turn.id, turnId: turn.id, role: turn.role,
      ...excerpt(turn.content, 0, 180) }));
    return freeze({ nodes, status: { ...current.status, eligibleTurnCount: eligible.length, omittedTurnCount: eligible.length - nodes.length,
      excerptedNodeCount: nodes.filter(node => node.text.length < byId.get(node.turnId).content.length).length } });
  }
  async function search({ query, purpose = 'display', excludeTurnIds = [] } = {}) {
    if (!scalarText(query) || query.length > limits.maxTextUnits || !['display', 'prompt'].includes(purpose)) fail('A bounded query and display/prompt purpose are required.');
    const excluded = ids(excludeTurnIds, 'Excluded sources'), current = read();
    if (!current.originals) return freeze({ hits: [], status: current.status });
    const latestUser = current.originals.findLast(turn => turn.role === 'user')?.id;
    const eligible = current.originals.filter(turn => !current.blocked.has(turn.id) && !current.protectedIds.has(turn.id) && !excluded.has(turn.id)
      && (purpose === 'display' || turn.role === 'user' && turn.id !== latestUser));
    const queryTerms = terms(query);
    const status = { ...current.status, eligibleTurnCount: eligible.length, purpose, meaningfulQueryTermCount: queryTerms.size, coreTruncated: false };
    if (!queryTerms.size) return freeze({ hits: [], status });
    const candidates = eligible.flatMap(turn => { const span = searchExcerpt(turn.content, queryTerms); return span ? [{ ...turn, ...span }] : []; });
    status.matchedTurnCount = candidates.length;
    status.excerptedTurnCount = candidates.filter(candidate => candidate.text.length < candidate.content.length).length;
    if (!candidates.length) return freeze({ hits: [], status });
    const byId = new Map(candidates.map(candidate => ['turn:' + candidate.id, candidate]));
    const records = candidates.map(candidate => core.recordFromMapping({ id: 'turn:' + candidate.id, text: candidate.text,
      source_id: candidate.id, source_name: candidate.role + ' ' + candidate.id, path: 'turn/' + encodeURIComponent(candidate.id),
      pocket: 'derived-conversation', scopes: [scopeKey], authority: 'unclassified', priority: 0,
      provenance: { file_source: false, chunk_source: true }, references: [], metadata: { role: candidate.role } }));
    const response = new core.RagEngine(records).search(query, { mode: 'keyword_only', include_scopes: [scopeKey], top_k: 12, max_context_tokens: 1800, expand: false });
    if (!Array.isArray(response?.results) || response.results.length > limits.maxNodes) fail('Core returned invalid conversation results.');
    const selected = response.results.map(result => {
      const candidate = byId.get(result.record?.id);
      if (!candidate || !result.has_retrieval_signal || !(result.keyword_micro > 0)) fail('Core selected an unknown or unsignaled source.');
      return candidate;
    });
    if (new Set(selected.map(turn => turn.id)).size !== selected.length) fail('Core returned duplicate conversation sources.');
    const hits = await Promise.all(selected.map(async turn => ({ nodeId: 'turn:' + turn.id, turnId: turn.id, role: turn.role, text: turn.text,
      turnHash: await hash(turn.content), offsets: { ...turn.offsets }, lineHash: await hash(turn.text) })));
    // A policy/owner switch cannot release results prepared under an old scope.
    const after = read();
    if (after.signature !== current.signature) return freeze({ hits: [], status: { ...status, state: 'stale', reason: 'conversation-or-policy-changed' } });
    const inspection = inspectRetrievalResults(response.results, result => {
      const turn = byId.get(result.record.id);
      return { nodeId: 'turn:' + turn.id, kind: 'conversation', scope: 'conversation', role: turn.role,
        turnId: turn.id, sourceTurnIds: [turn.id] };
    }, limits.maxNodes);
    return freeze({ hits, status: { ...status, coreTruncated: response.truncated === true }, inspection });
  }
  return Object.freeze({ snapshot, search });
}
