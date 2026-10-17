import { createConversationStore, createMemoryStore } from './store.mjs';
import { createRetrieval } from './rag-adapter.mjs';
import { createEventStore, createMemoryGraph } from './events.mjs';
import { createContextManager } from './context.mjs';
import { validateRetainedEvents } from './restore-events.mjs';
import { captureAnswerCitation, validateAnswerCitations } from './citations.mjs';
import { createAutomaticMemory } from './automatic-memory.mjs';
import { compactionPolicyHash, validateRetainedCompaction } from './retained-compaction.mjs';
import { defaultWorkspaceOwner as defaultOwner, resetStorageSchema as resetSchema, storageKey, workspaceStorageKey,
  sharedWorkspaceStorageKeys as sharedKeys, isWorkspaceResetMarker as resetMarker, clearWorkspaceStorage } from '../session-storage.mjs';

export { storageKey, workspaceStorageKey, clearWorkspaceStorage };
export async function createWorkspace({ adapter, core, storage, graphEnabled = true, automaticMemoryEnabled = true, getControllerState,
  actorId = defaultOwner.actorId, personaId = defaultOwner.personaId, conversationId = defaultOwner.conversationId }) {
  if (typeof personaId !== 'string' || !personaId.trim() || personaId.length > 200) throw Error('Invalid persona identity.');
  const ownerScope = Object.freeze({ actorId, personaId, conversationId });
  const ownStorageKey = workspaceStorageKey(ownerScope);
  const [personaKey, globalKey] = sharedKeys(ownerScope);
  let ownBaseline = storage?.getItem(ownStorageKey) ?? null;
  let resetEpoch;
  if (ownBaseline) {
    if (ownBaseline.length > 2_000_000) throw Error('Saved local conversation exceeds its preview bound.');
    const marker = JSON.parse(ownBaseline);
    if (marker.schema === resetSchema) {
      if (!resetMarker(marker, ownerScope)) throw Error('Saved local reset marker is invalid.');
      if (marker.pending) {
        const recover = async () => {
          // The marker read before waiting is only a recovery request. Another
          // tab may have completed it and saved a fresh chat while we waited.
          const current = storage.getItem(ownStorageKey);
          if (current?.length > 2_000_000) throw Error('Saved local conversation exceeds its preview bound.');
          const durable = current ? JSON.parse(current) : null;
          if (durable?.schema === resetSchema) {
            if (!resetMarker(durable, ownerScope)) throw Error('Saved local reset marker is invalid.');
            if (durable.pending) {
              if (durable.epoch !== marker.epoch) throw Error('Local reset changed while waiting. Reload before retrying recovery.');
              const result = clearWorkspaceStorage({ storage, owner: ownerScope, epoch: durable.epoch });
              if (!result.cleared) throw Error('Local reset could not finish: ' + result.error);
            }
          }
          ownBaseline = storage.getItem(ownStorageKey);
        };
        if (typeof navigator !== 'undefined' && navigator.locks?.request) await navigator.locks.request('rag-local-memory:' + actorId, recover);
        else await recover();
      }
    }
    const durable = ownBaseline ? JSON.parse(ownBaseline) : null;
    if (durable?.schema === resetSchema) {
      if (!resetMarker(durable, ownerScope) || durable.pending) throw Error('Saved local reset marker is invalid or incomplete.');
      resetEpoch = durable.epoch;
    } else if (durable?.resetEpoch !== undefined) {
      if (typeof durable.resetEpoch !== 'string' || !durable.resetEpoch || durable.resetEpoch.length > 100) throw Error('Saved local reset epoch is invalid.');
      resetEpoch = durable.resetEpoch;
    }
  }
  let personaBaseline = storage?.getItem(personaKey) ?? null, globalBaseline = storage?.getItem(globalKey) ?? null;
  let closed = false, clearPending = false, lifecycle = 0, clearPromise;
  const requireActive = () => {
    if (closed || clearPending) throw new DOMException('This workspace was closed or cleared. Reload to continue.', 'AbortError');
    if (storage) {
      const retained = storage.getItem(ownStorageKey), current = retained ? JSON.parse(retained) : null;
      const currentEpoch = current?.schema === resetSchema ? current.epoch : current?.resetEpoch;
      if (currentEpoch !== resetEpoch) throw Error('This conversation changed or was cleared in another tab. Reload before using it.');
    }
  };
  const ensureSharedFresh = () => {
    requireActive();
    if (storage && (storage.getItem(personaKey) !== personaBaseline || storage.getItem(globalKey) !== globalBaseline)) {
      throw Error('Shared memory changed in another workspace. Reload before using or saving memory.');
    }
  };
  const conversation = createConversationStore({ actorId, conversationId });
  const events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const answerCitations = [];
  let saved;
  const serialized = ownBaseline;
  if (serialized) {
    if (serialized.length > 2_000_000) throw Error('Saved local conversation exceeds its preview bound.');
    saved = JSON.parse(serialized);
    if (resetMarker(saved, ownerScope)) saved = undefined;
    if (saved) {
    if (saved.schema !== 'private-one-chat-memory/v1' || !Array.isArray(saved.events)) throw Error('Saved local memory format is unsupported.');
    if (saved.owner && JSON.stringify(saved.owner) !== JSON.stringify(ownerScope)
      || !saved.owner && ownStorageKey !== storageKey) throw Error('Saved conversation belongs to another memory scope.');
    conversation.importState(saved.conversation);
    await memory.importState(saved.memory);
    await validateRetainedEvents({ events: saved.events, conversation: conversation.snapshot(), records: memory.snapshot().records });
    // Legacy v1 snapshots have no citation annotations. Do not invent history.
    answerCitations.push(...await validateAnswerCitations({ citations: 'answerCitations' in saved ? saved.answerCitations : [],
      conversation: conversation.snapshot(), records: memory.snapshot().records, events: saved.events }));
    // Replay validated retained events, not fabricated display activity.
    for (const event of saved.events) {
      const { id, seq, ...data } = event;
      const restored = events.append(data);
      if (restored.id !== id || restored.seq !== seq) throw Error('Saved event sequence is invalid.');
    }
    }
  }
  let panel, persistenceError, automaticMemory;
  let persistenceQueue = Promise.resolve();
  const commitPersistence = async issuedLifecycle => {
    if (closed || clearPending || lifecycle !== issuedLifecycle) return { durable: false, stale: true, error: 'Workspace was closed or cleared; this save was cancelled.' };
    if (storage) {
      try {
        requireActive();
        if (automaticMemory) ensureSharedFresh();
        const value = JSON.stringify({ schema: 'private-one-chat-memory/v1', owner: ownerScope, ...(resetEpoch ? { resetEpoch } : {}),
          conversation: conversation.exportState(), memory: memory.exportState(), events: events.list(), answerCitations,
          contextCompaction: context.exportCompaction(),
          ...(automaticMemory ? { automaticMemoryPolicy: automaticMemory.exportPolicy() } : {}) });
        if (value.length > 2_000_000) throw Error('Local preview storage limit reached.');
        storage.setItem(ownStorageKey, value); ownBaseline = value;
        if (automaticMemory) {
          const persona = automaticMemory.exportPersona(), global = automaticMemory.exportGlobal();
          storage.setItem(personaKey, persona); personaBaseline = persona;
          storage.setItem(globalKey, global); globalBaseline = global;
        }
        persistenceError = undefined;
      } catch (error) { persistenceError = error; }
    }
    panel?.refresh();
    return { durable: Boolean(storage) && !persistenceError, error: persistenceError?.message };
  };
  const persist = () => {
    const issuedLifecycle = lifecycle;
    const commit = () => typeof navigator !== 'undefined' && navigator.locks?.request
      ? navigator.locks.request('rag-local-memory:' + actorId, () => commitPersistence(issuedLifecycle)) : commitPersistence(issuedLifecycle);
    const result = persistenceQueue.then(commit); persistenceQueue = result.catch(() => {}); return result;
  };
  if (automaticMemoryEnabled) automaticMemory = await createAutomaticMemory({ ownerScope, conversation, memory, core,
    policyState: saved?.automaticMemoryPolicy, personaState: personaBaseline ?? undefined,
    globalState: globalBaseline ?? undefined, ensureSharedFresh, persist });
  const unsubscribeConversation = conversation.subscribe(() => automaticMemory?.notify());
  const retrieval = createRetrieval({ core, onEvent: event => events.append(event) });
  const retainedCompaction = await validateRetainedCompaction({ retained: saved?.contextCompaction, conversation: conversation.snapshot(),
    events: events.list(), owner: ownerScope, policyHash: await compactionPolicyHash(JSON.stringify(memory.snapshot().records), automaticMemory?.retentionIdentity()),
    protectedTurnIds: [...memory.snapshot().records.flatMap(record => record.sourceTurnIds), ...(automaticMemory?.getBlockedTurnIds() ?? [])] });
  const context = createContextManager({ conversation, memory, retrieval, core, automaticMemory, retainedCompaction, ownerScope,
    measure: (messages, options) => adapter.measure(messages, options), events, getControllerState });
  const graph = graphEnabled ? createMemoryGraph(events) : undefined;
  const workspace = {
    conversation, memory, retrieval, context, events, graph, automaticMemory, ownerScope,
    provider: { ...adapter, reply: (messages, options) => {
      requireActive();
      const requestSha256 = context.inspectionSnapshot().latestPrepared?.requestSha256;
      const failed = error => { context.replyFailed({ requestSha256, cancelled: error?.name === 'AbortError' }); throw error; };
      try { return Promise.resolve(adapter.reply(messages, { ...options,
        beforeDispatch: () => { requireActive(); return context.validateDispatch(messages); }, onDispatch: () => { requireActive(); return context.dispatched(messages); } })).catch(failed); }
      catch (error) { return failed(error); }
    } },
    prepare: options => { requireActive(); return context.prepare(options); },
    sourcesForAnswer: answerTurnId => structuredClone(answerCitations.find(item => item.answerTurnId === answerTurnId)?.sources || []),
    async captureAnswerSources({ answerTurnId, requestSha256 }) {
      requireActive();
      const annotation = await captureAnswerCitation({ answerTurnId, requestSha256,
        conversation: conversation.snapshot(), records: memory.snapshot().records, events: events.list() });
      requireActive();
      if (annotation && !answerCitations.some(item => item.answerTurnId === answerTurnId)) answerCitations.push(annotation);
      context.bindReply({ answerTurnId, requestSha256 });
      return this.sourcesForAnswer(answerTurnId);
    },
    persist,
    clear() {
      if (clearPromise) return clearPromise;
      clearPending = true; ++lifecycle;
      workspace.dispose();
      const clear = () => clearWorkspaceStorage({ storage, owner: ownerScope });
      clearPromise = persistenceQueue.then(() => typeof navigator !== 'undefined' && navigator.locks?.request
        ? navigator.locks.request('rag-local-memory:' + actorId, clear) : clear())
        .catch(error => ({ cleared: false, durable: false, error: error.message })).then(result => {
        if (!result.cleared) clearPromise = undefined; // An explicit retry can finish a pending reset.
        return result;
      });
      return clearPromise;
    },
    attachPanel(value) { panel = value; panel.refresh(); },
    refresh: () => panel?.refresh(),
    dispose() { if (closed) return; closed = true; ++lifecycle; unsubscribeConversation(); context.dispose(); automaticMemory?.dispose(); graph?.dispose(); panel?.dispose(); panel = undefined; },
  };
  return workspace;
}
