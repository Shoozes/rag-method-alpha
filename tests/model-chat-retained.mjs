// Real browser/runtime regression using one existing GGUF. No model download,
// protocol-sized model payload, model copy, package install or native build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { listenStatic } from '../modules/browser-rag-ts/scripts/static-server.mjs';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const prefix = '/retained-proof/';
const profilePrefix = 'rag-model-chat-retained-';
const modelInput = process.env.BROWSER_MODEL_GGUF_FILE;
if (!modelInput) throw new Error('Set BROWSER_MODEL_GGUF_FILE to the existing exact pinned GGUF; no model is downloaded.');
const exampleRoot = process.env.BROWSER_MODEL_STATIC_ROOT
  ? await realpath(resolve(process.env.BROWSER_MODEL_STATIC_ROOT))
  : join(root, 'examples/browser-model-chat');
const runtimeRoot = process.env.BROWSER_MODEL_STATIC_ROOT
  ? join(exampleRoot, 'runtime') : join(root, '.artifacts/model-chat/runtime');
const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE
  || createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url)).resolve('playwright');
const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const checks = [], phases = [], externalRequests = [], pageErrors = [], localHttpFailures = [], screenshots = [], runtimeRequests = [];
const bridge = { requests: 0, bytes: 0 };
const cleanup = { browserClosed: false, serverClosed: false, previewClosed: false, profileRemoved: false };
let modelPath, preview, front, profile, chromeProcess, browser, context, browserVersion, failure;
let workerCreated = 0, workerClosed = 0;
const started = Date.now();
const sourcePaths = (await readdir(exampleRoot)).filter(name => /\.(?:html|mjs|js|css)$/.test(name)).sort();
const sourceIdentity = await Promise.all(sourcePaths.map(async name => ({ path: `example/${name}`, sha256: digest(await readFile(join(exampleRoot, name))) })));
sourceIdentity.push(process.env.BROWSER_MODEL_STATIC_ROOT
  ? { path: 'example/theme/aurel-gold.css', sha256: digest(await readFile(join(exampleRoot, 'theme/aurel-gold.css'))) }
  : { path: 'modules/browser-rag-ts/demo/aurel-gold.css', sha256: digest(await readFile(join(root, 'modules/browser-rag-ts/demo/aurel-gold.css'))) });
sourceIdentity.push({ path: 'tests/model-chat-retained.mjs', sha256: digest(await readFile(fileURLToPath(import.meta.url))) });
for (const path of ['examples/browser-model-chat/serve.mjs', 'examples/browser-model-chat/model-contract.mjs', 'modules/browser-rag-ts/scripts/static-server.mjs']) {
  sourceIdentity.push({ path, sha256: digest(await readFile(join(root, path))) });
}

async function check(name, work) {
  const at = Date.now();
  try { await work(); checks.push({ name, passed: true, ms: Date.now() - at }); }
  catch (error) { checks.push({ name, passed: false, ms: Date.now() - at }); throw error; }
  console.log(JSON.stringify({ check: name, passed: true }));
}
async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await sleep(50);
  assert.ok(predicate(), message);
}
async function settled(page, expected = 'ready') {
  await page.waitForFunction(() => ['ready', 'error', 'cancelled', 'unsupported'].includes(document.getElementById('app').dataset.phase), null, { timeout: 120000 });
  assert.equal(await page.locator('#app').getAttribute('data-phase'), expected, await page.locator('#error').textContent());
}
async function chooseRetainedFile(page) {
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(window.__retainedModelFile);
    document.getElementById('local-file').files = transfer.files;
    document.getElementById('local-file').dispatchEvent(new Event('change'));
  });
}
async function reply(page, prompt) {
  await page.locator('#prompt').fill(prompt);
  await page.locator('#send').click(); await settled(page);
  assert.ok((await page.locator('.message.assistant .content').last().textContent()).trim().length > 0);
}
async function closeServer(server) {
  if (!server) return;
  await new Promise((yes, no) => { server.close(error => error ? no(error) : yes()); server.closeIdleConnections(); });
}
function observePage(page) {
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => { workerCreated++; worker.on('close', () => workerClosed++); });
}

try {
  await check('retained-model-and-runtime-byte-identities', async () => {
    assert.equal(RUNTIME.version, '3.5.1', 'This regression targets the pinned primary and official compatibility profiles.');
    assert.equal(COMPAT.version, RUNTIME.version);
    modelPath = await realpath(resolve(modelInput));
    const info = await stat(modelPath); assert.ok(info.isFile()); assert.equal(info.size, MODEL.bytes);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
    assert.equal(hash.digest('hex'), MODEL.sha256);
    for (const [name, identity] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) {
      assert.equal(digest(await readFile(join(runtimeRoot, name))), identity.sha256, `Retained runtime: ${name}`);
    }
  });
  // A staged export must supply its own theme/runtime; never hide a missing
  // staged dependency behind the repository preview's fixed theme mount.
  preview = process.env.BROWSER_MODEL_STATIC_ROOT ? await listenStatic(exampleRoot) : await startServer({ root: exampleRoot, runtimeRoot });
  const upstream = new URL(preview.url || preview.baseUrl);
  front = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const target = request.url || '';
    if (target === prefix + 'proof/model.gguf') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': MODEL.bytes });
      if (request.method === 'HEAD') { response.end(); return; }
      bridge.requests++;
      const stream = createReadStream(modelPath);
      stream.on('data', chunk => { bridge.bytes += chunk.length; });
      try { await pipeline(stream, response); } catch { response.destroy(); }
      return;
    }
    if (!target.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const proxy = httpRequest({ hostname: '127.0.0.1', port: upstream.port,
      path: '/' + target.slice(prefix.length), method: request.method }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response); incoming.on('error', () => response.destroy());
    });
    proxy.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => proxy.destroy()); proxy.end();
  });
  await new Promise((yes, no) => { front.once('error', no); front.listen(0, '127.0.0.1', yes); });
  const address = front.address(); assert.equal(address.address, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}${prefix}`;
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  let spawnError;
  chromeProcess = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  chromeProcess.once('error', error => { spawnError = error; });
  let debugPort;
  for (let attempt = 0; attempt < 300 && !spawnError; attempt++) {
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (debugPort) break; } catch {}
    await sleep(100);
  }
  if (!debugPort) throw new Error('Owned Chrome did not expose its local debugging port.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  context = browser.contexts()[0]; browserVersion = browser.version();
  context.on('request', request => {
    const target = new URL(request.url());
    if (target.pathname.includes('/runtime/')) runtimeRequests.push(target.pathname);
  });
  context.on('response', response => {
    const target = new URL(response.url());
    if (target.origin === new URL(url).origin && response.status() >= 400) localHttpFailures.push({ path: target.pathname, status: response.status() });
  });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === new URL(url).origin || ['blob:', 'data:'].includes(target.protocol)) return route.continue();
    externalRequests.push({ protocol: target.protocol, host: target.hostname });
    return route.abort('internetdisconnected');
  });
  await context.exposeFunction('__recordRetainedPhase', state => phases.push({ ...state, atMs: Date.now() - started }));
  await context.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    const record = () => window.__recordRetainedPhase({ phase: app.dataset.phase, value: document.getElementById('load-progress').getAttribute('value') });
    new MutationObserver(record).observe(app, { attributes: true, attributeFilter: ['data-phase'] }); record();
  }));
  const page = context.pages()[0];
  observePage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await check('subpath-idle-never-requests-model-or-external-origin', async () => {
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    assert.equal(bridge.requests, 0); assert.deepEqual(externalRequests, []);
    assert.equal(await page.locator('#chat-stage').isVisible(), false);
  });
  async function refusal(name, injection, missingLabel) {
    await check(name, async () => {
      const probe = await context.newPage(); observePage(probe);
      try {
        // Fault injection changes only one feature in the actual production
        // Worker. Its adapter, preflight, error path and teardown remain real.
        await probe.route(url + 'engine-worker.mjs', async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: injection + '\n' + await response.text() });
        });
        await probe.goto(url); await probe.locator('#download').click(); await settled(probe, 'unsupported');
        const text = await probe.locator('#error').textContent();
        assert.match(text, /This browser cannot run this pinned runtime:/);
        assert.match(text, missingLabel); assert.match(text, /No model was downloaded/);
        assert.equal(bridge.requests, 0); assert.deepEqual(externalRequests, []);
        assert.equal(await probe.locator('#chat-stage').isVisible(), false);
        assert.equal(await probe.locator('#download').isVisible(), false);
        assert.equal(await probe.locator('#local-file').isVisible(), false);
        assert.equal(await probe.locator('#unsupported-hint').isVisible(), true);
        await until(() => workerClosed === workerCreated, 'Production refusal closed its Worker while the page stayed open');
      } finally { await probe.close(); }
    });
  }
  await refusal('injected-SIMD-permanent-refusal-before-model-request', `
const __retainedValidate = WebAssembly.validate.bind(WebAssembly);
WebAssembly.validate = bytes => {
  const view = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if (view.length < 64 && view.includes(253)) return false;
  return __retainedValidate(bytes);
};`, /SIMD/);
  await refusal('injected-OPFS-refusal-before-model-request', `
Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });`, /Origin private file system/);
  await check('one-loopback-stream-to-browser-held-file', async () => {
    const file = await page.evaluate(async model => {
      const response = await fetch('./proof/model.gguf');
      if (!response.ok) throw new Error('Retained model bridge failed.');
      window.__retainedModelFile = new File([await response.blob()], model.file, { type: 'application/octet-stream' });
      return { name: window.__retainedModelFile.name, size: window.__retainedModelFile.size };
    }, MODEL);
    assert.deepEqual(file, { name: MODEL.file, size: MODEL.bytes });
    assert.equal(bridge.requests, 1); assert.equal(bridge.bytes, MODEL.bytes);
  });
  await check('real-file-initialization-cancel-closes-owned-worker', async () => {
    const before = workerClosed;
    await page.evaluate(() => {
      const app = document.getElementById('app');
      const observer = new MutationObserver(() => {
        if (app.dataset.phase === 'initializing') { observer.disconnect(); document.getElementById('cancel').click(); }
      });
      observer.observe(app, { attributes: true, attributeFilter: ['data-phase'] });
    });
    await chooseRetainedFile(page); await settled(page, 'cancelled');
    await until(() => workerClosed > before, 'Cancelled model Worker closed');
    assert.ok(phases.some(item => item.phase === 'initializing' && item.value === null));
  });
  await check('real-file-retry-verifies-initializes-and-generates', async () => {
    await page.locator('#draft').fill('Reply with one short greeting.');
    await chooseRetainedFile(page); await settled(page);
    assert.match(await page.locator('#runtime-label').textContent(), /local file/);
    assert.equal(await page.locator('#prompt').inputValue(), 'Reply with one short greeting.');
    await reply(page, 'Reply with one short greeting.');
  });
  await check('fresh-worker-reinitialization-and-inference-reuse-retained-file', async () => {
    const before = workerCreated, closedBefore = workerClosed;
    await page.locator('#unload').click(); await settled(page, 'cancelled');
    await until(() => workerClosed > closedBefore, 'Unloaded model Worker closed');
    await chooseRetainedFile(page); await settled(page);
    assert.ok(workerCreated > before, 'Fresh owned Worker initialized');
    await reply(page, 'What is two plus two? Answer briefly.');
    assert.equal(bridge.requests, 1, 'Browser-held File reused without another model read/transfer');
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(localHttpFailures, []);
  });
  await check('real-ready-mobile-and-reduced-motion', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#loading-stage').isVisible(), false);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#scene *')].every(item => getComputedStyle(item).animationName === 'none')));
    await mkdir(output, { recursive: true });
    const name = 'live-mobile-chat.png';
    await page.screenshot({ path: join(output, name), fullPage: true });
    const bytes = await readFile(join(output, name)); screenshots.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
    await page.locator('#unload').click(); await settled(page, 'cancelled');
    await until(() => workerClosed === workerCreated, 'All observed model Workers closed');
  });
  await check('production-Memory32-selection-with-JavaScript-probe-fixtures', async () => {
    const requestsBefore = runtimeRequests.length;
    await page.route(url + 'engine-worker.mjs', async route => {
      const response = await route.fetch();
      const injection = `
const __nativeMemory = WebAssembly.Memory;
WebAssembly.Memory = new Proxy(__nativeMemory, { construct(target, args) {
  if (args[0]?.address === 'i64') throw new TypeError('Memory64 constructor probe fixture; engine feature set unchanged');
  return Reflect.construct(target, args);
}});
Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true });
Object.defineProperty(WebAssembly, 'promising', { value: undefined, configurable: true });`;
      await route.fulfill({ response, body: injection + '\n' + await response.text() });
    });
    // A new page lifetime must qualify itself again; native file selection sends
    // only the existing ordinary path, without another loopback/model transfer.
    await page.reload();
    await page.evaluate(() => document.getElementById('local-file').addEventListener('change', event => event.stopImmediatePropagation(), { capture: true, once: true }));
    const inputSession = await context.newCDPSession(page);
    try {
      const { root: documentNode } = await inputSession.send('DOM.getDocument');
      const { nodeId } = await inputSession.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#local-file' });
      await inputSession.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] });
    } finally { await inputSession.detach(); }
    await page.evaluate(model => {
      const input = document.getElementById('local-file');
      window.__retainedModelFile = new File([input.files[0]], model.file, { type: 'application/octet-stream' });
    }, MODEL);
    await chooseRetainedFile(page); await settled(page);
    assert.equal(await page.locator('#app').getAttribute('data-runtime-profile'), 'memory32-asyncify');
    assert.match(await page.locator('#runtime-label').textContent(), /Memory32|compatibility/i);
    await reply(page, 'What is two plus two? Answer briefly.');
    const selected = runtimeRequests.slice(requestsBefore);
    assert.ok(selected.some(path => path.endsWith('/runtime/compat/wllama.wasm')));
    assert.ok(selected.some(path => path.endsWith('/runtime/compat/wllama.js')));
    assert.equal(selected.some(path => path.endsWith('/runtime/wllama.wasm')), false);
    assert.equal(bridge.requests, 1); assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
    await page.locator('#unload').click(); await settled(page, 'cancelled');
    await until(() => workerClosed === workerCreated, 'Fallback model Worker and nested Worker closed');
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
    if (!exited()) {
      chromeProcess.kill();
      for (let i = 0; i < 100 && !exited(); i++) await sleep(50);
    }
    cleanup.browserClosed = exited();
    if (!cleanup.browserClosed) failure ||= new Error('Owned Chrome exit was not confirmed; profile preserved.');
  }
  try { await closeServer(front); cleanup.serverClosed = !!front; } catch (error) { failure ||= error; }
  try { if (preview) { await preview.close(); cleanup.previewClosed = true; } } catch (error) { failure ||= error; }
  if (profile && cleanup.browserClosed) {
    try {
      assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true;
    } catch { failure ||= new Error('Owned temporary profile cleanup failed.'); }
  }
  for (const item of sourceIdentity) {
    const path = item.path.startsWith('example/') ? join(exampleRoot, item.path.slice('example/'.length)) : join(root, item.path);
    if (digest(await readFile(path)) !== item.sha256) failure ||= new Error('Source changed during retained-model proof.');
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'retained-result.json'), JSON.stringify({
    schema: 'rag-method.model-chat.retained.v1', passed: !failure, fixture: false,
    model: { id: MODEL.id, file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256, revision: MODEL.revision },
    modelSource: 'existing native file streamed once over owned loopback; browser File API',
    capabilityRefusals: 'injected SIMD and OPFS permanent refusal in the actual production Worker; injected Memory64/JSPI absence selects and runs the actual maintained fallback',
    externalModelDownloads: 0, harnessModelFileCopies: 0, runtime: { version: RUNTIME.version, files: RUNTIME.files, compat: COMPAT },
    browser: browserVersion, node: process.version, subpath: prefix, staticExport: !!process.env.BROWSER_MODEL_STATIC_ROOT,
    sourceIdentity, checks, phases, runtimeRequests, externalRequests, localHttpFailures, bridge, screenshots, workers: { created: workerCreated, closed: workerClosed }, cleanup,
    ms: Date.now() - started,
    limitations: ['Desktop Chrome only; JavaScript probe fixtures do not disable engine Memory64. No iOS or physical/native file picker qualification.', 'File API input is constructed from existing exact bytes over loopback.', 'Browser-managed Blob/cache storage is not measured; the harness makes no explicit model file copy.', 'No canonical remote URL cache or offline cache recovery claim.', 'Native peak memory/release is not measured.'],
    ...(failure ? { error: failure.message } : {}),
  }, null, 2) + '\n');
}
if (failure) process.exitCode = 1;
