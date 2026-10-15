// Focused production initialization/cache diagnosis. Existing exact GGUF only;
// canonical model URL metadata, with transport redirected to owned loopback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelInput = process.env.BROWSER_MODEL_GGUF_FILE;
const playwrightInput = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE;
if (!modelInput || !playwrightInput) throw Error('Set BROWSER_MODEL_GGUF_FILE and BROWSER_MODEL_PLAYWRIGHT_MODULE to retained local inputs.');
const modelPath = await realpath(resolve(modelInput));
const { chromium } = await import(pathToFileURL(resolve(playwrightInput)).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));
const runtimeRoot = join(root, '.artifacts/model-chat/runtime');
const output = join(root, '.artifacts/proof/model-chat/init-result.json');
const sourcePaths = ['examples/browser-model-chat/engine-worker.mjs', 'examples/browser-model-chat/capabilities.mjs', 'examples/browser-model-chat/model-contract.mjs', 'tests/model-chat-init.mjs'];
const sourceIdentity = await Promise.all(sourcePaths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
const checks = [], diagnostics = [], requests = [], errors = [];
const baselineCommit = 'c2ad281';
const baselineWorker = execFileSync('git', ['show', baselineCommit + ':examples/browser-model-chat/engine-worker.mjs'], { cwd: root, encoding: 'utf8' });
const cleanup = { browserClosed: false, profileRemoved: false, serverClosed: false, previewClosed: false };
let profile, preview, server, processHandle, browser, context, origin, failure, version;
let modelTransfers = 0, modelTransferBytes = 0;
const started = Date.now();

function workerInjection(fault = false) {
  return `
const __nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (target === ${JSON.stringify(MODEL.url)}) return __nativeFetch(${JSON.stringify(origin + '/retained.gguf')}, options);
  if (target === ${JSON.stringify(MODEL.url.replace('/resolve/', '/raw/'))}) return Promise.resolve(new Response(${JSON.stringify('version https://git-lfs.github.com/spec/v1\noid sha256:' + MODEL.sha256 + '\nsize ' + MODEL.bytes + '\n')}, { status: 200 }));
  return __nativeFetch(input, options);
};
const __NativeMemory = WebAssembly.Memory;
WebAssembly.Memory = new Proxy(__NativeMemory, { construct(target, args) {
  if (args[0]?.address === 'i64') throw new TypeError('Memory64 absent: explicit desktop capability injection');
  return Reflect.construct(target, args);
}});
Object.defineProperty(WebAssembly, 'Suspending', { value: undefined, configurable: true });
Object.defineProperty(WebAssembly, 'promising', { value: undefined, configurable: true });
${fault ? `const __nativeObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => __nativeObjectURL(blob.size > 100000 ? new Blob(['throw new Error("Explicit nested Worker startup fault");\\n', blob], { type: 'text/javascript' }) : blob);` : ''}
const __NativeWorker = globalThis.Worker;
globalThis.Worker = class extends __NativeWorker {
  constructor(...args) {
    super(...args);
    const at = performance.now(); let readCount = 0, readBytes = 0, logCount = 0;
    this.addEventListener('error', event => self.postMessage({ type: 'diagnostic', value: { event: 'child-error', message: event.message, ms: Math.round(performance.now()-at) } }));
    this.addEventListener('messageerror', () => self.postMessage({ type: 'diagnostic', value: { event: 'child-messageerror', ms: Math.round(performance.now()-at) } }));
    this.addEventListener('message', ({ data }) => {
      if (data?.verb === 'fs.read_req') { readCount++; readBytes += data.args?.[2] || 0; }
      if (data?.verb === 'signal.abort' || data?.verb === 'console.error' || (data?.verb?.startsWith('console.') && (logCount++ < 4 || /^(?:llama_context:|llama_kv_cache|llama_memory|load_tensors:|ggml_|Using async|Multithread|Loading ")|warming up the model|running the model with an empty batch|buffer size/i.test(String(data.args?.[0] || ''))))) self.postMessage({ type: 'diagnostic', value: { event: data.verb, args: (data.args || []).slice(0, 2).map(item => String(item).slice(0, 200)), readCount, readBytes, ms: Math.round(performance.now()-at) } });
      else if (data?.callbackId) self.postMessage({ type: 'diagnostic', value: { event: 'child-result', callbackId: data.callbackId, readCount, readBytes, ms: Math.round(performance.now()-at) } });
    });
  }
};
`;
}

try {
  assert.equal((await stat(modelPath)).size, MODEL.bytes);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
  assert.equal(hash.digest('hex'), MODEL.sha256);
  for (const [name, identity] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) assert.equal(sha(await readFile(join(runtimeRoot, name))), identity.sha256, name);
  preview = await startServer();
  const upstream = new URL(preview.url);
  const workerSource = await readFile(join(root, 'examples/browser-model-chat/engine-worker.mjs'), 'utf8');
  server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    if (request.url === '/retained.gguf') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': MODEL.bytes });
      if (request.method === 'HEAD') return response.end();
      modelTransfers++;
      const stream = createReadStream(modelPath); stream.on('data', chunk => { modelTransferBytes += chunk.length; });
      try { await pipeline(stream, response); } catch { response.destroy(); }
      return;
    }
    if (['/engine-worker.mjs', '/engine-worker-fault.mjs', '/baseline-worker-fault.mjs'].includes(request.url)) {
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return response.end(workerInjection(request.url.includes('-fault')) + '\n' + (request.url.startsWith('/baseline') ? baselineWorker : workerSource));
    }
    const proxy = httpRequest({ hostname: '127.0.0.1', port: upstream.port, path: request.url, method: request.method }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    proxy.on('error', () => response.destroy()); response.on('close', () => proxy.destroy()); proxy.end();
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  origin = 'http://127.0.0.1:' + server.address().port;
  profile = await mkdtemp(join(tmpdir(), 'rag-init-probe-'));
  processHandle = spawn(process.env.BROWSER_RAG_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let debugPort;
  for (let i = 0; i < 300; i++) { try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (debugPort) break; } catch {} await pause(100); }
  assert.ok(debugPort, 'Owned browser started');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort); context = browser.contexts()[0]; version = browser.version();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push(url.origin === origin ? url.pathname : 'EXTERNAL_BLOCKED');
    return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort('blockedbyclient');
  });
  const page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  async function run(name) {
    const result = await page.evaluate(async () => {
      const worker = new Worker('./engine-worker.mjs', { type: 'module' });
      const at = performance.now(), phases = [], diagnostics = [];
      let timer;
      const request = (id, operation, payload) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.type === 'diagnostic') { diagnostics.push(data.value); return; }
          if (data.id !== id) return;
          if (data.type === 'progress') phases.push({ ...data.value, ms: Math.round(performance.now()-at) });
          if (data.type === 'error') reject(Error(data.value));
          if (data.type === 'result') resolve(data.value);
        };
        worker.onerror = error => reject(Error(error.message));
        worker.postMessage({ id, operation, payload });
      });
      try {
        return await Promise.race([
          (async () => {
            const prepared = await request(1, 'prepare', { source: 'download' });
            const preparedMs = Math.round(performance.now()-at);
            const reply = await request(2, 'reply', { messages: [{ role: 'user', content: 'What is 2 + 2? Answer briefly.' }] });
            return { prepared, preparedMs, reply, phases, diagnostics };
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Focused cache/init probe exceeded 120 seconds; not evidence of model failure')), 120000); }),
        ]);
      } catch (error) { return { error: error.message, phases, diagnostics }; }
      finally { clearTimeout(timer); worker.terminate(); }
    });
    if (result.error) throw Object.assign(Error(result.error), { diagnosis: result });
    assert.equal(result.prepared.runtimeProfile, 'memory32-asyncify'); assert.ok(result.reply.trim());
    checks.push({ name, passed: true, ...result });
    console.log(JSON.stringify({ check: name, preparedMs: result.preparedMs, cached: result.prepared.cached, reply: result.reply }));
    return result;
  }
  const cold = await run('production-Memory32-download-OPFS-open-verify-initialize-chat');
  assert.equal(cold.prepared.cached, false);
  assert.ok(cold.phases.some(item => item.phase === 'downloading'));
  assert.equal(modelTransfers, 1); assert.equal(modelTransferBytes, MODEL.bytes);
  const warm = await run('production-Memory32-warm-OPFS-open-verify-initialize-chat');
  assert.equal(warm.prepared.cached, true); assert.equal(warm.phases.some(item => item.phase === 'downloading'), false);
  assert.equal(modelTransfers, 1); assert.equal(requests.includes('EXTERNAL_BLOCKED'), false); assert.deepEqual(errors, []);
  async function startupFault(path, timeoutMs) {
    return page.evaluate(async ({ path, timeoutMs }) => {
      const worker = new Worker(path, { type: 'module' }), phases = [], diagnostics = [];
      let timer; const at = performance.now();
      try {
        return await new Promise(resolve => {
          timer = setTimeout(() => resolve({ outcome: 'pending', phases, diagnostics, ms: Math.round(performance.now()-at) }), timeoutMs);
          worker.onmessage = ({ data }) => {
            if (data.type === 'diagnostic') diagnostics.push(data.value);
            if (data.type === 'progress') phases.push(data.value);
            if (data.type === 'error') resolve({ outcome: 'error', error: data.value, code: data.code, phases, diagnostics, ms: Math.round(performance.now()-at) });
          };
          worker.onerror = event => { event.preventDefault(); resolve({ outcome: 'owner-error', error: event.message, phases, diagnostics, ms: Math.round(performance.now()-at) }); };
          worker.postMessage({ id: 1, operation: 'prepare', payload: { source: 'download' } });
        });
      } finally { clearTimeout(timer); worker.terminate(); }
    }, { path, timeoutMs });
  }
  const baseline = await startupFault('./baseline-worker-fault.mjs', 2500);
  assert.ok(baseline.diagnostics.some(item => item.event === 'child-error'));
  assert.equal(baseline.outcome, 'owner-error', 'Baseline Chrome bubbles a generic parent Worker error');
  checks.push({ name: 'historical-baseline-child-startup-error-bubbles-without-structured-code', passed: true, baselineCommit, baselineWorkerSHA256: sha(baselineWorker), ...baseline });
  console.log(JSON.stringify({ check: checks.at(-1).name, outcome: baseline.outcome, ms: baseline.ms }));
  if (!process.env.BROWSER_MODEL_BASELINE_DIAGNOSIS) {
    const fixed = await startupFault('./engine-worker-fault.mjs', 5000);
    assert.equal(fixed.outcome, 'error', 'Production must surface child Worker failure promptly');
    assert.equal(fixed.code, 'ENGINE_WORKER_ERROR');
    assert.ok(fixed.ms < 5000);
    assert.equal(fixed.phases.some(item => item.phase === 'downloading'), false);
    assert.equal(modelTransfers, 1, 'Startup failure must preserve and reuse the complete cache');
    checks.push({ name: 'production-child-startup-error-rejects-with-cache-retained', passed: true, ...fixed });
    console.log(JSON.stringify({ check: checks.at(-1).name, code: fixed.code, ms: fixed.ms }));
    const recovered = await run('production-fresh-worker-recovers-from-startup-fault-with-cache');
    assert.equal(recovered.prepared.cached, true); assert.equal(modelTransfers, 1);
  }
} catch (error) { failure = error; if (error.diagnosis) diagnostics.push(error.diagnosis); console.error(error.stack || error.message); }
finally {
  if (browser) { try { const session = await context.newCDPSession(context.pages()[0]); await session.send('Browser.close'); } catch {} await browser.close().catch(() => {}); }
  if (processHandle) { for (let i = 0; i < 100 && processHandle.exitCode === null && processHandle.signalCode === null; i++) await pause(50); if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill(); cleanup.browserClosed = processHandle.exitCode !== null || processHandle.signalCode !== null; }
  if (server) { await new Promise(done => { server.close(done); server.closeIdleConnections(); }); cleanup.serverClosed = true; }
  if (preview) { await preview.close(); cleanup.previewClosed = true; }
  if (profile) { assert.equal(dirname(profile), tmpdir().replace(/[\\/]$/, '')); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true; }
  for (const identity of sourceIdentity) if (sha(await readFile(join(root, identity.path))) !== identity.sha256) failure ||= Error('Source changed during probe: ' + identity.path);
  const compact = ({ diagnostics: events = [], ...item }) => ({ ...item, childDiagnostics: {
    eventCount: events.length,
    failures: events.filter(event => /error|abort/.test(event.event)),
    nativeInitialization: events.filter(event => event.event?.startsWith('console.') && (event.args || []).some(text => /(?:constructing llama_context|(?:CPU|KV|RS|compute|output).*buffer size|offloaded 0\/)/.test(text)))
      .map(event => ({ ms: event.ms, text: event.args.join(' ') })),
    lastFileRead: events.filter(event => event.readCount).map(({ readCount, readBytes }) => ({ readCount, readBytes })).at(-1) || null,
  } });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schema: 'rag-method.model-chat.init-probe.v1', passed: !failure, browser: version, ms: Date.now()-started, sourceIdentity, model: { file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256 }, checks: checks.map(compact), diagnostics: diagnostics.map(compact), requests, modelTransfers, modelTransferBytes, externalModelBytes: 0, errors, cleanup, limitations: ['Desktop Chrome with Memory64 and JSPI disabled in owning Worker; not physical iOS.', 'Only model fetch transport redirected to existing native GGUF on owned loopback; canonical URL and OPFS/cache/open/verify/runtime paths stay production.', 'Nested Worker diagnostic listeners record stages without changing pinned vendor bytes.', 'Historical Chrome startup fault bubbles to owner; this was not a reproduced device initialization hang.'], ...(failure ? { error: failure.message } : {}) }, null, 2)+'\n');
}
if (failure) process.exitCode = 1;
