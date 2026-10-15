import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { extractStructuredContext } from '../examples/browser-model-chat/memory/structured-context.mjs';

const hashText = async text => createHash('sha256').update(text, 'utf8').digest('hex');
const extract = (turns, options = {}) => extractStructuredContext(turns, { hashText, ...options });
const user = (id, content) => ({ id, role: 'user', content });
const assistant = (id, content) => ({ id, role: 'assistant', content });

test('marked lines beyond 120 codepoints in four older turns survive without narrative truncation', async () => {
  const turns = [
    user('t-0001', 'Unmarked preface. '.repeat(12) + '\nFact[Codename]: Amber\nMore unmarked prose.'),
    user('t-0002', 'Another unrelated preface. '.repeat(10) + '\nConstraint[Budget]: At most 42 credits'),
    user('t-0003', 'Fact[City]: Bristol'), user('t-0004', 'Fact[Delivery]: Tuesday'),
  ];
  const before = JSON.stringify(turns), context = await extract(turns);
  assert.equal(context.strategy, 'source-linked-structured-extractive-v1');
  assert.deepEqual(context.items.map(item => item.key), ['codename', 'budget', 'city', 'delivery']);
  assert.ok(context.items[0].offsets.start > 120 && context.items[1].offsets.start > 120);
  assert.ok(context.items.every(item => context.text.includes(item.quote)));
  assert.doesNotMatch(context.text, /Unmarked preface|More unmarked prose/);
  assert.match(context.text, /Only explicitly marked user lines retained; incomplete derived context, not independently verified; original transcript preserved/);
  assert.equal(context.coverage.inputTurnCount, 4); assert.equal(context.coverage.retainedItemCount, 4);
  assert.equal(context.coverage.omittedUnmarkedLineCount, 3); assert.equal(context.coverage.omittedUnmarkedTurnCount, 2);
  assert.equal(context.coverage.allActiveDeclaredItemsRetained, true); assert.equal(context.coverage.completeConversation, false);
  assert.equal(context.contentHash, await hashText(context.text)); assert.equal(JSON.stringify(turns), before);
});

test('explicit corrections replace active values and retain hash-only supersession lineage', async () => {
  const turns = [user('t-0001', 'Fact[Delivery]: Tuesday'), user('t-0002', 'Constraint[Budget]: 42 credits'),
    user('t-0003', 'Correction[DELIVERY]: Thursday'), user('t-0004', 'Correction[Budget]: 36 credits')];
  const context = await extract(turns);
  assert.deepEqual(context.items.map(item => [item.key, item.kind, item.value]), [['delivery', 'fact', 'Thursday'], ['budget', 'constraint', '36 credits']]);
  assert.doesNotMatch(context.text, /Tuesday|42 credits/);
  assert.match(context.text, /Correction\[DELIVERY\]: Thursday/);
  for (const item of context.items) {
    assert.equal(item.lineage.length, 2); assert.equal(item.sourceRefs.length, 1);
    for (const reference of item.lineage) {
      const source = turns.find(turn => turn.id === reference.turnId);
      const quote = source.content.slice(reference.offsets.start, reference.offsets.end);
      assert.equal(reference.turnHash, await hashText(source.content)); assert.equal(reference.lineHash, await hashText(quote));
      assert.equal('quote' in reference, false); assert.equal('value' in reference, false);
    }
  }
});

test('identical declarations deduplicate references across turns and casefolded keys share one namespace', async () => {
  const turns = [user('t-0001', 'Fact[City]: Bristol\nFact[City]: Bristol'), user('t-0002', 'Fact[City]: Bristol'),
    user('t-0003', 'Fact[CITY]: Bristol')];
  const context = await extract(turns);
  assert.equal(context.items.length, 1); assert.equal(context.items[0].quote, 'Fact[City]: Bristol');
  assert.equal(context.items[0].sourceRefs.length, 4); assert.equal(context.coverage.deduplicatedLineCount, 3);
  assert.deepEqual(context.items[0].sourceRefs.map(reference => reference.turnId), ['t-0001', 't-0001', 't-0002', 't-0003']);
  assert.notEqual(context.items[0].sourceRefs[0].offsets.start, context.items[0].sourceRefs[1].offsets.start);
  assert.equal(context.text.match(/Fact\[City\]: Bristol/g).length, 1);
});

test('conflicts, cross-kind collisions and unknown corrections fail closed without choosing a value', async () => {
  for (const turns of [[user('t-0001', 'Fact[City]: Bristol'), user('t-0002', 'Fact[CITY]: Paris')],
    [user('t-0001', 'Fact[City]: Bristol'), user('t-0002', 'Constraint[city]: Bristol')]]) {
    const before = JSON.stringify(turns);
    await assert.rejects(extract(turns), error => error.code === 'STRUCTURED_CONTEXT_CONFLICT' && /Correction\[city\]/.test(error.message) && !/Paris|Bristol/.test(error.message));
    assert.equal(JSON.stringify(turns), before);
  }
  await assert.rejects(extract([user('t-0001', 'Correction[City]: Paris')]), error => error.code === 'STRUCTURED_CONTEXT_UNKNOWN_CORRECTION');
  await assert.rejects(extract([user('t-0001', 'Fact[9invalid]: Paris')]), /Malformed/);
  await assert.rejects(extract([user('t-0001', 'Fact[City]:   ')]), /nonempty/);
});

test('item count, whole-quote and rendered total limits never silently discard active declarations', async () => {
  const turns = [user('t-0001', 'Fact[City]: Bristol\nFact[Delivery]: Thursday')];
  const before = JSON.stringify(turns);
  for (const options of [{ maxItems: 1 }, { maxItemCodepoints: 10 }, { maxTotalCodepoints: 100 }]) {
    await assert.rejects(extract(turns, options), error => error.code === 'STRUCTURED_CONTEXT_LIMIT' && /not truncated|none were truncated/.test(error.message));
    assert.equal(JSON.stringify(turns), before);
  }
  const valid = await extract(turns);
  await assert.rejects(extract(turns, { maxTotalCodepoints: valid.coverage.totalTextCodepoints - 1 }), /limit/);
  const exact = await extract(turns, { maxItems: 2, maxItemCodepoints: 24, maxTotalCodepoints: valid.coverage.totalTextCodepoints });
  assert.deepEqual(exact, valid);
});

test('protected user sources and all assistant declarations are excluded without admitting alternate facts', async () => {
  const turns = [user('t-0001', 'Fact[Secret]: protected value'), assistant('t-0002', 'Fact[City]: invented city\nCorrection[Budget]: 99'),
    user('t-0003', 'Constraint[Budget]: 42 credits')];
  const context = await extract(turns, { protectedTurnIds: ['t-0001'] });
  assert.deepEqual(context.items.map(item => item.key), ['budget']);
  assert.doesNotMatch(context.text, /protected value|invented city|99/);
  assert.equal(context.coverage.protectedTurnCount, 1); assert.equal(context.coverage.ignoredAssistantTurnCount, 1);
  assert.deepEqual(context.sources.map(source => source.turnId), ['t-0001', 't-0002', 't-0003'], 'omitted originals retain hash lineage only');
  await assert.rejects(extract([turns[0], user('t-0004', 'Correction[Secret]: new value')], { protectedTurnIds: new Set(['t-0001']) }), /no earlier eligible/);
});

test('Unicode and CRLF offsets slice exact whole lines and retain matching full-turn and quote hashes', async () => {
  const prefix = '🍵 cafe\u0301 unmarked preface\r\n';
  const quote = 'Fact[Greeting]: Hello 👩‍💻 cafe\u0301  ';
  const turns = [user('t-0001', prefix + quote + '\r\nConstraint[Mode]: quiet\r\n')];
  const context = await extract(turns), item = context.items[0];
  assert.deepEqual(item.offsets, { start: prefix.length, end: prefix.length + quote.length, unit: 'utf16' });
  assert.equal(turns[0].content.slice(item.offsets.start, item.offsets.end), quote);
  assert.equal(item.quote, quote); assert.equal(item.turnHash, await hashText(turns[0].content));
  assert.equal(item.sourceRefs[0].lineHash, await hashText(quote));
  assert.equal(context.coverage.totalTextCodepoints, [...context.text].length);
  assert.equal(context.excerpts[0].text, quote); assert.equal(context.excerpts[0].truncated, false);
  assert.throws(() => { item.lineage[0].offsets.start = 0; }, TypeError);
});

test('no eligible declarations returns null for the caller-owned labeled fallback; hash and input failures stay explicit', async () => {
  assert.equal(await extract([user('t-0001', 'Plain narrative only.'), assistant('t-0002', 'Fact[City]: not authored')]), null);
  assert.equal(await extract([user('t-0001', 'Fact[Secret]: omitted')], { protectedTurnIds: ['t-0001'] }), null);
  assert.equal(await extract([]), null);
  await assert.rejects(extract([user('t-0001', 'Fact[City]: Bristol')], { hashText: async () => 'not a hash' }), /SHA-256 digest/);
  await assert.rejects(extract([user('t-0001', 'Fact[City]: Bristol')], { hashText: async () => { throw Error('Injected hash failure'); } }), /Injected hash failure/);
  await assert.rejects(extract([user('t-0001', 'Fact[City]: Bristol'), user('t-0001', 'duplicate ID')]), /distinct canonical/);
  await assert.rejects(extract([user('t-0001', 'Fact[City]: Bristol')], { maxItems: 0 }), /positive integers/);
});
