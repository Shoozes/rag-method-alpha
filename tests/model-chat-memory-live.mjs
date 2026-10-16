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
const automaticFixtureCheck = 'labeled synthetic messages exercise the production HTTPS automatic TSL graph and real search';
const fixtureScopes = new Map([
  ['real panel binding and graph-disabled assembly work without loading a model', 'Binding-only presentation fixture: exposes the existing Memory entry while the model controller stays idle.'],
  [automaticFixtureCheck, 'Synthetic conversation fixture only: canonical user/generated turns and public Global starters, actual production bootstrap/storage/renderer/retrieval; no model loaded.'],
]);
const cleanup = { browserContextClosed: false, ownedTemporaryProfileRemoved: false };
const memoryFiles = ['workspace', 'store', 'events', 'context', 'structured-context', 'automatic-context', 'automatic-memory',
  'conversation-index', 'scoped-pockets', 'starter-facts', 'rag-adapter',
  'restore-events', 'citations', 'panel', 'navigation', 'compaction-cue', 'rag-core', 'graph-renderer'].map(name => `memory/${name}.mjs`).concat('memory/panel.css');
const payloadPaths = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs',
  'capabilities.mjs', 'bootstrap.mjs', 'theme/aurel-gold.css', 'runtime/index.js', 'runtime/wllama.wasm',
  'runtime/LICENSE', 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm', 'LICENSES/rag-method.txt',
  'LICENSES/lfm-open-license-1.0.txt', 'LICENSES/forcegraph-tsl.txt', 'LICENSES/three.txt', 'NOTICE.txt', 'README.txt', ...memoryFiles].sort();
const graphPins = { 'memory/graph-renderer.mjs': '90783080f8ce7849f5d0544864c7ac7bfb7875c689aecf1fa7951204b4112b3a',
  'LICENSES/forcegraph-tsl.txt': '1a897e0ee6f1fc65889976eadb848acefac9db7f9c97274a6c490f52390cd474',
  'LICENSES/three.txt': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc' };
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
  const evidence = { fixture: fixtureScopes.has(name), ...(fixtureScopes.has(name) ? { fixtureScope: fixtureScopes.get(name) } : {}) };
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at, ...evidence }); console.log('PASS experimental memory live: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message, ...evidence }); throw error; }
}
async function request(path, method = 'GET', limit = 128 * 1024) {
  // 44 GET/HEAD pairs + initial/final manifest + 15 private-route probes: 105 requests.
  if (++httpRequests > 112) throw new Error('Finite 112-request HTTP proof budget exceeded.');
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
    storage: localStorage.length, graphEnabled: Boolean(window.localMemoryPreview.workspace.graph),
    pocket: window.localMemoryPreview.workspace.automaticMemory.getScope(),
    automaticRoles: window.localMemoryPreview.workspace.automaticMemory.snapshot().nodes.map(node => node.role) }));
  assert.equal(state.turns, 0); assert.equal(state.records, 0); assert.equal(state.events, 0); assert.equal(state.storage, 0);
  assert.equal(state.pocket, 'all'); assert.deepEqual(state.automaticRoles, ['source', 'source', 'source']);
  return state;
}

try {
  const expectedManifest = required('BROWSER_MEMORY_EXPECTED_MANIFEST_SHA256', /^[a-f0-9]{64}$/);
  const expectedHead = required('BROWSER_MEMORY_EXPECTED_SOURCE_HEAD', /^[a-f0-9]{40}$/);
  const expectedFingerprint = required('BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT', /^[a-f0-9]{64}$/);
  const playwright = required('BROWSER_MODEL_PLAYWRIGHT_MODULE');
  const chrome = required('MODEL_CHAT_BROWSER');
  base = new URL(process.env.BROWSER_MEMORY_PREVIEW_URL || 'https://shoozes.github.io/rag-method-alpha/model-chat/');
  assert.equal(base.href, 'https://shoozes.github.io/rag-method-alpha/model-chat/', 'explicitly reviewed experimental Pages destination');
  await check('reviewed HTTPS manifest binds the exact public source and 43-file payload', async () => {
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
    assert.equal(manifest.source.fingerprintSha256, expectedFingerprint);
    assert.deepEqual(manifest.files.map(file => file.path).sort(), payloadPaths); assert.equal(manifest.files.length, 43);
    assert.equal(expectedPaths.length, 44); assert.equal(manifest.graph.bundleSha256, graphPins['memory/graph-renderer.mjs']);
    assert.equal(manifest.graph.layoutBackend, 'local');
    for (const [path, hash] of Object.entries(graphPins)) assert.equal(manifest.files.find(file => file.path === path)?.sha256, hash, path);
    assert.equal(manifest.model.licensePath, 'LICENSES/lfm-open-license-1.0.txt');
    assert.equal(manifest.model.licenseSha256, '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b');
    assert.equal(manifest.files.find(file => file.path === manifest.model.licensePath)?.sha256, manifest.model.licenseSha256);
  });
  await check('all 44 HTTPS files match reviewed GET bytes and GET/HEAD MIME', async () => {
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
      'memory/build-graph.mjs', 'worker/force-worker-entry.js',
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
    for (const path of memoryFiles.filter(path => path.endsWith('.mjs') && path !== 'memory/graph-renderer.mjs')) assert.ok(loaded.has(base.pathname + path), 'actual dynamic import closure: ' + path);
    await settle();
    const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      activeSceneAnimations: [...document.querySelectorAll('#scene *')].filter(node => getComputedStyle(node).animationName !== 'none').length }));
    assert.equal(geometry.width, 390); assert.equal(geometry.height, 844); assert.ok(geometry.document <= 391 && geometry.body <= 391);
    assert.equal(geometry.reducedMotion, true); assert.equal(geometry.activeSceneAnimations, 0); observations.push({ mobileGeometry: geometry });
    assert.equal(await page.locator('#memory-query').getAttribute('type'), 'search'); assert.equal(await page.locator('#memory-recall').textContent(), 'Search');
    assert.equal(await page.locator('#memory-graph [data-memory-kind="global"]').count(), 3);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="message"]').count(), 0);
  });
  await check('real panel binding and graph-disabled assembly work without loading a model', async () => {
    // The production entry is intentionally hidden until a model is ready.
    // This explicit presentation fixture tests its binding without a ready UI.
    await page.evaluate(() => { document.getElementById('chat-options').hidden = false; });
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    await page.locator('#memory-open').evaluate(button => button.click());
    assert.equal(await page.locator('#memory-dialog').evaluate(dialog => dialog.open), true);
    const bounds = await page.locator('#memory-dialog').boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
    await page.locator('#memory-close').click();
    const state = await productionPage('?memory=1&graph=0'); assert.equal(state.graphEnabled, false);
    assert.equal(await page.locator('#memory-graph svg, #memory-graph canvas:visible').count(), 0);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="global"]').count(), 3);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="message"]').count(), 0);
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
  await check(automaticFixtureCheck, async () => {
    const fixture = { label: 'SYNTHETIC CONVERSATION FIXTURE - no model loaded', bootstrapReplaced: false,
      seededUserTurns: 2, seededGeneratedTurns: 1, savedRecords: 0, globalStarters: 3, modelControllerPhase: 'idle', originalTranscriptPreserved: false,
      workspaceDisposed: false, syntheticStorageRemoved: false, trueIdleRestored: false };
    observations.push({ automaticMemoryFixture: fixture });
    let fixtureFailure;
    try {
      const seeded = await page.evaluate(async () => {
        const workspace = window.localMemoryPreview.workspace;
        if (workspace.conversation.snapshot().turns.length || workspace.memory.snapshot().records.length || localStorage.length) throw Error('Synthetic fixture requires the fresh empty production workspace.');
        const shared = workspace.conversation.append({ role: 'user', content: 'SYNTHETIC FIXTURE: The harbor access code is CEDAR-731. The delivery day is Thursday.' });
        const generated = workspace.conversation.append({ role: 'assistant', content: 'SYNTHETIC GENERATED REPLY: Acknowledged.' });
        const drink = workspace.conversation.append({ role: 'user', content: 'SYNTHETIC FIXTURE: The preferred hot drink is ginger tea.' });
        const result = await workspace.persist();
        if (!result.durable || result.error) throw Error('Synthetic fixture did not persist through the production storage contract.');
        return { conversation: workspace.conversation.exportState(), sourceTurnId: shared.id, generatedTurnId: generated.id, sourceText: shared.content,
          automaticNodes: workspace.automaticMemory.snapshot().nodes.map(node => ({ id: node.id, kind: node.kind, role: node.role })) };
      });
      // Reload the unmodified production bootstrap so its own transcript
      // renderer creates canonical source anchors. The controller stays idle.
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.localMemoryPreview?.workspace && document.getElementById('memory-dialog'));
      assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
      assert.equal(await page.evaluate(() => window.localMemoryPreview.app.controller.getState().phase), 'idle');
      assert.equal(await page.evaluate(() => window.localMemoryPreview.workspace.conversation.exportState()), seeded.conversation);
      await page.evaluate(label => {
        // Presentation-only entry exposure; no controller/model-ready change.
        document.getElementById('chat-options').hidden = false;
        const badge = document.createElement('p'); badge.id = 'live-automatic-memory-fixture-label'; badge.textContent = label;
        badge.style.cssText = 'margin:0;padding:6px;color:#ffedc8;background:#252014;font:10px/1.4 ui-monospace,monospace;pointer-events:none';
        document.querySelector('#memory-dialog .memory-panel-body').prepend(badge);
      }, fixture.label);
      await page.locator('#memory-open').evaluate(button => button.click());
      await page.waitForFunction(() => ['tsl', 'list', 'empty'].includes(document.getElementById('memory-graph').dataset.renderer), null, { timeout: 20_000 });
      const renderer = await page.locator('#memory-graph').evaluate(node => ({ mode: node.dataset.renderer, backend: node.dataset.backend }));
      assert.equal(renderer.mode, 'tsl', 'the live automatic-memory fixture must exercise the actual renderer');
      assert.ok(['webgpu', 'webgl2'].includes(renderer.backend)); fixture.renderer = renderer;
      assert.equal(await page.locator('#memory-graph canvas:visible').count(), 1);
      assert.equal(await page.locator('#live-automatic-memory-fixture-label').isVisible(), true);
      assert.ok(browserPaths.includes(base.pathname + 'memory/graph-renderer.mjs'), 'actual on-demand production graph module was fetched');
      assert.equal(await page.locator('[data-memory-kind="message"]').count(), 3);
      assert.equal(await page.locator('[data-memory-kind="global"]').count(), 3);
      assert.equal(await page.locator('[data-memory-kind="record"]').count(), 0);
      assert.equal(seeded.automaticNodes.filter(node => node.role === 'assistant').length, 1);
      const selected = () => page.locator('[data-memory-node][data-matched="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.memoryNode).sort());
      await page.locator('#memory-query').fill('harbor access code'); await page.locator('#memory-query').press('Enter');
      await page.waitForFunction(() => !document.getElementById('memory-query').disabled && document.getElementById('memory-status').textContent === 'Matching memories are lit up.');
      assert.deepEqual(await selected(), ['turn:' + seeded.sourceTurnId]);
      await page.locator('#memory-query').fill('flying violet whale'); assert.deepEqual(await selected(), []);
      await page.locator('#memory-query').press('Enter');
      await page.waitForFunction(() => !document.getElementById('memory-query').disabled && document.getElementById('memory-status').textContent === 'No matching memories.');
      assert.deepEqual(await selected(), []); await page.locator('#memory-query-clear').click();
      assert.equal(await page.locator('#memory-query').inputValue(), ''); assert.deepEqual(await selected(), []);
      await page.locator('#memory-pocket').selectOption('global');
      await page.waitForFunction(() => !document.getElementById('memory-pocket').disabled && document.querySelectorAll('[data-memory-kind="message"]').length === 0);
      assert.equal(await page.locator('[data-memory-kind="global"]').count(), 3);
      await page.locator('#memory-pocket').selectOption('conversation');
      await page.waitForFunction(() => !document.getElementById('memory-pocket').disabled && document.querySelectorAll('[data-memory-kind="global"]').length === 0);
      assert.equal(await page.locator('[data-memory-kind="message"]').count(), 3);
      await page.locator('#memory-pocket').selectOption('all');
      await page.waitForFunction(() => !document.getElementById('memory-pocket').disabled && document.querySelectorAll('[data-memory-node]').length === 6);
      const generated = page.locator('[data-memory-node="turn:' + seeded.generatedTurnId + '"]');
      await generated.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#memory-detail-title').textContent(), 'Assistant · generated');
      assert.equal(await page.locator('#memory-remember-persona').isVisible(), false);
      await page.locator('#memory-back').click();
      const message = page.locator('[data-memory-node="turn:' + seeded.sourceTurnId + '"]');
      await message.focus(); await page.keyboard.press('Enter');
      assert.equal(await message.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-memory-node][aria-pressed="true"]').count(), 1);
      assert.equal(await page.locator('#memory-detail-text').textContent(), seeded.sourceText);
      const sourceLink = page.locator('#memory-detail-sources [data-memory-source="' + seeded.sourceTurnId + '"]');
      assert.equal(await sourceLink.getAttribute('href'), '#turn-' + seeded.sourceTurnId);
      assert.equal(await page.locator('#turn-' + seeded.sourceTurnId + ' .content').textContent(), seeded.sourceText);
      await page.locator('#memory-back').click();
      assert.equal(await message.evaluate(node => document.activeElement === node), true);
      assert.equal(await page.locator('[data-memory-node][aria-pressed="true"]').count(), 0);
      await page.keyboard.press('Enter'); await sourceLink.click();
      assert.equal(await page.locator('#memory-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.evaluate(() => window.localMemoryPreview.workspace.conversation.exportState()), seeded.conversation);
      fixture.originalTranscriptPreserved = true;
      fixture.sourceLinkVerifiedAgainstCanonicalTurn = true;
      assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    } catch (error) { fixtureFailure = error; }
    finally {
      try {
        await page.evaluate(async () => {
          window.localMemoryPreview?.workspace.dispose();
          // This isolated fresh profile contains only the three synthetic workspace/pocket keys.
          for (const key of Object.keys(localStorage)) {
            if (key === 'private-one-chat-memory-v1' || key.startsWith('private-persona-memory-v1:') || key.startsWith('private-global-memory-v1:')) localStorage.removeItem(key);
            else throw Error('Unexpected storage key in isolated live fixture.');
          }
          document.getElementById('live-automatic-memory-fixture-label')?.remove();
        });
        fixture.workspaceDisposed = true; fixture.syntheticStorageRemoved = true;
        await productionPage('?memory=1'); fixture.trueIdleRestored = true;
      } catch (error) { fixtureFailure ||= error; }
    }
    assert.deepEqual(forbiddenRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(failedResponses, []); assert.equal(workers, 0);
    assert.ok(!browserPaths.some(path => /(?:\/runtime\/|\/engine-worker\.mjs$|\.gguf$)/i.test(path)));
    if (fixtureFailure) throw fixtureFailure;
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
      sourceFingerprintSha256: manifest.source.fingerprintSha256, filesIncludingManifest: 44 },
    checks, assets: assets.sort((left, right) => left.path.localeCompare(right.path)), privatePaths, observations, screenshot,
    boundary: { fixture: checks.some(check => check.fixture), fixtureCases: checks.filter(check => check.fixture).map(({ name, fixtureScope }) => ({ name, fixtureScope })),
      productionBootstrapReplaced: false, providerCalls: 0, actualNativeCalls: 0, modelDownloads: 0,
      runtimeWorkersCreated: workers, forbiddenRequests, pageErrors, failedResponses, browserPaths: [...new Set(browserPaths)].sort(),
      httpRequests, decodedStaticBytes: decodedBytes, localServerStarted: false, packageCopies: 0 }, cleanup,
    limitations: ['Mobile viewport/reduced-motion emulation in configured desktop Chromium, not physical iOS.',
      'Production idle checks plus two explicitly scoped presentation/automatic-memory fixtures; no model loading, inference, cache or answer-quality proof.',
      'Synthetic source anchors are verified while unloaded; actual ready-chat source focus is covered by the separate local fixture suite.',
      'Finite path probes do not prove arbitrary unknown paths or Git-history disclosure boundaries.'],
    ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) { console.error('FAIL experimental memory live: ' + failure.stack); process.exitCode = 1; }
else console.log(`PASS: ${checks.length} experimental Pages smoke checks; no model/native execution.`);
