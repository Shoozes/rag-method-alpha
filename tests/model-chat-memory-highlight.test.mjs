// Real workspace and keyword RAG; NONNATIVE meter only. No provider/model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace } from '../examples/browser-model-chat/memory/workspace.mjs';

const core = await import(pathToFileURL(resolve(process.env.BROWSER_MEMORY_CORE_MODULE?.trim() || '.artifacts/memory/rag-core.mjs')).href);
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const append = (workspace, content, role = 'user') => workspace.conversation.append({ role, content });
const used = workspace => workspace.automaticMemory.snapshot().usedNodeIds;
const dispatches = workspace => workspace.events.list().filter(event => event.type === 'context-dispatched');
const sourceIds = prepared => [...new Set(prepared.memorySources.map(source => source.nodeId))];
const sorted = values => [...values].sort();
const measured = { promptTokens: 300, contextTokens: 2048, overflow: false,
  actualNativeTokenization: false, meter: 'NONNATIVE highlight-test fixture' };

async function fixture(t, measure = () => measured) {
  const values = new Map(), calls = { measures: 0, provider: 0 };
  const workspace = await createWorkspace({ core,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    adapter: {
      async measure(messages, options) { calls.measures++; return measure(messages, options); },
      async reply() { calls.provider++; throw Error('This highlight test must never call a provider.'); },
    },
  });
  t.after(() => { workspace.dispose(); assert.equal(calls.provider, 0, 'no provider, runtime, or model execution'); });
  return { workspace, calls };
}

test('real user and generated-message search previews never mark request sources', async t => {
  const { workspace, calls } = await fixture(t);
  const authored = append(workspace, 'Fred owns a copper compass.');
  const generated = append(workspace, 'The generated response token is violetcapybara.', 'assistant');
  const first = await workspace.automaticMemory.search({ query: 'copper compass' });
  assert.ok(first.hits.some(hit => hit.nodeId === 'turn:' + authored.id && hit.role === 'user'));
  const second = await workspace.automaticMemory.search({ query: 'violetcapybara' });
  assert.ok(second.hits.some(hit => hit.nodeId === 'turn:' + generated.id && hit.role === 'assistant'));
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
  assert.equal(calls.measures, 0, 'search previews do not add tokenization or inference');
});

test('prepare and validation do not mark sources; a stale request cannot dispatch them', async t => {
  const { workspace } = await fixture(t);
  const source = append(workspace, 'Fred owns a copper compass.'); append(workspace, 'What does Fred own?');
  const prepared = await workspace.prepare();
  assert.ok(sourceIds(prepared).includes('turn:' + source.id));
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
  workspace.context.validateDispatch(prepared.messages);
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
  append(workspace, 'An additional accepted message changes the request binding.');
  assert.throws(() => workspace.context.validateDispatch(prepared.messages), /no longer matches/);
  assert.throws(() => workspace.context.dispatched(prepared.messages), /no longer matches/);
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
});

test('cancellation during the fixture meter cannot create last-request sources, including a late result', async t => {
  let entered, release;
  const measuring = new Promise(resolveEntered => { entered = resolveEntered; });
  const pending = new Promise(resolveMeasure => { release = resolveMeasure; });
  const { workspace } = await fixture(t, () => { entered(); return pending; });
  append(workspace, 'Fred owns a copper compass.'); append(workspace, 'What does Fred own?');
  const controller = new AbortController();
  const preparing = workspace.prepare({ signal: controller.signal });
  await measuring; controller.abort();
  await assert.rejects(preparing, { name: 'AbortError' });
  release(measured); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
});

test('cancellation after preparation prevents dispatch and meter failure never marks sources', async t => {
  const { workspace } = await fixture(t);
  append(workspace, 'Fred owns a copper compass.'); append(workspace, 'What does Fred own?');
  const controller = new AbortController();
  const prepared = await workspace.prepare({ signal: controller.signal }); controller.abort();
  assert.throws(() => workspace.context.dispatched(prepared.messages), /no longer matches|cancelled/i);
  assert.deepEqual(used(workspace), []); assert.deepEqual(dispatches(workspace), []);
  const { workspace: failing } = await fixture(t, () => { throw Error('NONNATIVE fixture meter failed'); });
  append(failing, 'Fred owns a copper compass.'); append(failing, 'What does Fred own?');
  await assert.rejects(failing.prepare(), /fixture meter failed/);
  assert.deepEqual(used(failing), []); assert.deepEqual(dispatches(failing), []);
});

test('successful dispatch marks exactly prepared Conversation, Persona, and Global IDs with the actual request binding', async t => {
  const { workspace } = await fixture(t);
  append(workspace, 'Fred owns a copper compass.');
  const persona = append(workspace, 'The persona beacon is quasarceladon.');
  await workspace.automaticMemory.pinPersona({ turnId: persona.id, text: persona.content });
  append(workspace, 'Find the copper compass, quasarceladon beacon, and Mars moons.');
  const prepared = await workspace.prepare();
  assert.deepEqual(new Set(prepared.memorySources.map(hit => hit.kind)), new Set(['conversation', 'persona', 'global']));
  assert.ok(prepared.memorySources.every(hit => hit.role !== 'assistant'));
  for (const hit of prepared.memorySources) assert.ok(prepared.messages[0].content.includes(JSON.stringify(hit.text)), 'the exact quoted hit is in the assembled request');
  assert.deepEqual(used(workspace), []); workspace.context.validateDispatch(prepared.messages);
  assert.deepEqual(used(workspace), []); workspace.context.dispatched(prepared.messages);
  assert.deepEqual(sorted(used(workspace)), sorted(sourceIds(prepared)));
  const [event] = dispatches(workspace); assert.equal(dispatches(workspace).length, 1);
  assert.equal(event.queryId, prepared.queryId); assert.equal(event.requestSha256, digest(JSON.stringify(prepared.messages)));
  assert.equal(event.requestSha256, prepared.measurement.requestSha256);
  assert.equal(event.conversationVersion, workspace.conversation.snapshot().version);
  const preview = await workspace.automaticMemory.search({ query: 'unmatchedvioletwhale' });
  assert.deepEqual(preview.hits, []); assert.deepEqual(sorted(used(workspace)), sorted(sourceIds(prepared)), 'a later search does not replace the last dispatched IDs');
  assert.throws(() => workspace.context.dispatched(prepared.messages), /no longer matches/);
  assert.equal(dispatches(workspace).length, 1);
  // Current limitations, not new event-schema requirements: Persona/Global
  // automatic IDs come from prepared.memorySources + the dispatch callback.
  // The existing event does not persist that full ID set; usedNodeIds has no
  // request SHA and is ephemeral. Dispatch is not proof of model attention.
  t.diagnostic('Exact automatic highlight IDs are proven at context.dispatched; no model-use, Worker acknowledgement, or persisted complete automatic-source event claim.');
});

test('compaction input coverage never becomes the dispatched retrieval highlight set', async t => {
  let measureCount = 0;
  const { workspace } = await fixture(t, () => ++measureCount === 1
    ? { ...measured, promptTokens: 2300, overflow: true } : measured);
  const source = append(workspace, 'Fred owns a copper compass.');
  const ignored = append(workspace, 'This generated aside is not authored evidence.', 'assistant');
  append(workspace, 'The garden contains pale tulips.'); append(workspace, 'An unrelated acknowledgement.', 'assistant');
  append(workspace, 'The delivery month is September.'); append(workspace, 'What does Fred own?');
  const prepared = await workspace.prepare();
  const compacted = workspace.events.list().find(event => event.type === 'compacted');
  assert.ok(prepared.compaction && compacted);
  assert.ok(compacted.sourceTurnIds.includes(ignored.id), 'coverage lists scanned inputs, including an ignored generated turn');
  assert.deepEqual(sourceIds(prepared), ['turn:' + source.id]);
  assert.deepEqual(used(workspace), [], 'compaction completion alone is not dispatch');
  workspace.context.validateDispatch(prepared.messages); workspace.context.dispatched(prepared.messages);
  assert.deepEqual(used(workspace), sourceIds(prepared));
  assert.equal(used(workspace).includes('turn:' + ignored.id), false);
  assert.ok(compacted.sourceTurnIds.some(id => !used(workspace).includes('turn:' + id)));
});
