// Real workspace, source stores, RAG and request assembly. All meters and
// replies here are explicitly NONNATIVE fixtures; no model is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';

const core = await import(pathToFileURL(resolve(process.env.BROWSER_MEMORY_CORE_MODULE?.trim() || '.artifacts/memory/rag-core.mjs')).href);
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const reportedConversation = [
  ['hello', 'hello! How can I assist you today?'],
  ['whats your name?', "I don't have a personal name..."],
  ['Your new name is Fred', 'Fred is a name that could be used for various purposes, such as a person, place, or concept...'],
  ['Just conversation is fine', 'No older user passage selected.'],
  ['what does that mean?', 'No evidence or context provided. Please provide the relevant information or context so I can assist you.'],
];
const append = (workspace, role, content) => workspace.conversation.append({ role, content });
const rawTurns = prepared => prepared.messages.filter(message => message.role !== 'system');
const text = prepared => prepared.messages.map(message => message.content).join('\n');
const memoryText = prepared => prepared.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
const metered = promptTokens => ({ promptTokens, contextTokens: 2048, overflow: promptTokens > 2048,
  meter: 'NONNATIVE prompt regression fixture', actualNativeTokenization: false });

async function fixture(t, { measure = () => metered(300) } = {}) {
  const calls = { measures: [], replies: [] };
  const adapter = {
    async measure(messages) { calls.measures.push(structuredClone(messages)); return measure(messages, calls.measures.length); },
    async reply(messages, options) {
      options.beforeDispatch?.(); calls.replies.push(structuredClone(messages)); options.onDispatch?.();
      return 'NONNATIVE fixture reply; no model execution';
    },
  };
  const workspace = await createWorkspace({ adapter, core, graphEnabled: false, getControllerState: () => ({ phase: 'ready' }) });
  t.after(() => workspace.dispose());
  return { workspace, calls };
}

async function dispatch(workspace, prepared, answer) {
  const returned = await workspace.provider.reply(prepared.messages);
  const turn = append(workspace, 'assistant', answer ?? returned);
  await workspace.captureAnswerSources({ answerTurnId: turn.id, requestSha256: prepared.measurement.requestSha256 });
  return turn;
}

test('reported five-exchange transcript keeps real roles with memory on and All to Conversation after Fred', async t => {
  for (const switchAfterFred of [false, true]) {
    const { workspace, calls } = await fixture(t);
    for (const [index, [user, reportedAnswer]] of reportedConversation.entries()) {
      if (switchAfterFred && index === 3) await workspace.automaticMemory.setScope('conversation');
      append(workspace, 'user', user);
      const canonical = workspace.conversation.snapshot().turns;
      const prepared = await workspace.prepare();
      assert.deepEqual(rawTurns(prepared), canonical.map(({ role, content }) => ({ role, content })), 'Matches the same direct conversation history used with memory off');
      assert.match(prepared.messages[0].content, /Continue the conversation/);
      assert.doesNotMatch(memoryText(prepared), /No older user passage selected|No saved evidence matched|If the answer is absent/);
      assert.deepEqual(prepared.memorySources, [], 'Still-present direct history is not duplicated as system memory');
      assert.equal(prepared.compaction, null); assert.equal(workspace.context.snapshot().cutoff, 0);
      const answer = await dispatch(workspace, prepared, reportedAnswer);
      assert.deepEqual(calls.replies.at(-1), prepared.messages);
      assert.equal(prepared.measurement.requestSha256, sha(JSON.stringify(prepared.messages)));
      assert.deepEqual(workspace.sourcesForAnswer(answer.id), []);
      const submitted = workspace.context.inspectionSnapshot().lastSubmitted;
      assert.deepEqual(submitted.exactMessages, prepared.messages); assert.equal(submitted.replyTurnId, answer.id);
      assert.equal(workspace.context.usageSnapshot().measurement.quality, 'fixture');
    }
    assert.equal(workspace.memory.snapshot().records.length, 0);
    assert.equal(workspace.automaticMemory.snapshot().nodes.some(node => node.scope === 'persona'), false);
  }
});

test('a presentation scope switch still invalidates an actual prepared dispatch', async t => {
  const { workspace, calls } = await fixture(t);
  append(workspace, 'user', 'Your new name is Fred'); append(workspace, 'assistant', 'We can use Fred in this chat.');
  append(workspace, 'user', 'Just conversation is fine');
  const prepared = await workspace.prepare(); await workspace.automaticMemory.setScope('conversation');
  await assert.rejects(workspace.provider.reply(prepared.messages), /no longer matches/);
  assert.equal(calls.replies.length, 0);
  const fresh = await workspace.prepare(); assert.equal(rawTurns(fresh).length, 3);
  assert.equal(workspace.context.snapshot().cutoff, 0); await dispatch(workspace, fresh);
  assert.equal(calls.replies.length, 1);
});

test('Persona and Global keep conversation authorization closed without erasing the All conversation tail', async t => {
  const { workspace } = await fixture(t);
  append(workspace, 'user', 'Your new name is Fred'); append(workspace, 'assistant', 'We can use Fred in this chat.');
  const latest = append(workspace, 'user', 'Just conversation is fine');
  for (const scope of ['persona', 'global']) {
    await workspace.automaticMemory.setScope(scope); const prepared = await workspace.prepare();
    assert.deepEqual(rawTurns(prepared), [{ role: latest.role, content: latest.content }]);
    assert.doesNotMatch(text(prepared), /Fred/); assert.equal(prepared.memorySources.some(hit => hit.scope === 'conversation'), false);
    assert.equal(workspace.context.snapshot().cutoff, 0, 'A temporary scope filter does not masquerade as a committed cutoff');
  }
  await workspace.automaticMemory.setScope('all');
  const prepared = await workspace.prepare(); assert.equal(rawTurns(prepared).length, 3); assert.match(text(prepared), /Fred/);
});

test('actual overflow prompt starts with a whole user exchange, has source-owned citations and no duplicate recent recall', async t => {
  const { workspace } = await fixture(t, { measure: (_messages, count) => metered(count === 1 ? 2100 : 400) });
  for (const [user, answer] of reportedConversation.slice(0, 4)) { append(workspace, 'user', user); append(workspace, 'assistant', answer); }
  append(workspace, 'user', reportedConversation[4][0]);
  const original = workspace.conversation.exportState(), prepared = await workspace.prepare(), raw = rawTurns(prepared);
  assert.equal(raw[0].role, 'user'); assert.deepEqual(raw.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(raw[0].content, 'Your new name is Fred'); assert.equal(raw.at(-1).content, 'what does that mean?');
  assert.equal(text(prepared).split('Your new name is Fred').length - 1, 1);
  assert.doesNotMatch(memoryText(prepared), /No older user passage selected|No saved evidence matched/);
  const summary = workspace.context.summarySnapshot(); assert.ok(summary?.sourceTurnIds.length);
  assert.equal(summary.summaryHash, sha(summary.text));
  for (const item of summary.items) {
    const source = workspace.conversation.snapshot().turns.find(turn => turn.id === item.turnId);
    assert.equal(source.role, 'user'); assert.equal(item.quote, source.content.slice(item.offsets.start, item.offsets.end));
    assert.equal(item.turnHash, sha(source.content));
  }
  assert.equal(workspace.conversation.exportState(), original, 'Preparation preserves the exact canonical transcript');
  const originalTurns = workspace.conversation.snapshot().turns;
  const answer = await dispatch(workspace, prepared), sources = workspace.sourcesForAnswer(answer.id);
  assert.ok(sources.length); assert.ok(sources.every(source => summary.sourceTurnIds.includes(source.turnId)));
  assert.equal(prepared.measurement.requestSha256, sha(JSON.stringify(prepared.messages)));
  assert.deepEqual(workspace.conversation.snapshot().turns.slice(0, -1), originalTurns, 'Only the accepted fixture reply is appended');
  assert.equal(workspace.events.list().filter(event => event.type === 'compacted').length, 1);
});

test('empty automatic extraction stays diagnostic and never becomes model prompt text or a retained pocket', async t => {
  const { workspace } = await fixture(t, { measure: (_messages, count) => metered(count === 1 ? 2100 : 400) });
  for (const [user, answer] of reportedConversation.slice(0, 4)) { append(workspace, 'user', user); append(workspace, 'assistant', answer); }
  append(workspace, 'user', 'Discuss orchids');
  const prepared = await workspace.prepare();
  assert.equal(workspace.context.snapshot().compacted.items.length, 0);
  assert.match(workspace.context.snapshot().compacted.text, /No older user passage selected/, 'Existing extractor diagnostics remain compatible');
  assert.doesNotMatch(memoryText(prepared), /No older user passage selected|Automatically selected exact older user passages|No saved evidence matched/);
  assert.equal(prepared.messages.filter(message => message.role === 'system').length, 1);
  assert.equal(workspace.context.summarySnapshot(), null); assert.deepEqual(prepared.extractiveSources, []);
  assert.equal(rawTurns(prepared)[0].role, 'user');
  const answer = await dispatch(workspace, prepared); assert.deepEqual(workspace.sourcesForAnswer(answer.id), []);
});

test('short reported transcript manual checks preserve history and return explicit source or measured no-reduction reasons', async t => {
  const { workspace, calls } = await fixture(t);
  for (const [user, answer] of reportedConversation.slice(0, 3)) { append(workspace, 'user', user); append(workspace, 'assistant', answer); }
  let original = workspace.conversation.exportState();
  assert.equal(workspace.context.manualCompactionStatus().eligible, true);
  await assert.rejects(workspace.context.compactNow(), error => error.code === 'MANUAL_COMPACTION_NO_SOURCE_CONTEXT');
  assert.equal(workspace.context.usageSnapshot().phase, 'error');
  assert.equal(workspace.context.usageSnapshot().errorCode, 'MANUAL_COMPACTION_NO_SOURCE_CONTEXT');
  assert.equal(workspace.conversation.exportState(), original); assert.equal(workspace.context.summarySnapshot(), null);
  for (const [user, answer] of reportedConversation.slice(3)) { append(workspace, 'user', user); append(workspace, 'assistant', answer); }
  original = workspace.conversation.exportState();
  await assert.rejects(workspace.context.compactNow(), error => {
    assert.equal(error.code, 'MANUAL_COMPACTION_NO_REDUCTION');
    assert.deepEqual(error.compactionCheck, { beforePromptTokens: 300, afterPromptTokens: 300, capacity: 2048, reserve: 160 }); return true;
  });
  assert.equal(workspace.conversation.exportState(), original); assert.equal(workspace.context.snapshot().cutoff, 0);
  assert.equal(workspace.events.list().some(event => event.type === 'compacted'), false); assert.equal(calls.replies.length, 0);
  assert.equal(workspace.context.usageSnapshot().errorCode, 'MANUAL_COMPACTION_NO_REDUCTION');
  append(workspace, 'user', 'Continue the conversation'); await workspace.prepare();
  assert.equal(workspace.context.usageSnapshot().phase, 'ready'); assert.equal(workspace.context.usageSnapshot().errorCode, null);
});

test('content correction and Forget still remove old authored values and generated echoes before scope changes', async t => {
  const { workspace } = await fixture(t);
  const old = append(workspace, 'user', 'The expedition codename is Amber.');
  const saved = await workspace.memory.save({ text: old.content, sourceTurnIds: [old.id], scope: { actorId: workspace.ownerScope.actorId, conversationId: workspace.ownerScope.conversationId }, modelSafe: true });
  append(workspace, 'assistant', 'The expedition codename is Amber.');
  const correction = append(workspace, 'user', 'The expedition codename is Copper.');
  await workspace.memory.correct({ recordId: saved.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  append(workspace, 'assistant', 'It used to be Amber and is now Copper.'); append(workspace, 'user', 'What is the expedition codename?');
  await workspace.automaticMemory.setScope('conversation'); const corrected = await workspace.prepare();
  assert.doesNotMatch(text(corrected), /Amber/); assert.deepEqual(corrected.evidence.map(hit => hit.text), [correction.content]);
  await workspace.memory.forget({ recordId: saved.id }); await workspace.automaticMemory.setScope('all');
  append(workspace, 'user', 'What is the expedition codename?'); const forgotten = await workspace.prepare();
  assert.doesNotMatch(text(forgotten), /Amber|Copper/); assert.deepEqual(forgotten.evidence, []);
  assert.equal(workspace.conversation.snapshot().turns.some(turn => turn.content === old.content), true);
});
