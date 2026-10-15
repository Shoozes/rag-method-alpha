#!/usr/bin/env node
// Explicit experimental Pages smoke check. Never loads a model, invokes a
// provider, replaces bootstrap, or executes runtime WASM. Viewport is emulation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const resultPath = join(output, 'memory-live-result.json');
const screenshotName = 'live-memory-mobile.png';
const profilePrefix = 'rag-memory-live-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], assets = [], privatePaths = [], forbiddenRequests = [], pageErrors = [], failedResponses = [], browserPaths = [], observations = [];
const cleanup = { browserContextClosed: false, ownedTemporaryProfileRemoved: false };
const memoryFiles = ['workspace', 'store', 'events', 'context', 'structured-context', 'automatic-context', 'rag-adapter',
  'restore-events', 'citations', 'panel', 'rag-core'].map(name => `memory/${name}.mjs`).concat('memory/panel.css');
const payloadPaths = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs',
  'capabilities.mjs', 'bootstrap.mjs', 'theme/aurel-gold.css', 'runtime/index.js', 'runtime/wllama.wasm',
  'runtime/LICENSE', 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm', 'LICENSES/rag-method.txt',
  'LICENSES/lfm-open-license-1.0.txt', 'NOTICE.txt', 'README.txt', ...memoryFiles].sort();
const expectedPaths = [...payloadPaths, 'site-manifest.json'].sort();
const executableMime = new Set(['application/javascript', 'text/javascript']);
let base, manifest, manifestSha256, context, profile, page, browserVersion, screenshot, failure, workers = 0, httpRequests = 0, decodedBytes = 0;
const started = Date.now();
function required(name, pattern) {
  const value = process.env[name];
  if (!value || pattern && !pattern.test(value)) throw new Error(`Set ${name} explicitly to the reviewed value.`);
  return value;
}
async function check(name, run) {
  const at = Date.now();
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at }); console.log('PASS experimental memory live: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message }); throw error; }
}
async function request(path, method = 'GET', limit = 128 * 1024) {
  if (++httpRequests > 100) throw new Error('Finite 100-request HTTP proof budget exceeded.');
  const target = new URL(path, base);
  assert.equal(target.origin, base.origin); assert.ok(target.pathname.startsWith(base.pathname));
  const response = await fetch(target, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.url, target.href, 'no asset redirects');
  const chunks = []; let count = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const value = await reader.read(); if (value.done) break;
        count += value.value.byteLength;
        if (count > limit || decodedBytes + count > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('Bounded HTTP body limit exceeded.'); }
        chunks.push(Buffer.from(value.value));
      }
    } finally { reader.releaseLock(); }
  }
  decodedBytes += count;
  return { response, bytes: Buffer.concat(chunks) };
}
function correctMime(path, type) {
  if (/\.(?:mjs|js)$/.test(path)) return executableMime.has(type);
  if (path.endsWith('.wasm')) return type === 'application/wasm';
  if (path.endsWith('.html')) return type === 'text/html';
  if (path.endsWith('.css')) return type === 'text/css';
  if (path.endsWith('.json')) return type === 'application/json';
  return ['text/plain', 'application/octet-stream'].includes(type);
}
async function settle() { await page.evaluate(() => new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept)))); }
async function productionPage(query) {
  await page.goto(new URL(query, base).href, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForFunction(() => window.localMemoryPreview?.workspace && document.getElementById('memory-dialog'));
  assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
  assert.equal(await page.locator('#loading-stage').isVisible(), true);
  assert.equal(await page.locator('#chat-stage').isVisible(), false);
  assert.equal(await page.locator('[role="alert"]:visible').filter({ hasText: /\S/ }).count(), 0);
  assert.equal(await page.locator('.introduction .lede').textContent(), 'Experimental preview. On your device.');
  assert.equal(await page.locator('.introduction .lede').isVisible(), true);
  assert.equal(await page.locator('.introduction .license').textContent(), 'Optional memory selects older passages automatically and can omit context. Model answers can miss or invent details. Check the source links.');
  const state = await page.evaluate(() => ({ turns: window.localMemoryPreview.workspace.conversation.snapshot().turns.length,
    records: window.localMemoryPreview.workspace.memory.snapshot().records.length, events: window.localMemoryPreview.workspace.events.list().length,
    storage: localStorage.length, graphEnabled: Boolean(window.localMemoryPreview.workspace.graph) }));
  assert.equal(state.turns, 0); assert.equal(state.records, 0); assert.equal(state.events, 0); assert.equal(state.storage, 0);
  return state;
}

try {
  const expectedManifest = required('BROWSER_MEMORY_EXPECTED_MANIFEST_SHA256', /^[a-f0-9]{64}$/);
  const expectedHead = required('BROWSER_MEMORY_EXPECTED_SOURCE_HEAD', /^[a-f0-9]{40}$/);
  const playwright = required('BROWSER_MODEL_PLAYWRIGHT_MODULE');
  const chrome = required('MODEL_CHAT_BROWSER');
  base = new URL(process.env.BROWSER_MEMORY_PREVIEW_URL || 'https://shoozes.github.io/rag-method-alpha/model-chat/');
  assert.equal(base.href, 'https://shoozes.github.io/rag-method-alpha/model-chat/', 'explicitly reviewed experimental Pages destination');
  await check('reviewed HTTPS manifest binds the exact public source and 34-file payload', async () => {
    const { response, bytes } = await request('site-manifest.json');
    assert.equal(response.status, 200); assert.ok(correctMime('site-manifest.json', response.headers.get('content-type')?.split(';')[0]));
    manifestSha256 = digest(bytes); assert.equal(manifestSha256, expectedManifest);
    manifest = JSON.parse(bytes);
    const { identitySha256, ...body } = manifest;
    assert.equal(identitySha256, digest(JSON.stringify(body)));
    assert.equal(manifest.schema, 'rag-model-chat-static/v1'); assert.equal(manifest.memoryPreview, true);
    assert.equal(manifest.publicReleaseQualified, false); assert.equal(manifest.model.weightsIncluded, false);
    assert.equal(manifest.source.head, expectedHead); assert.equal(manifest.source.dirty, false);
    assert.equal(manifest.source.fingerprintSha256, digest(JSON.stringify(manifest.source.files)));
    if (process.env.BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT) assert.equal(manifest.source.fingerprintSha256, process.env.BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT);
    assert.deepEqual(manifest.files.map(file => file.path).sort(), payloadPaths); assert.equal(manifest.files.length, 34);
    assert.equal(manifest.model.licensePath, 'LICENSES/lfm-open-license-1.0.txt');
    assert.equal(manifest.model.licenseSha256, '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b');
    assert.equal(manifest.files.find(file => file.path === manifest.model.licensePath)?.sha256, manifest.model.licenseSha256);
  });
  await check('all 35 HTTPS files match reviewed GET bytes and GET/HEAD MIME', async () => {
    for (let offset = 0; offset < expectedPaths.length; offset += 4) {
      const settled = await Promise.allSettled(expectedPaths.slice(offset, offset + 4).map(async path => {
        const expected = path === 'site-manifest.json' ? { sha256: expectedManifest, bytes: 128 * 1024 } : manifest.files.find(file => file.path === path);
        for (const method of ['GET', 'HEAD']) {
          const { response, bytes } = await request(path, method, expected.bytes);
          assert.equal(response.status, 200, method + ' ' + path);
          const type = response.headers.get('content-type')?.split(';')[0]; assert.ok(correctMime(path, type), method + ' ' + path + ' MIME: ' + type);
          if (method === 'GET') { assert.equal(digest(bytes), expected.sha256, path); if (path !== 'site-manifest.json') assert.equal(bytes.length, expected.bytes, path); }
          else assert.equal(bytes.length, 0, 'HEAD has no body');
        }
        assets.push({ path, sha256: expected.sha256 });
      }));
      const failed = settled.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    }
  });
  await check('finite private browser-path probes return genuine 404 status', async () => {
    for (const path of ['memory/PRIVATE_LOCAL_ONLY', 'memory/README.md', 'memory/PREVIEW_READINESS.md', 'memory/build-core.mjs',
      'memory/serve-local.mjs', 'memory-proof/runtime-probe.mjs', '.artifacts/proof/local-memory/receipt.json', '.git/config', '.env',
      'tests/model-chat-memory-live.mjs', 'node_modules/playwright/index.mjs', 'source/workspace.html', 'modules/browser-rag-ts/src/core/index.ts']) {
      const { response, bytes } = await request(path, 'HEAD', 0);
      assert.equal(response.status, 404, path); assert.equal(bytes.length, 0);
      privatePaths.push({ path, status: 404 });
    }
  });
  await access(chrome); await access(playwright);
  const { chromium } = await import(pathToFileURL(resolve(playwright)).href);
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, chromiumSandbox: true,
    serviceWorkers: 'block', ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] });
  context.setDefaultTimeout(8000); browserVersion = context.browser()?.version() || 'configured Chromium';
  const permitted = new Set(expectedPaths);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) || 'index.html' : '';
    const runtimeOrWorker = /(?:^runtime\/|^engine-worker\.mjs$|\.gguf$)/i.test(path) || route.request().resourceType() === 'worker';
    if (url.origin !== base.origin || !permitted.has(path) || runtimeOrWorker) {
      forbiddenRequests.push({ origin: url.origin, path: url.pathname, reason: runtimeOrWorker ? 'runtime-or-model-blocked' : 'outside-reviewed-assets' });
      await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  page = await context.newPage();
  page.on('worker', () => workers++); page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => browserPaths.push(new URL(request.url()).pathname));
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const session = await context.newCDPSession(page);
  await session.send('Network.clearBrowserCache'); await session.send('Network.clearBrowserCookies'); await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await check('unmodified production memory bootstrap initializes on mobile with reduced motion', async () => {
    const state = await productionPage('?memory=1'); assert.equal(state.graphEnabled, true);
    const loaded = new Set(browserPaths);
    for (const path of memoryFiles.filter(path => path.endsWith('.mjs'))) assert.ok(loaded.has(base.pathname + path), 'actual dynamic import closure: ' + path);
    await settle();
    const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      activeSceneAnimations: [...document.querySelectorAll('#scene *')].filter(node => getComputedStyle(node).animationName !== 'none').length }));
    assert.equal(geometry.width, 390); assert.equal(geometry.height, 844); assert.ok(geometry.document <= 391 && geometry.body <= 391);
    assert.equal(geometry.reducedMotion, true); assert.equal(geometry.activeSceneAnimations, 0); observations.push({ mobileGeometry: geometry });
    assert.equal(await page.locator('#memory-save').count(), 1); assert.equal(await page.locator('#memory-forget').textContent(), 'Forget saved record');
  });
  await check('real panel binding and graph-disabled assembly work without loading a model', async () => {
    // The production entry is intentionally hidden until a model is ready.
    // Programmatic clicking tests its binding only; this does not claim ready UI.
    await page.locator('#memory-open').evaluate(button => button.click());
    assert.equal(await page.locator('#memory-dialog').evaluate(dialog => dialog.open), true);
    const bounds = await page.locator('#memory-dialog').boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
    await page.locator('#memory-close').click();
    const state = await productionPage('?memory=1&graph=0'); assert.equal(state.graphEnabled, false);
    assert.equal(await page.locator('#memory-graph svg, #memory-graph canvas').count(), 0);
    observations.push({ panelOpenedProgrammaticallyWhileModelUnloaded: true, graphDisabledAssemblyVerified: true });
  });
  await check('essential screenshot shows actual idle HTTPS preview and its visible experimental notice', async () => {
    await productionPage('?memory=1'); await settle();
    await page.evaluate(() => scrollTo(0, 0));
    const bounds = await page.locator('.introduction .lede').boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await mkdir(output, { recursive: true }); const target = join(output, screenshotName);
    await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
    const bytes = await readFile(target); screenshot = { path: '.artifacts/proof/model-chat/' + screenshotName, bytes: bytes.length, sha256: digest(bytes), evidence: 'actual live idle UI; no fixture or model loaded' };
  });
  await check('no native, runtime, model or outside-scope browser requests occurred and manifest stayed fixed', async () => {
    assert.deepEqual(forbiddenRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(failedResponses, []); assert.equal(workers, 0);
    assert.ok(browserPaths.every(path => path.startsWith(base.pathname)));
    assert.ok(!browserPaths.some(path => /(?:\/runtime\/|\/engine-worker\.mjs$|\.gguf$)/i.test(path)));
    const { response, bytes } = await request('site-manifest.json'); assert.equal(response.status, 200); assert.equal(digest(bytes), expectedManifest);
  });
} catch (error) { failure = error; }
finally {
  try { if (context) { await context.close(); cleanup.browserContextClosed = true; } } catch (error) { failure ||= error; }
  try {
    if (profile) { assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true }); cleanup.ownedTemporaryProfileRemoved = true; }
  } catch (error) { failure ||= error; }
  await mkdir(output, { recursive: true });
  await writeFile(resultPath, JSON.stringify({ schema: 'rag-method.memory-live-preview/v1', status: failure ? 'fail' : 'pass',
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, node: process.version, browser: browserVersion,
    url: base?.href, verifierSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    manifest: manifest && { sha256: manifestSha256, identitySha256: manifest.identitySha256, sourceHead: manifest.source.head,
      sourceFingerprintSha256: manifest.source.fingerprintSha256, filesIncludingManifest: 35 },
    checks, assets: assets.sort((left, right) => left.path.localeCompare(right.path)), privatePaths, observations, screenshot,
    boundary: { fixture: false, productionBootstrapReplaced: false, providerCalls: 0, actualNativeCalls: 0, modelDownloads: 0,
      runtimeWorkersCreated: workers, forbiddenRequests, pageErrors, failedResponses, browserPaths: [...new Set(browserPaths)].sort(),
      httpRequests, decodedStaticBytes: decodedBytes, localServerStarted: false, packageCopies: 0 }, cleanup,
    limitations: ['Mobile viewport/reduced-motion emulation in configured desktop Chromium, not physical iOS.',
      'Actual idle loading UI and module binding only; no model loading, inference, cache or answer-quality proof.',
      'Finite path probes do not prove arbitrary unknown paths or Git-history disclosure boundaries.'],
    ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) { console.error('FAIL experimental memory live: ' + failure.stack); process.exitCode = 1; }
else console.log(`PASS: ${checks.length} experimental Pages smoke checks; no model/native execution.`);
