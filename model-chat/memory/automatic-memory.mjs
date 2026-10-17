import { createConversationIndex } from './conversation-index.mjs';
import { createScopedPockets } from './scoped-pockets.mjs';
import { SPACE_STARTER_FACTS } from './starter-facts.mjs';

const scopes = new Set(['all', 'global', 'persona', 'conversation']);
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const label = text => [...text.replace(/\s+/gu, ' ').trim()].slice(0, 58).join('');
const functionWords = new Set(('what which when where why how is are was were be been being the a an of to for does do did it its '
  + 'you your i my me we our us and or in on at by as with from that this these those can could would should will has have had please tell about').split(' '));
function promptWindow(text, query) {
  const terms = new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(term => term.length >= 2 && !functionWords.has(term)));
  const match = [...text.matchAll(/[\p{L}\p{N}]+/gu)].find(value => terms.has(value[0].toLowerCase()));
  const points = [...text], at = match ? [...text.slice(0, match.index)].length : 0;
  const start = Math.max(0, at - 80), quote = points.slice(start, start + 360).join('');
  return { text: quote, offset: points.slice(0, start).join('').length };
}

/** Presentation and routing over source-owned indexes; no fact extraction. */
export async function createAutomaticMemory({ ownerScope, conversation, memory, core, policyState,
  personaState, globalState, ensureSharedFresh = () => {}, persist = async () => ({ durable: false }) } = {}) {
  const owner = Object.freeze({ ...ownerScope }), observers = new Set();
  let selectedScope = 'all', used = [], blocked = new Set();
  if (policyState !== undefined) {
    if (typeof policyState !== 'string' || policyState.length > 100_000) throw Error('Invalid conversation memory policy.');
    const state = JSON.parse(policyState), actual = new Set(conversation.snapshot().turns.map(turn => turn.id));
    if (state.schema !== 'automatic-memory-policy/v1' || JSON.stringify(state.owner) !== JSON.stringify(owner)
      || !scopes.has(state.scope) || !Array.isArray(state.blockedTurnIds) || state.blockedTurnIds.length > 4096
      || new Set(state.blockedTurnIds).size !== state.blockedTurnIds.length || state.blockedTurnIds.some(id => !actual.has(id))) throw Error('Invalid retained memory scope or exclusions.');
    selectedScope = state.scope; blocked = new Set(state.blockedTurnIds);
  }
  let pockets;
  const legacyProtectedIds = () => [...new Set([...memory.snapshot().records.flatMap(record => record.sourceTurnIds),
    ...conversation.snapshot().turns.filter(turn => turn.role === 'user' && /^(?:Fact|Constraint|Correction)\[/m.test(turn.content)).map(turn => turn.id)])];
  const personaHistory = () => pockets ? JSON.parse(pockets.exportPersona()).records : [];
  const personaSources = () => personaHistory().filter(record => record.origin.conversationId === owner.conversationId).map(record => record.origin.turnId);
  const protectedIds = () => [...new Set([...legacyProtectedIds(), ...personaSources()])];
  const blockedIds = () => {
    const history = personaHistory(), forgotten = new Set(history.filter(record => record.status === 'forgotten').map(record => record.id));
    const savedHistory = memory.snapshot().records, forgottenSaved = new Set(savedHistory.filter(record => record.status === 'forgotten').map(record => record.id));
    return [...new Set([...blocked, ...savedHistory.filter(record => forgottenSaved.has(record.id)).flatMap(record => record.sourceTurnIds),
      ...history.filter(record => forgotten.has(record.id) && record.origin.conversationId === owner.conversationId).map(record => record.origin.turnId)])];
  };
  const getScope = () => selectedScope;
  const index = createConversationIndex({ conversation, core, ownerScope: { kind: 'conversation', ...owner },
    getActiveScope: getScope, getBlockedTurnIds: blockedIds, getProtectedTurnIds: protectedIds });
  pockets = await createScopedPockets({ ownerScope: owner, conversation, core, starterFacts: SPACE_STARTER_FACTS,
    personaState, globalState, getActiveScope: getScope, getProtectedTurnIds: () => [...new Set([...legacyProtectedIds(), ...blockedIds()])] });
  const notify = () => { for (const observer of [...observers]) { try { observer(); } catch { /* Views do not own source data. */ } } };
  const identity = () => { ensureSharedFresh(); return JSON.stringify([selectedScope, [...blocked].sort(), pockets.exportPersona(), pockets.exportGlobal()]); };
  const normalize = node => node.nodeId
    ? { ...node, text: conversation.snapshot().turns.find(turn => turn.id === node.turnId)?.content ?? node.text,
      id: node.nodeId, kind: 'message', scope: 'conversation', label: label(node.text) }
    : { ...node, kind: node.scope, label: label(node.text),
      ...(node.provenance?.sourceURL ? { sourceURL: node.provenance.sourceURL, sourceTitle: 'NASA' } : {}),
      ...(node.provenance?.origin?.conversationId === owner.conversationId ? { turnId: node.provenance.origin.turnId } : {}) };
  async function search({ query, purpose = 'display', excludeTurnIds = [] } = {}) {
    const before = identity(), version = conversation.snapshot().version;
    const [chat, shared] = await Promise.all([index.search({ query, purpose, excludeTurnIds }), pockets.search({ query, purpose })]);
    if (identity() !== before || conversation.snapshot().version !== version || chat.status.state === 'stale') throw Error('Memory changed during search. Search again.');
    const hits = [...chat.hits.map(hit => ({ ...hit, kind: 'conversation', scope: 'conversation' })),
      ...shared.hits.map(hit => ({ ...hit, nodeId: hit.id, kind: hit.scope }))];
    const limited = chat.status.state === 'limit';
    const candidates = [...(chat.inspection?.candidates ?? []), ...(shared.inspection?.candidates ?? [])];
    const scored = candidates.reduce((total, row) => total + Number(row.score_micro !== null) + Number(row.keyword_micro !== null), 0);
    const inspection = freeze({ candidates,
      coverage: 'Conversation core returns followed by shared-pocket core returns, before the existing automatic first-three limit; no cross-source ranking or exhaustive scanned candidate list.',
      availability: { scores: scored && scored === candidates.length * 2 ? 'available' : scored ? 'partial' : 'unavailable',
        reasons: 'unavailable', reason: limited ? chat.status.reason : scored === candidates.length * 2 && candidates.length ? null : 'No complete numeric core ranking was returned.' } });
    return { hits, status: { state: limited ? 'limit' : 'ok', ...(limited ? { message: chat.status.reason } : {}) }, inspection };
  }
  const changed = async operation => { ensureSharedFresh(); await operation(); used = []; notify(); const result = await persist(); notify(); return result; };
  const api = {
    ownerScope: owner, getScope, identity, notify,
    allowConversation: () => selectedScope === 'all' || selectedScope === 'conversation',
    getBlockedTurnIds: () => [...new Set([...blockedIds(), ...personaSources()])],
    snapshot({ preferredNodeIds = [], limit = 12 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw Error('Memory view admits at most twelve nodes.');
      try { ensureSharedFresh(); } catch (error) { return { nodes: [], links: [], usedNodeIds: [], status: { state: 'limit', message: error.message } }; }
      const preferred = preferredNodeIds.length ? preferredNodeIds : used;
      const chat = index.snapshot({ preferredTurnIds: preferred.filter(id => id.startsWith('turn:')).map(id => id.slice(5)), limit: 12 });
      const shared = pockets.snapshot({ preferredIds: preferred, limit: 12 });
      const nodes = [...chat.nodes, ...shared.nodes].map(normalize), byId = new Map(nodes.map(node => [node.id, node]));
      const admitted = [...new Set([...preferred, ...nodes.map(node => node.id)])].map(id => byId.get(id)).filter(Boolean).slice(0, limit);
      const ids = new Set(admitted.map(node => node.id)), links = [], turns = conversation.snapshot().turns;
      for (let at = 1; at < turns.length; at++) {
        const source = 'turn:' + turns[at - 1].id, target = 'turn:' + turns[at].id;
        if (ids.has(source) && ids.has(target)) links.push({ id: JSON.stringify([source, target]), source, target, kind: 'conversation-order' });
      }
      return { nodes: admitted, links, usedNodeIds: used.filter(id => ids.has(id)), status: { state: chat.status.state === 'limit' ? 'limit' : 'ok',
        ...(chat.status.state === 'limit' ? { message: chat.status.reason } : {}) } };
    },
    search: args => search({ ...args, purpose: 'display' }),
    async prepareContext({ query, excludeTurnId } = {}) {
      const result = await search({ query, purpose: 'prompt', excludeTurnIds: [excludeTurnId] });
      if (result.status.state === 'limit') throw Error(result.status.message || 'Conversation memory exceeded its local scan bound.');
      const hits = [];
      for (const hit of result.hits.slice(0, 3)) {
        if (hit.role === 'assistant') throw Error('Generated replies cannot become quoted user evidence.');
        const { text, offset } = promptWindow(hit.text, query);
        const offsets = hit.offsets ? { ...hit.offsets, start: hit.offsets.start + offset, end: hit.offsets.start + offset + text.length } : undefined;
        const origin = hit.provenance?.origin;
        hits.push({ ...hit, text, ...(offsets ? { offsets, lineHash: await hashText(text) } : {}),
          ...(origin ? { quoteSource: { ...origin, offsets: { start: origin.offsets.start + offset, end: origin.offsets.start + offset + text.length, unit: 'utf16' }, lineHash: await hashText(text) } } : {}) });
      }
      return { hits, identity: identity(), inspection: freeze({ ...result.inspection,
        selectedNodeIds: hits.map(hit => hit.nodeId), finalLimit: 3 }) };
    },
    markUsed(hits) { used = [...new Set(hits.map(hit => hit.nodeId))]; notify(); },
    setScope(value) { if (!scopes.has(value)) throw Error('Unknown memory pocket.'); return changed(() => { selectedScope = value; }); },
    pinPersona: request => changed(() => pockets.pin(request)),
    correctPersona: request => changed(() => pockets.correct(request)),
    forget(node) {
      return changed(async () => {
        if (node.kind === 'global') await pockets.removeGlobal({ recordId: node.recordId });
        else if (node.scope === 'persona') {
          await pockets.forgetPersona({ recordId: node.recordId, expectedVersion: node.version });
          const origin = node.provenance?.origin;
          if (origin?.conversationId === owner.conversationId) blocked.add(origin.turnId);
        } else {
          if (!conversation.snapshot().turns.some(turn => turn.id === node.turnId)) throw Error('Unknown conversation source.');
          blocked.add(node.turnId);
        }
      });
    },
    exportPolicy: () => JSON.stringify({ schema: 'automatic-memory-policy/v1', owner, scope: selectedScope, blockedTurnIds: [...blocked].sort() }),
    exportPersona: () => pockets.exportPersona(), exportGlobal: () => pockets.exportGlobal(),
    subscribe(observer) { if (typeof observer !== 'function') throw Error('Memory observer required.'); observers.add(observer); return () => observers.delete(observer); },
    dispose() { observers.clear(); },
  };
  return Object.freeze(api);
}
