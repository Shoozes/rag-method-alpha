import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCameraPose, memoryOrbitPose, memoryNavigationLimits, mountMemoryNavigation } from '../examples/browser-model-chat/memory/navigation.mjs';

const initial = () => ({ position: { x: 12, y: -7, z: 103 }, target: { x: 12, y: -7, z: 3 } });
const viewport = { width: 390, height: 320 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} ~= ${expected}`);
const difference = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = value => Math.hypot(value.x, value.y, value.z);
const unit = value => { const n = length(value); return { x: value.x / n, y: value.y / n, z: value.z / n }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const radius = pose => length(difference(pose.position, pose.target));
// Independent look-at perspective projection and ray/target-plane intersection.
function cameraAxes(pose) {
  const forward = unit(difference(pose.target, pose.position));
  const horizontal = cross(forward, { x: 0, y: 1, z: 0 });
  const right = length(horizontal) > 0.000001 ? unit(horizontal) : { x: 1, y: 0, z: 0 };
  return { forward, right, up: cross(right, forward) };
}
function project(world, pose) {
  const { forward, right, up } = cameraAxes(pose), relative = difference(world, pose.position);
  const focal = viewport.height / (2 * Math.tan(25 * Math.PI / 180)), depth = dot(relative, forward);
  return { x: viewport.width / 2 + focal * dot(relative, right) / depth,
    y: viewport.height / 2 - focal * dot(relative, up) / depth };
}
function targetPlanePoint(screen, pose) {
  const { forward, right, up } = cameraAxes(pose), tangent = Math.tan(25 * Math.PI / 180);
  const x = (screen.x * 2 / viewport.width - 1) * tangent * viewport.width / viewport.height;
  const y = (1 - screen.y * 2 / viewport.height) * tangent;
  const ray = unit({ x: forward.x + right.x * x + up.x * y, y: forward.y + right.y * x + up.y * y,
    z: forward.z + right.z * x + up.z * y });
  const t = dot(difference(pose.target, pose.position), forward) / dot(ray, forward);
  return { x: pose.position.x + ray.x * t, y: pose.position.y + ray.y * t, z: pose.position.z + ray.z * t };
}
const orientations = () => [initial(), { position: { x: 72, y: 45, z: 83 }, target: { x: 12, y: -7, z: 3 } },
  { position: { x: -47, y: 25, z: -91 }, target: { x: 12, y: -7, z: 3 } },
  { position: { x: 45, y: -60, z: 10 }, target: { x: 12, y: -7, z: 3 } }];

test('camera-facing pan follows screen displacement from arbitrary angled perspective cameras', () => {
  for (const pose of orientations()) {
    const before = structuredClone(pose), from = { x: 100, y: 120 }, to = { x: 180, y: 155 };
    const next = memoryCameraPose({ pose, viewport, from, to, limits: memoryNavigationLimits(pose) });
    const anchor = targetPlanePoint(from, pose), moved = project(anchor, next);
    near(moved.x, to.x); near(moved.y, to.y); near(radius(next), radius(pose));
    for (const key of ['x', 'y', 'z']) near(cameraAxes(next).forward[key], cameraAxes(pose).forward[key]);
    assert.deepEqual(pose, before); assert.notEqual(next.target, pose.target);
  }
});

test('two-contact centroid translation and pinch preserve independently projected anchors at all orientations', () => {
  for (const pose of orientations()) {
    const from = { x: 81, y: 97 }, to = { x: 157, y: 140 };
    const anchor = targetPlanePoint(from, pose), other = targetPlanePoint({ x: 150, y: 180 }, pose);
    const next = memoryCameraPose({ pose, viewport, from, to, scale: 2, limits: memoryNavigationLimits(pose) });
    const anchored = project(anchor, next);
    near(anchored.x, to.x); near(anchored.y, to.y); near(radius(next), radius(pose) / 2);
    near(Math.hypot(project(other, next).x - anchored.x, project(other, next).y - anchored.y),
      2 * Math.hypot(project(other, pose).x - from.x, project(other, pose).y - from.y));
  }
});

test('one-contact orbit changes viewing angle while preserving target, distance and finite pole limits', () => {
  const pose = initial(), from = { x: 100, y: 100 };
  const next = memoryOrbitPose({ pose, viewport, from, to: { x: from.x + viewport.width / 4, y: from.y } });
  near(next.position.x, pose.target.x - 100); near(next.position.z, pose.target.z); near(next.position.y, pose.target.y);
  near(radius(next), 100); assert.deepEqual(next.target, pose.target); assert.deepEqual(pose, initial());
  const projectedTarget = project(next.target, next); near(projectedTarget.x, viewport.width / 2); near(projectedTarget.y, viewport.height / 2);
  const world = { x: 30, y: 5, z: 20 };
  assert.ok(Math.hypot(project(world, next).x - project(world, pose).x, project(world, next).y - project(world, pose).y) > 10);
  for (const orientation of orientations()) for (const y of [-1000000, 1000000]) {
    const polar = memoryOrbitPose({ pose: orientation, viewport, from, to: { x: 600, y } });
    near(radius(polar), radius(orientation)); assert.deepEqual(polar.target, orientation.target);
    const vertical = (polar.position.y - polar.target.y) / radius(polar);
    assert.ok(Math.abs(vertical) < 0.999999); assert.ok(Object.values(polar.position).every(Number.isFinite));
    assert.ok(memoryCameraPose({ pose: polar, viewport, from, to: { x: 110, y: 120 }, limits: memoryNavigationLimits(polar) }));
  }
});

test('zoom clamps retain the same anchor and return fresh poses', () => {
  const pose = initial(), limits = memoryNavigationLimits(pose), from = { x: 90, y: 70 };
  const argumentsFor = scale => ({ pose, viewport, from, to: from, scale, limits });
  near(radius(memoryCameraPose(argumentsFor(1000))), 25);
  near(radius(memoryCameraPose(argumentsFor(0.0001))), 400);
  assert.deepEqual(memoryCameraPose(argumentsFor(1)), pose);
  assert.notEqual(memoryCameraPose(argumentsFor(1)).target, pose.target);
  assert.deepEqual(memoryNavigationLimits({ position: { x: 0, y: 0, z: 80000 }, target: { x: 0, y: 0, z: 0 } }),
    { minDistance: 20000, maxDistance: 100000 });
});

test('invalid inputs fail closed while angled and near-polar cameras remain finite', () => {
  const pose = initial(), args = { pose, viewport, from: { x: 1, y: 2 }, to: { x: 2, y: 3 }, limits: memoryNavigationLimits(pose) };
  for (const scale of [0, -1, Infinity, NaN, '2']) assert.equal(memoryCameraPose({ ...args, scale }), null);
  assert.equal(memoryCameraPose({ ...args, viewport: { width: 0, height: 320 } }), null);
  assert.equal(memoryCameraPose({ ...args, to: { x: NaN, y: 3 } }), null);
  assert.equal(memoryCameraPose({ ...args, limits: { minDistance: 10, maxDistance: 1 } }), null);
  assert.ok(memoryCameraPose({ ...args, pose: { ...pose, target: { ...pose.target, x: 15 } } }));
  for (const vertical of [-100, 100]) {
    const polar = { position: { x: 0, y: vertical, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    assert.ok(memoryCameraPose({ ...args, pose: polar, limits: memoryNavigationLimits(polar) }));
    assert.ok(memoryOrbitPose({ pose: polar, viewport, from: args.from, to: args.to }));
  }
  for (const bad of [null, { position: pose.target, target: pose.target }, { ...pose, target: { x: Infinity, y: 0, z: 0 } }]) {
    assert.equal(memoryOrbitPose({ ...args, pose: bad }), null); assert.equal(memoryNavigationLimits(bad), null);
  }
  assert.equal(memoryOrbitPose({ ...args, to: { x: Infinity, y: 2 } }), null);
  assert.equal(memoryOrbitPose({ ...args, viewport: { width: 0, height: 1 } }), null);
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
function fixture({ motion = false, useMediaPreference = false, startingPose = initial() } = {}) {
  const view = new Events(), doc = new Events(), surface = new Events();
  doc.defaultView = view; doc.hidden = false; surface.ownerDocument = doc;
  const classes = new Set(); surface.classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
  let rect = { left: 20, top: 30, ...viewport }, pose = structuredClone(startingPose), active = true, enabled = motion;
  const captured = new Set(), captureCalls = [], releases = [], writes = []; let fits = 0;
  surface.getBoundingClientRect = () => rect;
  surface.setPointerCapture = id => { captured.add(id); captureCalls.push(id); };
  surface.releasePointerCapture = id => { captured.delete(id); releases.push(id); surface.fire('lostpointercapture', { pointerId: id }); };
  const makeRenderer = (fittedPose = initial()) => ({ getCameraPose: () => structuredClone(pose), setCameraPose: value => { pose = structuredClone(value); writes.push(pose); },
    fit: () => { fits++; pose = structuredClone(fittedPose); } });
  let renderer = makeRenderer();
  let clock = 0, serial = 0; const frames = new Map();
  view.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  view.cancelAnimationFrame = id => frames.delete(id);
  view.matchMedia = () => ({ matches: !enabled });
  const tick = (elapsed = 16) => { clock += elapsed; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(clock); };
  const settle = () => { let count = 0; while (frames.size && count++ < 30) tick(); assert.equal(frames.size, 0, 'finite demand-driven camera settling'); return count; };
  const navigation = mountMemoryNavigation({ surface, getRenderer: () => active ? renderer : null,
    ...(useMediaPreference ? {} : { getMotionEnabled: () => enabled }) });
  return { surface, view, doc, navigation, captured, captureCalls, releases, writes, classes,
    tick, settle, get pendingFrames() { return frames.size; }, setMotion(value) { enabled = value; },
    get pose() { return pose; }, get renderer() { return renderer; }, get fits() { return fits; }, deactivate() { active = false; }, resize() { rect = { ...rect, width: 430 }; },
    replaceRenderer(fittedPose = initial()) { pose = structuredClone(fittedPose); renderer = makeRenderer(fittedPose); return renderer; } };
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
  assert.deepEqual(f.pose.target, initial().target); near(radius(f.pose), radius(initial()));
  assert.ok(f.pose.position.x < initial().position.x); assert.ok(f.pose.position.y > initial().position.y);
  f.view.fire('pointerup'); assert.equal(f.captured.size, 0); assert.equal(f.classes.size, 0);
  const click = f.surface.fire('click'); assert.equal(click.defaultPrevented, true); assert.equal(click.stopped, true);
  assert.equal(f.surface.fire('click', { detail: 0 }).defaultPrevented, false);
  // The next intentional tap is usable immediately, rather than waiting for a timer.
  f.surface.fire('pointerdown'); f.view.fire('pointerup'); assert.equal(f.surface.fire('click').defaultPrevented, false);
  f.navigation.dispose();
});

test('pinch captures only after actual movement, then continues a one-contact orbit without moving target', () => {
  const f = fixture(); f.surface.fire('pointerdown', { clientX: 120, clientY: 130 });
  f.surface.fire('pointerdown', { pointerId: 2, clientX: 220, clientY: 130 });
  assert.deepEqual([...f.captured], []); assert.equal(f.writes.length, 0);
  f.view.fire('pointermove', { pointerId: 2, clientX: 320, clientY: 170 });
  assert.deepEqual([...f.captured].sort(), [1, 2]); assert.ok(radius(f.pose) < 100);
  const beforeLift = structuredClone(f.pose);
  f.view.fire('pointerup', { pointerId: 2, clientX: 320, clientY: 170 });
  f.view.fire('pointermove', { clientX: 140, clientY: 130 });
  assert.deepEqual(f.pose.target, beforeLift.target); near(radius(f.pose), radius(beforeLift));
  assert.notDeepEqual(f.pose.position, beforeLift.position);
  f.view.fire('pointerup'); assert.equal(f.captured.size, 0); assert.equal(f.surface.fire('click').defaultPrevented, true);
  f.navigation.dispose();
});

test('stationary and sub-slop two-contact input never captures, writes or becomes a stray node tap', () => {
  const f = fixture();
  f.surface.fire('pointerdown', { clientX: 120, clientY: 130 });
  f.surface.fire('pointerdown', { pointerId: 2, clientX: 220, clientY: 130 });
  f.view.fire('pointermove', { pointerId: 2, clientX: 222, clientY: 130 });
  assert.deepEqual(f.captureCalls, []); assert.equal(f.writes.length, 0);
  f.view.fire('pointerup', { pointerId: 2 }); f.view.fire('pointerup');
  assert.equal(f.surface.fire('click').defaultPrevented, true);
  assert.equal(f.surface.fire('click', { detail: 0 }).defaultPrevented, false);
  f.surface.fire('pointerdown'); f.view.fire('pointerup');
  assert.equal(f.surface.fire('click').defaultPrevented, false); f.navigation.dispose();
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
    f.doc.hidden = false; f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 190 }); f.view.fire('pointerup');
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
  const angle = 45 * Math.PI * 2 / viewport.width;
  near(afterFullDrag.position.x, 12 - 100 * Math.sin(angle)); near(afterFullDrag.position.z, 3 + 100 * Math.cos(angle));
  assert.deepEqual(afterFullDrag.target, initial().target);
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

test('wheel zoom is bounded relative to Fit across resize and Fit restores the camera without reduced-motion animation', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) assert.equal(f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 }).defaultPrevented, true);
  near(radius(f.pose), 25);
  for (let i = 0; i < 40; i++) f.surface.fire('wheel', { deltaY: 240, deltaMode: 0 });
  near(radius(f.pose), 400);
  f.view.fire('resize');
  for (let i = 0; i < 30; i++) f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 });
  near(radius(f.pose), 25); assert.equal(f.pendingFrames, 0);
  assert.equal(f.navigation.fit(), true); assert.equal(f.fits, 1); assert.deepEqual(f.pose, initial());
  assert.equal(f.surface.fire('dragstart').defaultPrevented, true);
  f.deactivate(); assert.equal(f.navigation.fit(), false); f.navigation.dispose();
});

test('explicit renderer rebind preserves the original Fit limits through repeated restored zoom, wheel and pinch', () => {
  const f = fixture(); assert.equal(f.navigation.bind(f.renderer), true);
  const wheel = deltaY => { for (let index = 0; index < 30; index++) f.surface.fire('wheel', { deltaY, deltaMode: 0 }); };
  const pinch = clientX => {
    f.surface.fire('pointerdown', { clientX: 120, clientY: 130 });
    f.surface.fire('pointerdown', { pointerId: 2, clientX: 220, clientY: 130 });
    f.view.fire('pointermove', { pointerId: 2, clientX, clientY: 130 });
    f.view.fire('pointerup', { pointerId: 2 }); f.view.fire('pointerup');
  };
  wheel(-240); near(radius(f.pose), 25);
  for (let cycle = 0; cycle < 4; cycle++) {
    const saved = structuredClone(f.pose), next = f.replaceRenderer();
    assert.equal(f.navigation.bind(next, { preserveLimits: true }), true);
    next.setCameraPose(saved); wheel(-240); pinch(520);
    near(radius(f.pose), 25, 'Restoring a zoomed pose must not create a new 6.25-unit minimum.');
  }
  wheel(240); near(radius(f.pose), 400);
  for (let cycle = 0; cycle < 4; cycle++) {
    const saved = structuredClone(f.pose), next = f.replaceRenderer();
    assert.equal(f.navigation.bind(next, { preserveLimits: true }), true);
    next.setCameraPose(saved); wheel(240); pinch(128);
    near(radius(f.pose), 400, 'Rebinding at maximum zoom-out must not create a 1600-unit maximum.');
  }
  assert.equal(f.fits, 0, 'Binding reads the already-fitted pose without moving the camera.'); f.navigation.dispose();
});

test('fresh binding resets limits from the new Fit; preserving with no prior limits derives that Fit normally', () => {
  for (const firstOptions of [{}, { preserveLimits: true }]) {
    const f = fixture(), twice = initial(); twice.position.z = twice.target.z + 200;
    const next = f.replaceRenderer(twice); assert.equal(f.navigation.bind(next, firstOptions), true);
    for (let index = 0; index < 30; index++) f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 });
    near(radius(f.pose), 50);
    const fresh = initial(); fresh.position.z = fresh.target.z + 80;
    assert.equal(f.navigation.bind(f.replaceRenderer(fresh)), true, 'The default binding resets the previous limits.');
    for (let index = 0; index < 30; index++) f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 });
    near(radius(f.pose), 20);
    for (let index = 0; index < 40; index++) f.surface.fire('wheel', { deltaY: 240, deltaMode: 0 });
    near(radius(f.pose), 320); f.navigation.dispose();
  }
});

test('binding cancels in-flight input and rejects invalid renderers without rebasing valid private limits', () => {
  const f = fixture({ motion: true }); assert.equal(f.navigation.bind(f.renderer), true);
  f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 205 }); assert.equal(f.pendingFrames, 1);
  assert.equal(f.navigation.bind(f.renderer, { preserveLimits: true }), true);
  assert.equal(f.pendingFrames, 0); assert.equal(f.captured.size, 0); assert.equal(f.classes.size, 0);
  const count = f.writes.length; f.tick(1000); assert.equal(f.writes.length, count);
  for (const invalid of [null, {}, { getCameraPose: () => initial() },
    { getCameraPose() { throw Error('Disposed renderer.'); }, setCameraPose() {} },
    { getCameraPose: () => ({ position: {}, target: {} }), setCameraPose() {} }]) assert.equal(f.navigation.bind(invalid), false);
  assert.equal(f.navigation.bind(f.renderer, { preserveLimits: 'yes' }), false);
  f.setMotion(false);
  for (let index = 0; index < 30; index++) f.surface.fire('wheel', { deltaY: -240, deltaMode: 0 });
  near(radius(f.pose), 25);
  f.navigation.dispose(); assert.equal(f.navigation.bind(f.renderer), false);
});

test('normal-motion orbit responds immediately then settles in a finite demand-driven RAF sequence', () => {
  const f = fixture({ motion: true });
  f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 205, clientY: 184 });
  assert.equal(f.writes.length, 1); assert.equal(f.pendingFrames, 1);
  assert.notDeepEqual(f.pose, initial());
  const responsivePose = structuredClone(f.pose);
  f.view.fire('pointerup'); assert.equal(f.captured.size, 0);
  const frames = f.settle(); assert.ok(frames <= 12, 'at 16ms steps the 160ms ease must finish rather than keep rendering');
  const theta = -75 * Math.PI * 2 / viewport.width, phi = Math.PI / 2 - 34 * Math.PI / viewport.height;
  near(f.pose.position.x, 12 + 100 * Math.sin(phi) * Math.sin(theta));
  near(f.pose.position.y, -7 + 100 * Math.cos(phi)); near(f.pose.position.z, 3 + 100 * Math.sin(phi) * Math.cos(theta));
  assert.deepEqual(f.pose.target, initial().target); assert.notDeepEqual(f.pose, responsivePose);
  for (const pose of f.writes) { near(radius(pose), 100); assert.ok(Object.values(pose.position).every(Number.isFinite)); }
  const completeWrites = f.writes.length; f.tick(1000); f.tick(1000);
  assert.equal(f.writes.length, completeWrites); assert.equal(f.pendingFrames, 0); f.navigation.dispose();
});

test('a non-advancing RAF clock cannot create an unbounded camera animation', () => {
  const f = fixture({ motion: true });
  f.surface.fire('wheel', { deltaY: -120, deltaMode: 0 });
  for (let count = 0; count < 60 && f.pendingFrames; count++) f.tick(0);
  assert.equal(f.pendingFrames, 0); near(radius(f.pose), 100 / Math.exp(0.24));
  assert.ok(f.writes.length <= 50); const writes = f.writes.length; f.tick(1000); assert.equal(f.writes.length, writes);
  f.navigation.dispose();
});

test('rapid wheel input keeps one finite easing task, preserves its anchor and respects the fitted limits', () => {
  const f = fixture({ motion: true, startingPose: orientations()[1] });
  const old = structuredClone(f.pose), at = { x: 80, y: 70 }, anchor = targetPlanePoint(at, old);
  for (let index = 0; index < 30; index++) f.surface.fire('wheel', { clientX: at.x + 20, clientY: at.y + 30, deltaY: -240, deltaMode: 0 });
  assert.equal(f.pendingFrames, 1); f.settle(); near(radius(f.pose), radius(old) / 4);
  near(project(anchor, f.pose).x, at.x); near(project(anchor, f.pose).y, at.y);
  for (let index = 0; index < 40; index++) f.surface.fire('wheel', { clientX: at.x + 20, clientY: at.y + 30, deltaY: 240, deltaMode: 0 });
  assert.equal(f.pendingFrames, 1); f.settle(); near(radius(f.pose), radius(old) * 4);
  near(project(anchor, f.pose).x, at.x); near(project(anchor, f.pose).y, at.y);
  const completed = f.writes.length; f.tick(1000); assert.equal(f.writes.length, completed); f.navigation.dispose();
});

test('reduced motion applies exact navigation immediately and an active preference change ends easing', () => {
  for (const useMediaPreference of [false, true]) {
    const f = fixture({ useMediaPreference });
    f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 205, clientY: 150 });
    const angle = 75 * Math.PI * 2 / viewport.width;
    near(f.pose.position.x, 12 - 100 * Math.sin(angle)); near(f.pose.position.z, 3 + 100 * Math.cos(angle));
    assert.equal(f.pendingFrames, 0); f.view.fire('pointerup');
    f.setMotion(true); f.surface.fire('wheel', { deltaY: -120, deltaMode: 0 });
    assert.equal(f.pendingFrames, 1); f.setMotion(false); f.tick(); assert.equal(f.pendingFrames, 0);
    near(radius(f.pose), 100 / Math.exp(0.24));
    const count = f.writes.length; f.tick(1000); assert.equal(f.writes.length, count); f.navigation.dispose();
  }
});

test('Fit, cancellation, lost capture, close-style reset and lifetime changes cancel every pending easing task', () => {
  const interrupts = [f => f.view.fire('pointercancel'), f => f.surface.fire('lostpointercapture'), f => f.view.fire('blur'),
    f => { f.doc.hidden = true; f.doc.fire('visibilitychange'); }, f => f.view.fire('resize'), f => f.view.fire('orientationchange'),
    f => f.navigation.cancel(), f => f.navigation.resetGesture(), f => f.navigation.fit(), f => f.navigation.dispose()];
  for (const interrupt of interrupts) {
    const f = fixture({ motion: true }); f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 205 });
    assert.equal(f.pendingFrames, 1); interrupt(f);
    assert.equal(f.pendingFrames, 0); assert.equal(f.captured.size, 0); assert.equal(f.classes.size, 0);
    const count = f.writes.length; f.tick(1000); f.tick(1000); assert.equal(f.writes.length, count);
    f.navigation.dispose(); assert.equal(f.surface.count + f.view.count + f.doc.count, 0);
  }
  for (const change of [f => f.resize(), f => f.deactivate(), f => { f.doc.hidden = true; }]) {
    const f = fixture({ motion: true }); f.surface.fire('wheel', { deltaY: -80, deltaMode: 0 });
    const count = f.writes.length; change(f); f.tick();
    assert.equal(f.pendingFrames, 0); assert.equal(f.writes.length, count); f.navigation.dispose();
  }
});

test('a third contact cancels easing without flushing another camera write, and new deliberate input can recover', () => {
  const f = fixture({ motion: true });
  f.surface.fire('pointerdown'); f.surface.fire('pointerdown', { pointerId: 2, clientX: 230 });
  f.view.fire('pointermove', { pointerId: 2, clientX: 290 }); assert.equal(f.pendingFrames, 1);
  const count = f.writes.length;
  f.surface.fire('pointerdown', { pointerId: 3, clientX: 300 });
  assert.equal(f.pendingFrames, 0); assert.equal(f.writes.length, count); assert.equal(f.captured.size, 0);
  f.tick(1000); assert.equal(f.writes.length, count);
  for (const pointerId of [3, 2, 1]) f.view.fire('pointerup', { pointerId });
  f.surface.fire('pointerdown'); f.view.fire('pointermove', { clientX: 190 }); f.view.fire('pointerup'); f.settle();
  assert.ok(f.writes.length > count); f.navigation.dispose();
});
