import { createConversationStore, createMemoryStore } from './store.mjs';
import { createRetrieval } from './rag-adapter.mjs';
import { createEventStore, createMemoryGraph } from './events.mjs';
import { createContextManager } from './context.mjs';
import { validateRetainedEvents } from './restore-events.mjs';
import { captureAnswerCitation, validateAnswerCitations } from './citations.mjs';
import { createAutomaticMemory } from './automatic-memory.mjs';

export const storageKey = 'private-one-chat-memory-v1';
const defaultOwner = { actorId: 'local-user', personaId: 'local-assistant', conversationId: 'local-chat' };
export const workspaceStorageKey = owner => Object.keys(defaultOwner).every(key => owner[key] === defaultOwner[key])
  ? storageKey : storageKey + ':' + JSON.stringify([owner.actorId, owner.personaId, owner.conversationId]);
export async function createWorkspace({ adapter, core, storage, graphEnabled = true, automaticMemoryEnabled = true, getControllerState,
  actorId = defaultOwner.actorId, personaId = defaultOwner.personaId, conversationId = defaultOwner.conversationId }) {
  if (typeof personaId !== 'string' || !personaId.trim() || personaId.length > 200) throw Error('Invalid persona identity.');
  const ownerScope = Object.freeze({ actorId, personaId, conversationId });
  const ownStorageKey = workspaceStorageKey(ownerScope);
  const personaKey = 'private-persona-memory-v1:' + JSON.stringify([actorId, personaId]);
  const globalKey = 'private-global-memory-v1:' + JSON.stringify([actorId]);
  let personaBaseline = storage?.getItem(personaKey) ?? null, globalBaseline = storage?.getItem(globalKey) ?? null;
  const ensureSharedFresh = () => {
    if (storage && (storage.getItem(personaKey) !== personaBaseline || storage.getItem(globalKey) !== globalBaseline)) {
      throw Error('Shared memory changed in another workspace. Reload before using or saving memory.');
    }
  };
  const conversation = createConversationStore({ actorId, conversationId });
  const events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const answerCitations = [];
  let saved;
  const serialized = storage?.getItem(ownStorageKey);
  if (serialized) {
    if (serialized.length > 2_000_000) throw Error('Saved local conversation exceeds its preview bound.');
    saved = JSON.parse(serialized);
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
  let panel, persistenceError, automaticMemory;
  let persistenceQueue = Promise.resolve();
  const commitPersistence = async () => {
    if (storage) {
      try {
        if (automaticMemory) ensureSharedFresh();
        const value = JSON.stringify({ schema: 'private-one-chat-memory/v1', owner: ownerScope,
          conversation: conversation.exportState(), memory: memory.exportState(), events: events.list(), answerCitations,
          ...(automaticMemory ? { automaticMemoryPolicy: automaticMemory.exportPolicy() } : {}) });
        if (value.length > 2_000_000) throw Error('Local preview storage limit reached.');
        storage.setItem(ownStorageKey, value);
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
    const commit = () => typeof navigator !== 'undefined' && navigator.locks?.request
      ? navigator.locks.request('rag-local-memory:' + actorId, commitPersistence) : commitPersistence();
    const result = persistenceQueue.then(commit); persistenceQueue = result.catch(() => {}); return result;
  };
  if (automaticMemoryEnabled) automaticMemory = await createAutomaticMemory({ ownerScope, conversation, memory, core,
    policyState: saved?.automaticMemoryPolicy, personaState: personaBaseline ?? undefined,
    globalState: globalBaseline ?? undefined, ensureSharedFresh, persist });
  const unsubscribeConversation = conversation.subscribe(() => automaticMemory?.notify());
  const retrieval = createRetrieval({ core, onEvent: event => events.append(event) });
  const context = createContextManager({ conversation, memory, retrieval, core, automaticMemory, measure: (messages, options) => adapter.measure(messages, options), events, getControllerState });
  const graph = graphEnabled ? createMemoryGraph(events) : undefined;
  const workspace = {
    conversation, memory, retrieval, context, events, graph, automaticMemory, ownerScope,
    provider: { ...adapter, reply: (messages, options) => {
      const requestSha256 = context.inspectionSnapshot().latestPrepared?.requestSha256;
      const failed = error => { context.replyFailed({ requestSha256, cancelled: error?.name === 'AbortError' }); throw error; };
      try { return Promise.resolve(adapter.reply(messages, { ...options,
        beforeDispatch: () => context.validateDispatch(messages), onDispatch: () => context.dispatched(messages) })).catch(failed); }
      catch (error) { return failed(error); }
    } },
    prepare: options => context.prepare(options),
    sourcesForAnswer: answerTurnId => structuredClone(answerCitations.find(item => item.answerTurnId === answerTurnId)?.sources || []),
    async captureAnswerSources({ answerTurnId, requestSha256 }) {
      const annotation = await captureAnswerCitation({ answerTurnId, requestSha256,
        conversation: conversation.snapshot(), records: memory.snapshot().records, events: events.list() });
      if (annotation && !answerCitations.some(item => item.answerTurnId === answerTurnId)) answerCitations.push(annotation);
      context.bindReply({ answerTurnId, requestSha256 });
      return this.sourcesForAnswer(answerTurnId);
    },
    persist,
    attachPanel(value) { panel = value; panel.refresh(); },
    refresh: () => panel?.refresh(),
    dispose() { unsubscribeConversation(); context.dispose(); automaticMemory?.dispose(); graph?.dispose(); panel?.dispose(); },
  };
  return workspace;
}
