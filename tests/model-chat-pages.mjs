// Verify the published HTTPS payload and actual runtime with an existing native
// File. No model download, model file copy, oversized CDP payload or security flag.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';
import { inspectWasmMemories } from '../examples/browser-model-chat/wasm-memory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const live = new URL(process.env.BROWSER_MODEL_PAGES_URL || 'https://shoozes.github.io/rag-method-alpha/model-chat/');
assert.equal(live.protocol, 'https:'); assert.ok(live.pathname.endsWith('/'));
const expectedRoot = resolve(process.env.BROWSER_MODEL_STATIC_ROOT || join(root, '.artifacts/model-chat/site'));
const modelInput = process.env.BROWSER_MODEL_GGUF_FILE;
if (!modelInput) throw new Error('Set BROWSER_MODEL_GGUF_FILE to the existing exact pinned GGUF; this test never downloads weights.');
const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE
  || createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url)).resolve('playwright');
const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const checks = [], files = [], exclusions = [], phases = [], externalRequests = [], pageErrors = [], screenshots = [], runtimeRequests = [];
const cleanup = { browserClosed: false, profileRemoved: false };
const profilePrefix = 'rag-model-chat-pages-';
const started = Date.now();
const harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
let manifest, manifestSha256, modelPath, profile, chromeProcess, browser, context, browserVersion, failure;
let workerCreated = 0, workerClosed = 0, nativeSelections = 0;

async function check(name, action) {
  const at = Date.now();
  try { await action(); checks.push({ name, passed: true, ms: Date.now() - at }); }
  catch (error) { checks.push({ name, passed: false, ms: Date.now() - at }); throw error; }
  console.log(JSON.stringify({ check: name, passed: true }));
}
async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await sleep(50);
  assert.ok(predicate(), message);
}
async function response(path, method = 'GET') {
  return fetch(new URL(path, live), { method, cache: 'no-store', signal: AbortSignal.timeout(30000) });
}
async function settled(page, expected = 'ready') {
  await page.waitForFunction(() => ['ready', 'error', 'cancelled', 'unsupported'].includes(document.getElementById('app').dataset.phase), null, { timeout: 120000 });
  assert.equal(await page.locator('#app').getAttribute('data-phase'), expected, await page.locator('#error').textContent());
}
function observe(page) {
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => { workerCreated++; worker.on('close', () => workerClosed++); });
}
async function chooseRetainedFile(page) {
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(window.__pagesRetainedModel);
    const input = document.getElementById('local-file'); input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  });
}
async function reply(page, prompt) {
  await page.locator('#prompt').fill(prompt); await page.locator('#send').click(); await settled(page);
  assert.ok((await page.locator('.message.assistant .content').last().textContent()).trim().length > 0);
}

try {
  await check('exact-native-model-byte-identity', async () => {
    modelPath = await realpath(resolve(modelInput));
    const info = await stat(modelPath); assert.ok(info.isFile()); assert.equal(info.size, MODEL.bytes);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
    assert.equal(hash.digest('hex'), MODEL.sha256);
  });
  await check('published-manifest-matches-reviewed-static-stage', async () => {
    const res = await response('site-manifest.json'); assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/i);
    const bytes = Buffer.from(await res.arrayBuffer()); manifestSha256 = digest(bytes);
    assert.equal(manifestSha256, digest(await readFile(join(expectedRoot, 'site-manifest.json'))));
    manifest = JSON.parse(bytes); assert.equal(manifest.schema, 'rag-model-chat-static/v1');
    assert.equal(manifest.source.dirty, false); assert.equal(manifest.model.weightsIncluded, false);
    assert.equal(manifest.model.sha256, MODEL.sha256); assert.equal(manifest.runtime.version, RUNTIME.version);
    if (process.env.BROWSER_MODEL_EXPECTED_SOURCE) assert.equal(manifest.source.head, process.env.BROWSER_MODEL_EXPECTED_SOURCE);
    // Required runtime files are explicit; the reviewed stage owns the complete
    // payload allowlist instead of this harness freezing an obsolete file count.
    for (const name of Object.keys({ ...RUNTIME.files, ...COMPAT.files })) assert.ok(manifest.files.some(item => item.path === 'runtime/' + name));
    assert.ok(manifest.files.every(item => !/\.gguf$|(?:^|\/)(?:tests|proof|node_modules|\.artifacts|\.git)(?:\/|$)/i.test(item.path)));
  });
  await check('all-published-payload-hashes-nested-paths-and-mime', async () => {
    for (const item of manifest.files) {
      assert.ok(!item.path.startsWith('/') && !item.path.split('/').includes('..'));
      const res = await response(item.path); assert.equal(res.status, 200, item.path);
      assert.equal(res.url, new URL(item.path, live).href);
      const mime = res.headers.get('content-type') || '';
      if (/\.(?:mjs|js)$/.test(item.path)) assert.match(mime, /(?:application|text)\/(?:javascript|ecmascript)/i, item.path);
      else if (/\.wasm$/.test(item.path)) assert.match(mime, /application\/wasm/i, item.path);
      else if (/\.css$/.test(item.path)) assert.match(mime, /text\/css/i, item.path);
      else if (/\.html$/.test(item.path)) assert.match(mime, /text\/html/i, item.path);
      const bytes = Buffer.from(await res.arrayBuffer()); assert.equal(bytes.length, item.bytes, item.path);
      assert.equal(digest(bytes), item.sha256, item.path);
      const memory = /\.wasm$/.test(item.path) ? inspectWasmMemories(bytes) : null;
      if (memory) {
        assert.equal(memory.memories.length, 1, item.path);
        assert.equal(memory.requiresMemory64, item.path === 'runtime/wllama.wasm', item.path);
      }
      files.push({ path: item.path, bytes: bytes.length, sha256: item.sha256, mime, ...(memory ? { memory } : {}) });
    }
    for (const [name, identity] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) {
      assert.equal(files.find(item => item.path === 'runtime/' + name)?.sha256, identity.sha256);
    }
  });
  await check('private-setup-model-and-unknown-paths-404-without-spa-fallback', async () => {
    for (const path of ['.git/config', '.artifacts/proof/model-chat/receipt.json', 'tests/model-chat-pages.mjs',
      'prepare-runtime.mjs', 'serve.mjs', 'stage-static.mjs', 'models/' + MODEL.file, MODEL.file, 'missing-module.mjs']) {
      const res = await response(path, 'HEAD'); assert.equal(res.status, 404, path);
      exclusions.push({ path, status: res.status });
    }
  });
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  let spawnError;
  chromeProcess = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  chromeProcess.once('error', error => { spawnError = error; });
  let port;
  for (let i = 0; i < 300 && !spawnError; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {}
    await sleep(100);
  }
  if (!port) throw new Error('Owned Chrome did not expose its local debugging port.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  context = browser.contexts()[0]; browserVersion = browser.version();
  context.on('request', request => {
    const target = new URL(request.url());
    if (target.pathname.includes('/runtime/')) runtimeRequests.push(target.pathname);
  });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === live.origin || ['blob:', 'data:'].includes(target.protocol)) return route.continue();
    externalRequests.push({ host: target.hostname, method: route.request().method(), resource: route.request().resourceType() });
    return route.abort('internetdisconnected');
  });
  await context.exposeFunction('__recordPagesPhase', state => phases.push({ ...state, atMs: Date.now() - started }));
  await context.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    const record = () => window.__recordPagesPhase({ phase: app.dataset.phase, value: document.getElementById('load-progress').getAttribute('value') });
    new MutationObserver(record).observe(app, { attributes: true, attributeFilter: ['data-phase'] }); record();
  }));
  const page = context.pages()[0]; observe(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(live.href);
  await check('https-secure-context-and-idle-with-no-weight-request', async () => {
    assert.equal(await page.evaluate(() => isSecureContext && location.protocol === 'https:'), true);
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    assert.equal(await page.locator('#chat-stage').isVisible(), false); assert.deepEqual(externalRequests, []);
    const requirements = (await page.locator('.license').allTextContents()).join(' ');
    assert.match(requirements, /Memory64/); assert.match(requirements, /Memory32/);
    assert.match(requirements, /OPFS/);
  });
  async function refusal(name, injection, label) {
    await check(name, async () => {
      const probe = await context.newPage(); observe(probe);
      try {
        await probe.route(new URL('engine-worker.mjs', live).href, async route => {
          const res = await route.fetch(); await route.fulfill({ response: res, body: injection + '\n' + await res.text() });
        });
        await probe.goto(live.href); await probe.locator('#download').click(); await settled(probe, 'unsupported');
        const text = await probe.locator('#error').textContent();
        assert.match(text, /This browser cannot run this pinned runtime:/); assert.match(text, label);
        assert.match(text, /No model was downloaded/); assert.deepEqual(externalRequests, []);
        assert.equal(await probe.locator('#chat-stage').isVisible(), false);
        assert.equal(await probe.locator('#download').isVisible(), false);
        assert.equal(await probe.locator('#local-file').isVisible(), false);
        assert.equal(await probe.locator('#unsupported-hint').isVisible(), true);
        await until(() => workerClosed === workerCreated, 'Refusal must close the production Worker while its page remains open');
      } finally { await probe.close(); }
    });
  }
  await refusal('injected-production-SIMD-permanent-refusal-before-weights', `
const __pagesValidate = WebAssembly.validate.bind(WebAssembly);
WebAssembly.validate = bytes => {
  const view = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if (view.length < 64 && view.includes(253)) return false;
  return __pagesValidate(bytes);
};`, /SIMD/);
  await refusal('injected-production-OPFS-refusal-before-weights', `
Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });`, /Origin private file system/);
  await check('ordinary-native-file-input-and-exact-browser-file-size', async () => {
    // The existing native file has a content-hash name. Stop only its first
    // change event, then give the same File bytes the pinned GGUF basename.
    await page.evaluate(() => document.getElementById('local-file').addEventListener('change', event => event.stopImmediatePropagation(), { capture: true, once: true }));
    // Playwright's connected-CDP wrapper treats this same-machine browser as
    // remote and refuses paths above 50 MB. Chrome's native file input receives
    // only the ordinary local path here, never a model-byte protocol payload.
    const inputSession = await context.newCDPSession(page);
    try {
      const { root: documentNode } = await inputSession.send('DOM.getDocument');
      const { nodeId } = await inputSession.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#local-file' });
      await inputSession.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] }); nativeSelections++;
    } finally { await inputSession.detach(); }
    const file = await page.evaluate(model => {
      const input = document.getElementById('local-file'), native = input.files[0];
      if (!native) throw new Error('Native retained File input was empty.');
      window.__pagesRetainedModel = new File([native], model.file, { type: 'application/octet-stream' });
      return { nativeBytes: native.size, name: window.__pagesRetainedModel.name, bytes: window.__pagesRetainedModel.size };
    }, MODEL);
    assert.deepEqual(file, { nativeBytes: MODEL.bytes, name: MODEL.file, bytes: MODEL.bytes });
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
  });
  await check('live-native-file-initialization-cancel-tears-down-worker', async () => {
    const before = workerClosed;
    await page.evaluate(() => {
      const app = document.getElementById('app');
      const observer = new MutationObserver(() => {
        if (app.dataset.phase === 'initializing') { observer.disconnect(); document.getElementById('cancel').click(); }
      });
      observer.observe(app, { attributes: true, attributeFilter: ['data-phase'] });
    });
    await chooseRetainedFile(page); await settled(page, 'cancelled');
    await until(() => workerClosed > before, 'Cancelled runtime Worker closed');
    assert.ok(phases.some(item => item.phase === 'initializing' && item.value === null));
  });
  await check('live-file-retry-integrity-initialization-and-real-chat', async () => {
    await page.locator('#draft').fill('Reply with one short greeting.');
    await chooseRetainedFile(page); await settled(page);
    assert.match(await page.locator('#runtime-label').textContent(), /local file/);
    assert.equal(await page.locator('#prompt').inputValue(), 'Reply with one short greeting.');
    await reply(page, 'Reply with one short greeting.');
    await reply(page, 'What is two plus two? Answer briefly.');
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
  });
  await check('live-390px-ready-reduced-motion-and-unload', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#loading-stage').isVisible(), false);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#scene *')].every(item => getComputedStyle(item).animationName === 'none')));
    await page.locator('#unload').click(); await settled(page, 'cancelled');
    await until(() => workerClosed === workerCreated, 'All observed runtime Workers closed');
  });
  await check('live-maintained-Memory32-selection-and-chat-with-JavaScript-probe-fixtures', async () => {
    const requestsBefore = runtimeRequests.length;
    await page.route(new URL('engine-worker.mjs', live).href, async route => {
      const res = await route.fetch();
      const injection = `
const __nativeMemory = WebAssembly.Memory;
WebAssembly.Memory = new Proxy(__nativeMemory, { construct(target, args) {
  if (args[0]?.address === 'i64') throw new TypeError('Memory64 constructor probe fixture; engine feature set unchanged');
  return Reflect.construct(target, args);
}});
Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true });
Object.defineProperty(WebAssembly, 'promising', { value: undefined, configurable: true });`;
      await route.fulfill({ response: res, body: injection + '\n' + await res.text() });
    });
    await page.reload();
    await page.evaluate(() => document.getElementById('local-file').addEventListener('change', event => event.stopImmediatePropagation(), { capture: true, once: true }));
    const inputSession = await context.newCDPSession(page);
    try {
      const { root: documentNode } = await inputSession.send('DOM.getDocument');
      const { nodeId } = await inputSession.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#local-file' });
      await inputSession.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] }); nativeSelections++;
    } finally { await inputSession.detach(); }
    await page.evaluate(model => {
      const input = document.getElementById('local-file');
      window.__pagesRetainedModel = new File([input.files[0]], model.file, { type: 'application/octet-stream' });
    }, MODEL);
    await chooseRetainedFile(page); await settled(page);
    assert.equal(await page.locator('#app').getAttribute('data-runtime-profile'), 'memory32-asyncify');
    assert.match(await page.locator('#runtime-label').textContent(), /Memory32|compatibility/i);
    await reply(page, 'What is two plus two? Answer briefly.');
    const selected = runtimeRequests.slice(requestsBefore);
    assert.ok(selected.some(path => path.endsWith('/runtime/compat/wllama.wasm')));
    assert.ok(selected.some(path => path.endsWith('/runtime/compat/wllama.js')));
    assert.equal(selected.some(path => path.endsWith('/runtime/wllama.wasm')), false);
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
    await mkdir(output, { recursive: true });
    const path = 'live-mobile-chat.png'; await page.screenshot({ path: join(output, path), fullPage: true });
    const bytes = await readFile(join(output, path)); screenshots.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    await page.locator('#unload').click(); await settled(page, 'cancelled');
    await until(() => workerClosed === workerCreated, 'All observed fallback runtime Workers closed');
  });
} catch (error) { failure = error; console.error(error.stack); }
finally {
  if (browser) {
    try { const session = await context.newCDPSession(context.pages()[0]); await session.send('Browser.close'); } catch {}
    await browser.close().catch(() => {});
  }
  if (chromeProcess) {
    const exited = () => chromeProcess.exitCode !== null || chromeProcess.signalCode !== null;
    for (let i = 0; i < 100 && !exited(); i++) await sleep(50);
    if (!exited()) { chromeProcess.kill(); for (let i = 0; i < 100 && !exited(); i++) await sleep(50); }
    cleanup.browserClosed = exited();
    if (!cleanup.browserClosed) failure ||= new Error('Owned Chrome exit was not confirmed; profile preserved.');
  }
  if (profile && cleanup.browserClosed) {
    try {
      assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true;
    } catch { failure ||= new Error('Owned temporary browser profile cleanup failed.'); }
  }
  if (digest(await readFile(fileURLToPath(import.meta.url))) !== harnessSha256) failure ||= new Error('Live harness changed during verification.');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'pages-result.json'), JSON.stringify({
    schema: 'rag-method.model-chat.pages.v1', passed: !failure, fixture: false, url: live.href,
    publishedSource: manifest?.source, manifestSha256, publishedPayloadIdentity: manifest?.identitySha256,
    pagesCommit: process.env.BROWSER_MODEL_PAGES_COMMIT || null,
    harness: { path: 'tests/model-chat-pages.mjs', sha256: harnessSha256 },
    model: { id: MODEL.id, file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256, revision: MODEL.revision },
    modelSource: 'existing ordinary native file input via path-only Chrome DOM command; same bytes renamed in browser File API',
    externalModelDownloads: 0, harnessModelFileCopies: 0, nativeSelections,
    runtime: { version: RUNTIME.version, files: RUNTIME.files, compat: COMPAT }, browser: browserVersion, node: process.version,
    capabilityRefusals: 'injected missing SIMD and OPFS permanently refuse; injected Memory64 and JSPI absence selects and runs the actual published maintained Memory32 runtime',
    checks, files, exclusions, phases, runtimeRequests, externalRequests, pageErrors, screenshots,
    workers: { created: workerCreated, closed: workerClosed }, cleanup, ms: Date.now() - started,
    limitations: ['Desktop Chrome with mobile viewport and JS probe fixtures; VM Memory64 remains supported. Physical iOS is untested.',
      'Native File path selection uses browser automation; physical picker and iPhone Files are unqualified.',
      'Remote weight download/cache/recovery and native peak memory are not measured by this run.',
      'Browser-managed Blob storage is not measured; this harness creates no explicit disk copy of the model.'],
    ...(failure ? { error: failure.message } : {}),
  }, null, 2) + '\n');
}
if (failure) process.exitCode = 1;
