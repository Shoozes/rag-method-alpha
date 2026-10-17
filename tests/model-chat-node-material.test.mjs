import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { MEMORY_SCOPE_COLORS, MEMORY_SUMMARY_COLOR, memoryScopeColor, memoryNodeColor } from '../examples/browser-model-chat/memory/panel.mjs';

const rendererPath = new URL('../modules/browser-rag-ts/src/application/graphRenderer.ts', import.meta.url);
const palettePath = new URL('../modules/browser-rag-ts/src/application/graphPalette.ts', import.meta.url);
const palette = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await readFile(palettePath, 'utf8'))).toString('base64'));
const rendererSource = stripTypeScriptTypes(await readFile(rendererPath, 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
assert.doesNotMatch(rendererSource, /^import\b/m, 'The options-only harness must remove every runtime import.');

// Run the actual factory up to its graph-engine handoff. The engine sentinel
// prevents GPU, DOM, camera, animation and model work in this contract test.
async function graphOptions(options = {}) {
  const stop = new Error('Options captured before graph creation.');
  let captured;
  const factory = runInNewContext(rendererSource + '\ncreateTslRagGraphRenderer;', {
    THREE: {}, TSL: {}, ...palette,
    createThreePlatform: () => ({}),
    createForceGraph3D: async actual => {
      captured = structuredClone({ nodeSurface: actual.renderer.nodeSurface, stateTheme: actual.stateTheme });
      throw stop;
    },
  }, { filename: 'graphRenderer-options-contract.ts' });
  await assert.rejects(factory({ canvas: {}, onNodeActivate() {}, onTerminalFailure() {}, ...options }), error => error === stop);
  return captured;
}

const defaultSurface = {
  profile: 'metallic', metalness: 0.88, roughness: 0.2, emissive: 0.62,
  selectionEffect: { enabled: true, bubbleScale: 2.1, intensity: 0.9, color: 0xffe6b6, breathAmount: 0 },
};

test('omitted surface preserves the shared metallic material and interaction colors', async () => {
  const actual = await graphOptions();
  assert.deepEqual(actual.nodeSurface, defaultSurface);
  assert.deepEqual(actual.stateTheme, {
    selected: { color: 0xffe6b6, colorMix: 0.98, scale: 1.42 },
    focused: { color: 0xf0b979, colorMix: 0.82, scale: 1.2 },
  });
});

test('explicit default with preserved colors retains the existing material and vendor hover', async () => {
  const actual = await graphOptions({ nodeSurface: 'default', preserveNodeColors: true });
  assert.deepEqual(actual.nodeSurface, { ...defaultSurface, selectionEffect: { ...defaultSurface.selectionEffect, color: 0xffffff } });
  assert.equal(actual.stateTheme.selected.colorMix, 0);
  assert.equal(actual.stateTheme.focused.colorMix, 0);
  assert.ok(!Object.hasOwn(actual.stateTheme, 'hovered'));
});

test('memory surface opts into flat bodies and a quiet halo without recoloring or resizing states', async () => {
  const actual = await graphOptions({ nodeSurface: 'scope-colored', preserveNodeColors: true });
  assert.deepEqual(actual.nodeSurface, {
    ...defaultSurface, profile: 'flat',
    selectionEffect: { ...defaultSurface.selectionEffect, intensity: 0.12, color: 0xffffff },
  });
  assert.deepEqual(actual.stateTheme, {
    selected: { color: 0xffe6b6, colorMix: 0, scale: 1.42 },
    focused: { color: 0xf0b979, colorMix: 0, scale: 1.2 },
    hovered: { colorMix: 0 },
  });
});

test('memory scope palette supplies saturated body colors, readable labels and safe scope names', async () => {
  assert.deepEqual(MEMORY_SCOPE_COLORS, { conversation: '#0ea5ff', persona: '#c81fff', global: '#f59e0b' });
  assert.ok(Object.isFrozen(MEMORY_SCOPE_COLORS));
  assert.deepEqual(['conversation', 'persona', 'global'].map(memoryScopeColor), [0x0ea5ff, 0xc81fff, 0xf59e0b]);
  for (const scope of ['unknown', 'toString', '__proto__', undefined]) assert.equal(memoryScopeColor(scope), undefined);
  const css = await readFile(new URL('../examples/browser-model-chat/memory/panel.css', import.meta.url), 'utf8');
  const background = css.match(/\.memory-dialog\{[^}]*background:(#[\da-f]{6})/i)?.[1];
  assert.ok(background, 'Measure label contrast against the actual memory reading plane.');
  const luminance = hex => hex.slice(1).match(/../g).map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const [scope, color] of Object.entries({ ...MEMORY_SCOPE_COLORS, summary: MEMORY_SUMMARY_COLOR })) {
    const contrast = (luminance(color) + 0.05) / (luminance(background) + 0.05);
    assert.ok(contrast >= 4.5, `${scope} label contrast ${contrast.toFixed(3)} must reach 4.5:1.`);
  }
});

test('retained conversation summaries have a distinct visual type without becoming a new scope', () => {
  const summary = { kind: 'summary', scope: 'conversation', derived: true };
  const before = structuredClone(summary);
  assert.equal(memoryNodeColor(summary), 0x22e37f);
  assert.equal(memoryNodeColor({ kind: 'message', scope: 'conversation' }), 0x0ea5ff);
  assert.equal(memoryNodeColor({ kind: 'summary', scope: 'persona' }), 0xc81fff);
  assert.equal(memoryScopeColor('summary'), undefined);
  assert.deepEqual(summary, before);
});

test('fixed spatial memory placement preserves scope hue without changing the generic pinned appearance', async () => {
  const memory = await graphOptions({ presentation: 'memory-spatial', nodeSurface: 'scope-colored', preserveNodeColors: true });
  assert.deepEqual(memory.stateTheme.pinned, { colorMix: 0 });
  assert.equal(memory.nodeSurface.profile, 'metallic');
  assert.equal(memory.nodeSurface.metalness, 0);
  assert.ok(!Object.hasOwn((await graphOptions()).stateTheme, 'pinned'));
  assert.ok(!Object.hasOwn((await graphOptions({ nodeSurface: 'scope-colored', preserveNodeColors: true })).stateTheme, 'pinned'));
});
