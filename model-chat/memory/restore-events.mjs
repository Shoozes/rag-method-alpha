// Validate retained data bindings before rebuilding a graph. Browser storage
// remains user-editable: this cannot authenticate past dispatches or execution.
import { dispatchSources } from './citations.mjs';
const writes = new Set(['saved', 'corrected', 'forgotten']);
const selections = new Set(['recalled', 'context-dispatched']);
const hashPattern = /^[a-f0-9]{64}$/;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = detail => { throw new Error(`Retained memory event binding is invalid: ${detail}.`); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const hashText = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function validateRetainedEvents({ events, conversation, records } = {}) {
  if (!Array.isArray(events) || !Array.isArray(records) || !Array.isArray(conversation?.turns)
    || conversation.version !== conversation.turns.length) fail('canonical inputs');
  const turns = new Map(conversation.turns.map((turn, index) => [turn.id, { ...turn, position: index + 1 }]));
  const retained = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.id, record.version]);
    if (!positive(record.version) || retained.has(key)) fail('retained record identity');
    retained.set(key, record);
  }
  const current = new Map(), written = new Set(), priorEvents = new Set(), turnHashes = new Map();
  const sourceIds = event => {
    if (!Array.isArray(event.sourceTurnIds) || new Set(event.sourceTurnIds).size !== event.sourceTurnIds.length
      || event.sourceTurnIds.some(id => !turns.has(id))) fail('unknown or duplicate source turn');
    return event.sourceTurnIds;
  };
  const versionBound = (event, ids) => {
    if (!Number.isSafeInteger(event.conversationVersion) || event.conversationVersion < 1
      || event.conversationVersion > conversation.version || ids.some(id => turns.get(id).position > event.conversationVersion)) fail('conversation version');
  };
  for (const event of events) {
    if (!event || typeof event !== 'object') fail('event');
    const ids = sourceIds(event);
    if ('scope' in event && (!event.scope || event.scope.actorId !== conversation.actorId || event.scope.conversationId !== conversation.conversationId)) fail('scope');
    if (event.priorEventIds && (!Array.isArray(event.priorEventIds) || event.priorEventIds.some(id => !priorEvents.has(id)))) fail('prior event reference');
    if (writes.has(event.type)) {
      if ('recordIds' in event || 'versions' in event) fail('write reference fields');
      const key = JSON.stringify([event.recordId, event.version]), record = retained.get(key), previous = current.get(event.recordId);
      if (!record || written.has(key) || !positive(event.version)
        || (event.type === 'saved' ? previous || event.version !== 1 : !previous || previous.forgotten || event.version !== previous.record.version + 1)) fail('write version');
      if (event.contentHash !== record.contentHash || !hashPattern.test(event.contentHash || '')
        || !same(ids, record.sourceTurnIds) || ids.some(id => turns.get(id).role !== 'user')) fail('write provenance');
      if (record.scope.actorId !== conversation.actorId || record.scope.conversationId !== conversation.conversationId || record.modelSafe !== true) fail('record scope');
      if (event.type === 'forgotten' ? record.status !== 'forgotten' || record.text !== '' : record.status === 'forgotten' || !record.text) fail('tombstone');
      current.set(event.recordId, { record, forgotten: event.type === 'forgotten' }); written.add(key);
    } else if (selections.has(event.type)) {
      if ('recordId' in event || !Array.isArray(event.recordIds) || !Array.isArray(event.versions)
        || event.recordIds.length !== event.versions.length || new Set(event.recordIds).size !== event.recordIds.length) fail('selection references');
      const selected = event.recordIds.map((id, index) => {
        const value = current.get(id);
        if (!value || value.forgotten || event.versions[index] !== value.record.version) fail('selection version');
        return value.record;
      });
      if (!same(ids, [...new Set(selected.flatMap(record => record.sourceTurnIds))])) fail('selection sources');
      if (event.type === 'context-dispatched') {
        versionBound(event, ids);
        if (!positive(event.promptTokens) || !hashPattern.test(event.requestSha256 || '')) fail('dispatch measurement');
        try { await dispatchSources({ event, conversation, records }); }
        catch { fail('dispatch citation provenance'); }
      }
    } else if (event.type === 'compacted') {
      if ('trigger' in event && event.trigger !== 'manual') fail('compaction trigger');
      if ('recordId' in event || 'recordIds' in event || 'versions' in event || !ids.length) fail('compaction references');
      versionBound(event, ids);
      if (!positive(event.cycle) || !positive(event.capacity) || !positive(event.reserve) || event.reserve >= event.capacity
        || !positive(event.beforePromptTokens) || !positive(event.afterPromptTokens)
        || event.trigger !== 'manual' && event.beforePromptTokens + event.reserve <= event.capacity
        || event.trigger === 'manual' && event.afterPromptTokens >= event.beforePromptTokens
        || event.afterPromptTokens + event.reserve > event.capacity) fail('compaction budget');
      if (!hashPattern.test(event.summaryHash || '') || !hashPattern.test(event.requestBeforeSha256 || '')
        || event.trigger === 'manual' && event.requestBeforeSha256 === event.requestAfterSha256
        || !hashPattern.test(event.requestAfterSha256 || '') || !Array.isArray(event.sourceHashes) || event.sourceHashes.length !== ids.length) fail('compaction hashes');
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        if (!turnHashes.has(id)) turnHashes.set(id, await hashText(turns.get(id).content));
        if (event.sourceHashes[index] !== turnHashes.get(id)) fail('compaction source hash');
      }
    } else if (event.type === 'summary-rejected') {
      if ('recordId' in event || 'recordIds' in event || 'versions' in event) fail('rejected summary references');
    } else fail('event type');
    priorEvents.add(event.id);
  }
  if (written.size !== retained.size) fail('retained versions missing write events');
  return { eventCount: events.length, recordVersions: retained.size, writeCount: written.size,
    verification: 'canonical data bindings; not authentication of historical execution' };
}
