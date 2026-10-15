// Explicit compatibility probe: retained Memory32 runtime + existing verified model.
// No product adapter swap, external model transfer, package install or native build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { MODEL } from '../examples/browser-model-chat/model-contract.mjs';

if (process.argv.slice(2).join(' ') !== '--existing-cache') throw new Error('Pass --existing-cache for this explicit retained-runtime probe.');
const root = fileURLToPath(new URL('../', import.meta.url));
function configuredPath(name) {
  if (!process.env[name]?.trim()) throw new Error(`Set ${name} to an existing retained file. This probe never downloads assets.`);
  return resolve(process.env[name]);
}
const modelPath = configuredPath('BROWSER_MODEL_GGUF_FILE');
const runtime = [
  { route: '/runtime/index.js', input: 'BROWSER_MODEL_MEMORY32_JS_FILE', sha256: '18b4eec22fc6d0be7af4939283db14dd94d4517b86924bbe018dd9453af1ebde', type: 'application/javascript; charset=utf-8' },
  { route: '/runtime/wllama.wasm', input: 'BROWSER_MODEL_MEMORY32_WASM_FILE', sha256: '529c780d43cb57cb9ac7ef4c42e16463afb0b2dec4ecaae9a6df8179c435fd71', type: 'application/wasm' },
  { route: '/runtime/LICENSE', input: 'BROWSER_MODEL_MEMORY32_LICENSE_FILE', sha256: '5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720', type: 'text/plain; charset=utf-8' },
];
for (const item of runtime) item.path = configuredPath(item.input);
const licenseSource = 'https://github.com/ngxson/wllama/blob/5e63e3b226a077b33dc7c608f1fe630f3d21f539/LICENCE';
const output = join(root, '.artifacts/proof/model-chat/memory32-result.json');
const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE || createRequire(new URL('../modules/browser-rag-ts/package.json', import.meta.url)).resolve('playwright');
const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
const profile = await mkdtemp(join(tmpdir(), 'rag-memory32-'));
assert.equal(dirname(profile), tmpdir().replace(/[\\/]$/, ''));
let browser, context, chromeProcess, server, origin, failure, browserVersion;
const checks = [], requests = [], pageErrors = [], cleanup = { browserClosed: false, serverClosed: false, profileRemoved: false };
const started = Date.now();
let modelTransferredBytes = 0;
async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
const sourceIdentity = await Promise.all(['tests/model-chat-memory32.mjs', 'examples/browser-model-chat/model-contract.mjs'].map(async path => ({ path, sha256: await sha256(join(root, path)) })));
try {
  for (const item of runtime) assert.equal(await sha256(item.path), item.sha256, item.route);
  assert.match(await readFile(runtime[2].path, 'utf8'), /MIT License[\s\S]*Copyright \(c\) 2024 Xuan Son NGUYEN/);
  assert.equal((await stat(modelPath)).size, MODEL.bytes);
  assert.equal(await sha256(modelPath), MODEL.sha256);
  const html = '<!doctype html><meta charset="utf-8"><title>Retained Memory32 compatibility probe</title><p>Explicit local compatibility probe</p>';
  server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? '' : html);
    const file = request.url === '/model.gguf' ? { path: modelPath, type: 'application/octet-stream' } : runtime.find(item => item.route === request.url);
    if (!file) return response.writeHead(404).end();
    const info = await stat(file.path);
    response.writeHead(200, { 'Content-Type': file.type, 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(file.path);
    if (request.url === '/model.gguf') stream.on('data', chunk => { modelTransferredBytes += chunk.length; });
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  origin = 'http://127.0.0.1:' + server.address().port;
  chromeProcess = spawn(process.env.BROWSER_RAG_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let port;
  for (let i = 0; i < 300; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} await new Promise(done => setTimeout(done, 100)); }
  assert.ok(port, 'Owned ordinary Chrome debugging port');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  context = browser.contexts()[0]; browserVersion = browser.version();
  await context.route('**/*', route => { const url = route.request().url(); requests.push({ method: route.request().method(), path: url.startsWith(origin) ? url.slice(origin.length) : 'EXTERNAL_BLOCKED' }); return url.startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient'); });
  const page = context.pages()[0]; page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(120000); await page.goto(origin + '/');
  for (const hideOPFS of [false, true]) {
    const result = await page.evaluate(async ({ model, hideOPFS }) => {
    const { Wllama } = await import('/runtime/index.js');
    const stages = []; const at = performance.now(); const mark = phase => stages.push({ phase, ms: Math.round(performance.now() - at) });
    const storage = navigator.storage, previous = Object.getOwnPropertyDescriptor(storage, 'getDirectory');
    if (hideOPFS) Object.defineProperty(storage, 'getDirectory', { value: undefined, configurable: true });
    const opfsAvailableBeforeConstruct = typeof navigator.storage?.getDirectory === 'function';
    if (hideOPFS && opfsAvailableBeforeConstruct) throw Error('OPFS capability injection failed');
    let engine;
    try {
      engine = new Wllama({ 'single-thread/wllama.wasm': location.origin + '/runtime/wllama.wasm' }, { logger: { debug() {}, log() {}, warn() {}, error() {} }, suppressNativeLog: true });
      if (!globalThis.__memory32File) {
        mark('fetch-local-native-cache'); const response = await fetch('/model.gguf'); if (!response.ok) throw Error('Local model response: ' + response.status);
        globalThis.__memory32Blob = await response.blob();
        globalThis.__memory32File = new File([globalThis.__memory32Blob], model.file, { type: 'application/octet-stream' });
      }
      const blob = hideOPFS ? globalThis.__memory32File : globalThis.__memory32Blob;
      if (blob.size !== model.bytes) throw Error('Model byte count mismatch');
      mark('initializing'); await engine.loadModel([blob], { n_ctx: 2048, n_batch: 128, n_threads: 1, seed: 42 });
      if (!engine.isModelLoaded()) throw Error('Model not loaded');
      mark('generating'); const prompt = await engine.formatChat([{ role: 'user', content: 'What is 2 + 2? Answer briefly.' }], true);
      const reply = await engine.createCompletion(prompt, { nPredict: 48, sampling: { temp: 0 }, stopWords: ['<|im_end|>', '<|endoftext|>'] });
      mark('completed'); return { loaded: true, modelBytes: blob.size, input: hideOPFS ? 'File' : 'Blob', capabilityInjection: hideOPFS ? 'OPFS getDirectory hidden before construction' : null, opfsAvailableBeforeConstruct, reply: String(reply).trim().slice(0, 300), libllama: Wllama.getLibllamaVersion(), crossOriginIsolated, stages };
    } finally {
      await engine?.exit();
      if (hideOPFS) { if (previous) Object.defineProperty(storage, 'getDirectory', previous); else delete storage.getDirectory; }
    }
    }, { model: MODEL, hideOPFS });
    assert.ok(result.loaded); assert.ok(result.reply.trim(), 'Actual nonempty generated reply');
    assert.equal(result.libllama, 'release-2.3.7');
    if (hideOPFS) assert.equal(result.opfsAvailableBeforeConstruct, false);
    checks.push({ name: hideOPFS ? 'retained-memory32-file-with-hidden-opfs-capability' : 'retained-memory32-blob-init-and-reply', passed: true, ...result });
    console.log(JSON.stringify(checks.at(-1)));
  }
  assert.equal(modelTransferredBytes, MODEL.bytes);
  assert.equal(requests.some(item => item.path === 'EXTERNAL_BLOCKED'), false); assert.deepEqual(pageErrors, []);
} catch (error) { failure = error; console.error(error.message); }
finally {
  if (browser) { try { const session = await context.newCDPSession(context.pages()[0]); await session.send('Browser.close'); } catch {} await browser.close().catch(() => {}); }
  if (chromeProcess) { for (let i = 0; i < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; i++) await new Promise(done => setTimeout(done, 50)); if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) chromeProcess.kill(); cleanup.browserClosed = chromeProcess.exitCode !== null || chromeProcess.signalCode !== null; }
  if (server) { await new Promise(done => { server.close(done); server.closeIdleConnections(); }); cleanup.serverClosed = true; }
  try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true; } catch (error) { failure ||= error; }
  for (const item of runtime) if (await sha256(item.path) !== item.sha256) failure ||= Error('Runtime changed during probe');
  if (await sha256(modelPath) !== MODEL.sha256) failure ||= Error('Model changed during probe');
  for (const item of sourceIdentity) if (await sha256(join(root, item.path)) !== item.sha256) failure ||= Error('Source changed during probe');
  if (!cleanup.browserClosed || !cleanup.serverClosed) failure ||= Error('Owned process cleanup not confirmed');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schema: 'rag-method.memory32.compatibility-probe.v1', passed: !failure, sourceIdentity, model: { input: 'BROWSER_MODEL_GGUF_FILE', file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256 }, runtime: { embeddedVersion: 'release-2.3.7', files: runtime.map(({ route, input, sha256 }) => ({ route, input, sha256 })), licenseSource }, browser: browserVersion, ms: Date.now() - started, checks, requests, modelTransferredBytes, externalModelBytes: 0, pageErrors, cleanup, limitations: ['Desktop ordinary Chrome only; no physical iPhone or native Files picker proof.', 'OPFS absence is a labeled capability injection before runtime construction.', 'Existing verified model streamed once from native cache into a Blob/File; no OPFS model copy.', 'No product runtime change or maintained compatibility package qualification.'], ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) process.exitCode = 1;
