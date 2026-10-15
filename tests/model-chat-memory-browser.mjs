#!/usr/bin/env node
// Experimental memory UI proof: real stores/retrieval, labeled fixture provider, no model execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { buildCore } from '../examples/browser-model-chat/memory/build-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/local-memory');
const profilePrefix = 'rag-memory-browser-';
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || process.env.MODEL_CHAT_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE?.trim() || process.env.PLAYWRIGHT_MODULE?.trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], observations = [], forbiddenRequests = [], pageErrors = [], screenshots = [];
const cleanup = { browserContextClosed: false, loopbackServerClosed: false, ownedTemporaryProfileRemoved: false };
const sourcePaths = ['examples/browser-model-chat/index.html', 'examples/browser-model-chat/app.mjs',
  'examples/browser-model-chat/loader-controller.mjs', 'examples/browser-model-chat/style.css',
  'examples/browser-model-chat/bootstrap.mjs', 'examples/browser-model-chat/serve.mjs',
  'examples/browser-model-chat/memory/build-core.mjs', 'examples/browser-model-chat/memory/store.mjs',
  'examples/browser-model-chat/memory/build-graph.mjs',
  'examples/browser-model-chat/memory/events.mjs', 'examples/browser-model-chat/memory/rag-adapter.mjs',
  'examples/browser-model-chat/memory/context.mjs', 'examples/browser-model-chat/memory/workspace.mjs',
  'examples/browser-model-chat/memory/structured-context.mjs',
  'examples/browser-model-chat/memory/automatic-context.mjs',
  'examples/browser-model-chat/memory/citations.mjs',
  'examples/browser-model-chat/memory/restore-events.mjs',
  'examples/browser-model-chat/memory/panel.mjs', 'examples/browser-model-chat/memory/panel.css',
  'modules/browser-rag-ts/scripts/static-server.mjs',
  'modules/browser-rag-ts/src/application/graphRenderer.ts', 'modules/browser-rag-ts/src/application/layoutGraph.ts',
  'modules/browser-rag-ts/src/application/graphPalette.ts', 'modules/browser-rag-ts/src/presentation/nodeSpawnMotion.js',
  'tests/model-chat-memory-browser.mjs'];
const firstFact = 'The harbor access code is CEDAR-731.';
const correctedFact = 'The harbor access code is MAPLE-946.';
const historicalSavedAnswers = [];
let preview, context, profile, enabledPage, browserVersion, coreBuild, graphArtifact, failure, sourceIdentity, workerCount = 0;
const started = Date.now();

function fixtureModule(memoryEnabled) {
  return `
import { mountApp } from './app.mjs';
${memoryEnabled ? `import { createWorkspace } from './memory/workspace.mjs';
import { mountMemoryPanel } from './memory/panel.mjs';
import * as core from './memory/rag-core.mjs';` : ''}
const fixture = window.__memoryFixture = { label: 'UI FIXTURE - no model or runtime execution', calls: [], lastDispatch: null, overflowNextMeasure: false };
const adapter = {
  async prepare({ source, file }) {
    fixture.calls.push({ kind: 'prepare', source, fileBytes: file?.size ?? null });
    return { cached: false, modelId: 'fixture-only-no-model', runtimeProfile: 'memory64' };
  },
  async measure(messages) {
    fixture.calls.push({ kind: 'measure', messageCount: messages.length });
    if (fixture.overflowNextMeasure) {
      fixture.overflowNextMeasure = false;
      return { promptTokens: 2300, contextTokens: 2048, overflow: true };
    }
    return { promptTokens: 300, contextTokens: 2048, overflow: false };
  },
  async reply(messages, options = {}) {
    await options.beforeDispatch?.();
    await options.onDispatch?.();
    fixture.lastDispatch = structuredClone(messages);
    fixture.calls.push({ kind: 'reply', messageCount: messages.length });
    options.onToken?.('Fixture response');
    return 'Fixture response';
  },
  async dispose() { fixture.calls.push({ kind: 'dispose' }); },
};
${memoryEnabled ? `const workspace = await createWorkspace({ adapter, core, storage: localStorage, graphEnabled: new URL(location.href).searchParams.get('graph') !== '0' });
const app = mountApp(workspace.provider, { workspace });
const panel = mountMemoryPanel({ ...workspace, onChange: () => workspace.persist() });
workspace.attachPanel(panel);
window.localMemoryPreview = { app, workspace };` : `const app = mountApp(adapter);
window.localMemoryPreview = { app };`}
const badge = document.createElement('p');
badge.id = 'memory-fixture-badge';
badge.textContent = fixture.label;
badge.style.cssText = 'position:sticky;top:0;z-index:2;margin:0;padding:8px;background:#252014;color:#ffedc8;border-bottom:1px solid #e6c98e;font:11px/1.5 ui-monospace,monospace;pointer-events:none';
${memoryEnabled ? `panel.dialog.querySelector('.memory-panel-body').prepend(badge);` : `badge.style.cssText += ';position:fixed;bottom:0;top:auto;left:0;right:0;z-index:99999'; document.body.append(badge);`}
`;
}

async function check(name, run) {
  const at = Date.now();
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at }); console.log('PASS private memory UI: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message }); throw error; }
}
async function settle(page) { await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))); }
async function phase(page, name) { await page.locator(`#app[data-phase="${name}"]`).waitFor({ state: 'attached' }); }
async function ready(page) {
  await page.locator('#local-file').setInputFiles({ name: 'fixture-not-a-model.gguf', mimeType: 'application/octet-stream', buffer: Buffer.from('UI FIXTURE ONLY - NOT MODEL BYTES') });
  await phase(page, 'ready'); await settle(page);
}
async function send(page, text) {
  const previous = await page.locator('.message.assistant:not(.pending)').count();
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await page.waitForFunction(expected => {
    const replies = [...document.querySelectorAll('.message.assistant:not(.pending)')];
    return replies.length === expected && replies.at(-1)?.querySelector('.content')?.textContent === 'Fixture response'
      && document.getElementById('app').dataset.phase === 'ready';
  }, previous + 1);
  await settle(page);
}
async function openPanel(page) { await page.locator('#memory-open').click(); await page.waitForFunction(() => document.getElementById('memory-dialog')?.open); }
async function closePanel(page) { await page.locator('#memory-close').click(); await page.waitForFunction(() => !document.getElementById('memory-dialog')?.open); }
async function graphView(page) {
  const back = page.locator('#memory-back');
  if (await back.isVisible()) await back.click();
  await page.locator('#memory-query').waitFor({ state: 'visible' });
  await page.waitForFunction(() => ['tsl', 'list', 'empty'].includes(document.getElementById('memory-graph')?.dataset.renderer));
  await settle(page);
}
async function selectRecord(page, recordId = 'm-0001') {
  await graphView(page);
  await page.locator(`[data-memory-node="record:${recordId}"]`).click();
  await page.locator('#memory-detail-text').waitFor({ state: 'visible' });
}
async function recall(page, query = 'harbor access code') {
  await graphView(page);
  const before = await page.evaluate(() => window.localMemoryPreview.workspace.events.list().length);
  await page.locator('#memory-query').fill(query); await page.locator('#memory-recall').click();
  await page.waitForFunction(previous => ['Matching memories are lit up.', 'No matching saved memories.'].includes(document.getElementById('memory-status').textContent)
    && window.localMemoryPreview.workspace.events.list().length > previous, before);
  await settle(page);
}
async function answerSources(page, answerTurnId) {
  const footer = await page.locator(`#turn-${answerTurnId} .memory-sources`).evaluate(node => ({
    label: node.firstChild?.textContent,
    text: node.textContent,
    links: [...node.querySelectorAll('a')].map(link => ({ text: link.textContent, href: link.getAttribute('href') })),
  }));
  const sources = await page.evaluate(id => window.localMemoryPreview.workspace.sourcesForAnswer(id), answerTurnId);
  assert.equal(footer.label, 'Sources sent at the time: ');
  assert.ok(Array.isArray(sources) && sources.length > 0);
  assert.deepEqual(footer.links.map(link => link.href), sources.map(source => '#turn-' + source.turnId));
  return { sources, footer };
}
async function assertSavedAnswerHistory(page) {
  for (const historical of historicalSavedAnswers) assert.deepEqual(await answerSources(page, historical.answerTurnId), historical.value, 'historical sources remain attached to their original answer');
}
async function captureHistoricalAnswers(page) {
  const first = await answerSources(page, 't-0006');
  assert.deepEqual(first.sources.filter(source => source.kind === 'saved-record'), [{ kind: 'saved-record', recordId: 'm-0001', version: 1, turnId: 't-0001', turnHash: digest(firstFact) }]);
  const second = await answerSources(page, 't-0008');
  assert.deepEqual(second.sources.filter(source => source.kind === 'saved-record'), [{ kind: 'saved-record', recordId: 'm-0001', version: 2, turnId: 't-0005', turnHash: digest(correctedFact) }]);
  assert.equal(await page.locator('[data-memory-node]').count(), 0, 'no active saved records means no generated graph nodes');
  const activeSavedRecords = await page.evaluate(() => {
    const workspace = window.localMemoryPreview.workspace;
    const { actorId, conversationId } = workspace.conversation.snapshot();
    return workspace.memory.active({ actorId, conversationId }).length;
  });
  assert.equal(activeSavedRecords, 0);
  await closePanel(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const badge = document.getElementById('memory-fixture-badge');
    badge.textContent = 'UI FIXTURE - after reload · no model/runtime execution\nActive saved records: 0 · latest Search hits: 0';
    badge.style.cssText = 'position:fixed;bottom:6px;left:6px;right:6px;top:auto;z-index:999999;margin:0;padding:8px;background:#252014;color:#ffedc8;border:1px solid #e6c98e;font:11px/1.5 ui-monospace,monospace;white-space:pre-line;pointer-events:none';
    document.body.append(badge);
    const log = document.getElementById('messages');
    const footer = document.querySelector('#turn-t-0006 .memory-sources');
    log.scrollTop += footer.getBoundingClientRect().top - log.getBoundingClientRect().top - 16;
  });
  await settle(page);
  const bounds = await page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, log: rect(document.getElementById('messages')),
      fixtureBadge: rect(document.getElementById('memory-fixture-badge')),
      footers: ['t-0006', 't-0008'].map(answerTurnId => ({ answerTurnId, ...rect(document.querySelector(`#turn-${answerTurnId} .memory-sources`)) })) };
  });
  for (const footer of bounds.footers) {
    assert.ok(footer.top >= bounds.log.top && footer.bottom <= bounds.log.bottom && footer.bottom < bounds.fixtureBadge.top,
      'historical footer is wholly visible above the fixture banner: ' + JSON.stringify(footer));
    assert.ok(footer.left >= 0 && footer.right <= bounds.viewport.width, 'historical footer fits the narrow viewport');
  }
  assert.ok(bounds.fixtureBadge.top >= 0 && bounds.fixtureBadge.bottom <= bounds.viewport.height, 'fixture banner is inside the captured viewport');
  const screenshotPath = join(output, 'memory-panel.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const bytes = await readFile(screenshotPath);
  const capture = { view: 'post-reload-chat-with-historical-citations',
    caption: 'UI fixture after reload: historical m-0001 v1 and v2 answer footers remain visible while active saved records and Search hits are zero.',
    answerTurnIds: ['t-0006', 't-0008'], activeSavedRecords, recallHits: 0, afterReload: true,
    actualModelExecution: false, visibleFixtureLabel: true, ...bounds };
  screenshots.push({ path: '.artifacts/proof/local-memory/memory-panel.png', bytes: bytes.length, sha256: digest(bytes), ...capture });
  observations.push({ name: 'post-reload-historical-citations', ...capture });
  await openPanel(page);
}
async function newPage({ memoryEnabled = true, graphEnabled = true, missingCore = false, viewport = { width: 390, height: 844 } } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    // Each page owns a fresh fixture; reload preserves its exact persisted state.
    if (location.protocol === 'http:' && !sessionStorage.getItem('memory-browser-fixture')) {
      localStorage.removeItem('private-one-chat-memory-v1');
      sessionStorage.setItem('memory-browser-fixture', 'initialized');
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', () => { workerCount++; });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'data:') return;
    if (url.origin !== new URL(preview.url).origin || /engine-worker\.mjs|\/runtime\/|\.gguf(?:$|\?)/i.test(url.pathname)) {
      forbiddenRequests.push({ kind: url.origin === new URL(preview.url).origin ? 'runtime-or-model' : 'external', path: url.pathname });
    }
  });
  // Normal fixture cases replace only bootstrap. The explicit missing-core
  // negative control runs production bootstrap with that optional module absent.
  if (missingCore) await page.route('**/memory/rag-core.mjs', route => route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'Missing optional memory core fixture.' }));
  else await page.route('**/bootstrap.mjs', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fixtureModule(memoryEnabled) }));
  await page.goto(preview.url + (missingCore ? '?memory=1' : graphEnabled ? '' : '?graph=0'), { waitUntil: 'networkidle' });
  await phase(page, 'idle');
  if (!missingCore) assert.deepEqual(await page.evaluate(() => window.__memoryFixture.calls), [], 'no automatic preparation, measurement or provider call');
  return page;
}
async function geometry(page, name) {
  const value = await page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const dialog = document.getElementById('memory-dialog');
    const body = dialog.querySelector('.memory-panel-body');
    const visible = node => Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
    const forget = document.getElementById('memory-forget');
    const targets = [...dialog.querySelectorAll('button,input,select,textarea,a')].filter(visible).map(node => ({ id: node.id || node.tagName.toLowerCase(), ...rect(node) }));
    const motion = [...dialog.querySelectorAll('*'), dialog].filter(visible).map(node => getComputedStyle(node)).filter(style => style.animationName !== 'none' || style.transitionDuration.split(',').some(duration => parseFloat(duration) > 0));
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog), panelBody: { ...rect(body), clientWidth: body.clientWidth, scrollWidth: body.scrollWidth, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop: body.scrollTop },
      forgetButton: visible(forget) ? { ...rect(forget), label: forget.textContent, clientWidth: forget.clientWidth, scrollWidth: forget.scrollWidth, clientHeight: forget.clientHeight, scrollHeight: forget.scrollHeight } : null,
      document: { width: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, scrollX, scrollY }, targets, activeAnimationsOrTransitions: motion.length };
  });
  assert.ok(value.dialog.x >= -1 && value.dialog.y >= -1 && value.dialog.right <= value.viewport.width + 1 && value.dialog.bottom <= value.viewport.height + 1, name + ': dialog fits viewport ' + JSON.stringify(value));
  assert.ok(value.document.width <= value.viewport.width + 1 && value.document.bodyWidth <= value.viewport.width + 1, name + ': no horizontal document overflow');
  assert.ok(value.panelBody.scrollWidth <= value.panelBody.clientWidth + 1, name + ': no horizontal panel overflow');
  if (value.forgetButton) assert.ok(value.forgetButton.scrollWidth <= value.forgetButton.clientWidth + 1 && value.forgetButton.scrollHeight <= value.forgetButton.clientHeight + 1, name + ': full forget action label fits without clipping');
  assert.equal(value.document.scrollX, 0); assert.equal(value.document.scrollY, 0);
  assert.equal(value.activeAnimationsOrTransitions, 0, 'reduced motion leaves static controls');
  assert.ok(value.targets.length > 0, name + ': the current graph/detail/editor view has visible controls');
  for (const target of value.targets) assert.ok(target.width >= 44 && target.height >= 44, name + ': 44px target ' + JSON.stringify(target));
  const { targets, ...compact } = value;
  observations.push({ name, ...compact, touchTargets: { count: targets.length,
    minimumWidth: Math.min(...targets.map(target => target.width)), minimumHeight: Math.min(...targets.map(target => target.height)) } });
  return value;
}

try {
  if (!dependency) throw Error('Set BROWSER_MODEL_PLAYWRIGHT_MODULE or PLAYWRIGHT_MODULE to an already-prepared Playwright module. Automatic installation is disabled.');
  await access(chrome); await access(dependency);
  const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
  coreBuild = await buildCore();
  const graphPath = join(root, '.artifacts/memory/graph-renderer.mjs');
  const graphBytes = await readFile(graphPath);
  graphArtifact = { path: '.artifacts/memory/graph-renderer.mjs', bytes: graphBytes.length, sha256: digest(graphBytes) };
  sourceIdentity = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
  await mkdir(output, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  preview = await startServer({ memoryCoreRoot: dirname(coreBuild.corePath), memoryGraphRoot: dirname(graphPath) });
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, chromiumSandbox: true, serviceWorkers: 'block',
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] });
  context.setDefaultTimeout(8000); browserVersion = context.browser()?.version() || 'installed Chromium';

  await check('optional base chat works and missing-core production bootstrap falls back to working loading controls', async () => {
    const page = await newPage({ memoryEnabled: false });
    try {
      assert.equal(await page.locator('#memory-open').count(), 0); assert.equal(await page.locator('#memory-dialog').count(), 0);
      await ready(page); await send(page, 'A plain chat fixture message.');
      assert.equal(await page.locator('.message.assistant .content').last().textContent(), 'Fixture response');
      assert.deepEqual(await page.evaluate(() => window.__memoryFixture.calls.map(call => call.kind)), ['prepare', 'reply']);
    } finally { await page.close(); }
    const fallback = await newPage({ missingCore: true });
    try {
      await fallback.getByRole('alert').filter({ hasText: 'Local memory is unavailable. Basic chat is available.' }).waitFor();
      assert.equal(await fallback.locator('#memory-open').count(), 0);
      assert.equal(await fallback.locator('#download').isEnabled(), true);
      assert.equal(await fallback.locator('#local-file').isEnabled(), true);
      await fallback.locator('#load-details > summary').click();
      await fallback.locator('#effects').uncheck();
      assert.equal(await fallback.locator('#app').evaluate(node => node.classList.contains('quiet')), true, 'fallback app mounted its controls');
    } finally { await fallback.close(); }
  });
  await check('two synchronous submits accept exactly one authored turn and one reply', async () => {
    const page = await newPage();
    try {
      await ready(page);
      await page.evaluate(() => {
        document.getElementById('prompt').value = 'One accepted message despite duplicate submits.';
        document.getElementById('composer').requestSubmit();
        document.getElementById('composer').requestSubmit();
      });
      await page.waitForFunction(() => document.querySelector('.message.assistant:not(.pending) .content')?.textContent === 'Fixture response'
        && document.getElementById('app').dataset.phase === 'ready');
      await settle(page);
      assert.deepEqual(await page.evaluate(() => window.localMemoryPreview.workspace.conversation.snapshot().turns.map(turn => [turn.role, turn.content])),
        [['user', 'One accepted message despite duplicate submits.'], ['assistant', 'Fixture response']]);
      assert.equal(await page.evaluate(() => window.__memoryFixture.calls.filter(call => call.kind === 'reply').length), 1);
    } finally { await page.close(); }
  });
  await check('structured answer keeps its historical source annotations and links after reload', async () => {
    const page = await newPage();
    try {
      await ready(page);
      await send(page, 'Fact[harbor]: The harbor access code is CEDAR-731.');
      await send(page, 'Constraint[access]: Harbor access is allowed only after sunrise.');
      await send(page, 'Fact[room]: The review room is Copper.');
      await send(page, 'Correction[harbor]: The harbor access code is MAPLE-946.');
      await page.evaluate(() => { window.__memoryFixture.overflowNextMeasure = true; });
      await send(page, 'What are the harbor access code, access constraint, and review room?');
      assert.equal(await page.evaluate(() => window.localMemoryPreview.workspace.context.snapshot().compacted?.strategy), 'source-linked-structured-extractive-v1');
      const links = await page.locator('.message.assistant').last().locator('.memory-sources a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.getAttribute('href') })));
      assert.equal(links.length, 3);
      assert.deepEqual(new Set(links.map(link => link.href)), new Set(['#turn-t-0003', '#turn-t-0005', '#turn-t-0007']));
      for (const key of ['harbor', 'access', 'room']) assert.ok(links.some(link => link.text.includes(key)), key + ' has an authored context source');
      const historical = await answerSources(page, 't-0010');
      assert.ok(historical.sources.every(source => source.kind === 'structured' && /^[a-f0-9]{64}$/.test(source.turnHash)
        && /^[a-f0-9]{64}$/.test(source.lineHash) && source.offsets?.unit === 'utf16' && source.offsets.end > source.offsets.start));
      assert.deepEqual(new Set(historical.sources.map(source => source.key)), new Set(['harbor', 'access', 'room']));
      await page.reload({ waitUntil: 'networkidle' }); await phase(page, 'idle');
      assert.deepEqual(await page.evaluate(() => window.__memoryFixture.calls), [], 'restoring historical links does not call the provider');
      assert.deepEqual(await answerSources(page, 't-0010'), historical);
      await ready(page);
      assert.deepEqual(await answerSources(page, 't-0010'), historical);
      assert.equal(await page.locator('#turn-t-0003, #turn-t-0005, #turn-t-0007').count(), 3, 'historical source targets remain in the canonical view');
    } finally { await page.close(); }
  });
  await check('ordinary unmarked passages keep exact historical citations after automatic compaction and reload', async () => {
    const page = await newPage();
    try {
      await ready(page);
      await send(page, 'Our harbor access code is CEDAR-731. The nearby bakery opens on Sunday.');
      await send(page, 'Harbor access begins after sunrise. Bring a printed invitation to the harbor gate.');
      await send(page, 'The review room is Copper. Leave the parcels in the review room.');
      await send(page, 'We will meet by the harbor gate after the review.');
      await page.evaluate(() => { window.__memoryFixture.overflowNextMeasure = true; });
      await send(page, 'What harbor access code, access time and review room did I give you?');
      const state = await page.evaluate(() => {
        const workspace = window.localMemoryPreview.workspace;
        return { conversation: workspace.conversation.snapshot(), memory: workspace.memory.exportState(),
          compacted: workspace.context.snapshot().compacted, dispatch: window.__memoryFixture.lastDispatch,
          citations: JSON.parse(localStorage.getItem('private-one-chat-memory-v1')).answerCitations };
      });
      assert.equal(state.compacted.strategy, 'source-linked-automatic-extractive-v1');
      assert.equal(state.compacted.coverage.semanticSummary, false);
      assert.equal(state.compacted.coverage.completeConversation, false);
      const historical = await answerSources(page, 't-0010');
      assert.ok(historical.sources.length > 0 && historical.sources.length <= 8);
      assert.equal(new Set(historical.sources.map(source => source.key)).size, historical.sources.length);
      const olderUserIds = new Set(['t-0001', 't-0003', 't-0005']);
      for (const source of historical.sources) {
        assert.equal(source.kind, 'extractive'); assert.ok(olderUserIds.has(source.turnId));
        const original = state.conversation.turns.find(turn => turn.id === source.turnId);
        assert.equal(original.role, 'user'); assert.equal(source.turnHash, digest(original.content));
        assert.equal(source.offsets.unit, 'utf16');
        assert.ok(Number.isSafeInteger(source.offsets.start) && Number.isSafeInteger(source.offsets.end)
          && source.offsets.start >= 0 && source.offsets.end > source.offsets.start && source.offsets.end <= original.content.length);
        const quote = original.content.slice(source.offsets.start, source.offsets.end);
        assert.equal(source.lineHash, digest(quote));
        assert.ok(state.dispatch.some(message => message.role === 'system' && message.content.includes(quote)), 'the cited original passage was actually dispatched');
      }
      assert.equal(state.conversation.turns.length, 10);
      assert.ok(state.conversation.turns.filter(turn => turn.role === 'user').every(turn => !/^(Fact|Constraint|Correction)\[/m.test(turn.content)), 'the fixture uses ordinary messages without declaration markup');
      await page.reload({ waitUntil: 'networkidle' }); await phase(page, 'idle');
      assert.deepEqual(await page.evaluate(() => window.__memoryFixture.calls), [], 'citation restore makes no automatic provider calls');
      assert.deepEqual(await answerSources(page, 't-0010'), historical, 'full source arrays and footer href/text survive reload');
      assert.deepEqual(await page.evaluate(() => ({ conversation: window.localMemoryPreview.workspace.conversation.snapshot(),
        memory: window.localMemoryPreview.workspace.memory.exportState(), citations: JSON.parse(localStorage.getItem('private-one-chat-memory-v1')).answerCitations })),
      { conversation: state.conversation, memory: state.memory, citations: state.citations });
      await ready(page);
      assert.deepEqual(await answerSources(page, 't-0010'), historical);
      assert.equal(await page.evaluate(() => {
        const workspace = window.localMemoryPreview.workspace, scope = workspace.conversation.snapshot();
        return workspace.memory.active({ actorId: scope.actorId, conversationId: scope.conversationId }).length;
      }), 0, 'derived passages are not admitted as saved records');
      observations.push({ name: 'ordinary-automatic-historical-citations', answerTurnId: 't-0010',
        strategy: state.compacted.strategy, sourceCount: historical.sources.length,
        sourceTurnIds: historical.sources.map(source => source.turnId), exactCanonicalHashBindings: true,
        fullSourcesAndFooterPreservedAfterReload: true, activeSavedRecords: 0, fixtureMeasurementOnly: true });
    } finally { await page.close(); }
  });
  await check('a user-selected exact source saves one version without admitting edited or assistant words', async () => {
    enabledPage = await newPage();
    await ready(enabledPage); await send(enabledPage, firstFact); await openPanel(enabledPage);
    await graphView(enabledPage);
    assert.equal(await enabledPage.locator('[data-memory-node]').count(), 0, 'ordinary conversation has no invented saved graph nodes');
    await enabledPage.locator('#memory-add').click();
    await enabledPage.locator('#memory-source-turn').waitFor({ state: 'visible' });
    await enabledPage.locator('#memory-source-turn').selectOption('t-0001');
    assert.equal(await enabledPage.locator('#memory-text').inputValue(), firstFact);
    await enabledPage.locator('#memory-text').fill('Invented text not present in my message.');
    assert.equal(await enabledPage.locator('#memory-save').isDisabled(), true);
    assert.equal(await enabledPage.locator('#memory-source-turn option').count(), 2, 'only the authored turn is selectable');
    await enabledPage.locator('#memory-text').fill(firstFact); await enabledPage.locator('#memory-save').click();
    await enabledPage.waitForFunction(() => document.getElementById('memory-status').textContent === 'Saved from your message.');
    await selectRecord(enabledPage);
    assert.equal(await enabledPage.locator('#memory-detail-text').textContent(), firstFact);
    assert.equal(await enabledPage.getByRole('button', { name: 'Forget saved record', exact: true }).count(), 1);
    assert.equal(await enabledPage.locator('#memory-detail-sources a[data-memory-source="t-0001"]').getAttribute('href'), '#turn-t-0001');
  });
  await check('later chat and panel recall use real RAG with source links and accessible focus return', async () => {
    await closePanel(enabledPage); await send(enabledPage, 'What is the harbor access code?');
    assert.equal(await enabledPage.locator('.message.assistant').last().locator('.memory-sources a[href="#turn-t-0001"]').count(), 1);
    const historical = await answerSources(enabledPage, 't-0004');
    assert.deepEqual(historical.sources.filter(source => source.kind === 'saved-record'), [{ kind: 'saved-record', recordId: 'm-0001', version: 1, turnId: 't-0001', turnHash: digest(firstFact) }]);
    historicalSavedAnswers.push({ answerTurnId: 't-0004', value: historical });
    await openPanel(enabledPage); await recall(enabledPage);
    assert.equal(await enabledPage.locator('#memory-status').textContent(), 'Matching memories are lit up.');
    assert.equal(await enabledPage.locator('[data-memory-node="record:m-0001"][data-matched="true"]').count(), 1, 'the real RAG result lights its canonical saved record');
    assert.equal(await enabledPage.locator('#memory-graph').getAttribute('data-renderer'), 'tsl');
    await enabledPage.keyboard.press('Escape');
    await enabledPage.waitForFunction(() => document.getElementById('memory-dialog').open && document.getElementById('memory-query').value === '');
    await enabledPage.keyboard.press('Escape');
    await enabledPage.waitForFunction(() => !document.getElementById('memory-dialog').open && document.activeElement.id === 'memory-open');
    await openPanel(enabledPage);
    await selectRecord(enabledPage);
    assert.equal(await enabledPage.locator('#memory-detail-text').textContent(), firstFact);
    await enabledPage.locator('#memory-detail-sources a[data-memory-source="t-0001"]').click();
    await enabledPage.waitForFunction(() => !document.getElementById('memory-dialog').open && document.activeElement.id === 'turn-t-0001');
  });
  await check('an authored correction creates v2 and supersedes the old recall result', async () => {
    await send(enabledPage, correctedFact); await openPanel(enabledPage);
    await selectRecord(enabledPage); await enabledPage.locator('#memory-edit').click();
    await enabledPage.locator('#memory-source-turn').waitFor({ state: 'visible' });
    await enabledPage.locator('#memory-source-turn').selectOption('t-0005');
    assert.equal(await enabledPage.locator('#memory-text').inputValue(), correctedFact);
    await enabledPage.locator('#memory-correct').click();
    await enabledPage.waitForFunction(() => document.getElementById('memory-status').textContent === 'Memory corrected.');
    await recall(enabledPage);
    assert.equal(await enabledPage.locator('[data-memory-node="record:m-0001"][data-matched="true"]').count(), 1);
    const active = await enabledPage.evaluate(() => {
      const workspace = window.localMemoryPreview.workspace, state = workspace.conversation.snapshot();
      return workspace.memory.active({ actorId: state.actorId, conversationId: state.conversationId }).map(record => ({ id: record.id, version: record.version, text: record.text }));
    });
    assert.deepEqual(active, [{ id: 'm-0001', version: 2, text: correctedFact }]);
    await selectRecord(enabledPage);
    assert.equal(await enabledPage.locator('#memory-detail-text').textContent(), correctedFact);
    assert.ok(!(await enabledPage.locator('#memory-detail-text').textContent()).includes('CEDAR-731'));
    assert.equal(await enabledPage.locator('#memory-detail-sources a[data-memory-source="t-0005"]').getAttribute('href'), '#turn-t-0005');
    await assertSavedAnswerHistory(enabledPage);
  });
  await check('390px, 320px and keyboard-size layouts contain the dialog, retain 44px targets and reduced motion', async () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 390, height: 360 }]) {
      await enabledPage.setViewportSize(viewport); await settle(enabledPage);
      await enabledPage.evaluate(() => window.scrollTo(80, 250));
      await recall(enabledPage);
      await geometry(enabledPage, `${viewport.width}x${viewport.height}-graph`);
      await selectRecord(enabledPage);
      await geometry(enabledPage, `${viewport.width}x${viewport.height}-detail`);
      await enabledPage.locator('#memory-edit').click();
      await enabledPage.locator('#memory-source-turn').waitFor({ state: 'visible' });
      await geometry(enabledPage, `${viewport.width}x${viewport.height}-editing`);
      await graphView(enabledPage);
      assert.equal(await enabledPage.locator('[data-memory-node="record:m-0001"]').evaluate(node => node === document.activeElement), true, 'Back returns focus to the selected saved-record node');
    }
    await enabledPage.setViewportSize({ width: 390, height: 844 }); await settle(enabledPage);
  });
  await check('forget removes the saved record from retrieval while preserving an unsaved authored repeat and the transcript', async () => {
    await closePanel(enabledPage); await send(enabledPage, correctedFact); await openPanel(enabledPage);
    const historical = await answerSources(enabledPage, 't-0008');
    assert.deepEqual(historical.sources.filter(source => source.kind === 'saved-record'), [{ kind: 'saved-record', recordId: 'm-0001', version: 2, turnId: 't-0005', turnHash: digest(correctedFact) }]);
    historicalSavedAnswers.push({ answerTurnId: 't-0008', value: historical });
    const beforeForget = await enabledPage.evaluate(() => window.localMemoryPreview.workspace.conversation.exportState());
    assert.deepEqual(await enabledPage.evaluate(() => window.localMemoryPreview.workspace.memory.snapshot().records.at(-1).sourceTurnIds), ['t-0005'], 'the authored repeat t-0007 has not been admitted as a saved source');
    await selectRecord(enabledPage); await enabledPage.locator('#memory-forget').click();
    await enabledPage.waitForFunction(() => document.getElementById('memory-status').textContent === 'Memory forgotten.');
    await recall(enabledPage); assert.equal(await enabledPage.locator('#memory-status').textContent(), 'No matching saved memories.');
    assert.equal(await enabledPage.locator('[data-memory-node]').count(), 0, 'forgotten and superseded records do not generate graph nodes');
    assert.equal(await enabledPage.evaluate(() => {
      const workspace = window.localMemoryPreview.workspace;
      const { actorId, conversationId } = workspace.conversation.snapshot();
      return workspace.memory.active({ actorId, conversationId }).length;
    }), 0);
    assert.equal(await enabledPage.evaluate(() => window.localMemoryPreview.workspace.conversation.exportState()), beforeForget, 'forget does not silently delete or rewrite any canonical turn');
    const versions = await enabledPage.evaluate(() => window.localMemoryPreview.workspace.memory.snapshot().records);
    assert.deepEqual(versions.map(record => [record.version, record.status]), [[1, 'superseded'], [2, 'superseded'], [3, 'forgotten']]);
    assert.equal(versions.at(-1).text, '');
    await assertSavedAnswerHistory(enabledPage);
    await closePanel(enabledPage); await send(enabledPage, 'What is the harbor access code now?');
    const dispatched = await enabledPage.evaluate(() => JSON.stringify(window.__memoryFixture.lastDispatch));
    assert.ok(dispatched.includes(correctedFact), 'the separate unsaved authored repeat remains eligible conversational context');
    assert.deepEqual(await enabledPage.evaluate(() => window.localMemoryPreview.workspace.events.list().filter(event => event.type === 'context-dispatched').at(-1).recordIds), [], 'the forgotten saved record is not dispatched as retrieved evidence');
    assert.deepEqual(await enabledPage.evaluate(() => window.localMemoryPreview.workspace.conversation.snapshot().turns.filter(turn => turn.role === 'user').map(turn => turn.content)),
      [firstFact, 'What is the harbor access code?', correctedFact, correctedFact, 'What is the harbor access code now?']);
  });
  await check('reload restores the full original transcript and tombstone without automatic provider calls', async () => {
    const before = await enabledPage.evaluate(() => ({ conversation: window.localMemoryPreview.workspace.conversation.exportState(), memory: window.localMemoryPreview.workspace.memory.exportState(), events: window.localMemoryPreview.workspace.events.list(),
      answerCitations: JSON.parse(localStorage.getItem('private-one-chat-memory-v1')).answerCitations }));
    await enabledPage.reload({ waitUntil: 'networkidle' }); await phase(enabledPage, 'idle');
    assert.deepEqual(await enabledPage.evaluate(() => window.__memoryFixture.calls), []);
    const after = await enabledPage.evaluate(() => ({ conversation: window.localMemoryPreview.workspace.conversation.exportState(), memory: window.localMemoryPreview.workspace.memory.exportState(), events: window.localMemoryPreview.workspace.events.list(),
      answerCitations: JSON.parse(localStorage.getItem('private-one-chat-memory-v1')).answerCitations }));
    assert.deepEqual(after, before); assert.equal(await enabledPage.locator('.message').count(), 10);
    await assertSavedAnswerHistory(enabledPage);
    await ready(enabledPage); await openPanel(enabledPage); await recall(enabledPage);
    assert.equal(await enabledPage.locator('#memory-status').textContent(), 'No matching saved memories.');
    assert.equal(await enabledPage.locator('[data-memory-node]').count(), 0);
    await assertSavedAnswerHistory(enabledPage);
    assert.equal(await enabledPage.evaluate(() => {
      const workspace = window.localMemoryPreview.workspace;
      const { actorId, conversationId } = workspace.conversation.snapshot();
      return workspace.memory.active({ actorId, conversationId }).length;
    }), 0, 'rendering historical citation links never resurrects the forgotten record');
    await captureHistoricalAnswers(enabledPage);
  });
  await check('unload closes the panel and hides its entry without deleting retained conversation state', async () => {
    // This is the same controller cancellation invoked by the app's Unload model button.
    await enabledPage.evaluate(() => window.localMemoryPreview.app.controller.cancel());
    await phase(enabledPage, 'cancelled');
    await enabledPage.waitForFunction(() => !document.getElementById('memory-dialog').open && document.getElementById('memory-open').hidden);
    assert.equal(await enabledPage.evaluate(() => window.localMemoryPreview.workspace.conversation.snapshot().turns.length), 10);
    await enabledPage.close(); enabledPage = undefined;
  });
  await check('graph-disabled assembly still saves and recalls memory with no graph drawing', async () => {
    const page = await newPage({ graphEnabled: false });
    try {
      await ready(page); await send(page, firstFact); await openPanel(page);
      await graphView(page); await page.locator('#memory-add').click();
      await page.locator('#memory-source-turn').waitFor({ state: 'visible' });
      await page.locator('#memory-source-turn').selectOption('t-0001'); await page.locator('#memory-save').click();
      await page.waitForFunction(() => document.getElementById('memory-status').textContent === 'Saved from your message.');
      await recall(page);
      assert.equal(await page.locator('#memory-status').textContent(), 'Matching memories are lit up.');
      assert.equal(await page.locator('[data-memory-node="record:m-0001"][data-matched="true"]').count(), 1);
      assert.equal(await page.locator('#memory-graph').getAttribute('data-renderer'), 'list');
      assert.equal(await page.locator('#memory-graph svg:visible, #memory-graph canvas:visible').count(), 0);
      await selectRecord(page); assert.equal(await page.locator('#memory-detail-text').textContent(), firstFact);
      assert.ok(await page.evaluate(() => window.localMemoryPreview.workspace.events.list().some(event => event.type === 'recalled')), 'actual retrieval events remain in the ledger without a dashboard');
      assert.equal(await page.evaluate(() => window.localMemoryPreview.workspace.graph === undefined), true);
    } finally { await page.close(); }
  });
  await check('fixture boundary, generated core identity and source hashes remain intact', async () => {
    assert.deepEqual(forbiddenRequests, []); assert.deepEqual(pageErrors, []); assert.equal(workerCount, 0);
    assert.equal(digest(await readFile(coreBuild.corePath)), coreBuild.sha256);
    assert.equal(digest(await readFile(join(root, graphArtifact.path))), graphArtifact.sha256);
    for (const identity of sourceIdentity) assert.equal(digest(await readFile(join(root, identity.path))), identity.sha256, identity.path);
  });
} catch (error) { failure = error; }
finally {
  try { if (context) { await context.close(); cleanup.browserContextClosed = true; } } catch (error) { failure ||= error; }
  try { if (preview) { await preview.close(); cleanup.loopbackServerClosed = true; } } catch (error) { failure ||= error; }
  try {
    if (profile) {
      assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true }); cleanup.ownedTemporaryProfileRemoved = true;
    }
  } catch (error) { failure ||= error; }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'browser-result.json'), JSON.stringify({ schema: 'local-memory-browser-proof/v1', status: failure ? 'fail' : 'pass',
    label: 'Real memory stores and retrieval; labeled fixture provider only', actualModelExecution: false, actualIosValidation: false, physicalKeyboardValidation: false,
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, browser: browserVersion, node: process.version,
    fixtureBootstrapSha256: { basic: digest(fixtureModule(false)), memory: digest(fixtureModule(true)) }, sourceIdentity,
    core: coreBuild && { path: '.artifacts/memory/rag-core.mjs', bytes: coreBuild.bytes, sha256: coreBuild.sha256, esbuildVersion: coreBuild.esbuildVersion, sources: coreBuild.sources },
    graphArtifact,
    checks, observations, screenshots, boundary: { forbiddenRequests, pageErrors, runtimeWorkersCreated: workerCount }, cleanup,
    ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) { console.error('FAIL private memory UI: ' + failure.stack); process.exitCode = 1; }
else console.log('PASS: ' + checks.length + ' private memory UI checks; one labeled screenshot retained.');
