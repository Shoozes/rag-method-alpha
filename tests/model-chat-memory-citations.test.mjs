// Deterministic source/data binding fixtures; no inference or execution authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConversationStore, createMemoryStore } from '../examples/browser-model-chat/memory/store.mjs';
import { createEventStore } from '../examples/browser-model-chat/memory/events.mjs';
import { captureAnswerCitation, dispatchSources, validateAnswerCitations } from '../examples/browser-model-chat/memory/citations.mjs';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const clone = value => structuredClone(value);
const scope = { actorId: 'local-user', conversationId: 'local-chat' };
const invalid = /Answer citation binding is invalid/;
function reference(turn, quote, key) {
  const start = turn.content.indexOf(quote);
  return { key, turnId: turn.id, turnHash: sha(turn.content), offsets: { start, end: start + quote.length, unit: 'utf16' }, lineHash: sha(quote) };
}
async function fixture({ saved = true, structured = true } = {}) {
  const conversation = createConversationStore(), events = createEventStore();
  const memory = createMemoryStore({ conversation, onEvent: event => events.append(event) });
  const authored = conversation.append({ role: 'user', content: 'The delivery day is Tuesday.' });
  const record = saved ? await memory.save({ text: authored.content, sourceTurnIds: [authored.id], scope, modelSafe: true }) : undefined;
  const city = 'Fact[City]: The destination city is Bristol.', format = 'Constraint[format]: Answer in one short sentence.';
  const declared = conversation.append({ role: 'user', content: 'Prefix 😀\r\n' + city + '\r\n' + format + '\r\n' });
  conversation.append({ role: 'user', content: 'What is the delivery day and destination city?' });
  const requestSha256 = sha('fixture measured request');
  const event = events.append({ type: 'context-dispatched', queryId: 'q-1', recordIds: record ? [record.id] : [], versions: record ? [1] : [],
    sourceTurnIds: record ? [authored.id] : [], conversationVersion: 3, requestSha256, promptTokens: 130,
    ...(structured ? { contextSources: [reference(declared, city, 'city'), reference(declared, format, 'format')] } : {}) });
  const answer = conversation.append({ role: 'assistant', content: 'The delivery day is Tuesday and the destination city is Bristol.' });
  const input = () => ({ conversation: conversation.snapshot(), records: memory.snapshot().records, events: events.list() });
  return { conversation, memory, events, record, authored, declared, event, answer, requestSha256, input };
}
async function captured(data) { return captureAnswerCitation({ ...data.input(), answerTurnId: data.answer.id, requestSha256: data.requestSha256 }); }
async function mutable() {
  const data = await fixture();
  return { ...clone(data.input()), citations: [clone(await captured(data))] };
}

test('capture and serialized reload preserve ordered saved/structured sources without copied text', async () => {
  const data = await fixture(), before = data.memory.exportState();
  const citation = await captured(data), sources = await dispatchSources({ event: data.event, ...data.input() });
  assert.deepEqual(Object.keys(citation), ['answerTurnId', 'answerHash', 'dispatchEventId', 'sources']);
  assert.equal(citation.answerHash, sha(data.answer.content)); assert.equal(citation.dispatchEventId, data.event.id);
  assert.deepEqual(citation.sources, sources); assert.deepEqual(sources.map(source => source.kind), ['saved-record', 'structured', 'structured']);
  assert.deepEqual(sources[0], { kind: 'saved-record', recordId: data.record.id, version: 1, turnId: data.authored.id, turnHash: sha(data.authored.content) });
  assert.equal(sources[1].offsets.start, data.declared.content.indexOf('Fact[City]'));
  assert.equal(sources[1].offsets.unit, 'utf16');
  assert.equal('quote' in sources[1], false); assert.equal('text' in sources[0], false);
  assert.equal(Object.isFrozen(citation), true); assert.equal(Object.isFrozen(citation.sources[1].offsets), true);
  assert.throws(() => { citation.sources[0].version = 9; }, TypeError);
  const stored = JSON.parse(JSON.stringify({ answerCitations: [citation], ...data.input() }));
  const validated = await validateAnswerCitations({ citations: stored.answerCitations, ...stored });
  assert.deepEqual(validated, [citation]); assert.equal(Object.isFrozen(validated), true);
  stored.answerCitations[0].sources[1].key = 'changed';
  assert.equal(validated[0].sources[1].key, 'city'); assert.equal(data.memory.exportState(), before);
});

test('absent additive field and old dispatches do not fabricate annotations or structured sources', async () => {
  const old = await fixture({ structured: false });
  assert.deepEqual(await validateAnswerCitations(old.input()), []);
  const annotation = await captured(old);
  assert.equal(annotation.sources.length, 1); assert.equal(annotation.sources[0].kind, 'saved-record');
  const empty = await fixture({ saved: false, structured: false });
  assert.equal(await captured(empty), null);
  assert.deepEqual(await dispatchSources({ event: empty.event, ...empty.input() }), []);
  await assert.rejects(validateAnswerCitations({ ...empty.input(), citations: [{ answerTurnId: empty.answer.id,
    answerHash: sha(empty.answer.content), dispatchEventId: empty.event.id, sources: [] }] }), invalid);
  await assert.rejects(validateAnswerCitations({ ...old.input(), citations: null }), invalid);
});

test('v1 and v2 citations remain historical after correction and forgetting without reviving retrieval', async () => {
  const data = await fixture({ structured: false }), one = await captured(data);
  const correction = data.conversation.append({ role: 'user', content: 'The delivery day is Thursday.' });
  await data.memory.correct({ recordId: data.record.id, expectedVersion: 1, text: correction.content, sourceTurnIds: [correction.id] });
  data.conversation.append({ role: 'assistant', content: 'Correction acknowledged.' });
  data.conversation.append({ role: 'user', content: 'What is the current delivery day?' });
  const requestSha256 = sha('second measured request');
  data.events.append({ type: 'context-dispatched', queryId: 'q-2', recordIds: [data.record.id], versions: [2], sourceTurnIds: [correction.id],
    conversationVersion: 7, requestSha256, promptTokens: 90 });
  const answer = data.conversation.append({ role: 'assistant', content: 'The delivery day is Thursday.' });
  const two = await captureAnswerCitation({ ...data.input(), answerTurnId: answer.id, requestSha256 });
  await data.memory.forget({ recordId: data.record.id });
  const before = data.memory.exportState(), restored = await validateAnswerCitations({ ...data.input(), citations: JSON.parse(JSON.stringify([one, two])) });
  assert.deepEqual(restored.map(citation => citation.sources[0].version), [1, 2]);
  assert.deepEqual(restored.map(citation => citation.sources[0].turnId), [data.authored.id, correction.id]);
  assert.deepEqual(data.memory.snapshot().records.map(record => record.status), ['superseded', 'superseded', 'forgotten']);
  assert.deepEqual(data.memory.active(scope), []); assert.equal(data.memory.exportState(), before);
});

test('answer changes, wrong role, duplicate annotations and unexpected annotation/source fields fail', async () => {
  const base = await mutable();
  for (const mutate of [
    value => { value.conversation.turns[3].content = 'Changed answer.'; },
    value => { value.conversation.turns[3].role = 'user'; },
    value => { value.citations[0].answerHash = sha('wrong answer'); },
    value => { value.citations[0].answerTurnId = 'unknown'; },
    value => { value.citations.push(clone(value.citations[0])); },
    value => { value.citations[0].text = 'Copied generated answer'; },
    value => { value.citations[0].sources[0].quote = 'Copied fact'; },
    value => { value.citations[0].sources[1].offsets.extra = true; },
    value => { value.citations[0].sources.reverse(); },
    value => { value.citations[0].sources.pop(); },
    value => { value.citations[0].dispatchEventId = 'missing'; },
  ]) { const value = clone(base); mutate(value); await assert.rejects(validateAnswerCitations(value), invalid); }
  await assert.rejects(validateAnswerCitations({ ...base, citations: Array(2001).fill(base.citations[0]) }), invalid);
});

test('selected historical record text, version, hashes, scope and safety cannot be tampered', async () => {
  const base = await mutable();
  for (const mutate of [
    value => { value.records[0].text = 'Invented text.'; },
    value => { value.records[0].contentHash = sha('wrong text'); },
    value => { value.records[0].sourceHashes[0].contentHash = sha('wrong source'); },
    value => { value.records[0].sourceHashes[0].turnId = 't-0002'; },
    value => { value.records[0].scope.actorId = 'another-user'; },
    value => { value.records[0].scope.conversationId = 'another-chat'; },
    value => { value.records[0].modelSafe = false; },
    value => { value.records[0].status = 'forgotten'; },
    value => { value.records[0].version = 2; },
    value => { value.events.at(-1).versions = [99]; },
    value => { value.events.at(-1).recordIds = ['unknown']; },
    value => { value.records.push(clone(value.records[0])); },
    value => { value.events.at(-1).sourceTurnIds = ['t-0002']; },
  ]) { const value = clone(base); mutate(value); await assert.rejects(validateAnswerCitations(value), invalid); }
});

test('structured references reject altered whole-line offsets, keys, hashes, fields and limits', async () => {
  const data = await fixture({ saved: false });
  const base = { ...clone(data.input()), citations: [clone(await captured(data))] };
  for (const mutate of [
    reference => { reference.key = 'other'; },
    reference => { reference.key = 'City'; },
    reference => { reference.offsets.start++; },
    reference => { reference.offsets.end--; },
    reference => { reference.offsets.end += 2; },
    reference => { reference.offsets.start = -1; },
    reference => { reference.offsets.end = 999999; },
    reference => { reference.offsets.start += 0.5; },
    reference => { reference.offsets.unit = 'codepoints'; },
    reference => { reference.offsets.hidden = true; },
    reference => { reference.turnHash = sha('wrong turn'); },
    reference => { reference.lineHash = sha('wrong line'); },
    reference => { reference.quote = 'invented quote'; },
    reference => { reference.turnId = 'missing'; },
  ]) {
    const value = clone(base); mutate(value.events.at(-1).contextSources[0]);
    await assert.rejects(validateAnswerCitations(value), invalid);
  }
  for (const contextSources of [null, {}, Array(25).fill(data.event.contextSources[0]), [data.event.contextSources[0], data.event.contextSources[0]]]) {
    await assert.rejects(dispatchSources({ ...data.input(), event: { ...data.event, contextSources } }), invalid);
  }
});

test('declarations require whole user-authored lines, exact grammar, nonempty values and matching scope', async () => {
  const data = await fixture({ saved: false }), base = clone(data.input());
  for (const content of ['Fact[City]:', 'Fact[City]:   ', 'Fact[invalid key]: Bristol', 'Claim[City]: Bristol', 'Fact[City]: Bristol\nConstraint[format]: short']) {
    const value = clone(base), turn = value.conversation.turns[1]; turn.content = content;
    value.events.at(-1).contextSources = [{ key: 'city', turnId: turn.id, turnHash: sha(content), offsets: { start: 0, end: content.length, unit: 'utf16' }, lineHash: sha(content) }];
    await assert.rejects(dispatchSources({ ...value, event: value.events.at(-1) }), invalid);
  }
  for (const mutate of [
    value => { value.conversation.turns[1].role = 'assistant'; },
    value => { value.conversation.turns[1].actorId = 'another-user'; },
    value => { value.conversation.turns[1].conversationId = 'another-chat'; },
  ]) { const value = clone(base); mutate(value); await assert.rejects(dispatchSources({ ...value, event: value.events.at(-1) }), invalid); }
});

test('assistant and future user turns cannot become saved-record or structured sources', async () => {
  const base = await mutable();
  for (const role of ['assistant', 'user']) {
    const value = clone(base), future = value.conversation.turns[3]; future.role = role;
    const record = value.records[0]; record.text = future.content; record.contentHash = sha(future.content);
    record.sourceTurnIds = [future.id]; record.sourceHashes = [{ turnId: future.id, contentHash: sha(future.content) }];
    value.events.at(-1).sourceTurnIds = [future.id];
    await assert.rejects(validateAnswerCitations(value), invalid);
  }
  const value = clone(base); value.conversation.turns.push({ ...value.conversation.turns[2], id: 't-0005', content: 'Fact[city]: Future Bristol.' }); value.conversation.version++;
  const turn = value.conversation.turns.at(-1);
  value.events.at(-1).contextSources = [reference(turn, turn.content, 'city')];
  await assert.rejects(validateAnswerCitations(value), invalid);
});

test('dispatch needs a valid latest user query, canonical position, request hash and scope', async () => {
  const base = await mutable();
  for (const mutate of [
    event => { event.conversationVersion = 0; },
    event => { event.conversationVersion = 2; },
    event => { event.conversationVersion = 4; },
    event => { event.conversationVersion = 99; },
    event => { event.requestSha256 = 'invalid'; },
    event => { event.queryId = ''; },
    event => { event.promptTokens = 0; },
    event => { event.scope = null; },
    event => { event.scope = { actorId: 'other', conversationId: 'local-chat' }; },
  ]) { const value = clone(base); mutate(value.events.at(-1)); await assert.rejects(validateAnswerCitations(value), invalid); }
});

test('capture refuses missing or ambiguous dispatch matches and malformed ledgers', async () => {
  const data = await fixture();
  await assert.rejects(captureAnswerCitation({ ...data.input(), answerTurnId: data.answer.id, requestSha256: sha('another request') }), invalid);
  await assert.rejects(captureAnswerCitation({ ...data.input(), answerTurnId: data.authored.id, requestSha256: data.requestSha256 }), invalid);
  const events = [...data.events.list(), { ...data.event, id: 'e-99', seq: 99 }];
  await assert.rejects(captureAnswerCitation({ ...data.input(), events, answerTurnId: data.answer.id, requestSha256: data.requestSha256 }), invalid);
  await assert.rejects(validateAnswerCitations({ ...data.input(), events: [...data.events.list(), data.event], citations: [] }), invalid);
  const citations = [clone(await captured(data))];
  Object.defineProperty(citations[0], 'answerHash', { enumerable: true, get() { throw Error('Getter must not execute'); } });
  await assert.rejects(validateAnswerCitations({ ...data.input(), citations }), invalid);
});

async function passageFixture(content = 'Before the note: delivery to Bristol 🌲. Keep the answer short. After the note.') {
  const conversation = createConversationStore(), events = createEventStore();
  const turn = conversation.append({ role: 'user', content });
  conversation.append({ role: 'user', content: 'What delivery instructions apply?' });
  const quote = content.includes('delivery to') ? 'delivery to Bristol 🌲.' : content;
  const source = reference(turn, quote, 'passage-1');
  const requestSha256 = sha('exact passage request');
  const event = events.append({ type: 'context-dispatched', queryId: 'q-1', recordIds: [], versions: [], sourceTurnIds: [],
    conversationVersion: 2, requestSha256, promptTokens: 100, extractiveSources: [source] });
  const answer = conversation.append({ role: 'assistant', content: 'Delivery is to Bristol.' });
  const input = { conversation: conversation.snapshot(), records: [], events: events.list() };
  return { turn, event, answer, requestSha256, input };
}

test('ordinary mid-line exact passages capture and round-trip without declaration grammar or copied text', async () => {
  const data = await passageFixture();
  const citation = await captureAnswerCitation({ ...data.input, answerTurnId: data.answer.id, requestSha256: data.requestSha256 });
  assert.deepEqual(citation.sources, [{ kind: 'extractive', ...data.event.extractiveSources[0] }]);
  assert.ok(citation.sources[0].offsets.start > 0 && citation.sources[0].offsets.end < data.turn.content.length);
  assert.equal('quote' in citation.sources[0], false); assert.equal(Object.isFrozen(citation.sources[0].offsets), true);
  assert.deepEqual(await validateAnswerCitations({ ...JSON.parse(JSON.stringify(data.input)), citations: JSON.parse(JSON.stringify([citation])) }), [citation]);
  const mixed = await fixture(), input = clone(mixed.input());
  const sourceTurn = input.conversation.turns[0];
  input.events.at(-1).extractiveSources = [reference(sourceTurn, 'delivery day', 'passage-1')];
  const sources = await dispatchSources({ ...input, event: input.events.at(-1) });
  assert.deepEqual(sources.map(source => source.kind), ['saved-record', 'structured', 'structured', 'extractive']);
});

test('extractive offsets cannot split surrogate pairs even when the forged slice hash matches', async () => {
  const data = await passageFixture(), split = data.turn.content.indexOf('🌲');
  for (const offsets of [{ start: split + 1, end: split + 2 }, { start: split, end: split + 1 }]) {
    const event = clone(data.event), source = event.extractiveSources[0];
    source.offsets = { ...offsets, unit: 'utf16' };
    source.lineHash = sha(data.turn.content.slice(offsets.start, offsets.end));
    await assert.rejects(dispatchSources({ ...data.input, event }), invalid);
  }
});

test('extractive references enforce bounded exact fields, unique keys, UTF16 ranges and hashes', async () => {
  const data = await passageFixture();
  for (const mutate of [
    value => { value.key = 'Invalid'; }, value => { value.key = ''; },
    value => { value.offsets.start = -1; }, value => { value.offsets.start += 0.5; },
    value => { value.offsets.end = value.offsets.start; }, value => { value.offsets.end = 999999; },
    value => { value.offsets.unit = 'codepoints'; }, value => { value.offsets.extra = true; },
    value => { value.turnHash = sha('different turn'); }, value => { value.lineHash = sha('different quote'); },
    value => { value.quote = 'copied text'; }, value => { value.turnId = 'unknown'; },
  ]) {
    const event = clone(data.event); mutate(event.extractiveSources[0]);
    await assert.rejects(dispatchSources({ ...data.input, event }), invalid);
  }
  for (const extractiveSources of [null, {}, Array(9).fill(data.event.extractiveSources[0]), [data.event.extractiveSources[0], data.event.extractiveSources[0]]]) {
    await assert.rejects(dispatchSources({ ...data.input, event: { ...data.event, extractiveSources } }), invalid);
  }
  const long = await passageFixture('x'.repeat(4097));
  await assert.rejects(dispatchSources({ ...long.input, event: long.event }), invalid);
  const blank = await passageFixture('Before   after'), event = clone(blank.event);
  event.extractiveSources = [reference(blank.turn, '   ', 'passage-1')];
  await assert.rejects(dispatchSources({ ...blank.input, event }), invalid);
  const mixed = await fixture(), mixedEvent = clone(mixed.event);
  mixedEvent.extractiveSources = [reference(mixed.declared, 'The destination city is Bristol.', 'city')];
  await assert.rejects(dispatchSources({ ...mixed.input(), event: mixedEvent }), invalid);
});

test('extractive sources reject assistant, future and foreign turns without changing historical saved records', async () => {
  const data = await passageFixture();
  for (const mutate of [
    value => { value.conversation.turns[0].role = 'assistant'; },
    value => { value.conversation.turns[0].actorId = 'other-user'; },
    value => { value.conversation.turns[0].conversationId = 'other-chat'; },
    value => {
      const future = value.conversation.turns[2]; future.role = 'user';
      value.event.extractiveSources = [reference(future, future.content, 'future')];
    },
  ]) {
    const value = { ...clone(data.input), event: clone(data.event) }; mutate(value);
    await assert.rejects(dispatchSources(value), invalid);
  }
  const saved = await fixture({ structured: false }), original = await captured(saved);
  await saved.memory.forget({ recordId: saved.record.id });
  assert.deepEqual(await validateAnswerCitations({ ...saved.input(), citations: [original] }), [original]);
  assert.deepEqual(saved.memory.active(scope), []);
});
