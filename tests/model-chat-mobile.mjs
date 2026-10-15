#!/usr/bin/env node
// Mobile UI fixture only. No model, runtime Worker, WASM or provider execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const require = createRequire(import.meta.url);
const moduleRequire = createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.artifacts/proof/model-chat');
const baseline = process.argv.includes('--baseline');
const profilePrefix = 'rag-model-chat-mobile-';
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || process.env.MODEL_CHAT_BROWSER
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], screenshots = [], requests = [], pageErrors = [], observations = [];
let baselineObservations = [];
if (!baseline) {
  try {
    const prior = JSON.parse(await readFile(path.join(output, 'mobile-result.json'), 'utf8'));
    baselineObservations = prior.mode === 'baseline-observation' ? prior.observations : prior.baselineObservations || [];
  } catch { /* A first verification does not require historical baseline artifacts. */ }
}
let context, preview, profile, browserVersion, failure;
let browserClosed = false, serverClosed = false, profileRemoved = false;
const sourcePaths = ['examples/browser-model-chat/index.html', 'examples/browser-model-chat/app.mjs',
  'examples/browser-model-chat/style.css', 'tests/model-chat-mobile.mjs'];
const started = Date.now();
const fixtureModule = String.raw`
export function createRuntimeAdapter() {
  let loading, replying;
  const control = window.__mobileFixture = {
    label: 'MOCK MOBILE UI FIXTURE - no model/runtime execution', calls: [],
    ready() { loading.resolve({ cached: false, modelId: 'mobile-fixture-only' }); },
    token(text) { replying.onToken(text); },
    answer(text) { replying.resolve(text); },
    fail(message) { loading.reject(new Error(message)); },
  };
  return {
    prepare({ onProgress, signal }) {
      control.calls.push('prepare');
      onProgress({ phase: 'downloading', loaded: 76703152, total: 153406304 });
      return new Promise((resolve, reject) => { loading = { resolve, reject, signal }; });
    },
    reply(messages, { onToken, signal }) {
      control.calls.push('reply');
      return new Promise((resolve, reject) => { replying = { resolve, reject, onToken, signal }; });
    },
    async dispose() { control.calls.push('dispose'); },
  };
}
`;

async function loadPlaywright() {
  for (const candidate of [process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE, process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
    try { return require(candidate); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  for (const resolver of [moduleRequire, require]) {
    try { return resolver('playwright'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Existing Playwright required; set BROWSER_MODEL_PLAYWRIGHT_MODULE. No dependencies are installed.');
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function phase(page, value) { await page.locator('#app[data-phase="' + value + '"]').waitFor(); }
async function fixture(page, action, value) { return page.evaluate(({ action, value }) => window.__mobileFixture[action](value), { action, value }); }
async function ready(page) {
  await page.locator('#download').click(); await phase(page, 'downloading');
  await fixture(page, 'ready'); await phase(page, 'ready'); await settle(page);
}
async function newPage(viewport = { width: 390, height: 844 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(preview.url).origin || /engine-worker\.mjs|\/runtime\/|\.gguf(?:$|\?)/i.test(url.pathname)) {
      requests.push({ kind: url.origin === new URL(preview.url).origin ? 'runtime-or-model' : 'external', path: url.pathname });
      await route.abort(); return;
    }
    if (url.pathname.endsWith('/runtime-adapter.mjs')) {
      await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fixtureModule }); return;
    }
    await route.continue();
  });
  await page.goto(preview.url, { waitUntil: 'networkidle' }); await phase(page, 'idle');
  assert.equal(await page.evaluate(() => window.__mobileFixture.calls.length), 0);
  return page;
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const container = selector => {
      const node = document.querySelector(selector), r = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { left: r.left, right: r.right, width: r.width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        minWidth: style.minWidth, cssWidth: style.width, boxSizing: style.boxSizing,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, display: style.display };
    };
    const log = document.getElementById('messages');
    return { viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height,
        visualWidth: visualViewport?.width, offsetLeft: visualViewport?.offsetLeft, offsetTop: visualViewport?.offsetTop },
      page: { scrollX, scrollY, scrollHeight: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth },
      log: { ...rect('messages'), overflowY: getComputedStyle(log).overflowY, scrollHeight: log.scrollHeight, clientHeight: log.clientHeight, scrollTop: log.scrollTop },
      composer: rect('composer'), prompt: rect('prompt'), send: rect('send'), unload: rect('unload'), clear: rect('clear'),
      containers: Object.fromEntries(['#app', '#chat-stage', '.chat-header', '.chat-header>div', '.conversation', '#composer'].map(selector => [selector, container(selector)])) };
  });
}
async function capture(page, name) {
  await page.evaluate(() => {
    const badge = document.createElement('div'); badge.id = 'mobile-fixture-badge';
    badge.textContent = 'UI FIXTURE · no model loaded';
    badge.style.cssText = 'position:fixed;top:4px;right:4px;z-index:999999;padding:5px 7px;background:#17140d;color:#ffedc8;border:1px solid #e6c98e;font:10px ui-monospace,monospace;pointer-events:none';
    document.body.append(badge);
  });
  const target = path.join(output, name);
  try { await page.screenshot({ path: target, fullPage: false, animations: 'disabled' }); }
  finally { await page.locator('#mobile-fixture-badge').evaluate(node => node.remove()); }
  screenshots.push({ path: '.artifacts/proof/model-chat/' + name, evidence: 'fixture', sha256: digest(await readFile(target)) });
}
async function check(name, run) {
  try { await run(); checks.push({ name, status: 'pass', evidence: 'fixture' }); console.log('PASS mobile fixture: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', evidence: 'fixture', message: error.message }); throw error; }
}
async function noHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    messages: document.getElementById('messages').scrollWidth,
    logWidth: document.getElementById('messages').clientWidth }));
  assert.ok(sizes.document <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, JSON.stringify(sizes));
  assert.ok(sizes.messages <= sizes.logWidth + 1, JSON.stringify(sizes));
}
async function containedChat(page) {
  await settle(page);
  const value = await geometry(page);
  assert.ok(['auto', 'scroll'].includes(value.log.overflowY), 'conversation is its own scroll container: ' + JSON.stringify(value));
  assert.ok(value.log.height >= 40 && value.log.bottom <= value.viewport.height + 1, 'conversation remains usable: ' + JSON.stringify(value));
  assert.ok(value.composer.top >= -1 && value.composer.bottom <= value.viewport.height + 1, 'composer in viewport: ' + JSON.stringify(value));
  assert.ok(value.prompt.top >= -1 && value.prompt.bottom <= value.viewport.height + 1, 'prompt in viewport: ' + JSON.stringify(value));
  assert.ok(value.send.top >= -1 && value.send.bottom <= value.viewport.height + 1, 'send in viewport: ' + JSON.stringify(value));
  for (const key of ['composer', 'prompt', 'send', 'unload', 'clear']) {
    const bounds = value[key];
    assert.ok(bounds.left >= -1 && bounds.right <= value.viewport.width + 1 && bounds.top >= -1 && bounds.bottom <= value.viewport.height + 1,
      key + ' fully in viewport without hidden clipping: ' + JSON.stringify(value));
  }
  assert.ok(value.page.scrollHeight <= value.viewport.height + 1 && Math.abs(value.page.scrollY) <= 1, 'ready page does not scroll behind log: ' + JSON.stringify(value));
  await noHorizontalOverflow(page);
  return value;
}
async function touchTarget(locator) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, '44px minimum touch target: ' + JSON.stringify(bounds));
}
async function send(page, text) {
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await phase(page, 'generating'); await settle(page);
}
async function nearTail(page) {
  return page.locator('#messages').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight <= 5);
}
const sourceIdentity = await Promise.all(sourcePaths.map(async name => ({ path: name, sha256: digest(await readFile(path.join(root, name))) })));
try {
  await access(chrome); const { chromium } = await loadPlaywright();
  await mkdir(output, { recursive: true }); profile = await mkdtemp(path.join(os.tmpdir(), profilePrefix));
  preview = await startServer();
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, chromiumSandbox: true,
    serviceWorkers: 'block', ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] });
  context.setDefaultTimeout(5000); browserVersion = context.browser()?.version() || 'installed Chromium';
  if (baseline) {
    const page = await newPage();
    const file = await page.locator('.file-choice').boundingBox();
    const errorInsideLoading = await page.locator('#error').evaluate(node => !!node.closest('#loading-stage'));
    await ready(page); await page.evaluate(() => scrollTo(0, 0)); await settle(page);
    observations.push({ viewport: '390x844', ...(await geometry(page)), fileTargetHeight: file.height, readyErrorInsideHiddenLoading: errorInsideLoading });
    await capture(page, 'mobile-layout-fixture.png');
    await page.setViewportSize({ width: 390, height: 480 }); await page.locator('#prompt').focus();
    await page.evaluate(() => scrollTo(0, 0)); await settle(page);
    observations.push({ viewport: '390x480 keyboard-size simulation', ...(await geometry(page)) });
    await page.close();
    console.log(JSON.stringify({ kind: 'baseline-observation', observations }));
  } else {
    await check('loading File and download controls have at least 44px touch targets', async () => {
      const page = await newPage();
      try { await touchTarget(page.locator('.file-choice')); await touchTarget(page.locator('#download')); }
      finally { await page.close(); }
    });
    await check('390x844 ready chat contains the conversation and keeps composer visible', async () => {
      const page = await newPage();
      try {
        await ready(page); observations.push({ name: 'ready390x844', ...(await containedChat(page)) });
        for (const id of ['send', 'unload', 'clear']) await touchTarget(page.locator('#' + id));
      } finally { await page.close(); }
    });
    await check('keyboard-size, landscape and narrow resizing preserve draft and composer visibility', async () => {
      const page = await newPage();
      try {
        await ready(page); const draft = 'This fixture draft survives keyboard-size changes and rotation.';
        await page.locator('#prompt').fill(draft); await page.locator('#prompt').focus();
        for (const viewport of [{ width: 390, height: 480 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport); await settle(page);
          assert.equal(await page.locator('#prompt').inputValue(), draft);
          const value = await containedChat(page);
          assert.equal(Math.round(value.viewport.visualHeight), viewport.height, 'actual visualViewport tracks the simulated keyboard/rotation size');
          observations.push({ name: 'resize' + viewport.width + 'x' + viewport.height, ...value });
        }
      } finally { await page.close(); }
    });
    await check('safe-area and visual viewport hooks are present without physical-device claims', async () => {
      const page = await newPage();
      try {
        const css = await page.locator('link[href="./style.css"]').evaluate(async node => (await fetch(node.href)).text());
        assert.match(css, /env\(safe-area-inset-bottom/);
        assert.match(css, /env\(safe-area-inset-top/);
        const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
        assert.match(viewport, /viewport-fit\s*=\s*cover/);
        const before = await page.evaluate(() => ({ height: visualViewport.height, width: visualViewport.width }));
        await page.setViewportSize({ width: 390, height: 480 }); await settle(page);
        const after = await page.evaluate(() => ({ height: visualViewport.height, width: visualViewport.width }));
        assert.ok(after.height < before.height && after.width === before.width);
      } finally { await page.close(); }
    });
    await check('long plain messages wrap and tokens follow only while reading the latest reply', async () => {
      const page = await newPage({ width: 390, height: 480 });
      try {
        await ready(page);
        await send(page, 'Fixture plain text <img src=x onerror="window.mobileInjection=true"> ' + 'unbroken'.repeat(90));
        let text = Array.from({ length: 55 }, (_, index) => 'Fixture reply line ' + index + ' remains readable.').join('\n');
        await fixture(page, 'token', text); await settle(page);
        assert.equal(await page.locator('#messages img').count(), 0);
        assert.equal(await page.evaluate(() => window.mobileInjection), undefined);
        assert.equal(await nearTail(page), true, 'initial streaming follows the tail');
        await noHorizontalOverflow(page); await containedChat(page);
        text += '\n' + 'A longer unbroken token: ' + 'longword'.repeat(140);
        await fixture(page, 'token', text); await settle(page);
        assert.equal(await nearTail(page), true, 'new tokens stay visible when already at the bottom');
        await page.locator('#messages').evaluate(node => { node.scrollTop = 0; }); await settle(page);
        const readingTop = await page.locator('#messages').evaluate(node => node.scrollTop);
        text += '\n' + 'Further fixture tokens arrive while earlier text is being read.\n'.repeat(10);
        await fixture(page, 'token', text); await settle(page);
        assert.ok(Math.abs(await page.locator('#messages').evaluate(node => node.scrollTop) - readingTop) <= 2, 'streaming does not yank a scrolled-up reader');
        await page.locator('#new-messages').waitFor({ state: 'visible' });
        await touchTarget(page.locator('#new-messages'));
        assert.equal(await page.locator('#new-messages').getAttribute('aria-controls'), 'messages');
        await page.locator('#new-messages').click(); await settle(page);
        assert.equal(await nearTail(page), true, 'explicit latest-message control returns to bottom');
        text += '\nThe latest fixture sentence stays in view.';
        await fixture(page, 'token', text); await settle(page);
        assert.equal(await nearTail(page), true);
        await fixture(page, 'answer', text); await phase(page, 'ready'); await settle(page);
        assert.equal(await page.locator('#new-messages').isVisible(), false);
        await containedChat(page);
      } finally { await page.close(); }
    });
    await check('conversation-limit feedback is visible in ready chat at keyboard-size height', async () => {
      const page = await newPage({ width: 390, height: 480 });
      try {
        await ready(page); await send(page, 'Fixture conversation budget check.');
        await fixture(page, 'answer', 'Budget fixture text. '.repeat(250)); await phase(page, 'ready');
        await page.locator('#prompt').fill('next-question-'.repeat(100)); await page.locator('#send').click(); await settle(page);
        assert.equal(await page.locator('#app').getAttribute('data-phase'), 'ready');
        assert.equal(await page.locator('#chat-error').isVisible(), true);
        assert.match(await page.locator('#chat-error').textContent(), /conversation limit/i);
        assert.equal(await page.locator('#chat-error').getAttribute('role'), 'alert');
        const bounds = await page.locator('#chat-error').boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 481, 'limit feedback within viewport: ' + JSON.stringify(bounds));
        await containedChat(page);
        await page.locator('#clear').click(); assert.equal(await page.locator('#chat-error').isVisible(), false);
      } finally { await page.close(); }
    });
    await check('leaving ready chat restores scrollable loading layout and retains an unsent draft', async () => {
      const page = await newPage({ width: 320, height: 568 });
      try {
        await ready(page); await page.locator('#prompt').fill('Fixture draft kept when unloading.');
        await page.locator('#unload').click(); await phase(page, 'cancelled'); await settle(page);
        assert.equal(await page.locator('#loading-stage').isVisible(), true);
        assert.equal(await page.locator('#draft').inputValue(), 'Fixture draft kept when unloading.');
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'long loading page stays scrollable');
        await touchTarget(page.locator('.file-choice'));
      } finally { await page.close(); }
    });
    await check('essential keyboard-size screenshot is visibly labeled as a UI fixture', async () => {
      const page = await newPage({ width: 390, height: 480 });
      try {
        await ready(page); await send(page, 'Can I keep the message box visible?');
        await fixture(page, 'answer', 'UI fixture response: the conversation scrolls above the message box. No model was loaded for this layout check.');
        await phase(page, 'ready'); await page.locator('#prompt').fill('A draft survives rotation.');
        await containedChat(page); await capture(page, 'mobile-layout-fixture.png');
      } finally { await page.close(); }
    });
    await check('fixture boundary and source identity remain intact', async () => {
      assert.deepEqual(requests, []); assert.deepEqual(pageErrors, []);
      for (const identity of sourceIdentity) assert.equal(digest(await readFile(path.join(root, identity.path))), identity.sha256, identity.path);
    });
  }
} catch (error) { failure = error; }
finally {
  try { if (context) { await context.close(); browserClosed = true; } } catch (error) { failure ||= error; }
  try { if (preview) { await preview.close(); serverClosed = true; } } catch (error) { failure ||= error; }
  try {
    if (profile) { assert.equal(path.resolve(path.dirname(profile)), path.resolve(os.tmpdir())); assert.ok(path.basename(profile).startsWith(profilePrefix)); await rm(profile, { recursive: true, force: true }); profileRemoved = true; }
  } catch (error) { failure ||= error; }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'mobile-result.json'), JSON.stringify({ schemaVersion: 1, kind: 'browser-model-chat-mobile-fixture',
    label: 'Mock adapter UI checks; no model/runtime execution', mode: baseline ? 'baseline-observation' : 'verification', status: failure ? 'fail' : 'pass',
    actualModelExecution: false, actualIosValidation: false, physicalKeyboardValidation: false,
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, browser: browserVersion, node: process.version,
    sourceIdentity, checks, observations, baselineObservations, screenshots, boundary: { forbiddenRequests: requests, pageErrors },
    cleanup: { browserContextClosed: browserClosed, loopbackServerClosed: serverClosed, ownedTemporaryProfileRemoved: profileRemoved },
    ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) { console.error('FAIL mobile fixture: ' + failure.message); process.exitCode = 1; }
else console.log('PASS: ' + checks.length + ' mobile fixture checks; ' + observations.length + (baseline ? ' baseline observations.' : ' viewport observations.'));
