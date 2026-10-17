import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createSummaryEffects, planSummaryEffects, planSummaryNodeMerge, sampleSummaryNodeMerge,
  createSummaryStartGate, SUMMARY_START_MAX_FRAMES,
  SUMMARY_EFFECT_MS, SUMMARY_NODE_MERGE_MS, SUMMARY_NODE_MERGE_MAX_FRAMES } from '../examples/browser-model-chat/memory/summary-effects.mjs';
import { projectConversationSummary } from '../examples/browser-model-chat/memory/panel.mjs';

const rendererSource = stripTypeScriptTypes(await readFile(new URL('../modules/browser-rag-ts/src/application/graphRenderer.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const point = (node_id, x, y = 0, z = 0) => ({ node_id, x, y, z });
const sourceId = 'turn:t-0001', targetId = 'summary:committed';
const sourceColor = 0x0ea5ff, targetColor = 0x22e37f, personaColor = 0xc81fff;
const canonicalColors = new Map([[sourceId, sourceColor], [targetId, targetColor], ['persona:untouched', personaColor]]);
const positions = [point(sourceId, -40, 10, 20), point(targetId, 45, -15, -10), point('persona:untouched', 0, 50, 20)];
const nodes = positions.map(({ node_id: id, x, y, z }) => ({ id, kind: 'chunk', record_id: null, source_id: id, path: 'memory/' + id, x, y, z }));
const graphData = { nodes, links: [] };

// This uses the actual consumer wrapper and its producer position-mutation port.
// The boundary graph is labeled, deterministic and does not stand in for GPU pixel proof.
async function rendererFixture() {
  const state = { positions: new Map(), bodyColors: new Map(), colorWrites: [], fixedWrites: [], renders: 0, raf: new Map(), listeners: new Map() };
  const canvas = { clientWidth: 800, clientHeight: 600, dataset: {},
    addEventListener(name, callback) { state.listeners.set(name, callback); }, removeEventListener() {}, dispatchEvent() {} };
  const graph = {
    getStartupReport: () => ({ renderer: { selected: 'webgl2' } }), on: () => () => {}, getDiagnostics: () => ({ backend: 'webgl2' }),
    getCameraPose: () => structuredClone(state.pose), setCameraPose: pose => { state.pose = structuredClone(pose); },
    getNodePosition: id => state.positions.get(id),
    getGraphView: () => ({ hasNode: id => state.positions.has(id), getNode: id => state.nodes.find(node => node.id === id) }),
    setData(data) { state.nodes = structuredClone(data.nodes); state.positions = new Map(data.nodes.map(node => [node.id, { ...node.initialPosition }])); this.refreshNodeStyles(data.nodes.map(node => node.id)); },
    setNodeFixed(id, value) { if (!state.positions.has(id)) return false; state.fixedWrites.push({ id, ...value }); state.positions.set(id, { ...value }); return true; },
    setNodeStyle(style) { state.nodeStyle = { ...state.nodeStyle, ...style }; this.refreshNodeStyles(state.positions.keys()); },
    refreshNodeStyles(ids) { for (const id of ids) { const node = state.nodes.find(node => node.id === id); if (!node) continue;
      const color = state.nodeStyle.color(node); state.bodyColors.set(id, color); state.colorWrites.push({ id, color }); } },
    setNodeFlagsMany() {}, setNodeSurface(surface) { state.surface = surface; }, setSelection() {}, clearSelection() {},
    setLinkStyle() {}, setLinkFlow() {}, render() { state.renders++; }, clear() { state.positions.clear(); }, dispose() {},
  };
  class Camera { position = { set() {} }; lookAt() {} updateMatrixWorld() {} updateProjectionMatrix() {} }
  class Vector { constructor(x, y, z) { Object.assign(this, { x, y, z }); } project() { return { x: this.x / 200, y: this.y / 200, z: 0 }; } }
  let rafId = 0;
  const factory = runInNewContext(rendererSource + '\ncreateTslRagGraphRenderer;', {
    THREE: { PerspectiveCamera: Camera, Vector3: Vector }, TSL: {}, NodeFlags: { Focused: 4 },
    graphColorNumber: () => 0x0ea5ff, graphFamilyColorNumber: () => 0x0ea5ff,
    window: { devicePixelRatio: 1 }, Event, matchMedia: () => ({ matches: false }),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => { state.raf.set(++rafId, callback); return rafId; }, cancelAnimationFrame: id => state.raf.delete(id),
    createThreePlatform: () => ({}), createForceGraph3D: async options => { state.pose = options.renderer.cameraPose; state.nodeStyle = options.nodes; return graph; },
    createNodeSpawnMotion: () => ({ scale: () => 1, activeCount: 0, setMany() {}, animate() {}, pulse() {}, cancelAll() {}, dispose() {} }),
    sampleCameraPoseTween() { throw Error('Camera must stay still during actual node convergence.'); }, planPerspectiveCameraFrame() { throw Error('Spatial fixture uses native spatial framing.'); },
  });
  const renderer = await factory({ canvas, presentation: 'memory-spatial', nodeColor: id => canonicalColors.get(id),
    onNodeActivate() {}, onTerminalFailure(message) { throw Error(message); } });
  renderer.render(graphData);
  return { renderer, state, canvas };
}

function effectFixture(renderer, { motion = true, onFinish = () => {}, projected, failUpdate = false } = {}) {
  const frames = new Map(), timers = new Map(), updates = [], finished = [];
  let frameId = 0, timerId = 0;
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; this.clientWidth = 800; this.clientHeight = 600; }
    setAttribute() {} append(node) { node.parent = this; this.children.push(node); } prepend(node) { node.parent = this; this.children.unshift(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    animate() { return { cancel() {} }; }
  }
  const document = { createElement: () => new Element(), createElementNS: () => new Element(), visibilityState: 'visible' };
  const container = new Element(); container.ownerDocument = document;
  const effects = createSummaryEffects({ container,
    getTargets: () => projected ?? renderer.diagnostics().node_targets, getNodePositions: () => renderer.diagnostics().node_positions,
    beginNodePresentation: ids => { const lease = renderer.beginNodePresentation(ids); return lease && {
      positions: lease.positions, get active() { return lease.active; }, restore: () => lease.restore(),
      update(values) { updates.push(structuredClone(values)); return !failUpdate && lease.update(values); },
    }; },
    getMotionEnabled: () => motion,
    onFinish: eventId => { finished.push(eventId); onFinish(eventId); },
    requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id),
    schedule: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; }, unschedule: id => timers.delete(id),
  });
  return { effects, container, frames, timers, updates, finished, document,
    frame(time) { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(time); },
    expire() { const callbacks = [...timers.values()]; timers.clear(); for (const item of callbacks) item.callback(); } };
}
const event = (eventId = 'committed') => ({ eventId, sourceNodeIds: [sourceId], targetNodeId: targetId });

function gateFixture() {
  const frames = new Map(), starts = [], unavailable = [], state = { current: true, layout: { width: 800, height: 500, revision: 1 } };
  let sequence = 0;
  const gate = createSummaryStartGate({ getLayout: () => { if (state.error) throw Error('Labeled layout refusal.'); return state.layout; },
    isCurrent: () => state.current, start: id => starts.push(id), onUnavailable: id => unavailable.push(id),
    requestFrame: callback => { frames.set(++sequence, callback); return sequence; }, cancelFrame: id => frames.delete(id) });
  return { gate, frames, starts, unavailable, state,
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); } };
}

test('start waits for two stable host-layout frames after footer height and graph revision changes', () => {
  const f = gateFixture(); f.gate.queue('fresh'); f.frame(); assert.deepEqual(f.starts, []);
  f.state.layout = { width: 800, height: 482, revision: 2 }; f.frame(); assert.deepEqual(f.starts, []);
  f.frame(); assert.deepEqual(f.starts, ['fresh']); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.gate.diagnostics(), { pending: false, eventId: null, frameCount: 0, scheduledFrames: 0 });
});

test('unstable layout has a strict eight-frame wait and cannot leave a repeating idle clock', () => {
  const f = gateFixture(); f.gate.queue('fresh');
  for (let index = 0; index < 100; index++) { f.state.layout.revision = index; f.frame(); }
  assert.deepEqual(f.starts, []); assert.deepEqual(f.unavailable, ['fresh']); assert.equal(f.frames.size, 0);
  assert.equal(SUMMARY_START_MAX_FRAMES, 8); assert.equal(f.gate.diagnostics().pending, false);
});

test('navigation cancellation drops a scheduled start and rejects its late stale callback', () => {
  const f = gateFixture(); f.gate.queue('fresh'); const stale = [...f.frames.values()][0]; f.gate.cancel(); stale();
  assert.deepEqual(f.starts, []); assert.deepEqual(f.unavailable, []); assert.equal(f.frames.size, 0);
  f.gate.cancel(); assert.equal(f.gate.diagnostics().scheduledFrames, 0);
});

test('repeated observation keeps one pending start and replacement cannot start the old event', () => {
  const f = gateFixture(); assert.equal(f.gate.queue('old'), true); const stale = [...f.frames.values()][0];
  assert.equal(f.gate.queue('old'), false); assert.equal(f.frames.size, 1);
  f.gate.queue('fresh'); stale(); f.frame(); f.frame(); assert.deepEqual(f.starts, ['fresh']); assert.equal(f.frames.size, 0);
});

test('scope, visibility, invalid viewport and failed layout checks do not authorize delayed movement', () => {
  for (const change of [f => { f.state.current = false; }, f => { f.state.layout.height = 0; },
    f => { f.state.layout.revision = NaN; }, f => { f.state.error = true; }]) {
    const f = gateFixture(); f.gate.queue('fresh'); change(f); f.frame();
    assert.deepEqual(f.starts, []); assert.deepEqual(f.unavailable, ['fresh']); assert.equal(f.frames.size, 0);
  }
});

test('disposal cancels an unstarted effect and cannot schedule another event', () => {
  const f = gateFixture(); f.gate.queue('fresh'); f.gate.dispose(); f.gate.dispose();
  assert.equal(f.gate.queue('later'), false); assert.equal(f.gate.queue(''), false); f.frame();
  assert.deepEqual(f.starts, []); assert.equal(f.frames.size, 0);
});

test('world merge planning requires the same unique finite visible mesh endpoints, without guessing', () => {
  const plan = planSummaryEffects(event(), [{ node_id: sourceId, x: 100, y: 100, visible: true }, { node_id: targetId, x: 200, y: 200, visible: true }], { width: 800, height: 600 });
  const merge = planSummaryNodeMerge(plan, positions);
  assert.deepEqual(merge.sources, [positions[0]]); assert.deepEqual(merge.target, positions[1]);
  for (const invalid of [[], positions.slice(1), [...positions, positions[0]], [...positions, positions[1]],
    positions.map(row => row.node_id === targetId ? { ...row, z: NaN } : row), positions.map(row => ({ ...row, x: 100001 }))]) {
    assert.equal(planSummaryNodeMerge(plan, invalid), null);
  }
  const first = sampleSummaryNodeMerge(merge, 0), middle = sampleSummaryNodeMerge(merge, 400), end = sampleSummaryNodeMerge(merge, SUMMARY_NODE_MERGE_MS);
  assert.deepEqual(first.positions, [positions[0]]);
  assert.ok(middle.positions[0].x > positions[0].x && middle.positions[0].x < positions[1].x);
  assert.deepEqual(end.positions, [{ ...positions[1], node_id: sourceId }]); assert.equal(end.phase, 'merged');
  assert.equal(sampleSummaryNodeMerge(merge, NaN), null); assert.deepEqual(positions[0], point(sourceId, -40, 10, 20));
});

test('renderer lease moves existing native source positions, preserves target/identities and restores original coordinates', async () => {
  const { renderer, state } = await rendererFixture();
  const canonical = structuredClone(graphData), lease = renderer.beginNodePresentation([sourceId]);
  assert.equal(lease.active, true); assert.deepEqual(structuredClone(lease.positions), [positions[0]]);
  const destination = [{ ...positions[1], node_id: sourceId }]; assert.equal(lease.update(destination), true);
  assert.deepEqual(state.positions.get(sourceId), { x: 45, y: -15, z: -10 });
  assert.deepEqual(state.positions.get(targetId), { x: 45, y: -15, z: -10 });
  assert.deepEqual([...state.positions.keys()], positions.map(value => value.node_id));
  for (const invalid of [[], [point(targetId, 0)], [point(sourceId, Infinity)], [point(sourceId, 100001)], [point(sourceId, 1), point(sourceId, 2)]]) {
    const count = state.fixedWrites.length; assert.equal(lease.update(invalid), false); assert.equal(state.fixedWrites.length, count);
  }
  lease.restore(); lease.restore(); assert.equal(lease.active, false); assert.equal(lease.update(destination), false);
  assert.deepEqual(state.positions.get(sourceId), { x: -40, y: 10, z: 20 });
  assert.ok(state.fixedWrites.every(value => value.id === sourceId)); assert.deepEqual(graphData, canonical); renderer.dispose();
});

test('a presentation tween reaches the destination hue through actual producer body styles without changing canonical colors', async () => {
  const { renderer, state, canvas } = await rendererFixture(), canonical = structuredClone(graphData);
  const colors = () => new Map(renderer.diagnostics().node_colors.map(row => [row.node_id, row.base_color]));
  assert.equal(state.bodyColors.get(sourceId), 0x0160ff, 'producer initially receives the linear blue material anchor');
  assert.equal(state.bodyColors.get(targetId), 0x04c436, 'producer target initially receives the linear emerald material anchor');
  const lease = renderer.beginNodePresentation([sourceId], { targetColor });
  assert.equal(lease.update([positions[0]], 0), true); assert.equal(colors().get(sourceId), sourceColor);
  const middle = [{ ...positions[0], x: 0 }]; assert.equal(lease.update(middle, .5), true);
  assert.equal(colors().get(sourceId), 0x18c4bf, 'displayed sRGB midpoint is derived from the captured source and exact target');
  assert.equal(state.bodyColors.get(sourceId), 0x028d85, 'actual producer receives the midpoint after material linearization');
  assert.equal(JSON.parse(canvas.dataset.nodeColors).find(row => row.node_id === sourceId).base_color, 0x18c4bf);
  assert.equal(colors().get(targetId), targetColor); assert.equal(colors().get('persona:untouched'), personaColor);
  assert.equal(lease.update([{ ...positions[1], node_id: sourceId }], 1), true);
  assert.equal(state.bodyColors.get(sourceId), state.bodyColors.get(targetId)); assert.equal(colors().get(sourceId), targetColor);
  lease.restore(); assert.equal(colors().get(sourceId), sourceColor); assert.equal(state.bodyColors.get(sourceId), 0x0160ff);
  assert.deepEqual(state.positions.get(sourceId), { x: -40, y: 10, z: 20 }); assert.deepEqual(graphData, canonical);
  const positionOnly = renderer.beginNodePresentation([sourceId]); positionOnly.update(middle);
  assert.equal(colors().get(sourceId), sourceColor, 'a later position-only lease cannot inherit a prior transient color');
  positionOnly.restore(); renderer.dispose();
});

test('each leased body interpolates its own captured RGB and invalid updates cannot partially mutate color or position', async () => {
  const { renderer, state, canvas } = await rendererFixture(), ids = [sourceId, 'persona:untouched'];
  const lease = renderer.beginNodePresentation(ids, { targetColor });
  const originals = [positions[0], positions[2]];
  assert.equal(lease.update(originals, .5), true);
  assert.equal(state.bodyColors.get(sourceId), 0x028d85); assert.equal(state.bodyColors.get(ids[1]), 0x2d3885);
  for (const progress of [NaN, Infinity, -.01, 1.01, null, '0.5']) {
    const before = { positions: structuredClone([...state.positions]), colors: canvas.dataset.nodeColors, fixed: state.fixedWrites.length, styles: state.colorWrites.length };
    assert.equal(lease.update(originals.map(row => ({ ...row, x: row.x + 1 })), progress), false);
    assert.deepEqual([...state.positions], before.positions); assert.equal(canvas.dataset.nodeColors, before.colors);
    assert.equal(state.fixedWrites.length, before.fixed); assert.equal(state.colorWrites.length, before.styles);
  }
  const before = { colors: canvas.dataset.nodeColors, fixed: state.fixedWrites.length, styles: state.colorWrites.length };
  assert.equal(lease.update([point(sourceId, 100), point('wrong-second-id', 200)], 1), false);
  assert.equal(canvas.dataset.nodeColors, before.colors); assert.equal(state.fixedWrites.length, before.fixed); assert.equal(state.colorWrites.length, before.styles);
  lease.restore(); assert.equal(state.bodyColors.get(sourceId), 0x0160ff); assert.equal(state.bodyColors.get(ids[1]), 0x9303ff);
  renderer.dispose();
});

test('invalid target colors reject a new lease without interrupting the active valid presentation', async () => {
  const { renderer, state } = await rendererFixture(), lease = renderer.beginNodePresentation([sourceId], { targetColor });
  lease.update([positions[0]], .5);
  for (const targetColor of [NaN, Infinity, -1, 0x1000000, .5, null, '22e37f']) {
    const before = { fixed: state.fixedWrites.length, styles: state.colorWrites.length };
    assert.equal(renderer.beginNodePresentation([sourceId], { targetColor }), null); assert.equal(lease.active, true);
    assert.equal(state.fixedWrites.length, before.fixed); assert.equal(state.colorWrites.length, before.styles);
  }
  assert.equal(renderer.beginNodePresentation([sourceId], null), null); assert.equal(lease.active, true);
  lease.restore(); renderer.dispose();
});

test('selection and focus preserve the actual tween body while the selected aura restores on cancellation', async () => {
  const { renderer, state } = await rendererFixture();
  const lease = renderer.beginNodePresentation([sourceId], { targetColor }); lease.update([positions[0]], .5);
  renderer.setInteractionState(sourceId, [sourceId]);
  assert.equal(state.bodyColors.get(sourceId), 0x028d85); assert.equal(state.surface.selectionEffect.color, 0x028d85);
  renderer.stopMotion(); assert.equal(lease.active, false);
  assert.equal(state.bodyColors.get(sourceId), 0x0160ff); assert.equal(state.surface.selectionEffect.color, 0x0160ff);
  renderer.dispose();
});

test('renderer leases cannot overwrite replacement topology and cancel on camera, motion, fit, clear and disposal', async () => {
  for (const cancel of [renderer => renderer.setCameraPose(renderer.getCameraPose()), renderer => renderer.fit(), renderer => renderer.setMotionEnabled(false),
    renderer => renderer.stopMotion(), renderer => renderer.clear(), renderer => renderer.dispose(), renderer => renderer.render(graphData)]) {
    const { renderer, state } = await rendererFixture(), lease = renderer.beginNodePresentation([sourceId], { targetColor });
    lease.update([{ ...positions[1], node_id: sourceId }], .5); cancel(renderer); const writes = state.fixedWrites.length;
    assert.equal(lease.active, false); lease.restore(); assert.equal(state.fixedWrites.length, writes);
    if (state.positions.has(sourceId)) {
      assert.deepEqual(state.positions.get(sourceId), { x: -40, y: 10, z: 20 });
      assert.equal(state.bodyColors.get(sourceId), 0x0160ff, 'cancellation restores the actual producer source material');
      const diagnostics = renderer.diagnostics();
      if (diagnostics.viewport.lifecycle === 'disposed') assert.equal(diagnostics.node_colors.length, 0);
      else assert.equal(diagnostics.node_colors.find(row => row.node_id === sourceId).base_color, sourceColor);
    }
    renderer.dispose();
  }
  const { renderer } = await rendererFixture();
  assert.equal(renderer.beginNodePresentation(['missing']), null); assert.equal(renderer.beginNodePresentation([sourceId, sourceId]), null);
  assert.equal(renderer.beginNodePresentation(Array(13).fill(sourceId)), null);
  const old = renderer.beginNodePresentation([sourceId]), next = renderer.beginNodePresentation([sourceId]);
  assert.equal(old.active, false); assert.equal(next.active, true); next.restore(); renderer.dispose();
});

test('fresh committed effects move actual producer meshes to the real retained target, then settle to summary-only projection', async () => {
  const { renderer, state, canvas } = await rendererFixture();
  const canonical = structuredClone(graphData);
  const f = effectFixture(renderer, { onFinish() { renderer.render({ ...graphData, nodes: graphData.nodes.filter(node => node.id !== sourceId) }); } });
  assert.equal(f.effects.play(event()).movingNodeCount, 1);
  f.frame(0); f.frame(400);
  const during = JSON.parse(canvas.dataset.nodePositions).find(node => node.node_id === sourceId);
  assert.ok(during.x > -40 && during.x < 45, 'actual producer position changed, rather than an overlay stand-in');
  f.frame(920);
  assert.deepEqual(state.positions.get(sourceId), state.positions.get(targetId));
  assert.equal(f.container.children[0].dataset.nodeMergePhase, 'merged');
  f.frame(SUMMARY_NODE_MERGE_MS); assert.equal(f.frames.size, 0); assert.equal(f.effects.diagnostics().movingNodeCount, 1);
  assert.equal(f.container.children[0].dataset.targetNodeId, targetId); assert.ok(f.container.children[0].children.length > 1);
  f.expire(); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.effects.diagnostics().active, false);
  assert.deepEqual(f.finished, ['committed']); assert.ok(!state.positions.has(sourceId)); assert.ok(state.positions.has(targetId));
  assert.equal(f.effects.play(event()).reason, 'already-seen'); assert.deepEqual(graphData, canonical); renderer.dispose();
});

test('interruption, hidden document and refused movement restore sources and retain no frame work', async () => {
  for (const interrupt of [(f, renderer) => f.effects.stop(), (f, renderer) => renderer.setCameraPose(renderer.getCameraPose()),
    f => { f.document.visibilityState = 'hidden'; }, f => f.effects.dispose()]) {
    const { renderer, state } = await rendererFixture(), f = effectFixture(renderer);
    f.effects.play(event()); f.frame(0); f.frame(400); interrupt(f, renderer); f.frame(500);
    assert.equal(f.effects.diagnostics().active, false); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
    assert.deepEqual(state.positions.get(sourceId), { x: -40, y: 10, z: 20 }); renderer.dispose();
  }
  const { renderer } = await rendererFixture(), f = effectFixture(renderer, { failUpdate: true });
  f.effects.play(event()); f.frame(0); assert.equal(f.effects.diagnostics().active, false); assert.equal(f.frames.size, 0); assert.deepEqual(f.finished, ['committed']); renderer.dispose();
});

test('reduced motion settles sources immediately, marks the real summary, and schedules no movement', async () => {
  const { renderer, state } = await rendererFixture(); let settled = false;
  const f = effectFixture(renderer, { motion: false, onFinish() { if (settled) return; settled = true; renderer.render({ ...graphData, nodes: graphData.nodes.filter(node => node.id !== sourceId) }); } });
  const result = f.effects.play(event()); assert.equal(result.reason, 'reduced-motion'); assert.equal(result.played, true);
  assert.equal(result.movingNodeCount, 0); assert.equal(result.particleCount, 0); assert.equal(f.frames.size, 0);
  assert.ok(!state.positions.has(sourceId)); assert.ok(state.positions.has(targetId));
  assert.equal(f.container.children[0].children[0].dataset.nodeId, targetId); assert.equal(f.effects.diagnostics().animationCount, 0);
  f.expire(); assert.equal(f.effects.diagnostics().scheduledCallbacks, 0); renderer.dispose();
});

test('movement has an independent strict frame cap and expiry removes all light/motion work', async () => {
  const { renderer } = await rendererFixture(), f = effectFixture(renderer);
  f.effects.play(event()); for (let i = 0; i < 200; i++) f.frame(0);
  assert.equal(f.updates.length, SUMMARY_NODE_MERGE_MAX_FRAMES); assert.equal(f.frames.size, 0);
  assert.equal(f.effects.diagnostics().nodeMergePhase, 'merged');
  assert.deepEqual([...f.timers.values()].map(value => value.ms), [SUMMARY_EFFECT_MS]); f.expire();
  assert.equal(f.effects.diagnostics().framePending, false); assert.equal(f.container.children.length, 0); renderer.dispose();
});

test('settled summary projection hides only represented originals; exact search/source reveal remains local and immutable', () => {
  const summary = { id: targetId, eventId: 'committed', kind: 'summary', scope: 'conversation', derived: true,
    sourceTurnIds: ['t-0001'], text: 'Authored facts with exact source lineage.' };
  const base = { nodes: [{ id: sourceId, kind: 'message', turnId: 't-0001', scope: 'conversation', role: 'user' },
    { id: 'turn:t-0002', kind: 'message', scope: 'conversation', role: 'assistant' }, { id: 'persona:unaffected', scope: 'persona' }], links: [] };
  const canonical = structuredClone(base);
  assert.deepEqual(projectConversationSummary(base, summary).nodes.map(node => node.id), [targetId, 'turn:t-0002', 'persona:unaffected']);
  const visible = projectConversationSummary(base, summary, [sourceId]);
  assert.deepEqual(visible.nodes.map(node => node.id), [targetId, sourceId, 'turn:t-0002', 'persona:unaffected']);
  assert.deepEqual(visible.links.map(link => [link.source, link.target]), [[sourceId, targetId]]);
  assert.deepEqual(base, canonical); assert.equal(summary.scope, 'conversation');
});
