import test from 'node:test';
import assert from 'node:assert/strict';
import { contextUsageView } from '../examples/browser-model-chat/app.mjs';

const usage = (phase, promptTokens, extra = {}) => ({ phase, capacity: 2048, reserve: 160, usablePromptTokens: 1888,
  measurement: promptTokens === null ? null : { promptTokens, contextTokens: 2048, overflow: promptTokens > 2048, quality: 'measured' }, ...extra });

test('empty and reloaded context have no invented zero or percentage', () => {
  for (const phase of ['unmeasured', 'measuring']) {
    const view = contextUsageView(usage(phase, null));
    assert.equal(view.value, null); assert.equal(view.fraction, null);
    assert.match(view.detail, /not measured/); assert.match(view.detail, /1,888 prompt tokens; 160 reserved/);
  }
});

test('near-limit occupancy accounts for reserve exactly once and includes existing overhead', () => {
  const view = contextUsageView(usage('ready', 1888));
  assert.equal(view.max, 1888); assert.equal(view.value, 1888); assert.equal(view.fraction, 1);
  assert.match(view.detail, /System instructions and retrieved text are included, not subtracted again/);
  assert.match(view.detail, /bar endpoint is the prompt limit/); assert.equal(view.label, 'Last prompt');
});

test('compacting shows bounded before occupancy, not invented percent-complete progress', () => {
  const view = contextUsageView(usage('compacting', 2200));
  assert.equal(view.value, 1888); assert.equal(view.fraction, 1); assert.equal(view.busy, true);
  assert.match(view.detail, /2,200 of 1,888/); assert.match(view.detail, /before count, not percentage completion/);
  assert.equal(view.label, 'Compacting context');
});

test('only a committed ready prompt is described as compacted; stale/failure/cancel stay explicit', () => {
  const compaction = { cycle: 1, beforePromptTokens: 2200, afterPromptTokens: 500 };
  const ready = contextUsageView(usage('ready', 500, { compaction }));
  assert.equal(ready.label, 'Context compacted'); assert.equal(ready.value, 500);
  for (const phase of ['stale', 'error', 'cancelled']) {
    const view = contextUsageView(usage(phase, 2200));
    assert.equal(view.value, 1888); assert.notEqual(view.label, 'Context compacted');
    assert.match(view.detail, /keeps the original transcript/);
  }
  assert.match(contextUsageView(usage('stale', 500)).detail, /draft and subsequent reply are not remeasured/);
});

test('explicit estimates and fixture counts never acquire native measurement claims', () => {
  const estimate = usage('ready', 700); estimate.measurement.quality = 'estimate';
  assert.match(contextUsageView(estimate).detail, /^Estimated:/);
  estimate.measurement.quality = 'fixture';
  assert.match(contextUsageView(estimate).detail, /^Fixture measurement, not native tokens:/);
});

test('only recognized manual no-change codes show a neutral unchanged result with actual before occupancy', () => {
  for (const errorCode of ['MANUAL_COMPACTION_NO_SOURCE_CONTEXT', 'MANUAL_COMPACTION_NO_REDUCTION']) {
    const view = contextUsageView(usage('error', 700, { errorCode }));
    assert.equal(view.phase, 'error'); assert.equal(view.label, 'Context unchanged'); assert.equal(view.unchanged, true);
    assert.equal(view.value, 700); assert.equal(view.busy, false);
    assert.match(view.detail, /Check completed without changing context; prior context and originals kept/);
    assert.doesNotMatch(view.detail, /preparation failed|successful compacted/);
  }
  for (const errorCode of [undefined, 'RUNTIME_FAILED', 'MANUAL_COMPACTION_NO_SOURCE_CONTEXT extra']) {
    const view = contextUsageView(usage('error', 700, { errorCode, error: 'Nothing changed' }));
    assert.equal(view.label, 'Check failed'); assert.equal(view.unchanged, false); assert.match(view.detail, /preparation failed/);
  }
  assert.equal(contextUsageView(usage('measuring', 700, { errorCode: 'MANUAL_COMPACTION_NO_REDUCTION' })).label, 'Checking context');
});

test('malformed or mismatched counters remain unknown rather than rendering invalid meter values', () => {
  for (const state of [undefined, usage('ready', -1), usage('ready', 500, { usablePromptTokens: 2048 }),
    { ...usage('ready', 500), measurement: { promptTokens: 500, contextTokens: 4096, overflow: false } }]) {
    const view = contextUsageView(state); assert.equal(view.value, null); assert.equal(view.fraction, null);
  }
});
