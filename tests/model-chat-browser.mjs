#!/usr/bin/env node
// Browser UI fixture only: no model bytes, WASM, provider calls, or downloads.
// Run: node tests/model-chat-browser.mjs [--chrome <installed executable>]
// Optional: BROWSER_MODEL_PLAYWRIGHT_MODULE or PLAYWRIGHT_MODULE selects an existing package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const require = createRequire(import.meta.url);
const browserPackageRequire = createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.artifacts', 'proof', 'model-chat');
const profilePrefix = 'rag-model-chat-fixture-';
const chromeFlag = process.argv.indexOf('--chrome');
const executablePath = chromeFlag < 0
  ? process.env.MODEL_CHAT_BROWSER || process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : process.argv[chromeFlag + 1];
const fixtureLabel = 'Mock adapter UI checks; no model or runtime execution';
const sourcePaths = [
  'examples/browser-model-chat/index.html', 'examples/browser-model-chat/app.mjs',
  'examples/browser-model-chat/loader-controller.mjs', 'examples/browser-model-chat/style.css',
  'examples/browser-model-chat/serve.mjs', 'tests/model-chat-browser.mjs',
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], screenshots = [], unexpectedRequests = [], pageErrors = [];
let preview, context, profile, browserVersion, cleanupComplete = false, failure;
let adapterReplacements = 0, requestCount = 0;
const started = Date.now();

// This is the only fulfilled production module. No Worker or real adapter runs.
// Deliberately retain old promises/callbacks after dispose to test late results.
const fixtureModule = String.raw`
export function createRuntimeAdapter() {
  const operations = [], replies = [];
  const fixture = window.__loaderFixture = {
    label: 'MOCK UI FIXTURE — no model/runtime execution', mode: 'cold',
    calls: [], progressEvents: [], disposals: 0,
    progress(event, index = operations.length - 1) {
      const operation = operations[index];
      fixture.progressEvents.push({ ...event });
      operation.onProgress(event);
    },
    ready(result = {}, index = operations.length - 1) {
      operations[index].resolve({ cached: operations[index].cached, modelId: 'fixture-only-model', ...result });
    },
    fail(message = 'Fixture preparation failed', index = operations.length - 1) {
      operations[index].reject(new Error(message));
    },
    unsupported(capabilities, index = operations.length - 1) {
      operations[index].reject(Object.assign(new Error(capabilities.map(item => item.label).join(', ') + ' is unavailable. No model was downloaded.'), {
        code: 'UNSUPPORTED_BROWSER', retryable: false, capabilities,
      }));
    },
    token(text, index = replies.length - 1) { replies[index].onToken(text); },
    answer(text, index = replies.length - 1) { replies[index].resolve(text); },
    signalState() { return operations.map(item => item.signal.aborted); },
    replySignalState() { return replies.map(item => item.signal.aborted); },
  };
  return {
    prepare({ source, file, signal, onProgress }) {
      const cached = fixture.mode === 'cached';
      fixture.calls.push({ kind: 'prepare', source, cached, file: file ? { name: file.name, size: file.size } : null });
      const promise = new Promise((resolve, reject) => operations.push({ resolve, reject, signal, onProgress, cached }));
      fixture.progress(fixture.mode === 'unsupported' ? { phase: 'checking', cached: false }
        : source === 'file' ? { phase: 'verifying', cached: false }
        : cached ? { phase: 'checking', cached: true }
        : { phase: 'downloading', loaded: 76703152, total: 153406304, cached: false });
      return promise;
    },
    reply(messages, { signal, onToken }) {
      fixture.calls.push({ kind: 'reply', messages: structuredClone(messages) });
      return new Promise((resolve, reject) => replies.push({ resolve, reject, signal, onToken }));
    },
    async dispose() { fixture.disposals += 1; },
  };
}
`;

async function loadPlaywright() {
  const candidates = [process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE, process.env.PLAYWRIGHT_MODULE].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_REQUIRE_ESM') throw error;
    }
  }
  for (const resolvePackage of [browserPackageRequire, require]) {
    try { return resolvePackage('playwright'); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_REQUIRE_ESM') throw error;
    }
  }
  throw new Error('An existing Playwright installation is required; prepare modules/browser-rag-ts or set BROWSER_MODEL_PLAYWRIGHT_MODULE. This harness does not install dependencies.');
}

async function check(name, run) {
  try {
    await run(); checks.push({ name, status: 'pass', evidence: 'fixture' });
    console.log('PASS fixture: ' + name);
  } catch (error) {
    checks.push({ name, status: 'fail', evidence: 'fixture', message: error.message });
    throw error;
  }
}

async function phase(page, value) {
  await page.locator('#app[data-phase="' + value + '"]').waitFor({ state: 'attached' });
}
async function fixture(page, action, ...args) {
  return page.evaluate(({ action, args }) => {
    const control = window.__loaderFixture;
    if (action === 'mode') { control.mode = args[0]; return; }
    return control[action](...args);
  }, { action, args });
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function ready(page, cached = false) {
  await fixture(page, 'progress', { phase: 'verifying', cached });
  await phase(page, 'verifying');
  assert.equal(await page.locator('#load-progress').getAttribute('value'), null, 'verification has no invented byte estimate');
  await fixture(page, 'progress', { phase: 'initializing', cached });
  await phase(page, 'initializing');
  assert.equal(await page.locator('#load-progress').getAttribute('value'), null, 'initialization is indeterminate');
  assert.equal(await page.locator('#percent').textContent(), '');
  assert.match(await page.locator('#byte-status').textContent(), /no percentage estimate/);
  assert.equal(await page.locator('#chat-stage').isVisible(), false, 'chat stays gated until adapter readiness');
  await fixture(page, 'ready');
  await phase(page, 'ready');
}
async function noOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    app: document.getElementById('app').getBoundingClientRect().width,
  }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.body <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.app <= geometry.viewport + 1, JSON.stringify(geometry));
}
async function screenshot(page, name) {
  const target = path.join(output, name);
  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.id = 'browser-fixture-badge';
    badge.textContent = 'UI fixture \u00b7 no model loaded';
    badge.style.cssText = 'position:fixed;z-index:2147483647;right:12px;bottom:12px;padding:10px 14px;border:1px solid #e6c98e;border-radius:3px;background:#17140d;color:#ffedc8;font:13px ui-monospace,monospace;box-shadow:0 2px 12px #0008;pointer-events:none';
    document.body.append(badge);
  });
  try { await page.screenshot({ path: target, fullPage: true, animations: 'disabled' }); }
  finally { await page.locator('#browser-fixture-badge').evaluate(node => node.remove()); }
  screenshots.push({ path: '.artifacts/proof/model-chat/' + name, evidence: 'fixture', sha256: digest(await readFile(target)) });
}
async function newPage({ mobile = false, reducedMotion = false } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    requestCount += 1;
    const url = new URL(request.url());
    if (url.origin !== new URL(preview.url).origin || /(?:engine-worker\.mjs|\/runtime\/|\.gguf(?:$|\?))/i.test(url.pathname)) {
      unexpectedRequests.push({ origin: url.origin === new URL(preview.url).origin ? 'loopback' : 'external', path: url.pathname });
    }
  });
  await page.route('**/runtime-adapter.mjs', async route => {
    adapterReplacements += 1;
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fixtureModule });
  });
  await page.goto(preview.url, { waitUntil: 'networkidle' });
  await phase(page, 'idle');
  assert.equal(await page.evaluate(() => window.__loaderFixture.calls.length), 0, 'no automatic model preparation');
  return page;
}

const sourceIdentity = await Promise.all(sourcePaths.map(async relative => ({ path: relative, sha256: digest(await readFile(path.join(root, relative))) })));
try {
  await access(executablePath);
  const { chromium } = await loadPlaywright();
  await mkdir(output, { recursive: true });
  profile = await mkdtemp(path.join(os.tmpdir(), profilePrefix));
  preview = await startServer();
  // Keep Chromium's sandbox enabled. Never add security, certificate, GPU, or model flags.
  context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, chromiumSandbox: true, serviceWorkers: 'block',
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'],
  });
  context.setDefaultTimeout(5_000);
  browserVersion = context.browser()?.version() || 'installed Chromium';

  await check('cold measured loading, indeterminate initialization, draft handoff and desktop layout', async () => {
    const page = await newPage();
    try {
      const draft = 'A fixture draft survives model preparation.';
      await page.locator('#draft').fill(draft);
      assert.equal(await page.locator('#runtime-profile').textContent(), 'Automatic WASM runtime selection');
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await fixture(page, 'progress', { phase: 'downloading', loaded: 76703152, total: 153406304, runtimeProfile: 'memory64' });
      assert.equal(await page.locator('#app').getAttribute('data-runtime-profile'), 'memory64');
      assert.equal(await page.locator('#runtime-profile').textContent(), 'Memory64 CPU / WASM');
      assert.equal(await page.locator('#load-progress').getAttribute('value'), '0.5');
      assert.equal(await page.locator('#percent').textContent(), '50%');
      assert.equal(await page.locator('#send').isDisabled(), true);
      await noOverflow(page);
      await screenshot(page, 'desktop-loading-fixture.png');
      await ready(page);
      assert.match(await page.locator('#runtime-label').textContent(), /Memory64 CPU \/ WASM/);
      assert.equal(await page.locator('#prompt').inputValue(), draft);
      assert.equal(await page.locator('#chat-heading').evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#scene').isVisible(), false);
      assert.equal(await page.locator('#effects').isVisible(), false);
      await noOverflow(page);
    } finally { await page.close(); }
  });

  await check('cached preparation has no fictional download or initialization percent', async () => {
    const page = await newPage();
    try {
      await fixture(page, 'mode', 'cached');
      await page.locator('#download').click();
      await phase(page, 'checking');
      await fixture(page, 'progress', { phase: 'checking', cached: true, runtimeProfile: 'memory32-asyncify' });
      assert.equal(await page.locator('#app').getAttribute('data-runtime-profile'), 'memory32-asyncify');
      assert.match(await page.locator('#runtime-profile').textContent(), /Memory32 compatibility \/ Asyncify \(may be slower\)/);
      assert.equal(await page.locator('#load-progress').getAttribute('value'), null);
      assert.match(await page.locator('#byte-status').textContent(), /cached bytes/);
      await ready(page, true);
      assert.match(await page.locator('#runtime-label').textContent(), /Memory32 compatibility \/ Asyncify/);
      assert.match(await page.locator('#runtime-label').textContent(), /cached bytes/);
      assert.equal(await page.evaluate(() => window.__loaderFixture.progressEvents.some(event => event.phase === 'downloading')), false);
    } finally { await page.close(); }
  });

  await check('failure is literal, preserves draft, and retry reaches ready', async () => {
    const page = await newPage();
    try {
      const draft = 'Keep this draft after the fixture fails.';
      const cause = '<img src=x onerror="window.fixtureInjection=true"> fixture failure';
      await page.locator('#draft').fill(draft);
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await fixture(page, 'fail', cause);
      await phase(page, 'error');
      assert.match(await page.locator('#error').textContent(), /<img src=x/);
      assert.equal(await page.locator('#error img').count(), 0);
      assert.equal(await page.locator('#error').getAttribute('aria-describedby'), null, 'Transient errors do not announce unsupported guidance');
      assert.equal(await page.locator('#draft').inputValue(), draft);
      assert.equal(await page.locator('#chat-stage').isVisible(), false);
      assert.match(await page.locator('#download').textContent(), /Retry/);
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await ready(page);
      assert.equal(await page.locator('#prompt').inputValue(), draft);
      assert.equal(await page.locator('#error').isVisible(), false);
    } finally { await page.close(); }
  });

  await check('cancel quarantines late preparation results and allows a new load', async () => {
    const page = await newPage();
    try {
      const draft = 'Keep this draft after cancellation.';
      await page.locator('#draft').fill(draft);
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await page.locator('#cancel').click();
      await phase(page, 'cancelled');
      assert.deepEqual(await fixture(page, 'signalState'), [true]);
      await fixture(page, 'progress', { phase: 'initializing' }, 0);
      await fixture(page, 'ready', {}, 0);
      await settle(page);
      await phase(page, 'cancelled');
      assert.equal(await page.locator('#chat-stage').isVisible(), false);
      assert.equal(await page.locator('#send').isDisabled(), true);
      assert.equal(await page.locator('#draft').inputValue(), draft);
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await ready(page);
      assert.equal(await page.locator('#prompt').inputValue(), draft);
    } finally { await page.close(); }
  });

  await check('permanent capability refusal preserves the draft and removes futile download, retry and File controls', async () => {
    const page = await newPage({ mobile: true, reducedMotion: true });
    try {
      const draft = 'Keep this draft on an unsupported browser.';
      await page.locator('#draft').fill(draft);
      await fixture(page, 'mode', 'unsupported');
      await page.locator('#download').click(); await phase(page, 'checking');
      await fixture(page, 'unsupported', [{ id: 'opfs', label: 'Browser storage (OPFS)', detail: 'The API is unavailable.' }]);
      await phase(page, 'unsupported');
      assert.match(await page.locator('#error').textContent(), /Browser storage \(OPFS\).*No model was downloaded/);
      assert.equal(await page.locator('#error').getAttribute('role'), 'alert');
      assert.equal(await page.locator('#error').getAttribute('aria-describedby'), 'unsupported-hint');
      assert.equal(await page.locator('#error').evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#draft').inputValue(), draft);
      assert.equal(await page.locator('#chat-stage').isVisible(), false);
      assert.equal(await page.locator('#download').isVisible(), false); assert.equal(await page.locator('#download').isDisabled(), true);
      assert.equal(await page.locator('.file-choice').isVisible(), false); assert.equal(await page.locator('#local-file').isDisabled(), true);
      assert.equal(await page.locator('#cancel').isVisible(), false); assert.equal(await page.locator('#load-progress').isVisible(), false);
      assert.match(await page.locator('#unsupported-hint').textContent(), /Retrying or choosing a local file cannot add it/);
      assert.match(await page.locator('#unsupported-hint').textContent(), /Physical iPhone support is not yet verified/);
      // Disabled controls are not the lifecycle boundary: even a dispatched File
      // event must be refused without calling the adapter a second time.
      await page.evaluate(() => {
        document.getElementById('download').click();
        const input = document.getElementById('local-file'), transfer = new DataTransfer();
        transfer.items.add(new File(['fixture'], 'fixture-only.gguf'));
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle(page); await phase(page, 'unsupported');
      assert.equal(await page.evaluate(() => window.__loaderFixture.calls.length), 1);
      assert.equal(await page.evaluate(() => window.__loaderFixture.progressEvents.some(event => event.phase === 'downloading')), false);
      await noOverflow(page); await screenshot(page, 'unsupported-browser-fixture.png');
    } finally { await page.close(); }
  });

  await check('390px local-file fixture, literal streaming, generation cancellation and unload', async () => {
    const page = await newPage({ mobile: true });
    try {
      const draft = 'A local-file fixture draft.';
      await page.locator('#draft').fill(draft);
      await noOverflow(page);
      const file = Buffer.from('GGUF UI fixture only; never passed to a model runtime.');
      await page.locator('#local-file').setInputFiles({ name: 'fixture-only.gguf', mimeType: 'application/octet-stream', buffer: file });
      await phase(page, 'verifying');
      const call = await page.evaluate(() => window.__loaderFixture.calls[0]);
      assert.equal(call.source, 'file');
      assert.deepEqual(call.file, { name: 'fixture-only.gguf', size: file.length });
      await ready(page);
      assert.equal(await page.locator('#prompt').inputValue(), draft);
      assert.match(await page.locator('#runtime-label').textContent(), /local file/);
      const userText = '<svg onload="window.fixtureInjection=true"> literal user text';
      const answer = '<img src=x onerror="window.fixtureInjection=true">\n<script>throw 1</script>\nFixture answer: plain text.';
      await page.locator('#prompt').fill(userText);
      await page.locator('#send').click();
      await phase(page, 'generating');
      await fixture(page, 'token', answer.slice(0, 55));
      assert.equal(await page.locator('.message.assistant .content').last().textContent(), answer.slice(0, 55));
      await fixture(page, 'token', answer);
      await fixture(page, 'answer', answer);
      await phase(page, 'ready');
      assert.equal(await page.locator('.message.user .content').last().textContent(), userText);
      assert.equal(await page.locator('.message.assistant .content').last().textContent(), answer);
      assert.equal(await page.locator('#messages img, #messages script, #messages svg').count(), 0);
      assert.equal(await page.evaluate(() => window.fixtureInjection === true), false);
      assert.equal(await page.locator('#scene').isVisible(), false);
      await noOverflow(page);
      await page.locator('#prompt').fill('A second fixture request that will be stopped.');
      await page.locator('#send').click();
      await phase(page, 'generating');
      await fixture(page, 'token', 'Partial fixture answer.');
      assert.equal(await page.locator('#unload').isDisabled(), true);
      await page.locator('#stop').click();
      await phase(page, 'cancelled');
      assert.deepEqual(await fixture(page, 'replySignalState'), [false, true]);
      await fixture(page, 'token', 'LATE COMPLETION MUST NOT APPEAR');
      await fixture(page, 'answer', 'LATE COMPLETION MUST NOT APPEAR');
      await settle(page);
      assert.equal(await page.locator('.message.interrupted .content').last().textContent(), 'Partial fixture answer.');
      assert.equal(await page.locator('#chat-stage').isVisible(), false);
      await page.locator('#download').click();
      await phase(page, 'downloading');
      await ready(page);
      await page.locator('#prompt').fill('Preserve this unsent message when unloading.');
      await page.locator('#unload').click();
      await phase(page, 'cancelled');
      assert.equal(await page.locator('#draft').inputValue(), 'Preserve this unsent message when unloading.');
      assert.ok(await page.evaluate(() => window.__loaderFixture.disposals) >= 2);
      await noOverflow(page);
    } finally { await page.close(); }
  });

  await check('reduced motion and ambient-light switch remove scene animation', async () => {
    const page = await newPage({ reducedMotion: true });
    try {
      await page.locator('#download').click();
      await phase(page, 'downloading');
      const names = await page.locator('#scene, #scene *').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
      assert.ok(names.every(name => name === 'none'), JSON.stringify(names));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#effects').uncheck();
      assert.equal(await page.locator('#app').evaluate(node => node.classList.contains('quiet')), true);
      const quietNames = await page.locator('#scene, #scene *').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
      assert.ok(quietNames.every(name => name === 'none'), JSON.stringify(quietNames));
      await ready(page);
      assert.equal(await page.locator('#scene').isVisible(), false);
    } finally { await page.close(); }
  });

  await check('fixture boundary: no engine, runtime, model, external requests or page errors', async () => {
    assert.equal(adapterReplacements, 7);
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(pageErrors, []);
    for (const identity of sourceIdentity) {
      assert.equal(digest(await readFile(path.join(root, identity.path))), identity.sha256, 'source unchanged during check: ' + identity.path);
    }
  });
} catch (error) {
  failure = error;
} finally {
  try { if (context) await context.close(); } catch (error) { failure ||= error; }
  try { if (preview) await preview.close(); } catch (error) { failure ||= error; }
  try {
    if (profile) {
      const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      assert.equal(normalized(path.dirname(profile)), normalized(os.tmpdir()));
      assert.ok(path.basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true });
    }
    cleanupComplete = true;
  } catch (error) { failure ||= error; }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'fixture-result.json'), JSON.stringify({
    schemaVersion: 1, kind: 'browser-model-chat-fixture', label: fixtureLabel,
    status: failure ? 'fail' : 'pass', actualModelExecution: false, actualCacheValidation: false,
    actualIosValidation: false, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    browser: browserVersion, node: process.version, sourceIdentity, checks, screenshots,
    boundary: { adapterReplacements, requestCount, unexpectedRequests, pageErrors },
    cleanup: { browserContextClosed: !!context && cleanupComplete, loopbackServerClosed: !!preview && cleanupComplete, ownedTemporaryProfileRemoved: !!profile && cleanupComplete },
    ...(failure ? { error: failure.message } : {}),
  }, null, 2) + '\n');
}
if (failure) {
  console.error('FAIL fixture: ' + failure.message);
  process.exitCode = 1;
} else console.log('PASS: ' + checks.length + ' fixture checks; no model/runtime execution.');
