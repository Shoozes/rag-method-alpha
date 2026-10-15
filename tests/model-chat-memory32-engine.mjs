// Genuine parser proof in an installed WebKit/JSC engine. No WebAssembly API
// is replaced: the positive control must reject real Memory64 bytecode.
// Optional File inference uses one retained native model, without downloads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';
import { inspectWasmMemories } from '../examples/browser-model-chat/wasm-memory.mjs';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const binaryOnly = process.argv.includes('--binary-only');
if (process.argv.some((arg, index) => index > 1 && arg !== '--binary-only')) throw Error('Only --binary-only is supported.');
const root = fileURLToPath(new URL('../', import.meta.url));
const configured = name => { if (!process.env[name]?.trim()) throw Error(`Set ${name} to an existing retained file.`); return resolve(process.env[name]); };
const { webkit } = await import(pathToFileURL(configured('BROWSER_MODEL_PLAYWRIGHT_MODULE')).href);
const executablePath = configured('BROWSER_MODEL_WEBKIT_PATH');
const output = join(root, '.artifacts/proof/model-chat/memory32-engine-result.json');
const runtimeRoot = join(root, '.artifacts/model-chat/runtime');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = ['tests/model-chat-memory32-engine.mjs', 'examples/browser-model-chat/runtime-profile.mjs',
  'examples/browser-model-chat/runtime-errors.mjs', 'examples/browser-model-chat/wasm-memory.mjs', 'examples/browser-model-chat/model-contract.mjs'];
const sourceIdentity = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
const checks = [], binaries = [], requests = [], errors = [];
const cleanup = { browserClosed: false, previewClosed: false };
let browser, preview, page, failure, browserVersion, nativeSelections = 0;
let workerCreated = 0, workerClosed = 0;
const started = Date.now();
async function check(name, action) {
  const at = Date.now();
  try { await action(); checks.push({ name, passed: true, ms: Date.now() - at }); }
  catch (error) { checks.push({ name, passed: false, ms: Date.now() - at }); throw error; }
  console.log(JSON.stringify({ check: name, passed: true }));
}
try {
  await check('exact-pinned-binaries-memory-declarations', async () => {
    for (const [path, identity] of [['wllama.wasm', RUNTIME.files['wllama.wasm']], ['compat/wllama.wasm', COMPAT.files['compat/wllama.wasm']]]) {
      const bytes = await readFile(join(runtimeRoot, path));
      assert.equal(digest(bytes), identity.sha256);
      const memory = inspectWasmMemories(bytes);
      assert.equal(memory.requiresMemory64, path === 'wllama.wasm');
      assert.equal(memory.memories.length, 1);
      assert.equal(memory.memories[0].offset, path === 'wllama.wasm' ? 4293 : 3357);
      assert.equal(memory.memories[0].flags, path === 'wllama.wasm' ? 7 : 3);
      binaries.push({ path: 'runtime/' + path, bytes: bytes.length, sha256: identity.sha256, ...memory });
    }
  });
  preview = await startServer();
  browser = await webkit.launch({ executablePath, headless: true, timeout: 20000 });
  browserVersion = browser.version();
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => { workerCreated++; worker.on('close', () => workerClosed++); });
  await page.route('**/*', route => {
    const url = route.request().url();
    const ownedBlob = url.startsWith('blob:' + preview.url);
    requests.push({ path: url.startsWith(preview.url) ? url.slice(preview.url.length) : ownedBlob ? 'OWNED_BLOB_WORKER' : 'EXTERNAL_BLOCKED' });
    return url.startsWith(preview.url) || ownedBlob ? route.continue() : route.abort('blockedbyclient');
  });
  await page.goto(preview.url);
  let controls;
  await check('genuine-engine-rejects-memory64-and-compiles-memory32', async () => {
    controls = await page.evaluate(async () => {
      const result = {};
      for (const [name, flag] of [['memory32', 0], ['memory64', 4]]) {
        const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, flag, 0]);
        const value = result[name] = { valid: WebAssembly.validate(bytes) };
        try { await WebAssembly.compile(bytes); value.compiled = true; }
        catch (error) { value.compiled = false; value.error = error.message; }
      }
      try { new WebAssembly.Memory({ address: 'i64', initial: 1n }); result.constructorMemory64 = true; }
      catch { result.constructorMemory64 = false; }
      result.jspi = typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function';
      result.opfs = typeof navigator.storage?.getDirectory === 'function';
      return result;
    });
    assert.equal(controls.memory32.valid, true); assert.equal(controls.memory32.compiled, true);
    assert.equal(controls.memory64.valid, false); assert.equal(controls.memory64.compiled, false);
    assert.match(controls.memory64.error, /Memory64 is not enabled/);
    // This is the concrete false positive that allowed the vendor to reselect.
    assert.equal(controls.constructorMemory64, true); assert.equal(controls.jspi, true);
  });
  await check('exact-primary-rejected-at-phone-offset-compat-compiles', async () => {
    for (const binary of binaries) {
      const result = await page.evaluate(async path => {
        const response = await fetch(path), bytes = await response.arrayBuffer();
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const out = { bytes: bytes.byteLength, sha256, valid: WebAssembly.validate(bytes) };
        try { await WebAssembly.compile(bytes); out.compiled = true; }
        catch (error) { out.compiled = false; out.error = error.message; }
        return out;
      }, binary.path);
      assert.equal(result.bytes, binary.bytes); assert.equal(result.sha256, binary.sha256);
      assert.equal(result.compiled, !binary.requiresMemory64);
      if (binary.requiresMemory64) assert.match(result.error, /byte 4294: Memory64 is not enabled/);
      Object.assign(binary, { engine: result });
    }
  });
  if (!binaryOnly) {
    const modelPath = await realpath(configured('BROWSER_MODEL_GGUF_FILE'));
    await check('retained-model-exact-bytes-no-download', async () => {
      assert.equal((await stat(modelPath)).size, MODEL.bytes);
      const hash = createHash('sha256'); for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
      assert.equal(hash.digest('hex'), MODEL.sha256);
    });
    // Local browser launch supports a native path; no model-sized protocol
    // buffer or second on-disk GGUF is constructed by this harness.
    // Remove the app input listener before selection so this genuine-engine
    // test can use public vendor cache injection on this OPFS-less WK host.
    // This host has no OPFS; production capability preflight would refuse it.
    await page.locator('#local-file').evaluate(input => { const clone = input.cloneNode(true); input.replaceWith(clone); });
    await page.locator('#local-file').setInputFiles(modelPath); nativeSelections++;
    let inference;
    const requestBoundary = requests.length;
    await check('genuine-memory32-file-initialization-and-inference-read-only-storage-fixture', async () => {
      inference = await page.evaluate(async ({ origin, workerHash }) => {
        const file = document.getElementById('local-file').files[0];
        const source = `
globalThis.document = Object.freeze({ baseURI: ${JSON.stringify(origin)} });
self.onmessage = async ({ data: file }) => {
  let engine; let calls = 0; let timer; const stages = []; const started = performance.now();
  const mark = phase => stages.push({ phase, ms: Math.round(performance.now() - started) });
  try {
    const { Wllama } = await import('${origin}runtime/index.js');
    const { runtimeResources, bindRuntimeResources } = await import('${origin}runtime-profile.mjs');
    const { installRuntimeAbortGuard } = await import('${origin}runtime-errors.mjs');
    const memory64 = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,4,0]));
    if (memory64) throw Error('Expected real Memory64 parser refusal');
    const workerCode = await (await fetch('${origin}runtime/compat/wllama.js')).text();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workerCode)))].map(b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== '${workerHash}') throw Error('Compat glue identity mismatch');
    const resources = runtimeResources('memory32-asyncify', workerCode, '${origin}');
    // Public injection seam, File-only: methods must never be called. No OPFS
    // or WebAssembly globals are faked, and no persistent model cache is used.
    const storage = new Proxy({}, { get() { calls++; throw Error('File test must not touch storage'); } });
    const config = { cacheManager: storage, modelManager: storage,
      logger: { debug() {}, log() {}, warn() {}, error() {} }, suppressNativeLog: true, allowOffline: true };
    const baseline = new Wllama({ default: '${origin}runtime/wllama.wasm' }, config);
    baseline.setCompat({ wasm: resources.wasmPath, worker: { code: workerCode } }, 'firefox_safari');
    const baselineResources = baseline.getWorkerResources();
    if (baselineResources.compat || baselineResources.wasmPath !== '${origin}runtime/wllama.wasm') throw Error('Expected unbound original constructor to reselect primary Memory64 assets');
    // Primary compilation already failed at the phone's byte 4294 in the
    // genuine engine control. Do not open this known-incompatible baseline.
    const baselineSelection = { compat: baselineResources.compat, wasmPath: 'runtime/wllama.wasm', modelOpened: false };
    engine = new Wllama({ default: resources.wasmPath }, config);
    engine.setCompat({ wasm: resources.wasmPath, worker: { code: workerCode } }, 'firefox_safari');
    const vendorReselected = engine.getWorkerResources();
    // A compat default is a second safeguard but the old vendor still chooses
    // primary glue here: compat:false would mismatch the Memory32 WASM.
    if (vendorReselected.compat) throw Error('Expected constructor-only false positive in this exact engine');
    bindRuntimeResources(engine, resources);
    let rejectAbort; const abort = new Promise((_, reject) => { rejectAbort = reject; });
    installRuntimeAbortGuard(engine, identity => rejectAbort(Error(identity.message || 'Runtime abort')));
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned genuine-engine test wait limit')), 120000); });
    mark('initializing');
    await Promise.race([engine.loadModel([file], { n_ctx: 2048, n_batch: 128, n_threads: 1, n_gpu_layers: 0, seed: 42 }), abort, timeout]);
    if (!engine.isModelLoaded()) throw Error('No loaded model'); mark('generating');
    const completion = await Promise.race([engine.createChatCompletion({ messages: [{ role: 'user', content: 'What is 2 + 2? Answer briefly.' }], max_tokens: 48, temperature: 0 }), abort, timeout]);
    const reply = completion.choices?.[0]?.message?.content || ''; mark('completed');
    await engine.exit(); engine = undefined;
    postMessage({ loaded: true, bytes: file.size, reply: String(reply).trim().slice(0,300), memory64, storageCalls: calls,
      runtimeProfile: 'memory32-asyncify', baselineSelection, vendorConstructorFalsePositive: !vendorReselected.compat, libllama: Wllama.getLibllamaVersion(), stages });
  } catch(error) { try { await engine?.exit(); } catch {} postMessage({ error: error.message, stages }); }
  finally { clearTimeout(timer); }
};`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url, { type: 'module' });
        try { return await new Promise((resolve, reject) => { worker.onmessage = ({ data }) => resolve(data); worker.onerror = event => { event.preventDefault(); reject(Error(event.message)); }; worker.postMessage(file); }); }
        finally { worker.terminate(); URL.revokeObjectURL(url); }
      }, { origin: preview.url, workerHash: COMPAT.files['compat/wllama.js'].sha256 });
      assert.equal(inference.error, undefined, JSON.stringify(inference));
      assert.equal(inference.loaded, true); assert.equal(inference.memory64, false);
      assert.equal(inference.bytes, MODEL.bytes); assert.equal(inference.storageCalls, 0);
      assert.deepEqual(inference.baselineSelection, { compat: false, wasmPath: 'runtime/wllama.wasm', modelOpened: false });
      assert.ok(inference.reply.trim()); assert.equal(inference.vendorConstructorFalsePositive, true);
      assert.ok(!requests.slice(requestBoundary).some(item => item.path === 'runtime/wllama.wasm'), 'Inference must not fetch the primary Memory64 binary');
      console.log(JSON.stringify({ genuineEngineInference: inference }));
    });
    checks.at(-1).inference = inference;
  }
  checks.push({ name: 'no-external-or-model-download-requests', passed: !requests.some(item => item.path === 'EXTERNAL_BLOCKED') });
  assert.ok(checks.at(-1).passed);
  assert.deepEqual(errors, []);
  checks.push({ name: 'no-uncaught-browser-errors', passed: true });
  checks.push({ name: 'genuine-parser-controls', passed: true, controls });
} catch (error) { failure = error; }
finally {
  if (browser) { await browser.close().catch(() => {}); cleanup.browserClosed = true; }
  if (preview) { await preview.close().catch(() => {}); cleanup.previewClosed = true; }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schema: 'model-chat-genuine-memory32-engine/v1', passed: !failure,
    browser: { engine: 'installed desktop WebKit/JSC', version: browserVersion, physicalIOS: false, wasmOverrides: false },
    binaryOnly, sourceIdentity, binaries, model: binaryOnly ? null : { file: MODEL.file, bytes: MODEL.bytes, sha256: MODEL.sha256,
      source: 'existing native File', storage: 'public cacheManager/modelManager injection; all methods forbidden; no persistent cache' },
    checks, requests, errors, nativeSelections, workers: { created: workerCreated, closed: workerClosed }, cleanup,
    elapsedMs: Date.now() - started, failure: failure?.message }, null, 2) + '\n');
}
if (failure) throw failure;
