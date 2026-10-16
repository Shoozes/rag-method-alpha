import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCameraPose, memoryNavigationLimits, mountMemoryNavigation } from '../examples/browser-model-chat/memory/navigation.mjs';

const initial = () => ({ position: { x: 12, y: -7, z: 103 }, target: { x: 12, y: -7, z: 3 } });
const viewport = { width: 390, height: 320 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} ~= ${expected}`);
// Independent plane projection: a graph coordinate must follow the touched point.
function project(world, pose) {
  const verticalSpan = 2 * (pose.position.z - pose.target.z) * Math.tan(25 * Math.PI / 180);
  return { x: viewport.width / 2 + (world.x - pose.target.x) * viewport.height / verticalSpan,
    y: viewport.height / 2 - (world.y - pose.target.y) * viewport.height / verticalSpan };
}

test('one-contact camera pan moves actual graph-plane projection by the touch displacement', () => {
  const pose = initial(), before = structuredClone(pose), from = { x: 100, y: 120 }, to = { x: 180, y: 155 };
  const next = memoryCameraPose({ pose, viewport, from, to, limits: memoryNavigationLimits(pose) });
  const world = { x: 12, y: -7 }, oldPoint = project(world, pose), newPoint = project(world, next);
  near(newPoint.x - oldPoint.x, 80); near(newPoint.y - oldPoint.y, 35);
  assert.deepEqual(pose, before); assert.equal(next.position.z, pose.position.z); assert.equal(next.target.z, 3);
});

test('two-contact midpoint translation and zoom preserve the anchored world point', () => {
  const pose = initial(), from = { x: 81, y: 97 }, to = { x: 157, y: 140 };
  const units = 200 * Math.tan(25 * Math.PI / 180) / viewport.height;
  const anchor = { x: pose.target.x + (from.x - viewport.width / 2) * units,
    y: pose.target.y - (from.y - viewport.height / 2) * units };
  const next = memoryCameraPose({ pose, viewport, from, to, scale: 2, limits: memoryNavigationLimits(pose) });
  const anchored = project(anchor, next);
  near(anchored.x, to.x); near(anchored.y, to.y); near(next.position.z - next.target.z, 50);
  const graphPoint = { x: 15, y: -2 };
  near(Math.hypot(project(graphPoint, next).x - anchored.x, project(graphPoint, next).y - anchored.y),
    2 * Math.hypot(project(graphPoint, pose).x - from.x, project(graphPoint, pose).y - from.y));
});

test('zoom clamps retain the same anchor and return fresh poses', () => {
  const pose = initial(), limits = memoryNavigationLimits(pose), from = { x: 90, y: 70 };
  const argumentsFor = scale => ({ pose, viewport, from, to: from, scale, limits });
  assert.equal(memoryCameraPose(argumentsFor(1000)).position.z - 3, 25);
  assert.equal(memoryCameraPose(argumentsFor(0.0001)).position.z - 3, 400);
  assert.deepEqual(memoryCameraPose(argumentsFor(1)), pose);
  assert.notEqual(memoryCameraPose(argumentsFor(1)).target, pose.target);
  assert.deepEqual(memoryNavigationLimits({ position: { x: 0, y: 0, z: 80000 }, target: { x: 0, y: 0, z: 0 } }),
    { minDistance: 20000, maxDistance: 100000 });
});

test('invalid, empty or unexpectedly angled cameras fail closed without changing source state', () => {
  const pose = initial(), args = { pose, viewport, from: { x: 1, y: 2 }, to: { x: 2, y: 3 }, limits: memoryNavigationLimits(pose) };
  for (const scale of [0, -1, Infinity, NaN, '2']) assert.equal(memoryCameraPose({ ...args, scale }), null);
  assert.equal(memoryCameraPose({ ...args, viewport: { width: 0, height: 320 } }), null);
  assert.equal(memoryCameraPose({ ...args, to: { x: NaN, y: 3 } }), null);
  assert.equal(memoryCameraPose({ ...args, limits: { minDistance: 10, maxDistance: 1 } }), null);
  assert.equal(memoryCameraPose({ ...args, pose: { ...pose, target: { ...pose.target, x: 15 } } }), null);
  assert.equal(memoryNavigationLimits({ ...pose, position: { ...pose.position, z: Infinity } }), null);
  assert.deepEqual(pose, initial());
});

class Events {
  listeners = new Map();
  addEventListener(name, callback, options) {
    const rows = this.listeners.get(name) ?? []; rows.push({ callback, options }); this.listeners.set(name, rows);
  }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(row => row.callback !== callback)); }
  fire(type, fields = {}) {
    const event = { type, target: this, pointerId: 1, pointerType: 'touch', button: 0, clientX: 130, clientY: 150, detail: 1,
      defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...fields };
    for (const { callback } of [...this.listeners.get(type) ?? []]) { callback(event); if (event.stopped) break; }
    return event;
  }
  get count() { return [...this.listeners.values()].reduce((total, rows) => total + rows.length, 0); }
}
function fixture() {
  const view = new Events(), doc = new Events(), surface = new Events();
  doc.defaultView = view; doc.hidden = false; surface.ownerDocument = doc;
  const classes = new Set(); surface.classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
  let rect = { left: 20, top: 30, ...viewport }, pose = initial(), active = true;
  const captured = new Set(), captureCalls = [], releases = [], writes = []; let fits = 0;
  surface.getBoundingClientRect = () => rect;
  surface.setPointerCapture = id => { captured.add(id); captureCalls.push(id); };
  surface.releasePointerCapture = id => { captured.delete(id); releases.push(id); surface.fire('lostpointercapture', { pointerId: id }); };
  const renderer = { getCameraPose: () => structuredClone(pose), setCameraPose: value => { pose = structuredClone(value); writes.push(pose); },
    fit: () => { fits++; pose = initial(); } };
  const navigation = mountMemoryNavigation({ surface, getRenderer: () => active ? renderer : null });
  return { surface, view, doc, navigation, captured, captureCalls, releases, writes, classes,
    get pose() { return pose; }, get fits() { return fits; }, deactivate() { active = false; }, resize() { rect = { ...rect, width: 430 }; } };
}

test('native taps and sub-slop movement neither capture nor suppress node or keyboard activation', () => {
  const f = fixture();
  assert.equal(f.surface.fire('pointerdown').defaultPrevented, false);
  f.view.fire('pointermove', { clientX: 133, clientY: 153 });
  assert.equal(f.view.fire('pointerup', { clientX: 133, clientY: 153 }).defaultPrevented, false);
  assert.equal(f.writes.length, 0); assert.deepEqual(f.captureCalls, []);
  assert.equal(f.surface.fire('click').defaultPrevented, false);
  assert.equal(f.surface.fire('click', { detail: 0 }).defaultPrevented, false);
  f.navigation.dispose();
});

test('drag starts after slop, releases capture and suppresses only its pointer click', () => {
  const f = fixture(); f.surface.fire('pointerdown');
  assert.equal(f.view.fire('pointermove', { clientX: 180, clientY: 175 }).defaultPrevented, true);
  assert.deepEqual(f.captureCalls, [1]); assert.equal(f.writes.length, 1);
  assert.ok(f.pose.target.x < initial().target.x); assert.ok(f.pose.target.y > initial().target.y);
  f.view.fire('pointerup'); assert.equal(f.captured.size, 0); assert.equal(f.classes.size, 0);
  const click = f.surface.fire('click'); assert.equal(click.defaultPrevented, true); assert.equal(click.stopped, true);
  assert.equal(f.surface.fire('click', { detail: 0 }).defaultPrevented, false);
  // The next intentional tap is usable immediately, rather than waiting for a timer.
  f.surface.fire('pointerdown'); f.view.fire('pointerup'); assert.equal(f.surface.fire('click').defaultPrevented, false);
  f.navigation.dispose();
});

test('pinch captures both contacts, zooms around its moving midpoint, then continues one-contact pan', () => {
  const f = fixture(); f.surface.fire('pointerdown', { clientX: 120, clientY: 130 });
  f.surface.fire('pointerdown', { pointerId: 2, clientX: 220, clientY: 130 });
  assert.deepEqual([...f.captured].sort(), [1, 2]);
  f.view.fire('pointermove', { pointerId: 2, clientX: 320, clientY: 170 });
  assert.ok(f.pose.position.z - f.pose.target.z < 100);
  const beforeLift = structuredClone(f.pose);
  f.view.fire('pointerup', { pointerId: 2, clientX: 320, clientY: 170 });
  f.view.fire('pointermove', { clientX: 140, clientY: 130 });
  assert.ok(f.pose.target.x < beforeLift.target.x); near(f.pose.position.z, beforeLift.position.z);
  f.view.fire('pointerup'); assert.equal(f.captured.size, 0); assert.equal(f.surface.fire('click').defaultPrevented, true);
  f.navigation.dispose();
});

test('cancel, lost capture, blur, hidden document and resize interrupt without a stuck camera', () => {
  for (const interrupt of [f => f.view.fire('pointercancel'), f => f.surface.fire('lostpointercapture'),
    f => f.view.fire('blur'), f => { f.doc.hidden = true; f.doc.fire('visibilitychange'); },
    f => f.view.fire('resize'), f => f.view.fire('orientationchange'), f => f.navigation.cancel()]) {
    const f = fixture(); f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 170 });
    interrupt(f); const count = f.writes.length;
    f.view.fire('pointermove', { clientX: 240 }); f.view.fire('pointerup');
    assert.equal(f.writes.length, count); assert.equal(f.captured.size, 0); assert.equal(f.classes.size, 0);
    assert.equal(f.surface.fire('click').defaultPrevented, true);
    f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 190 }); f.view.fire('pointerup');
    assert.ok(f.writes.length > count); f.navigation.dispose();
  }
});

test('overlay capture transfer keeps dragging; only loss of the graph surface capture interrupts', () => {
  const f = fixture(), overlayButton = {};
  f.surface.fire('pointerdown', { target: overlayButton });
  f.view.fire('pointermove', { clientX: 140 });
  assert.equal(f.writes.length, 1); assert.ok(f.captured.has(1));
  // Native implicit capture belonged to the button; its loss bubbles to the graph.
  f.surface.fire('lostpointercapture', { target: overlayButton });
  f.view.fire('pointermove', { clientX: 175 });
  assert.equal(f.writes.length, 2); assert.ok(f.captured.has(1));
  const afterFullDrag = structuredClone(f.pose);
  const actualProjection = project({ x: 12, y: -7 }, afterFullDrag), initialProjection = project({ x: 12, y: -7 }, initial());
  near(actualProjection.x - initialProjection.x, 45);
  f.surface.fire('lostpointercapture');
  f.view.fire('pointermove', { clientX: 210 });
  assert.equal(f.writes.length, 2); assert.equal(f.captured.size, 0);
  f.view.fire('pointerup'); assert.equal(f.surface.fire('click').defaultPrevented, true);
  f.navigation.dispose();
});

test('third contact suspends navigation until all contacts lift; it cannot become a stray tap', () => {
  const f = fixture(); f.surface.fire('pointerdown'); f.surface.fire('pointerdown', { pointerId: 2, clientX: 230 });
  f.surface.fire('pointerdown', { pointerId: 3, clientX: 300 });
  f.view.fire('pointermove', { clientX: 190 }); f.view.fire('pointerup', { pointerId: 3 });
  f.view.fire('pointermove', { pointerId: 2, clientX: 280 });
  assert.equal(f.writes.length, 0); assert.equal(f.captured.size, 0);
  f.view.fire('pointerup', { pointerId: 2 }); f.view.fire('pointerup');
  assert.equal(f.surface.fire('click').defaultPrevented, true);
  f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 190 });
  assert.equal(f.writes.length, 1); f.navigation.dispose();
});

test('inactive/fallback renderer, changed surface geometry and disposal leave unrelated input alone', () => {
  const f = fixture(); f.surface.fire('pointerdown'); f.resize();
  f.view.fire('pointermove', { clientX: 190 }); assert.equal(f.writes.length, 0);
  f.deactivate();
  assert.equal(f.surface.fire('pointerdown').defaultPrevented, false);
  assert.equal(f.surface.fire('wheel', { deltaY: 90, deltaMode: 0 }).defaultPrevented, false);
  assert.equal(f.surface.fire('dragstart').defaultPrevented, false);
  assert.equal(f.view.fire('pointermove', { pointerId: 90, clientX: 200 }).defaultPrevented, false);
  f.navigation.dispose(); f.navigation.dispose();
  assert.equal(f.surface.count + f.view.count + f.doc.count, 0);
});

test('graph wheel zoom is bounded and Fit restores the existing camera; no animation is scheduled', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) assert.equal(f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 }).defaultPrevented, true);
  near(f.pose.position.z - f.pose.target.z, 25);
  for (let i = 0; i < 40; i++) f.surface.fire('wheel', { deltaY: 240, deltaMode: 0 });
  near(f.pose.position.z - f.pose.target.z, 400);
  assert.equal(f.navigation.fit(), true); assert.equal(f.fits, 1); assert.deepEqual(f.pose, initial());
  assert.equal(f.surface.fire('dragstart').defaultPrevented, true);
  f.deactivate(); assert.equal(f.navigation.fit(), false); f.navigation.dispose();
});
