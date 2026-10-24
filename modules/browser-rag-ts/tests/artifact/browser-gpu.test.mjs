import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGraphics, readBrowserGpu, requireNativeGraphics } from '../../../../scripts/browser_gpu.mjs';

const canvas = { backend: 'webgl2', context_lost: false, debug_renderer_info: true,
  unmasked_vendor: 'Google Inc. (NVIDIA)', unmasked_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, D3D11)' };
const browserGpu = { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, D3D11)', webgl: 'enabled' };
const graphics = { status: 'native', canvas, browser_gpu: browserGpu, software_webgl_requested: false };

test('native proof requires the live canvas and enabled browser WebGL evidence', () => {
  assert.equal(classifyGraphics(canvas, browserGpu), 'native');
  assert.doesNotThrow(() => requireNativeGraphics(graphics));
  assert.equal(classifyGraphics(canvas, { ...browserGpu, webgl: 'disabled_software' }), 'unverified');
  assert.equal(classifyGraphics({ ...canvas, context_lost: true }, browserGpu), 'unverified');
  assert.equal(classifyGraphics({ ...canvas, backend: 'webgpu' }, browserGpu), 'unverified');
});

test('listing physical devices never qualifies a software renderer', () => {
  const devices = [{ name: 'NVIDIA GeForce RTX 4090' }];
  for (const renderer of ['ANGLE (Google, SwiftShader Device (Subzero))', 'llvmpipe (LLVM 19)', 'Microsoft Basic Render Driver', 'WARP']) {
    const softwareCanvas = { ...canvas, unmasked_vendor: 'Google Inc.', unmasked_renderer: renderer };
    assert.equal(classifyGraphics(softwareCanvas, { ...browserGpu, devices }), 'software', renderer);
    assert.throws(() => requireNativeGraphics({ ...graphics, canvas: softwareCanvas }), /Native GPU/u);
  }
  assert.equal(classifyGraphics(canvas, { ...browserGpu, renderer: 'SwiftShader', devices }), 'software');
});

test('missing, masked, contradictory or relabelled evidence fails native admission', () => {
  assert.equal(classifyGraphics({ backend: 'webgl2' }, browserGpu), 'unverified');
  assert.equal(classifyGraphics({ ...canvas, debug_renderer_info: false, unmasked_renderer: '' }, browserGpu), 'unverified');
  assert.equal(classifyGraphics(canvas, { devices: [{ name: 'NVIDIA GeForce RTX 4090' }] }), 'unverified');
  assert.equal(classifyGraphics(canvas, browserGpu, true), 'unverified');
  assert.throws(() => requireNativeGraphics({ ...graphics, software_webgl_requested: true }), /Native GPU/u);
  assert.throws(() => requireNativeGraphics({ ...graphics, status: 'unverified' }), /Native GPU/u);
  assert.throws(() => requireNativeGraphics({ status: 'native' }), /Native GPU/u);
});

test('GPU diagnostics retain bounded fields and detach their protocol session', async () => {
  let detached = 0;
  const browser = { newBrowserCDPSession: async () => ({
    send: async method => {
      assert.equal(method, 'SystemInfo.getInfo');
      return { gpu: { auxAttributes: { glRenderer: browserGpu.renderer },
        featureStatus: { webgl: 'enabled', gpu_compositing: 'enabled' },
        devices: Array.from({ length: 12 }, () => ({ deviceString: 'x'.repeat(1000) })) } };
    }, detach: async () => { detached++; },
  }) };
  const result = await readBrowserGpu(browser);
  assert.equal(result.renderer, browserGpu.renderer);
  assert.equal(result.devices.length, 8);
  assert.equal(result.devices[0].name.length, 512);
  assert.equal(detached, 1);
});

test('unavailable or timed out diagnostics stay unverified and detach', async () => {
  for (const send of [async () => { throw new Error('unsupported protocol'); }, () => new Promise(() => {})]) {
    let detached = false;
    const result = await readBrowserGpu({ newBrowserCDPSession: async () => ({
      send, detach: async () => { detached = true; },
    }) }, 5);
    assert.match(result.unavailable, /unsupported protocol|timed out/u);
    assert.equal(classifyGraphics(canvas, result), 'unverified');
    assert.equal(detached, true);
  }
});
