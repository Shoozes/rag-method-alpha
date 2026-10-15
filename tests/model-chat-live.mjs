// Explicit local browser acceptance. No simulated model/adapter in this file.
// --remote permits one real pinned model download into a disposable browser cache.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { MODEL, RUNTIME } from '../examples/browser-model-chat/model-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const remote = process.argv.slice(2).includes('--remote');
if (!remote) throw new Error('Explicitly pass --remote to permit the real pinned model download.');
const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE || createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url)).resolve('playwright');
const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'rag-model-chat-'));
const checks = [], phases = [], network = [], screenshots = [];
let preview, context, browser, chromeProcess, browserVersion, failure;
const started = Date.now();
const cleanup = { browserClosed: false, serverClosed: false, profileRemoved: false };
const sourcePaths = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'runtime-adapter.mjs', 'engine-worker.mjs', 'model-contract.mjs', 'serve.mjs']
  .map(name => `examples/browser-model-chat/${name}`).concat('tests/model-chat-live.mjs', 'modules/browser-rag-ts/demo/aurel-gold.css', 'modules/browser-rag-ts/scripts/static-server.mjs');
const sourceIdentity = await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') })));
async function check(name, work) {
  const start = Date.now();
  await work(); checks.push({ name, passed: true, ms: Date.now() - start });
  console.log(JSON.stringify({ check: name, passed: true }));
}
async function settled(page, expected = 'ready') {
  await page.waitForFunction(() => ['ready', 'error', 'cancelled'].includes(document.getElementById('app').dataset.phase), null, { timeout: 120000 });
  const actual = await page.locator('#app').getAttribute('data-phase');
  assert.equal(actual, expected, await page.locator('#error').textContent());
}
try {
  for (const [name, item] of Object.entries(RUNTIME.files)) {
    const bytes = await readFile(join(root, '.artifacts/model-chat/runtime', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `Prepared runtime: ${name}`);
  }
  await mkdir(output, { recursive: true });
  preview = await startServer();
  // Attach to our own ordinary headless Chrome: no Playwright launch defaults,
  // GPU/certificate bypasses, disabled sandbox, or global browser settings.
  chromeProcess = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let debugPort;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (debugPort) break; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  if (!debugPort) throw new Error('Owned Chrome did not expose its local debugging port.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  context = browser.contexts()[0];
  browserVersion = browser.version();
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.protocol === 'https:') network.push({ host: url.hostname, method: response.request().method(), status: response.status() });
  });
  await context.exposeFunction('__recordLivePhase', state => phases.push({ ...state, atMs: Date.now() - started }));
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const app = document.getElementById('app');
      const record = () => window.__recordLivePhase({ phase: app.dataset.phase,
        value: document.getElementById('load-progress').getAttribute('value'),
        bytes: document.getElementById('byte-status').textContent });
      new MutationObserver(record).observe(app, { attributes: true, attributeFilter: ['data-phase'] });
      record();
    });
  });
  const page = context.pages()[0];
  await page.setViewportSize({ width: 1440, height: 1080 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(preview.url);
  await check('live-idle-no-model-auto-download', async () => {
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    assert.equal(network.length, 0);
    assert.equal(await page.locator('#chat-stage').isVisible(), false);
  });
  await check('real-file-rejects-wrong-artifact', async () => {
    await page.locator('#local-file').setInputFiles({ name: 'wrong.gguf', mimeType: 'application/octet-stream', buffer: Buffer.from('not a model') });
    await settled(page, 'error');
    assert.match(await page.locator('#error').textContent(), /Expected 153,406,304 bytes/);
  });
  if (remote) {
    await check('real-remote-cold-download-verify-init', async () => {
      await page.locator('#download').click();
      await settled(page);
      assert.match(await page.locator('#runtime-label').textContent(), /download verified/);
      assert.ok(network.some(item => item.host === 'huggingface.co' && item.status >= 200 && item.status < 400), 'Actual official model request observed');
      assert.ok(phases.some(item => item.phase === 'downloading'), 'Actual download phase observed');
      assert.ok(phases.some(item => item.phase === 'initializing' && item.value === null), 'Initialization indeterminate');
    });
    await check('real-remote-chat', async () => {
      await page.locator('#prompt').fill('What is 2 + 2? Answer briefly.');
      await page.locator('#send').click();
      await settled(page);
      assert.ok((await page.locator('.message.assistant .content').last().textContent()).trim().length > 0);
    });
    await check('real-file-api-from-verified-browser-cache-and-init-cancel', async () => {
      await page.locator('#unload').click();
      await settled(page, 'cancelled');
      // Reuse the actual fetched cache bytes as a File, with no extra download or
      // disk copy. This proves the File API path, not a physical iOS file picker.
      await page.evaluate(async model => {
        const { Wllama } = await import('/runtime/index.js');
        const owner = new Wllama({ default: '/runtime/wllama.wasm' });
        owner.setCompat(null);
        const cached = (await owner.modelManager.getModels()).find(item => item.url === model.url);
        window.__liveModelFile = new File(await cached.open(), model.file, { type: 'application/octet-stream' });
        const app = document.getElementById('app');
        const observer = new MutationObserver(() => {
          if (app.dataset.phase === 'initializing') { observer.disconnect(); document.getElementById('cancel').click(); }
        });
        observer.observe(app, { attributes: true, attributeFilter: ['data-phase'] });
        const transfer = new DataTransfer(); transfer.items.add(window.__liveModelFile);
        document.getElementById('local-file').files = transfer.files;
        document.getElementById('local-file').dispatchEvent(new Event('change'));
      }, MODEL);
      await settled(page, 'cancelled');
      await page.evaluate(() => {
        const transfer = new DataTransfer(); transfer.items.add(window.__liveModelFile);
        document.getElementById('local-file').files = transfer.files;
        document.getElementById('local-file').dispatchEvent(new Event('change'));
      });
      await settled(page);
      assert.match(await page.locator('#runtime-label').textContent(), /local file/);
      await page.locator('#prompt').fill('Reply with exactly the word READY.');
      await page.locator('#send').click(); await settled(page);
      assert.ok((await page.locator('.message.assistant .content').last().textContent()).trim().length > 0);
    });
    await check('real-cache-only-reopen-with-external-requests-blocked', async () => {
      await page.reload();
      let attempted = 0;
      await context.route('https://**/*', route => { attempted++; return route.abort('internetdisconnected'); });
      await page.locator('#download').click();
      await settled(page);
      assert.match(await page.locator('#runtime-label').textContent(), /cached bytes/);
      assert.equal(attempted, 0, 'Cache reopen never requested external URLs');
      await page.locator('#prompt').fill('Say hello in one short sentence.');
      await page.locator('#send').click();
      await settled(page);
      assert.ok((await page.locator('.message.assistant .content').last().textContent()).trim().length > 0);
    });
  }
  await check('real-ready-mobile-and-reduced-motion', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#loading-stage').isVisible(), false);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#scene *')].every(item => getComputedStyle(item).animationName === 'none')));
    const file = 'live-mobile-chat.png';
    await page.screenshot({ path: join(output, file), fullPage: true }); screenshots.push(file);
  });
  assert.deepEqual(pageErrors, []);
} catch (error) { failure = error; console.error(error.stack); }
finally {
  if (browser) {
    try { const session = await context.newCDPSession(context.pages()[0]); await session.send('Browser.close'); } catch {}
    await browser.close().catch(() => {});
  }
  if (chromeProcess) {
    for (let attempt = 0; attempt < 100 && chromeProcess.exitCode === null; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 50));
    if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
      chromeProcess.kill();
      for (let attempt = 0; attempt < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    cleanup.browserClosed = chromeProcess.exitCode !== null || chromeProcess.signalCode !== null;
    if (!cleanup.browserClosed) failure ||= new Error('Owned Chrome exit was not confirmed.');
  }
  if (preview) { await preview.close(); cleanup.serverClosed = true; }
  try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true; }
  catch (error) { cleanup.profileRemoved = false; failure ||= new Error(`Owned browser profile cleanup failed: ${error.code}`); }
  for (const item of sourceIdentity) {
    if (createHash('sha256').update(await readFile(join(root, item.path))).digest('hex') !== item.sha256) failure ||= new Error('Source changed during the live proof.');
  }
  const result = { schema: 'rag-method.model-chat.live.v1', passed: !failure, fixture: false,
    remoteDownloadAuthorized: remote, model: MODEL, runtime: { version: RUNTIME.version, files: RUNTIME.files },
    browser: browserVersion, ms: Date.now() - started, sourceIdentity, checks, phases, network, screenshots, cleanup,
    limitations: ['Desktop Chromium only; mobile viewport is emulation.', 'No iOS qualification or universal memory/loading claim.', 'Native memory release is not measured.'],
    ...(failure ? { error: failure.message } : {}) };
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'live-result.json'), JSON.stringify(result, null, 2) + '\n');
}
if (failure) process.exitCode = 1;
