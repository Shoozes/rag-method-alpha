import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPACTION_CUE_MS, createCompactionCue } from '../examples/browser-model-chat/memory/compaction-cue.mjs';

const success = (id = 'e-1', sourceTurnIds = ['t-1']) => ({ type: 'compacted', id, cycle: 1, capacity: 2048, reserve: 160,
  beforePromptTokens: 2000, afterPromptTokens: 900, sourceTurnIds, sourceHashes: sourceTurnIds.map(() => 'a'.repeat(64)),
  summaryHash: 'b'.repeat(64), requestBeforeSha256: 'c'.repeat(64), requestAfterSha256: 'd'.repeat(64) });
const node = turnId => ({ id: 'turn:' + turnId, kind: 'message', scope: 'conversation', turnId });

test('historical restored compactions are silent, new IDs play at most once', () => {
  const cue = createCompactionCue([success()]);
  assert.equal(cue.observe(success()), false);
  assert.equal(cue.take([node('t-1')]), null);
  assert.equal(cue.observe(success('e-2')), true);
  assert.equal(cue.observe(success('e-2')), false);
  assert.deepEqual(cue.take([node('t-1')]).nodeIds, ['turn:t-1']);
  assert.equal(cue.take([node('t-1')]), null, 'Already consumed even if playback closes or is cancelled.');
  assert.equal(cue.observe(success('e-2')), false);
});

test('only actual current Conversation message identities can receive a halo', () => {
  const cue = createCompactionCue();
  cue.observe(success('e-1', ['t-1', 't-2', 't-3', 't-4']));
  const actual = cue.take([node('t-1'), { ...node('t-2'), scope: 'persona' }, { ...node('t-3'), kind: 'global' },
    { ...node('t-4'), id: 'invented-target' }, node('t-5')]);
  assert.deepEqual(actual.nodeIds, ['turn:t-1']);
  assert.equal(actual.message, 'Context compacted · originals kept');
  assert.ok(Object.isFrozen(actual) && Object.isFrozen(actual.eventIds) && Object.isFrozen(actual.nodeIds));
});

test('no visible lineage gives a truthful text cue, without inventing a merge destination', () => {
  const cue = createCompactionCue(); cue.observe(success());
  assert.deepEqual(cue.take([]).nodeIds, []);
  assert.equal(cue.take([node('t-1')]), null, 'Switching a pocket later cannot replay old work.');
});

test('failure, rejection, missing lineage and unchanged or unsuccessful prompt measurements do not cue', () => {
  const malformed = [
    { type: 'summary-rejected' }, { type: 'compacting' },
    { sourceTurnIds: [] }, { sourceHashes: [] }, { sourceTurnIds: ['t-1', 't-1'], sourceHashes: ['a'.repeat(64), 'a'.repeat(64)] },
    { summaryHash: '' }, { requestAfterSha256: 'c'.repeat(64) }, { beforePromptTokens: 900 },
    { afterPromptTokens: 2000 }, { reserve: 2048 }, { capacity: undefined },
  ];
  for (const patch of malformed) {
    const cue = createCompactionCue();
    assert.equal(cue.observe({ ...success(), ...patch }), false, JSON.stringify(patch));
    assert.equal(cue.take([node('t-1')]), null);
  }
});

test('multiple successes are coalesced once with a bounded visible node set and brief lifetime', () => {
  const cue = createCompactionCue(), nodes = Array.from({ length: 20 }, (_, index) => node('t-' + index));
  cue.observe(success('e-1', nodes.slice(0, 10).map(item => item.turnId)));
  cue.observe(success('e-2', nodes.slice(10).map(item => item.turnId)));
  const taken = cue.take(nodes);
  assert.deepEqual(taken.eventIds, ['e-1', 'e-2']); assert.equal(taken.nodeIds.length, 12);
  assert.equal(taken.durationMs, COMPACTION_CUE_MS); assert.ok(COMPACTION_CUE_MS >= 1000 && COMPACTION_CUE_MS <= 4000);
  cue.dispose(); assert.equal(cue.observe(success('e-3')), false); assert.equal(cue.take(nodes), null);
});
