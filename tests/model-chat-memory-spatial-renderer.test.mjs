import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const rendererPath = new URL('../modules/browser-rag-ts/src/application/graphRenderer.ts', import.meta.url);
const palettePath = new URL('../modules/browser-rag-ts/src/application/graphPalette.ts', import.meta.url);
const palette = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await readFile(palettePath, 'utf8'))).toString('base64'));
const source = stripTypeScriptTypes(await readFile(rendererPath, 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(source, /^import\b/m);

// Exercise the actual wrapper against a graph-engine boundary. This proves
// options, payloads and lifecycle decisions, not GPU pixels or native projection.
async function mount(options = {}, width = 390, height = 500) {
  const state = { colors: new Map(), nodes: [], surfaces: [], frames: [], renders: 0, raf: new Map(), motion: { pulses: 0 } };
  const canvas = { clientWidth: width, clientHeight: height, dataset: {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const graph = {
    getStartupReport: () => ({ renderer: { selected: 'webgl2' } }),
    on: () => () => {}, getDiagnostics: () => ({ backend: 'webgl2' }),
    getCameraPose: () => structuredClone(state.pose), setCameraPose: pose => { state.pose = structuredClone(pose); },
    getNodePosition: id => state.nodes.find(node => node.id === id)?.initialPosition,
    getGraphBounds: () => state.nodes.length ? {
      min: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.min(...state.nodes.map(node => node.initialPosition[axis]))])),
      max: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.max(...state.nodes.map(node => node.initialPosition[axis]))])),
    } : undefined,
    getGraphView: () => ({ hasNode: id => state.nodes.some(node => node.id === id), getNode: id => state.nodes.find(node => node.id === id) }),
    setData(data) { state.nodes = structuredClone(data.nodes); for (const node of data.nodes) state.colors.set(node.id, state.options.nodes.color(node)); },
    setNodeStyle: value => { state.style = value; }, refreshNodeStyles() {}, setNodeFlagsMany() {},
    setNodeSurface: value => state.surfaces.push(structuredClone(value)),
    setSelection: value => { state.selection = [...value]; }, clearSelection: () => { state.selection = []; },
    setLinkStyle() {}, setLinkFlow() {}, render: () => state.renders++, clear: () => { state.nodes = []; }, dispose() {},
  };
  class Camera { position = { set() {} }; lookAt() {} updateMatrixWorld() {} updateProjectionMatrix() {} }
  class Vector { project() { return { x: 0, y: 0, z: 0 }; } }
  let nextRaf = 0;
  const factory = runInNewContext(source + '\ncreateTslRagGraphRenderer;', {
    ...palette, THREE: { PerspectiveCamera: Camera, Vector3: Vector }, TSL: {}, NodeFlags: { Focused: 4 },
    window: { devicePixelRatio: 2 }, Event, matchMedia: () => ({ matches: false }),
    ResizeObserver: class { constructor(callback) { state.resize = callback; } observe() {} disconnect() {} },
    requestAnimationFrame: callback => { state.raf.set(++nextRaf, callback); return nextRaf; },
    cancelAnimationFrame: id => state.raf.delete(id),
    createThreePlatform: () => ({}), createForceGraph3D: async value => {
      state.options = value; state.pose = structuredClone(value.renderer.cameraPose); return graph;
    },
    createNodeSpawnMotion: callbacks => ({ scale: () => 1, activeCount: 0, setMany() {}, animate() {},
      pulse() { if (!callbacks.reducedMotion()) state.motion.pulses++; }, cancelAll() {}, dispose() {} }),
    sampleCameraPoseTween() { throw Error('No tween sampling expected in quiet contract checks.'); },
    planPerspectiveCameraFrame: (bounds, frameOptions) => {
      state.frames.push(structuredClone({ bounds, options: frameOptions }));
      const target = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (bounds.min[axis] + bounds.max[axis]) / 2]));
      const direction = frameOptions.direction || { x: 0, y: 0, z: 1 }, length = Math.hypot(direction.x, direction.y, direction.z);
      return { target, position: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, target[axis] + direction[axis] / length * 200])) };
    },
  }, { filename: 'graphRenderer-spatial-contract.ts' });
  const renderer = await factory({ canvas, onNodeActivate() {}, onTerminalFailure(error) { throw Error(error); }, ...options });
  renderer.setMotionEnabled(false);
  return { renderer, state, canvas, flush() { const callbacks = [...state.raf.values()]; state.raf.clear(); for (const callback of callbacks) callback(0); } };
}
const node = (id, kind, x, y, z) => ({ id, kind, x, y, z, record_id: null, source_id: id, path: 'memory/' + id });
const positioned = { nodes: [node('conversation', 'chunk', -34, 9, -22), node('persona', 'chunk', 15, -26, 37), node('global', 'source', 41, 31, -8)], links: [] };
const scopeColors = { conversation: 0x0ea5ff, persona: 0xc81fff, global: 0xf59e0b };
const linearColors = { conversation: 0x0160ff, persona: 0x9303ff, global: 0xe95701 };
function cameraBasis(pose) {
  const delta = ['x', 'y', 'z'].map(axis => pose.position[axis] - pose.target[axis]), length = Math.hypot(...delta);
  const normal = delta.map(value => value / length), sideLength = Math.hypot(normal[0], normal[2]);
  const right = [normal[2] / sideLength, 0, -normal[0] / sideLength];
  return { normal, right, up: [normal[1] * right[2], normal[2] * right[0] - normal[0] * right[2], -normal[1] * right[0]] };
}
function assertDirection(pose, expected) {
  const actual = cameraBasis(pose).normal, length = Math.hypot(expected.x, expected.y, expected.z);
  for (const [index, axis] of ['x', 'y', 'z'].entries()) assert.ok(Math.abs(actual[index] - expected[axis] / length) < 1e-10);
}
function bodyExtent({ state, canvas }) {
  const basis = cameraBasis(state.pose), focal = canvas.clientHeight / (2 * Math.tan(25 * Math.PI / 180));
  const dot = (point, axis) => point.reduce((sum, value, index) => sum + value * axis[index], 0);
  const targets = state.nodes.map(node => {
    const relative = ['x', 'y', 'z'].map(axis => node.initialPosition[axis] - state.pose.position[axis]);
    const depth = -dot(relative, basis.normal), radius = state.style.radius(node) * focal / depth;
    return { x: dot(relative, basis.right) * focal / depth, y: dot(relative, basis.up) * focal / depth, radius };
  });
  return { width: (Math.max(...targets.map(p => p.x + p.radius)) - Math.min(...targets.map(p => p.x - p.radius))) / canvas.clientWidth,
    height: (Math.max(...targets.map(p => p.y + p.radius)) - Math.min(...targets.map(p => p.y - p.radius))) / canvas.clientHeight, targets };
}

test('spatial opt-in preserves supplied XYZ and native depth diagnostics without changing identities', async () => {
  const { renderer, state, canvas } = await mount({ presentation: 'memory-spatial', nodeColor: id => scopeColors[id] }, 900, 500);
  renderer.render(positioned);
  assert.equal(state.options.layout.dimensions, 3); assert.equal(state.options.layout.autoStart, false);
  for (const [index, actual] of state.nodes.entries()) {
    const expected = positioned.nodes[index];
    assert.deepEqual(actual.initialPosition, { x: expected.x, y: expected.y, z: expected.z });
    assert.deepEqual(actual.fixed, actual.initialPosition); assert.equal(actual.id, expected.id);
  }
  assert.deepEqual(JSON.parse(canvas.dataset.nodePositions), positioned.nodes.map(({ id, x, y, z }) => ({ node_id: id, x, y, z })));
  assert.equal(canvas.dataset.presentation, 'memory-spatial');
  const actual = structuredClone(renderer.diagnostics()); assert.equal(actual.presentation, 'memory-spatial'); assert.equal(actual.node_positions.length, 3);
  assert.deepEqual([...state.colors.values()], Object.values(linearColors));
  assert.deepEqual(actual.node_colors.map(value => value.base_color), Object.values(scopeColors), 'Semantic diagnostics keep approved sRGB identities.'); renderer.dispose();
});

test('ordinary atlas and previous flat memory presentations retain material, framing and fixed depth defaults', async () => {
  for (const options of [{}, { nodeSurface: 'scope-colored', preserveNodeColors: true }]) {
    const { renderer, state, canvas } = await mount(options, 900, 500); renderer.render(positioned);
    assert.equal(state.options.layout.dimensions, 2);
    assert.deepEqual(state.nodes.map(node => node.initialPosition.z), [0, 0, 2]);
    assert.equal(state.nodes[0].initialPosition.x, -34 * 1.3);
    assert.equal(state.options.nodes.radius({ data: { kind: 'chunk' } }), 1.9);
    assert.equal(state.options.renderer.nodeSurface.profile, options.nodeSurface ? 'flat' : 'metallic');
    assert.equal(state.options.renderer.nodeSurface.metalness, 0.88); assert.equal(state.options.renderer.nodeSurface.emissive, 0.62);
    assert.deepEqual(state.frames[0].options, { aspect: 1.8, verticalFovDegrees: 50, padding: 1.16, minimumDistance: 24 });
    assert.equal('presentation' in renderer.diagnostics(), false); assert.equal('presentation' in canvas.dataset, false); renderer.dispose();
  }
});

test('spatial perspective Fit follows viewport aspect and preserves user viewing direction', async () => {
  const harness = await mount({ presentation: 'memory-spatial' }), { renderer, state, canvas, flush } = harness; renderer.render(positioned);
  assert.equal(state.frames.length, 0, 'The memory Fit does not expand eight empty AABB corners.');
  assertDirection(state.pose, { x: 38.4, y: 24, z: 120 });
  let extent = bodyExtent(harness); assert.ok(Math.max(extent.width, extent.height) >= 0.65 && Math.max(extent.width, extent.height) <= 0.84);
  assert.ok(extent.targets.every(point => point.radius >= 8 - 1e-9), 'Per-node depth keeps all bodies readable.');
  const pose = { position: { x: 70, y: 50, z: 130 }, target: { x: 10, y: -10, z: 10 } };
  renderer.setCameraPose(pose); canvas.clientWidth = 820; state.resize(); flush();
  assert.deepEqual(structuredClone(renderer.getCameraPose()), pose, 'Resize keeps the user camera until an explicit fit.');
  renderer.fit();
  assertDirection(state.pose, { x: 60, y: 60, z: 120 });
  extent = bodyExtent(harness); assert.ok(Math.max(extent.width, extent.height) >= 0.65 && Math.max(extent.width, extent.height) <= 0.84); renderer.dispose();
});

test('spatial bodies retain every scope hue through states and use a quiet matching native selection halo', async () => {
  const { renderer, state } = await mount({ presentation: 'memory-spatial', nodeColor: id => scopeColors[id] }); renderer.render(positioned);
  const actual = structuredClone(state.options.renderer);
  assert.equal(actual.frameLoop, 'demand'); assert.deepEqual(actual.pixelRatio, { minimum: 1, maximum: 2 });
  assert.deepEqual(actual.nodeSurface, { profile: 'metallic', metalness: 0, roughness: 0.82, emissive: 0.04,
    selectionEffect: { enabled: true, bubbleScale: 1.5, intensity: 0.22, color: linearColors.conversation, breathAmount: 0 } });
  for (const appearance of ['selected', 'focused', 'hovered']) assert.equal(state.options.stateTheme[appearance].colorMix, 0);
  assert.ok(state.style.radius({ id: 'conversation', data: { kind: 'chunk' } }) >= 6);
  renderer.setInteractionState('persona', ['conversation']);
  assert.equal(state.surfaces.at(-1).selectionEffect.color, linearColors.persona);
  renderer.setInteractionState('global', ['persona']);
  assert.equal(state.surfaces.at(-1).selectionEffect.color, linearColors.global);
  assert.deepEqual([...state.colors.values()], Object.values(linearColors));
  assert.equal(state.motion.pulses, 0); assert.equal(state.raf.size, 0, 'Quiet mode leaves no camera or material animation frames.'); renderer.dispose();
});

test('missing or nonfinite spatial depth is rejected before changing the displayed graph', async () => {
  const { renderer, state } = await mount({ presentation: 'memory-spatial' }); renderer.render(positioned);
  for (const z of [undefined, null, NaN, Infinity, -Infinity]) {
    assert.throws(() => renderer.render({ ...positioned, nodes: [node('bad', 'chunk', 0, 0, z)] }), /finite host-supplied/);
    assert.equal(state.nodes.length, 3); assert.equal(state.nodes[0].id, 'conversation');
  }
  renderer.clear(); assert.deepEqual(structuredClone(renderer.diagnostics().node_positions), []); renderer.dispose();
});
