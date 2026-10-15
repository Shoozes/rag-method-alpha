import { createConversationStore, createMemoryStore } from './store.mjs';
import { createRetrieval } from './rag-adapter.mjs';
import { createEventStore, createMemoryGraph } from './events.mjs';
import { createContextManager } from './context.mjs';
import { validateRetainedEvents } from './restore-events.mjs';
import { captureAnswerCitation, validateAnswerCitations } from './citations.mjs';

export const storageKey = 'private-one-chat-memory-v1';
export async function createWorkspace({ adapter, core, storage, graphEnabled = true }) {
  const conversation = createConversationStore();
  const events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const answerCitations = [];
  const serialized = storage?.getItem(storageKey);
  if (serialized) {
    if (serialized.length > 2_000_000) throw Error('Saved local conversation exceeds its preview bound.');
    const saved = JSON.parse(serialized);
    if (saved.schema !== 'private-one-chat-memory/v1' || !Array.isArray(saved.events)) throw Error('Saved local memory format is unsupported.');
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
  const retrieval = createRetrieval({ core, onEvent: event => events.append(event) });
  const context = createContextManager({ conversation, memory, retrieval, core, measure: messages => adapter.measure(messages), events });
  const graph = graphEnabled ? createMemoryGraph(events) : undefined;
  let panel, persistenceError;
  const workspace = {
    conversation, memory, retrieval, context, events, graph,
    provider: { ...adapter, reply: (messages, options) => adapter.reply(messages, { ...options,
      beforeDispatch: () => context.validateDispatch(messages), onDispatch: () => context.dispatched(messages) }) },
    prepare: () => context.prepare(),
    sourcesForAnswer: answerTurnId => structuredClone(answerCitations.find(item => item.answerTurnId === answerTurnId)?.sources || []),
    async captureAnswerSources({ answerTurnId, requestSha256 }) {
      const annotation = await captureAnswerCitation({ answerTurnId, requestSha256,
        conversation: conversation.snapshot(), records: memory.snapshot().records, events: events.list() });
      if (annotation && !answerCitations.some(item => item.answerTurnId === answerTurnId)) answerCitations.push(annotation);
      return this.sourcesForAnswer(answerTurnId);
    },
    async persist() {
      if (storage) {
        try {
          const value = JSON.stringify({ schema: 'private-one-chat-memory/v1', conversation: conversation.exportState(), memory: memory.exportState(), events: events.list(), answerCitations });
          if (value.length > 2_000_000) throw Error('Local preview storage limit reached.');
          storage.setItem(storageKey, value); persistenceError = undefined;
        } catch (error) { persistenceError = error; }
      }
      panel?.refresh();
      return { durable: Boolean(storage) && !persistenceError, error: persistenceError?.message };
    },
    attachPanel(value) { panel = value; panel.refresh(); },
    refresh: () => panel?.refresh(),
    dispose() { graph?.dispose(); panel?.dispose(); },
  };
  return workspace;
}
