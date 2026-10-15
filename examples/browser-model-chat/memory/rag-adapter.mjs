// The existing retrieval core ranks evidence. This adapter only enforces the
// conversation-memory boundary and preserves exact fact/source identities.
const MAX_HITS = 3;
const MAX_SOURCES = 32;
const TERM_GATE = 'english-function-word-overlap-v1';
// Private application evidence gate, not a change to rag-behavior-v2. This
// small English question/function-word list prevents shared "is/the/my" terms
// alone from injecting a fact. It is lexical filtering, not semantic relevance.
const functionWords = new Set(('what which when where why how is are was were be been being the a an of to for '
  + 'does do did it its you your i my me we our us and or in on at by as with from that this these those '
  + 'can could would should will has have had please tell about').split(' '));
const meaningfulTerms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  .filter(term => Array.from(term).length >= 2 && !functionWords.has(term)));
const hashPattern = /^[0-9a-f]{64}$/;
const invalid = label => new Error(`Invalid memory retrieval ${label}.`);
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const copyScope = value => {
  if (!value || !validId(value.actorId) || !validId(value.conversationId)) throw invalid('scope');
  return { actorId: value.actorId, conversationId: value.conversationId };
};
const sameScope = (left, right) => left?.actorId === right.actorId && left?.conversationId === right.conversationId;
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

function snapshotLatest(records) {
  if (!Array.isArray(records)) throw invalid('records');
  const latest = new Map();
  const versions = new Map();
  for (const record of records) {
    if (!record || !validId(record.id) || !Number.isSafeInteger(record.version) || record.version < 1) throw invalid('record version');
    if (!versions.has(record.id)) versions.set(record.id, new Set());
    if (versions.get(record.id).has(record.version)) throw invalid('duplicate record version');
    versions.get(record.id).add(record.version);
    const previous = latest.get(record.id);
    if (!previous || previous.version < record.version) {
      latest.set(record.id, { id: record.id, version: record.version, status: record.status, text: record.text,
        modelSafe: record.modelSafe, contentHash: record.contentHash,
        scope: record.scope && { actorId: record.scope.actorId, conversationId: record.scope.conversationId },
        sourceTurnIds: Array.isArray(record.sourceTurnIds) ? [...record.sourceTurnIds] : null });
    }
  }
  return [...latest.values()];
}

export function createRetrieval({ core, onEvent } = {}) {
  for (const method of ['RagEngine', 'recordFromMapping', 'assertContextMatches', 'formatContextPacket']) {
    if (typeof core?.[method] !== 'function') throw new Error(`Memory retrieval core is missing ${method}.`);
  }
  return {
    async search({ query, records, scope: requestedScope, queryId } = {}) {
      const scope = copyScope(requestedScope);
      if (!validId(queryId) || typeof query !== 'string') throw invalid('query');
      // Select versions before access/status filters: a forgotten, inaccessible
      // or unsafe latest version must never revive an older active fact.
      const eligible = snapshotLatest(records).filter(record => record.status === 'active' && record.modelSafe === true && sameScope(record.scope, scope));
      const ownerScope = 'conversation:' + JSON.stringify([scope.actorId, scope.conversationId]);
      const origins = new Map();
      const mapped = [];
      for (const record of eligible) {
        if (typeof record.text !== 'string' || !record.text.trim() || !hashPattern.test(record.contentHash || '')
          || !record.sourceTurnIds?.length || record.sourceTurnIds.length > MAX_SOURCES
          || record.sourceTurnIds.some(id => !validId(id)) || new Set(record.sourceTurnIds).size !== record.sourceTurnIds.length) throw invalid('fact provenance');
        if (await hashText(record.text) !== record.contentHash) throw invalid('content integrity');
        const id = 'memory:' + JSON.stringify([record.id, record.version]);
        const value = core.recordFromMapping({ id, text: record.text, source_id: id, source_name: record.id,
          path: 'memory/' + encodeURIComponent(record.id) + '/v' + record.version,
          pocket: 'conversation-memory', scopes: [ownerScope], authority: 'conversation_memory', priority: 0,
          provenance: { file_source: false, chunk_source: true }, references: [],
          metadata: { memory_record_id: record.id, memory_version: record.version, content_hash: record.contentHash,
            source_turn_ids: [...record.sourceTurnIds], heading: 'Authored conversation fact' } });
        // Never silently normalize the evidence whose exact hash was verified.
        if (value.text !== record.text) throw invalid('fact text normalization');
        origins.set(id, record); mapped.push(value);
      }
      const engine = new core.RagEngine(mapped);
      const options = { mode: 'keyword_only', include_scopes: [ownerScope], top_k: MAX_HITS,
        max_context_tokens: 384, expand: false };
      let response = engine.search(query, options);
      const queryTerms = meaningfulTerms(query);
      const gated = response.results.filter(result => [...meaningfulTerms(result.record.text)].some(term => queryTerms.has(term)));
      if (gated.length !== response.results.length) {
        // Reuse the real core on the gated records to obtain its matching
        // token estimate and selected IDs; never reuse a pre-filter count.
        response = new core.RagEngine(gated.map(result => result.record)).search(query, options);
      }
      const selected = response.results;
      if (selected.some(result => !result.has_retrieval_signal || result.keyword_micro <= 0)) throw invalid('retrieval signal');
      const contextPacket = { query_id: queryId, query, estimated_tokens: response.context_tokens,
        chunks: selected.map(({ record }) => ({ id: record.id, source_id: record.source_id, path: record.path,
          heading: 'Authored conversation fact', text: record.text })) };
      core.assertContextMatches(contextPacket, queryId, query, { context_tokens: response.context_tokens,
        context_selected_ids: response.results.map(result => result.record.id) });
      const hits = selected.map(({ record }) => {
        const original = origins.get(record.id);
        if (!original) throw invalid('selected record identity');
        return { recordId: original.id, version: original.version, text: original.text,
          sourceTurnIds: [...original.sourceTurnIds], contentHash: original.contentHash, scope: { ...scope } };
      });
      const event = { type: 'recalled', queryId, scope: { ...scope }, recordIds: hits.map(hit => hit.recordId),
        versions: hits.map(hit => hit.version), sourceTurnIds: [...new Set(hits.flatMap(hit => hit.sourceTurnIds))],
        selectedCount: hits.length, eligibleCount: eligible.length, mode: 'keyword_only', term_gate: TERM_GATE };
      try {
        const observed = onEvent?.(structuredClone(event));
        if (observed && typeof observed.then === 'function') Promise.resolve(observed).catch(() => {});
      } catch { /* Observers cannot change retrieval. */ }
      return { queryId, hits, contextPacket, contextText: core.formatContextPacket(contextPacket), term_gate: TERM_GATE };
    },
  };
}
