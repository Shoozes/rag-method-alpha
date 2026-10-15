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
async function revealControl(page, id) {
  const disclosure = page.locator('#' + id).locator('xpath=ancestor::details[1]');
  if (await disclosure.count() && !await disclosure.evaluate(node => node.open)) await disclosure.locator(':scope > summary').click();
}
async function newPage(viewport = { width: 390, height: 844 }, { viewportFixture = false } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  if (viewportFixture) await page.addInitScript(() => {
    // A labeled event/geometry fixture, not physical Safari keyboard evidence.
    const value = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
    window.__fixtureViewport = change => { Object.assign(value, change); value.dispatchEvent(new Event('resize')); value.dispatchEvent(new Event('scroll')); };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value });
  });
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
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { left: r.left, right: r.right, width: r.width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        minWidth: style.minWidth, cssWidth: style.width, boxSizing: style.boxSizing,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, display: style.display };
    };
    const log = document.getElementById('messages');
    return { viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale, visualHeight: visualViewport?.height,
        visualWidth: visualViewport?.width, offsetLeft: visualViewport?.offsetLeft, offsetTop: visualViewport?.offsetTop },
      page: { scrollX, scrollY, scrollHeight: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth },
      log: { ...rect('messages'), overflowY: getComputedStyle(log).overflowY, scrollHeight: log.scrollHeight, clientHeight: log.clientHeight, scrollTop: log.scrollTop },
      app: rect('app'), composer: rect('composer'), prompt: rect('prompt'), send: rect('send'),
      containers: Object.fromEntries(['#app', '#chat-stage', '.chat-header', '.chat-header>div', '.conversation', '#composer'].map(selector => [selector, container(selector)])) };
  });
}
async function capture(page, name) {
  await page.evaluate(() => {
    const badge = document.createElement('div'); badge.id = 'mobile-fixture-badge';
    badge.textContent = 'UI FIXTURE · no model loaded';
    badge.style.cssText = 'position:fixed;top:4px;right:4px;z-index:999999;padding:5px 7px;background:#17140d;color:#ffedc8;border:1px solid #e6c98e;font:10px ui-monospace,monospace;pointer-events:none';
    // Keep the evidence label clear of the real header actions.
    badge.style.top = Math.ceil(document.querySelector('.masthead').getBoundingClientRect().bottom + 4) + 'px';
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
  const visualTop = value.viewport.offsetTop || 0, visualBottom = visualTop + (value.viewport.visualHeight || value.viewport.height);
  assert.ok(['auto', 'scroll'].includes(value.log.overflowY), 'conversation is its own scroll container: ' + JSON.stringify(value));
  assert.ok(value.log.height >= 40 && value.log.bottom <= visualBottom + 1, 'conversation remains usable: ' + JSON.stringify(value));
  assert.ok(value.composer.top >= visualTop - 1 && value.composer.bottom <= visualBottom + 1, 'composer in visual viewport: ' + JSON.stringify(value));
  assert.ok(value.prompt.top >= visualTop - 1 && value.prompt.bottom <= visualBottom + 1, 'prompt in visual viewport: ' + JSON.stringify(value));
  assert.ok(value.send.top >= visualTop - 1 && value.send.bottom <= visualBottom + 1, 'send in visual viewport: ' + JSON.stringify(value));
  for (const key of ['composer', 'prompt', 'send']) {
    const bounds = value[key];
    assert.ok(bounds.left >= -1 && bounds.right <= value.viewport.width + 1 && bounds.top >= visualTop - 1 && bounds.bottom <= visualBottom + 1,
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
        await touchTarget(page.locator('#send'));
        assert.ok((await geometry(page)).log.height >= 844 / 2, 'transcript owns most of the ready screen');
        assert.equal(await page.locator('#unload').isVisible(), false, 'secondary actions start collapsed');
        await revealControl(page, 'unload');
        for (const id of ['unload', 'clear']) await touchTarget(page.locator('#' + id));
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
        assert.doesNotMatch(viewport, /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i, 'viewport permits native zoom');
        const before = await page.evaluate(() => ({ height: visualViewport.height, width: visualViewport.width }));
        await page.setViewportSize({ width: 390, height: 480 }); await settle(page);
        const after = await page.evaluate(() => ({ height: visualViewport.height, width: visualViewport.width }));
        assert.ok(after.height < before.height && after.width === before.width);
      } finally { await page.close(); }
    });
    await check('scrolled loading entry anchors ready chat and prevents unintended page pan', async () => {
      const page = await newPage({ width: 390, height: 480 });
      try {
        await page.locator('#draft').fill('A draft from the scrolled loading page.');
        await page.locator('#download').click(); await phase(page, 'downloading');
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page);
        const loadingScrollY = await page.evaluate(() => scrollY);
        assert.ok(loadingScrollY > 0, 'precondition: loading page was actually scrolled');
        await fixture(page, 'ready'); await phase(page, 'ready');
        const initial = await containedChat(page);
        assert.ok(Math.abs(initial.app.top) <= 1 && Math.abs(initial.app.left) <= 1, 'ready shell starts at visible origin');
        assert.equal(await page.locator('#prompt').inputValue(), 'A draft from the scrolled loading page.');
        await page.evaluate(() => scrollTo(120, 180));
        await page.mouse.move(4, 4); await page.mouse.wheel(180, 160); await settle(page);
        const attempted = await containedChat(page);
        assert.ok(Math.abs(attempted.page.scrollX) <= 1 && Math.abs(attempted.page.scrollY) <= 1, 'root stays anchored after attempted pan');
        observations.push({ name: 'scrolled-loading-to-ready', ...attempted });
        await revealControl(page, 'unload'); await page.locator('#unload').click(); await phase(page, 'cancelled'); await settle(page);
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - loadingScrollY) <= 1, 'leaving ready chat restores the original loading-page scroll position');
      } finally { await page.close(); }
    });
    await check('synthetic Safari-style visual viewport offsets preserve draft and reader position', async () => {
      const page = await newPage({ width: 390, height: 844 }, { viewportFixture: true });
      try {
        await ready(page); await send(page, 'Viewport fixture reader position.');
        await fixture(page, 'answer', 'Earlier transcript line remains readable.\n'.repeat(100)); await phase(page, 'ready'); await settle(page);
        await page.locator('#prompt').fill('Unsent viewport fixture draft.');
        await page.locator('#messages').evaluate(node => { node.scrollTop = 64; }); await settle(page);
        const readingTop = await page.locator('#messages').evaluate(node => node.scrollTop);
        for (const change of [{ height: 430, offsetTop: 38 }, { height: 520, offsetTop: 0 }, { height: 844, offsetTop: 0 }]) {
          await page.evaluate(change => window.__fixtureViewport(change), change); await settle(page);
          const value = await containedChat(page);
          assert.ok(Math.abs(value.app.top - change.offsetTop) <= 1, 'shell follows the fixture visual origin');
          assert.ok(Math.abs(value.app.height - change.height) <= 1, 'shell fits the fixture available height');
          assert.equal(await page.locator('#prompt').inputValue(), 'Unsent viewport fixture draft.');
          assert.ok(Math.abs(await page.locator('#messages').evaluate(node => node.scrollTop) - readingTop) <= 2, 'viewport resize preserves a scrolled-up reader');
          observations.push({ name: 'synthetic-visual-viewport', input: change, ...value });
        }
      } finally { await page.close(); }
    });
    await check('native browser page zoom remains available without reflowing the app height', async () => {
      const page = await newPage();
      const session = await context.newCDPSession(page);
      try {
        await ready(page);
        const before = await page.locator('#app').evaluate(node => ({ height: node.style.getPropertyValue('--app-height'), top: node.style.getPropertyValue('--app-top') }));
        await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
        await page.waitForFunction(() => visualViewport.scale > 1.5); await settle(page);
        assert.deepEqual(await page.locator('#app').evaluate(node => ({ height: node.style.getPropertyValue('--app-height'), top: node.style.getPropertyValue('--app-top') })), before, 'zoom does not squeeze the application into the magnified viewport');
        assert.equal(await page.locator('#prompt').inputValue(), '');
        await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await settle(page);
        await containedChat(page);
      } finally { await session.detach(); await page.close(); }
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
        await revealControl(page, 'clear'); await page.locator('#clear').click(); assert.equal(await page.locator('#chat-error').isVisible(), false);
      } finally { await page.close(); }
    });
    await check('leaving ready chat restores scrollable loading layout and retains an unsent draft', async () => {
      const page = await newPage({ width: 320, height: 568 });
      try {
        await ready(page); await page.locator('#prompt').fill('Fixture draft kept when unloading.');
        await revealControl(page, 'unload'); await page.locator('#unload').click(); await phase(page, 'cancelled'); await settle(page);
        assert.equal(await page.locator('#loading-stage').isVisible(), true);
        assert.equal(await page.locator('#draft').inputValue(), 'Fixture draft kept when unloading.');
        await page.locator('#draft').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#draft').isVisible(), true, 'loading controls remain reachable after ready root lock is released');
        await touchTarget(page.locator('.file-choice'));
      } finally { await page.close(); }
    });
    await check('essential 390x844 after screenshot is visibly labeled as a UI fixture', async () => {
      const page = await newPage({ width: 390, height: 844 });
      try {
        await ready(page); await send(page, 'Hello');
        await fixture(page, 'answer', 'Hello! How can I help you today?'); await phase(page, 'ready');
        await send(page, 'Can we keep the conversation in view?');
        await fixture(page, 'answer', 'Yes. Your conversation stays above the message box.');
        await phase(page, 'ready'); await page.locator('#prompt').fill('Ready for a new thought.');
        observations.push({ name: 'after390x844', ...(await containedChat(page)) });
        await capture(page, 'after-mobile.png');
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
