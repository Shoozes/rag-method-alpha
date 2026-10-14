import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser_runtime.mjs';
import { assertCaptureSource } from './capture_source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = join(ROOT, 'modules/browser-rag-ts');
const SITE = join(MODULE, '.artifacts/release/browser-rag-ts');
const OUTPUT = join(ROOT, '.artifacts/proof/atlas-presentation');
const require = createRequire(join(MODULE, 'package.json'));
const { chromium } = require('playwright');
const updateMedia = process.argv.includes('--update-media');
if (process.argv.slice(2).some(arg => arg !== '--update-media')) throw new Error('Only --update-media is supported. Build the browser application first.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
await realpath(SITE);
const sourceIdentity = await assertCaptureSource(ROOT, SITE);
await mkdir(OUTPUT, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = await realpath(resolve(SITE, `.${path.endsWith('/') ? path + 'index.html' : path}`));
    const inside = relative(SITE, file);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('outside artifact');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const captures = [];
const errors = [];
const matrix = [];
let browser;
let runtime = {};
let failure;
const check = (name, condition, details) => { assert.ok(condition, `${name}: ${JSON.stringify(details)}`); checks.push(name); };
const frames = page => page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))));
async function ready(page) {
  await page.locator('#copy-context:enabled').waitFor({ state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => /graph ready:/u.test(document.querySelector('#graph-state')?.textContent ?? '') && document.querySelector('#app')?.dataset.operationOwner === 'idle', undefined, { timeout: 120000 });
}
async function quiet(page) {
  const disclosure = page.locator('.motion-disclosure');
  if (!await disclosure.evaluate(el => el.open)) await disclosure.locator('summary').click();
  await page.locator('#motion-style').selectOption('quiet');
  await disclosure.locator('summary').click();
  await page.locator('#fit-graph').click();
  await frames(page);
}
async function capture(page, name, state, fullPage = false) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page);
  const path = join(OUTPUT, `${name}.png`);
  const bytes = await page.screenshot({ path, fullPage, animations: 'disabled' });
  captures.push({ name, state, file: `${name}.png`, viewport: page.viewportSize(), full_page: fullPage,
    renderer: await page.locator('#graph-surface').getAttribute('data-renderer'),
    backend: await page.locator('#graph-tsl-canvas').evaluate(canvas => JSON.parse(canvas.dataset.rendererDiagnostics ?? '{}').selected_backend ?? 'svg'),
    backend_status: await page.locator('#renderer-state').textContent(), sha256: sha256(bytes), bytes: bytes.length });
}
async function layout(page, name, desktop = false) {
  await frames(page);
  const result = await page.evaluate(() => {
    const rect = selector => { const element = document.querySelector(selector); const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, shown: getComputedStyle(element).display !== 'none' && r.width > 0 && r.height > 0 }; };
    const parts = Object.fromEntries(['.hero', '.stage-heading', '.graph-pane', '.command-panel', '.evidence-pane', '#run-query'].map(s => [s, rect(s)]));
    const overlap = (a, b) => a.shown && b.shown && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
    const pairs = [['.graph-pane', '.command-panel'], ['.graph-pane', '.evidence-pane'], ['.command-panel', '.evidence-pane'], ['.stage-heading', '.graph-pane']];
    const bad = pairs.filter(([a, b]) => overlap(parts[a], parts[b]));
    const targets = JSON.parse(document.querySelector('#graph-tsl-canvas').dataset.nodeTargets ?? '[]');
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      overlaps: bad, parts, offscreenNodes: targets.filter(p => !p.visible).length, nodes: targets.length };
  });
  check(`${name}: no overlapping panes`, result.overlaps.length === 0, result.overlaps);
  check(`${name}: no horizontal overflow`, result.scrollWidth <= result.width + 1, result);
  check(`${name}: graph and Search remain usable`, result.parts['.graph-pane'].height >= 250 && result.parts['#run-query'].height >= 44, result.parts);
  if (desktop) check(`${name}: entire chrome fits the viewport`, result.scrollHeight <= result.height + 1 && result.parts['#run-query'].bottom <= result.height, result);
  matrix.push({ name, ...result });
}
function monitor(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`${request.url()}: ${request.failure()?.errorText}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
}
try {
  const launched = await launchChromium(chromium, { headless: true }, 'BROWSER_RAG_CHROMIUM_PATH');
  browser = launched.browser;
  runtime = { browser: browser.version(), executable: launched.executable, playwright: require('playwright/package.json').version,
    software_webgl_requested: process.env.LOCAL_BROWSER_SOFTWARE_WEBGL === '1' };
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  context.on('page', monitor);
  const page = await context.newPage();
  await page.goto(`${origin}/browser/?backend=webgl2`);
  await page.locator('#open-demo-vault:enabled').waitFor();
  await page.locator('#open-demo-vault').click();
  await ready(page);
  await quiet(page);
  await page.waitForFunction(() => document.querySelector('#graph-surface')?.dataset.renderer === 'tsl', undefined, { timeout: 30000 });
  check('real public vault loaded', (await page.locator('#active-collection').textContent()).includes('921 documents'));
  const initial = await page.locator('#result-list button[data-record-id]').evaluateAll(nodes => nodes.map(n => n.dataset.recordId));
  const packet = await page.locator('#context-content').textContent();
  check('accepted ranked results and verbatim context exist', initial.length >= 6 && packet.includes('TextureLoader'));
  await layout(page, 'desktop overview', true);
  await capture(page, 'atlas-overview', 'Accepted documentation query; Quiet motion; complete graph overview; evidence closed.');
  await page.locator('#toggle-inspector').click();
  await page.locator('#result-list button[data-record-id]').first().click();
  await page.locator('#copy-source:enabled').waitFor();
  check('selected result exposes a pinned source', (await page.locator('#source-origin').getAttribute('href')).startsWith('https://github.com/mrdoob/three.js/blob/'));
  check('source text is readable', (await page.locator('#source-content').textContent()).length > 100);
  await page.locator('#fit-graph').click();
  await layout(page, 'desktop evidence', true);
  await capture(page, 'atlas-evidence', 'First accepted result opened in the docked source reader.');
  await page.locator('#close-inspector').click();
  check('close evidence returns keyboard focus', await page.locator('#toggle-inspector').evaluate(element => document.activeElement === element));
  // Presentation changes must not change retrieval IDs or the exact context packet.
  await page.locator('#graph-view').selectOption('evidence');
  await page.waitForFunction(() => document.querySelector('#graph-state')?.textContent.includes('Evidence graph ready:'));
  await page.locator('#run-query').click();
  await ready(page);
  check('graph view and quiet effects preserve ranking', JSON.stringify(initial) === JSON.stringify(await page.locator('#result-list button[data-record-id]').evaluateAll(nodes => nodes.map(n => n.dataset.recordId))));
  check('graph view and quiet effects preserve complete context', packet === await page.locator('#context-content').textContent());
  await page.locator('#fit-graph').click();
  await capture(page, 'atlas-evidence-graph', 'Accepted evidence neighborhood with curved relationship highlights.');
  // Exercise projection changes independently of retrieval state.
  const overlays = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph-tsl-canvas');
    const path = document.querySelector('.evidence-connection');
    if (!path) return false;
    const saved = canvas.dataset.nodeTargets;
    const id = path.dataset.sourceNodeId;
    const token = path.dataset.linkId;
    const wait = () => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const show = async visible => {
      canvas.dataset.nodeTargets = JSON.stringify(JSON.parse(saved).map(point => point.node_id === id ? { ...point, visible } : point));
      canvas.dispatchEvent(new Event('rag-camera-frame'));
      await wait();
    };
    try {
      await show(false);
      const hidden = path.style.visibility === 'hidden';
      await show(true);
      return hidden && path.style.visibility === 'visible' && [...document.querySelectorAll('.evidence-connection')].filter(p => p.dataset.linkId === token).length === 1;
    } finally { canvas.dataset.nodeTargets = saved; canvas.dispatchEvent(new Event('rag-camera-frame')); }
  });
  check('camera visibility restores existing evidence curves without duplicate paths', overlays);
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#motion-style').selectOption('full');
  await page.locator('#replay-build').click();
  await page.waitForFunction(() => Number(document.querySelector('#graph-tsl-canvas')?.dataset.spawnActive) > 0);
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#fit-graph').click();
  await frames(page);
  check('Overview settles transient node growth as well as camera motion', await page.locator('#graph-tsl-canvas').getAttribute('data-spawn-active') === '0');
  await page.locator('#replay-trace').click();
  await page.locator('#graph-surface[data-trace-active="true"]').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await frames(page);
  check('hidden-tab signal cancels replay without changing accepted context',
    await page.locator('#graph-surface').getAttribute('data-trace-active') !== 'true' && packet === await page.locator('#context-content').textContent());
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check('returning to a tab does not auto-restart a cancelled replay', await page.locator('#graph-surface').getAttribute('data-trace-active') !== 'true');
  await quiet(page);

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#fit-graph').click();
    await page.evaluate(() => scrollTo(0, 0));
    await layout(page, `${viewport.width}x${viewport.height}`, viewport.width > 1000 && viewport.height >= 768);
    if (viewport.width === 390) await capture(page, 'atlas-mobile', 'Mobile evidence graph and complete Search controls; natural page scroll.', true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await layout(page, '200% text zoom');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#motion-style').selectOption('full');
  await page.locator('.motion-disclosure summary').click();
  await page.locator('#run-query').click();
  await ready(page);
  check('reduced motion never starts a trace', await page.locator('#graph-surface').getAttribute('data-trace-active') !== 'true');
  check('reduced motion preserves complete context', packet === await page.locator('#context-content').textContent());
  const svg = await context.newPage();
  await svg.goto(`${origin}/browser/?renderer=svg`);
  await svg.locator('#open-demo-vault:enabled').waitFor();
  await svg.locator('#open-demo-vault').click();
  await ready(svg);
  await quiet(svg);
  check('explicit SVG fallback remains available', await svg.locator('#graph-surface').getAttribute('data-renderer') === 'svg');
  await layout(svg, 'SVG overview', true);
  await svg.close();
  // Check the real landing page image after loading, not merely its HTML attributes.
  const landing = await context.newPage();
  await landing.goto(`${origin}/`);
  await landing.locator('figure img').evaluate(image => image.decode());
  const preview = await landing.locator('figure img').evaluate(image => ({ fit: getComputedStyle(image).objectFit, shown: image.clientWidth / image.clientHeight, native: image.naturalWidth / image.naturalHeight }));
  check('landing preview retains its complete image ratio', preview.fit === 'contain' && Math.abs(preview.shown - preview.native) < .02, preview);
  await landing.close();
  await context.close();
  check('healthy journeys report no browser errors', errors.length === 0, errors);
} catch (error) {
  failure = error.stack ?? String(error);
  console.error(failure);
} finally {
  if (browser) await browser.close();
  await new Promise(ok => { server.close(ok); server.closeAllConnections(); });
}
let sourceCommit = 'unavailable';
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* Archive verification has no Git metadata. */ }
const manifest = { schema: 'rag-method-atlas-presentation-v1', status: failure ? 'fail' : 'pass',
  source_commit: sourceCommit, source_identity: sourceIdentity, runtime, checks, responsive_matrix: matrix, captures, errors, ...(failure ? { failure } : {}) };
await writeFile(join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (failure) process.exitCode = 1;
else if (updateMedia) {
  await assertCaptureSource(ROOT, SITE);
  const media = join(ROOT, 'docs/media');
  await mkdir(media, { recursive: true });
  for (const [source, destination] of [['atlas-overview', 'rag-method-evidence-workbench'], ['atlas-evidence', 'rag-method-source-reader'], ['atlas-mobile', 'rag-method-evidence-mobile'], ['atlas-evidence-graph', 'rag-method-evidence-graph']]) {
    await copyFile(join(OUTPUT, `${source}.png`), join(media, `${destination}.png`));
  }
  await copyFile(join(OUTPUT, 'atlas-overview.png'), join(MODULE, 'demo/media/explorer-preview.png'));
  await copyFile(join(OUTPUT, 'manifest.json'), join(media, 'atlas-presentation.json'));
}
console.log(`Atlas presentation: ${failure ? 'FAIL' : 'PASS'}; ${checks.length} checks; ${captures.length} captures; ${OUTPUT}`);
