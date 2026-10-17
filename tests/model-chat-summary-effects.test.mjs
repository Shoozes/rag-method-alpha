import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryEffects, planSummaryEffects, SUMMARY_EFFECT_MS, SUMMARY_EFFECT_MAX_PARTICLES,
  SUMMARY_EFFECT_MAX_SOURCES } from '../examples/browser-model-chat/memory/summary-effects.mjs';

const input = (eventId = 'e-1', sourceNodeIds = ['turn:t-1']) => ({ eventId, sourceNodeIds, targetNodeId: 'summary:actual-hash' });
const target = (node_id, x = 120, y = 80, visible = true) => ({ node_id, x, y, visible });
const targets = () => [target('turn:t-1', 20, 30), target('summary:actual-hash')];
const viewport = { width: 390, height: 320 };

function fixture({ motion = true, projected = targets(), animate = true, initialEventIds = [], failAnimationAt = Infinity } = {}) {
  const animations = [], scheduled = new Map(), cancelledTimers = [], created = [];
  let nextTimer = 0;
  class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.attributes = {}; this.children = [];
      this.clientWidth = viewport.width; this.clientHeight = viewport.height; created.push(this);
      if (animate) this.animate = (frames, options) => {
        if (animations.length === failAnimationAt) throw new Error('Labeled presentation-port failure.');
        const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
        animations.push(animation); return animation;
      };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(child) { child.parent = this; this.children.push(child); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  }
  const document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  const container = new Element('section'); container.ownerDocument = document;
  const effects = createSummaryEffects({ container, getTargets: () => projected, getMotionEnabled: () => motion,
    initialEventIds, schedule: (callback, ms) => { const id = ++nextTimer; scheduled.set(id, { callback, ms }); return id; },
    unschedule: id => { cancelledTimers.push(id); scheduled.delete(id); } });
  return { effects, container, animations, scheduled, cancelledTimers, created,
    expire() { const tasks = [...scheduled.values()]; scheduled.clear(); for (const task of tasks) task.callback(); } };
}

test('planning retains only supplied actual visible Conversation source IDs and the actual retained target', () => {
  const supplied = input('e-1', ['turn:t-1', 'turn:t-2', 'turn:t-3', 'turn:t-4', 'turn:t-5', 'turn:t-1']);
  const plan = planSummaryEffects(supplied, [...targets(), target('turn:t-2', 40, 50, false),
    target('turn:t-3', Infinity), target('turn:t-4', 391), target('turn:t-5', -1), target('turn:unaffected', 45, 52)], viewport);
  assert.deepEqual(plan.sources, [{ nodeId: 'turn:t-1', x: 20, y: 30 }]);
  assert.equal(plan.target.nodeId, supplied.targetNodeId); assert.equal(plan.requestedSourceCount, 5);
  assert.equal(plan.omittedSourceCount, 4); assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.sources));
  assert.deepEqual(supplied.sourceNodeIds, ['turn:t-1', 'turn:t-2', 'turn:t-3', 'turn:t-4', 'turn:t-5', 'turn:t-1']);
});

test('planning rejects invalid or ambiguous endpoints without guessing a destination or promoting scope', () => {
  for (const patch of [{ eventId: '' }, { targetNodeId: null }, { targetNodeId: 'turn:t-1' }, { sourceNodeIds: [] },
    { sourceNodeIds: ['persona:p-1'] }, { sourceNodeIds: ['summary:other'] }, { sourceNodeIds: ['turn:'] },
    { sourceNodeIds: Array(257).fill('turn:t-1') }]) assert.equal(planSummaryEffects({ ...input(), ...patch }, targets(), viewport), null);
  for (const projected of [[], [target('turn:t-1')], [...targets(), target('summary:actual-hash')]]) {
    assert.equal(planSummaryEffects(input(), projected, viewport).target, null);
  }
  assert.deepEqual(planSummaryEffects(input(), [...targets(), target('turn:t-1')], viewport).sources, []);
  assert.equal(planSummaryEffects(input(), targets(), { width: 0, height: 320 }), null);
});

test('a committed presentation has bounded source trails and particles ending at actual summary coordinates', () => {
  const sourceNodeIds = Array.from({ length: 40 }, (_, index) => 'turn:t-' + index);
  const f = fixture({ projected: [...sourceNodeIds.map((id, index) => target(id, 10 + index * 6, 40)), target(input().targetNodeId)] });
  const actual = f.effects.play(input('committed-only', sourceNodeIds));
  assert.equal(actual.played, true); assert.equal(actual.sourceCount, SUMMARY_EFFECT_MAX_SOURCES);
  assert.equal(actual.omittedSourceCount, 28); assert.equal(actual.particleCount, SUMMARY_EFFECT_MAX_PARTICLES);
  const overlay = f.container.children[0];
  assert.equal(overlay.attributes['aria-hidden'], 'true'); assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.dataset.eventId, 'committed-only'); assert.equal(overlay.dataset.targetNodeId, input().targetNodeId);
  assert.equal(f.created.filter(element => element.className === 'memory-summary-particle').length, 24);
  for (const particle of f.created.filter(element => element.className === 'memory-summary-particle')) {
    assert.ok(sourceNodeIds.slice(0, 12).includes(particle.dataset.sourceNodeId));
    assert.equal(particle.dataset.targetNodeId, input().targetNodeId);
  }
  for (const animation of f.animations) {
    assert.ok(animation.options.duration + (animation.options.delay ?? 0) <= SUMMARY_EFFECT_MS);
    assert.equal(animation.options.fill, 'both'); assert.notEqual(animation.options.iterations, Infinity);
  }
  const flights = f.animations.filter(animation => animation.frames.length === 5);
  assert.equal(flights.length, 24);
  for (const animation of flights) assert.match(animation.frames.at(-1).transform, /^translate\(120px, 80px\)/);
  assert.deepEqual([...f.scheduled.values()].map(task => task.ms), [SUMMARY_EFFECT_MS]);
  f.expire(); assert.equal(f.container.children.length, 0); assert.ok(f.animations.every(animation => animation.cancelled));
  assert.deepEqual(f.effects.diagnostics(), { disposed: false, active: false, eventId: null, particleCount: 0, trailCount: 0,
    animationCount: 0, scheduledCallbacks: 0, consumedEventCount: 1 });
  assert.equal(f.effects.play(input('committed-only', sourceNodeIds)).reason, 'already-seen');
});

test('reduced motion preserves a static real target ring with no particles, animations or frame loop', () => {
  const f = fixture({ motion: false }); const actual = f.effects.play(input());
  assert.equal(actual.played, true); assert.equal(actual.reason, 'reduced-motion'); assert.equal(actual.reducedMotion, true);
  assert.equal(actual.particleCount, 0); assert.equal(f.animations.length, 0);
  const overlay = f.container.children[0]; assert.equal(overlay.dataset.reducedMotion, 'true');
  assert.equal(overlay.children.length, 1); assert.equal(overlay.children[0].dataset.nodeId, input().targetNodeId);
  assert.equal(f.effects.diagnostics().scheduledCallbacks, 1); f.expire();
  assert.equal(f.effects.diagnostics().scheduledCallbacks, 0); assert.equal(f.container.children.length, 0);
});

test('restored, absent or invalid endpoints never cue and never replay after a later view change', () => {
  const restored = fixture({ initialEventIds: ['e-1'] });
  assert.equal(restored.effects.play(input()).reason, 'already-seen'); assert.equal(restored.created.length, 1);
  const invisible = fixture({ projected: [target('turn:t-1')] });
  assert.equal(invisible.effects.play(input()).reason, 'target-not-visible');
  assert.equal(invisible.effects.play(input()).reason, 'already-seen'); assert.equal(invisible.scheduled.size, 0);
  const noSource = fixture({ projected: [target(input().targetNodeId)] });
  assert.equal(noSource.effects.play(input()).reason, 'sources-not-visible'); assert.equal(noSource.animations.length, 0);
  const invalid = fixture(); assert.equal(invalid.effects.play({ ...input(), sourceNodeIds: [] }).reason, 'invalid-lineage');
  assert.equal(invalid.effects.play(input()).reason, 'already-seen'); assert.equal(invalid.scheduled.size, 0);
});

test('stop, replacement and dispose cancel all work without late cleanup interrupting a newer success', () => {
  const f = fixture(); f.effects.play(input());
  const oldExpiry = [...f.scheduled.values()][0].callback, firstAnimations = [...f.animations];
  f.effects.play(input('e-2')); assert.ok(firstAnimations.every(animation => animation.cancelled));
  assert.equal(f.container.children.length, 1); assert.equal(f.scheduled.size, 1);
  oldExpiry(); assert.equal(f.effects.diagnostics().eventId, 'e-2');
  f.effects.stop(); f.effects.stop(); assert.equal(f.container.children.length, 0); assert.equal(f.scheduled.size, 0);
  assert.ok(f.animations.every(animation => animation.cancelled));
  assert.equal(f.effects.play(input('e-2')).reason, 'already-seen');
  f.effects.play(input('e-3')); f.effects.dispose(); f.effects.dispose();
  assert.equal(f.effects.diagnostics().disposed, true); assert.equal(f.effects.diagnostics().scheduledCallbacks, 0);
  assert.equal(f.effects.play(input('e-4')).reason, 'disposed'); assert.equal(f.scheduled.size, 0);
});

test('a missing Web Animations port gives static feedback without dropping the true completion', () => {
  const f = fixture({ animate: false }); const actual = f.effects.play(input());
  assert.equal(actual.played, true); assert.equal(actual.reason, 'static-fallback'); assert.equal(actual.particleCount, 0);
  assert.equal(f.container.children[0].children.length, 1); assert.equal(f.animations.length, 0); f.expire();
  assert.equal(f.container.children.length, 0);
});

test('a presentation failure cancels partial work, retains no callbacks and cannot replay the committed event', () => {
  const f = fixture({ failAnimationAt: 2 }); const actual = f.effects.play(input());
  assert.equal(actual.played, false); assert.equal(actual.reason, 'unavailable');
  assert.equal(f.animations.length, 2); assert.ok(f.animations.every(animation => animation.cancelled));
  assert.equal(f.container.children.length, 0); assert.equal(f.scheduled.size, 0);
  assert.equal(f.effects.diagnostics().animationCount, 0); assert.equal(f.effects.diagnostics().scheduledCallbacks, 0);
  assert.equal(f.effects.play(input()).reason, 'already-seen');
});
