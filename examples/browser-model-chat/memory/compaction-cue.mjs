// Presentation only: real compaction source messages, never a summary or promotion.
export const COMPACTION_CUE_MS = 2400;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

function successful(event) {
  return event?.type === 'compacted' && identity(event.id) && positive(event.cycle)
    && positive(event.capacity) && positive(event.reserve) && event.reserve < event.capacity
    && positive(event.beforePromptTokens) && positive(event.afterPromptTokens)
    && event.beforePromptTokens + event.reserve > event.capacity
    && event.afterPromptTokens + event.reserve <= event.capacity
    && event.afterPromptTokens < event.beforePromptTokens
    && hash(event.summaryHash) && hash(event.requestBeforeSha256) && hash(event.requestAfterSha256)
    && event.requestBeforeSha256 !== event.requestAfterSha256
    && Array.isArray(event.sourceTurnIds) && event.sourceTurnIds.length > 0 && event.sourceTurnIds.length <= 256
    && event.sourceTurnIds.every(identity) && new Set(event.sourceTurnIds).size === event.sourceTurnIds.length
    && Array.isArray(event.sourceHashes) && event.sourceHashes.length === event.sourceTurnIds.length && event.sourceHashes.every(hash);
}

/** Consume before playback: closing, interruption or a reload cannot replay old work. */
export function createCompactionCue(initialEvents = []) {
  const seen = new Set(initialEvents.filter(event => event?.type === 'compacted').map(event => event.id));
  const pending = new Map();
  let disposed = false;
  return Object.freeze({
    observe(event) {
      if (disposed || !successful(event) || seen.has(event.id) || pending.has(event.id)) return false;
      pending.set(event.id, [...event.sourceTurnIds]);
      return true;
    },
    take(visibleNodes = []) {
      if (disposed || !pending.size) return null;
      const eventIds = [...pending.keys()], sources = new Set([...pending.values()].flat());
      for (const id of eventIds) seen.add(id);
      pending.clear();
      const nodeIds = [...new Set(visibleNodes.filter(node => node?.kind === 'message' && node.scope === 'conversation'
        && identity(node.turnId) && node.id === 'turn:' + node.turnId && sources.has(node.turnId)).map(node => node.id))].slice(0, 12);
      return Object.freeze({ eventIds: Object.freeze(eventIds), nodeIds: Object.freeze(nodeIds), durationMs: COMPACTION_CUE_MS,
        message: 'Context compacted · originals kept' });
    },
    dispose() { disposed = true; pending.clear(); seen.clear(); },
  });
}
