// Explicit retained-model qualification of the official 3.5.1 Memory32 fallback.
// Existing native File path only: no model download, payload copy, or native build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MODEL } from '../examples/browser-model-chat/model-contract.mjs';

if (process.argv.slice(2).join(' ') !== '--existing-cache') throw Error('Pass --existing-cache; no asset is downloaded by this probe.');
const root = fileURLToPath(new URL('../', import.meta.url));
const configured = name => { if (!process.env[name]?.trim()) throw Error(`Set ${name} to an existing retained file.`); return resolve(process.env[name]); };
const modelPath = configured('BROWSER_MODEL_GGUF_FILE');
const runtimeRoot = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(root, '.artifacts/model-chat/runtime'));
const compatRoot = resolve(process.env.BROWSER_MODEL_COMPAT_ROOT || join(runtimeRoot, 'compat'));
const runtime = [
  { route: '/runtime/index.js', path: join(runtimeRoot, 'index.js'), sha256: '2ed031e8d61cebd1d4c7d4956a6350f5afc7fa7c678c3a324d66f6df958f67db', type: 'application/javascript; charset=utf-8' },
  { route: '/runtime/wllama.wasm', path: join(runtimeRoot, 'wllama.wasm'), sha256: '4197ce6d3dc9240c42ee52b4197dc99638875a06b0083901f8a57767338a0cfa', type: 'application/wasm' },
  { route: '/compat/wllama.js', path: join(compatRoot, 'wllama.js'), sha256: '011e11f2c2a4a94d1764a4f45993e01ae5c48f72d78d59464972b26606afd6ac', type: 'application/javascript; charset=utf-8' },
  { route: '/compat/wllama.wasm', path: join(compatRoot, 'wllama.wasm'), sha256: '9ea153d9396db12c385d53e9a8330b1638ca3e8805159a762ce8859d92d2ac8b', type: 'application/wasm' },
  { route: '/runtime/LICENSE', path: join(runtimeRoot, 'LICENSE'), sha256: '5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720', type: 'text/plain; charset=utf-8' },
];
const output = join(root, '.artifacts/proof/model-chat/compat-result.json');
const { chromium } = await import(pathToFileURL(configured('BROWSER_MODEL_PLAYWRIGHT_MODULE')).href);
const profile = await mkdtemp(join(tmpdir(), 'rag-compat-'));
assert.equal(dirname(profile), tmpdir().replace(/[\\/]$/, ''));
let browser, context, chromeProcess, server, origin, failure, browserVersion;
const checks = [], requests = [], pageErrors = [];
const cleanup = { browserClosed: false, serverClosed: false, profileRemoved: false };
const started = Date.now();
async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
const sourceIdentity = { path: 'tests/model-chat-compat.mjs', sha256: await sha256(fileURLToPath(import.meta.url)) };
try {
  for (const item of runtime) assert.equal(await sha256(item.path), item.sha256, item.route);
  assert.equal((await stat(modelPath)).size, MODEL.bytes);
  assert.equal(await sha256(modelPath), MODEL.sha256);
  const html = '<!doctype html><meta charset="utf-8"><title>Official Memory32 fallback qualification</title><p>Explicit local compatibility probe</p><input id="native-model" type="file">';
  server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? '' : html);
    const item = runtime.find(item => item.route === request.url);
    if (!item) return response.writeHead(404).end();
    response.writeHead(200, { 'Content-Type': item.type, 'Content-Length': (await stat(item.path)).size, 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(item.path); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
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
  page.setDefaultTimeout(180000); await page.goto(origin + '/');
  // CDP sends a local path, never 153 MB through the protocol or a second disk file.
  const session = await context.newCDPSession(page);
  const { root: document } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.nodeId, selector: '#native-model' });
  await session.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] });
  assert.equal(await page.locator('#native-model').evaluate(input => input.files[0]?.size), MODEL.bytes);
  for (const hideJSPI of [false, true]) {
    const result = await page.evaluate(async ({ model, hideJSPI }) => {
      const source = `
        globalThis.document = Object.freeze({ baseURI: '${origin}/' });
        const NativeMemory = WebAssembly.Memory;
        WebAssembly.Memory = new Proxy(NativeMemory, { construct(target, args) {
          if (args[0]?.address === 'i64') throw new TypeError('Memory64 unavailable: explicit test injection');
          return Reflect.construct(target, args);
        }});
        ${hideJSPI ? "Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true }); Object.defineProperty(WebAssembly, 'promising', { value: undefined, configurable: true }); Object.defineProperty(navigator.storage, 'getDirectory', { value: () => { throw Error('File route must not access OPFS'); }, configurable: true });" : ''}
        self.onmessage = async ({ data }) => {
          let engine;
          const stages = []; const at = performance.now(); const mark = phase => stages.push({ phase, ms: Math.round(performance.now() - at) });
          try {
            const { Wllama } = await import('${origin}/runtime/index.js');
            let memory64ConstructorProbeSucceeded = true; try { new WebAssembly.Memory({ address: 'i64', initial: 1n }); } catch { memory64ConstructorProbeSucceeded = false; }
            if (memory64ConstructorProbeSucceeded) throw Error('Memory64 probe injection failed');
            const jsPIPresentBeforeInit = typeof WebAssembly.Suspending === 'function';
            const storageDescriptor = Object.getOwnPropertyDescriptor(navigator.storage, 'getDirectory');
            Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });
            let missingOPFSError;
            try { new Wllama({ default: '${origin}/runtime/wllama.wasm' }); } catch (error) { missingOPFSError = error.message; }
            if (storageDescriptor) Object.defineProperty(navigator.storage, 'getDirectory', storageDescriptor); else delete navigator.storage.getDirectory;
            if (missingOPFSError !== 'No supported storage backend found') throw Error('Expected OPFS constructor requirement was not observed');
            engine = new Wllama({ default: '${origin}/runtime/wllama.wasm' }, { logger: { debug() {}, log() {}, warn() {}, error() {} }, suppressNativeLog: true, allowOffline: true });
            const workerCode = await (await fetch('${origin}/compat/wllama.js')).text();
            const workerHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workerCode)))].map(value => value.toString(16).padStart(2, '0')).join('');
            if (workerHash !== '011e11f2c2a4a94d1764a4f45993e01ae5c48f72d78d59464972b26606afd6ac') throw Error('Compat worker hash mismatch');
            engine.setCompat({ wasm: new URL('./compat/wllama.wasm', document.baseURI).href, worker: { code: workerCode } }, 'firefox_safari');
            const resources = engine.getWorkerResources();
            if (!resources.compat || !resources.wasmPath.endsWith('/compat/wllama.wasm')) throw Error('Memory32 fallback not selected');
            mark('compiling-memory32'); await WebAssembly.compile(await (await fetch(resources.wasmPath)).arrayBuffer());
            mark('initializing'); await engine.loadModel([data.file], { n_ctx: 2048, n_batch: 128, n_threads: 1, n_gpu_layers: 0, seed: 42 });
            if (!engine.isModelLoaded()) throw Error('No loaded model');
            mark('generating'); const completion = await engine.createChatCompletion({ messages: [{ role: 'user', content: 'What is 2 + 2? Answer briefly.' }], max_tokens: 48, temperature: 0 });
            const reply = completion.choices?.[0]?.message?.content || '';
            mark('completed'); await engine.exit(); engine = undefined;
            postMessage({ loaded: true, modelBytes: data.file.size, reply: String(reply).trim().slice(0, 300), libllama: Wllama.getLibllamaVersion(), memory64ConstructorProbeSucceeded, jsPIPresentBeforeInit, missingOPFSError, runtime: 'official-3.5.1-memory32-asyncify', crossOriginIsolated, stages });
          } catch (error) { try { await engine?.exit(); } catch {} postMessage({ error: error.stack || String(error) }); }
        };
      `;
      const workerURL = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      const worker = new Worker(workerURL, { type: 'module' });
      try {
        const nativeFile = document.querySelector('#native-model').files[0];
        const file = new File([nativeFile], model.file, { type: 'application/octet-stream' });
        return await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Compatibility probe timeout')), 180000); worker.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(Error(data.error)) : resolve(data); }; worker.onerror = error => { clearTimeout(timer); reject(Error(error.message)); }; worker.postMessage({ file }); });
      } finally { worker.terminate(); URL.revokeObjectURL(workerURL); }
    }, { model: MODEL, hideJSPI });
    assert.ok(result.loaded); assert.ok(result.reply.trim()); assert.equal(result.memory64ConstructorProbeSucceeded, false);
    assert.equal(result.libllama, 'b9640-dd4623a');
    if (hideJSPI) assert.equal(result.jsPIPresentBeforeInit, false);
    checks.push({ name: hideJSPI ? 'official-memory32-no-jspi-file-with-opfs-access-forbidden' : 'official-memory32-file-init-and-chat', passed: true, capabilityInjection: hideJSPI ? 'JavaScript constructor/JSPI probe fixtures; VM Memory64 unchanged; OPFS API exposed but calls throw' : 'Only the JavaScript Memory64 constructor probe is forced to fail; VM Memory64 unchanged', ...result });
    console.log(JSON.stringify(checks.at(-1)));
  }
  assert.equal(requests.some(item => item.path === 'EXTERNAL_BLOCKED'), false);
  assert.equal(requests.some(item => item.path === '/runtime/wllama.wasm'), false, 'The Memory64 WASM must not be fetched');
  assert.deepEqual(pageErrors, []);
} catch (error) { failure = error; console.error(error.stack || error.message); }
finally {
  if (browser) { try { const session = await context.newCDPSession(context.pages()[0]); await session.send('Browser.close'); } catch {} await browser.close().catch(() => {}); }
  if (chromeProcess) { for (let i = 0; i < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; i++) await new Promise(done => setTimeout(done, 50)); if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) chromeProcess.kill(); cleanup.browserClosed = chromeProcess.exitCode !== null || chromeProcess.signalCode !== null; }
  if (server) { await new Promise(done => { server.close(done); server.closeIdleConnections(); }); cleanup.serverClosed = true; }
  try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true; } catch (error) { failure ||= error; }
  for (const item of runtime) if (await sha256(item.path) !== item.sha256) failure ||= Error('Runtime changed during qualification');
  if (await sha256(modelPath) !== MODEL.sha256) failure ||= Error('Model changed during qualification');
  if (await sha256(fileURLToPath(import.meta.url)) !== sourceIdentity.sha256) failure ||= Error('Probe changed during qualification');
  if (!cleanup.browserClosed || !cleanup.serverClosed || !cleanup.profileRemoved) failure ||= Error('Owned cleanup not confirmed');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schema: 'rag-method.official-memory32.compatibility-probe.v1', passed: !failure, sourceIdentity, model: { input: 'BROWSER_MODEL_GGUF_FILE', file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256 }, runtime: { main: '@wllama/wllama@3.5.1', compat: '@wllama/wllama-compat@3.5.1', libllama: 'b9640-dd4623a', compatGitHead: '912c18b75d4358c1405a64646b8dbe43a205943b', archiveBytes: 3544062, archiveSHA256: '465c6429ebeef90bc111ab260f808d907a6b6b4b4c533ee13557f357e9279b1a', archiveIntegrity: 'sha512-eWFeyLmAgshNsT4eti7El4F0Iip1/Gt/vn5thAhezFoRS8vkC2YjXRMAGmwHRttTWz+7u21f1Me/A70La1TgyA==', files: await Promise.all(runtime.map(async ({ route, path, sha256 }) => ({ route, bytes: (await stat(path)).size, sha256 }))) }, browser: browserVersion, ms: Date.now() - started, checks, requests, modelTransfer: 'native File through CDP path only', externalModelBytes: 0, pageErrors, cleanup, limitations: ['Ordinary desktop Chrome qualification only; no physical iPhone or native Files picker proof.', 'JavaScript API fixtures select Memory32 in a Memory64-capable VM; this does not prove actual Memory64 refusal.', 'The default CacheManager still requires OPFS API presence even for File inputs.', 'No change to production runtime configuration in this probe.'], ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) process.exitCode = 1;
