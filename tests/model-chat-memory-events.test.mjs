import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMORY_EVENT_TYPES, createEventStore, createMemoryGraph } from '../examples/browser-model-chat/memory/events.mjs';

test('actual events have stable store identities, immutable snapshots and no input aliases', () => {
  const store = createEventStore();
  const input = { type: 'saved', recordId: 'm-1', sourceTurnIds: ['t-1'], detail: { text: 'Original source' } };
  const first = store.append(input);
  input.detail.text = 'Later mutation'; input.sourceTurnIds.push('t-2');
  assert.deepEqual(first, { type: 'saved', recordId: 'm-1', sourceTurnIds: ['t-1'], detail: { text: 'Original source' }, id: 'e-1', seq: 1 });
  assert.throws(() => { first.detail.text = 'Mutation'; }, TypeError);
  const before = store.list();
  assert.throws(() => before.push(first), TypeError);
  const second = store.append({ type: 'corrected', recordId: 'm-2', priorEventIds: [first.id], sourceTurnIds: ['t-3'] });
  assert.equal(second.id, 'e-2'); assert.equal(second.seq, 2);
  assert.equal(before.length, 1); assert.equal(store.list().length, 2);
  assert.equal(JSON.parse(JSON.stringify(store.list()))[0].detail.text, 'Original source');
});

test('all known types are accepted while forged identities, invalid references and invalid data leave no gaps', () => {
  const store = createEventStore();
  for (const type of MEMORY_EVENT_TYPES) store.append({ type });
  let getterCalls = 0;
  const accessor = { type: 'saved', get text() { getterCalls++; return 'not a plain value'; } };
  const cycle = { type: 'saved' }; cycle.self = cycle;
  const invalid = [null, [], 'saved', { type: 'invented' }, { type: 'saved', id: 'e-99' }, { type: 'saved', seq: 99 },
    { type: 'saved', sourceTurnIds: ['t-1', 't-1'] }, { type: 'saved', recordId: '' },
    { type: 'saved', priorEventIds: ['e-999'] }, { type: 'saved', detail: undefined }, { type: 'saved', value: NaN },
    { type: 'saved', value: Infinity }, { type: 'saved', value: 1n }, { type: 'saved', value: () => {} },
    { type: 'saved', value: new Date() }, { type: 'saved', value: [, 'hole'] }, cycle, accessor];
  for (const event of invalid) assert.throws(() => store.append(event));
  assert.equal(getterCalls, 0);
  assert.equal(store.list().length, MEMORY_EVENT_TYPES.length);
  assert.equal(store.append({ type: 'saved' }).seq, MEMORY_EVENT_TYPES.length + 1);
});

test('event byte, depth, collection and ledger limits fail before committing', () => {
  const store = createEventStore();
  let deep = 'leaf'; for (let i = 0; i < 10; i++) deep = { deep };
  for (const event of [{ type: 'saved', text: 'é'.repeat(9000) }, { type: 'saved', deep }, { type: 'recalled', recordIds: Array.from({ length: 257 }, (_, i) => `m-${i}`) }]) {
    assert.throws(() => store.append(event));
  }
  assert.equal(store.list().length, 0);
  for (let i = 0; i < 4096; i++) store.append({ type: 'saved' });
  assert.throws(() => store.append({ type: 'saved' }), RangeError);
  assert.equal(store.list().at(-1).seq, 4096);
});

test('observers run after commit; exceptions and unsubscriptions cannot change stored events', () => {
  const store = createEventStore(); const seen = [];
  const unsubscribe = store.subscribe(() => { throw new Error('Optional view broke'); });
  const secondUnsubscribe = store.subscribe(event => { assert.equal(store.list().at(-1), event); seen.push(event.id); });
  assert.equal(store.append({ type: 'saved' }).id, 'e-1');
  unsubscribe(); unsubscribe();
  store.append({ type: 'forgotten' });
  secondUnsubscribe(); store.append({ type: 'recalled' });
  assert.deepEqual(seen, ['e-1', 'e-2']); assert.equal(store.list().length, 3);
  assert.throws(() => store.subscribe({}), TypeError);
});

test('nested observer appends retain delivery order and rejected asynchronous observers are isolated', async () => {
  const store = createEventStore(); const seen = [];
  store.subscribe(event => {
    if (event.id === 'e-1') store.append({ type: 'forgotten', recordId: 'm-1', priorEventIds: [event.id] });
  });
  store.subscribe(async () => { throw new Error('Asynchronous view failed'); });
  store.subscribe(event => seen.push(event.id));
  const graph = createMemoryGraph(store);
  store.append({ type: 'saved', recordId: 'm-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, ['e-1', 'e-2']);
  assert.ok(graph.snapshot().links.some(link => link.source === 'e-2' && link.target === 'e-1' && link.kind === 'prior'));
  graph.dispose();
});

test('graph projects only explicit prior-event, record and source links; content does not imply affinity', () => {
  const store = createEventStore();
  const saved = store.append({ type: 'saved', recordId: 'm-1', sourceTurnIds: ['t-1'], text: 'Ada is allowed to use finance tools' });
  const graph = createMemoryGraph(store);
  const corrected = store.append({ type: 'corrected', recordId: 'm-2', recordIds: ['m-1'], sourceTurnIds: ['t-2'], priorEventIds: [saved.id], permissions: ['admin'] });
  store.append({ type: 'recalled', recordIds: ['m-2'], query: 'Ada finance admin', affinity: 'm-1' });
  const snapshot = graph.snapshot();
  assert.deepEqual(snapshot.nodes.map(node => node.id), ['e-1', 'record:m-1', 'turn:t-1', 'e-2', 'record:m-2', 'turn:t-2', 'e-3']);
  assert.equal(snapshot.links.length, 7);
  assert.ok(snapshot.links.some(link => link.source === corrected.id && link.target === saved.id && link.kind === 'prior'));
  assert.deepEqual(new Set(snapshot.links.map(link => link.kind)), new Set(['record', 'source', 'prior']));
  assert.ok(snapshot.nodes.every(node => !('permissions' in node) && !('text' in node) && !('affinity' in node)));
  assert.throws(() => snapshot.nodes.push({}), TypeError);
  assert.throws(() => { snapshot.links[0].target = 'invented'; }, TypeError);
});

test('forgotten records remain auditable history and disposal detaches graph without altering the ledger', () => {
  const store = createEventStore(); const graph = createMemoryGraph(store);
  const saved = store.append({ type: 'saved', recordId: 'm-1', sourceTurnIds: ['t-1'] });
  store.append({ type: 'forgotten', recordId: 'm-1', priorEventIds: [saved.id] });
  const before = graph.snapshot();
  assert.equal(before.nodes.filter(node => node.kind === 'event').length, 2);
  assert.equal(before.nodes.filter(node => node.kind === 'record').length, 1);
  graph.dispose(); graph.dispose();
  store.append({ type: 'context-dispatched', recordIds: [] });
  assert.deepEqual(graph.snapshot(), before);
  assert.equal(store.list().length, 3);
  const replacement = createMemoryGraph(store);
  assert.equal(replacement.snapshot().nodes.filter(node => node.kind === 'event').length, 3);
  replacement.dispose();
});

test('absent, active, failed and removed graph views produce identical stored event histories', () => {
  const histories = [];
  for (const mode of ['absent', 'active', 'failed', 'removed']) {
    const store = createEventStore();
    const graph = mode === 'active' || mode === 'removed' ? createMemoryGraph(store) : null;
    if (mode === 'failed') store.subscribe(() => { throw new Error('Graph rendering failure'); });
    store.append({ type: 'saved', recordId: 'm-1', sourceTurnIds: ['t-1'] });
    if (mode === 'removed') graph.dispose();
    store.append({ type: 'recalled', recordIds: ['m-1'] });
    store.append({ type: 'forgotten', recordId: 'm-1', priorEventIds: ['e-1'] });
    histories.push(store.list()); graph?.dispose();
  }
  for (const history of histories) assert.deepEqual(history, histories[0]);
});
