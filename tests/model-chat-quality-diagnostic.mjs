// Opt-in bounded native quality diagnostic. Never changes product prompts or the
// prior acceptance receipt; authored held-out inputs are evaluation-only.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { MODEL, RUNTIME, COMPAT } from '../examples/browser-model-chat/model-contract.mjs';
import { QUALITY_HINT, reconstructQualityCases, heldOutQualityCases, withQualityHint, qualityFailures, sha256 } from './model-chat-quality-cases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.includes('--help')) {
  console.log('Usage: node tests/model-chat-quality-diagnostic.mjs\nRequires existing pinned BROWSER_MODEL_GGUF_FILE. Optional BROWSER_MODEL_RUNTIME_ROOT, BROWSER_MODEL_MEMORY_ROOT, BROWSER_MODEL_PLAYWRIGHT_MODULE, MODEL_CHAT_BROWSER. Reads the frozen space-journey receipt; writes quality-result.tmp alongside it. At most12 native replies, fresh Workers, ten-minute bound; no downloads or paid calls.');
  process.exit(0);
}
assert.equal(process.argv.length, 2, 'Unknown arguments. Use --help.');
assert.ok(process.env.BROWSER_MODEL_GGUF_FILE, 'Set BROWSER_MODEL_GGUF_FILE to the retained pinned model; no download is performed.');
const output = join(root, '.artifacts/proof/space-journey');
const frozenReceiptSha256 = '9ccdf8b1433222aa3072c2567ac328074296b6a2aecf6e8b9182f034497faf08';
const runtimeRoot = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(root, '../rag-model-onboarding/.artifacts/model-chat/runtime'));
const memoryRoot = resolve(process.env.BROWSER_MODEL_MEMORY_ROOT || join(root, '.artifacts/memory'));
const chrome = process.env.MODEL_CHAT_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const playwright = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE;
if (!playwright) throw Error('Set BROWSER_MODEL_PLAYWRIGHT_MODULE to an existing Playwright module; automatic installation is disabled.');
const started = Date.now(), hardLimitMs = 10 * 60_000, pause = ms => new Promise(done => setTimeout(done, ms));
const sourceIdentity = [], results = [], externalRequests = [], browserErrors = [], setupChecks = [];
const cleanup = { adaptersDisposed: false, browserClosed: false, profileRemoved: false, serverClosed: false };
let server, profile, chromeProcess, browser, context, page, failure, hardTimer, nativeReplyCalls = 0, nativeMeterCalls = 0, actualCases = [], baselineCases = [], candidateCases = [];
const checkpoint = (event, data = {}) => console.log(JSON.stringify({ event, elapsedMs: Date.now() - started, ...data }));
const guarded = ['examples/browser-model-chat/engine-worker.mjs', 'examples/browser-model-chat/runtime-adapter.mjs',
  'examples/browser-model-chat/model-contract.mjs', 'examples/browser-model-chat/runtime-profile.mjs', 'examples/browser-model-chat/runtime-errors.mjs',
  'examples/browser-model-chat/capabilities.mjs', 'examples/browser-model-chat/wasm-memory.mjs', 'examples/browser-model-chat/session-storage.mjs',
  'examples/browser-model-chat/memory/context.mjs', 'examples/browser-model-chat/memory/automatic-context.mjs',
  'examples/browser-model-chat/memory/automatic-memory.mjs', 'examples/browser-model-chat/memory/store.mjs',
  'examples/browser-model-chat/memory/retained-compaction.mjs', 'examples/browser-model-chat/memory/conversation-index.mjs',
  'examples/browser-model-chat/memory/scoped-pockets.mjs', 'examples/browser-model-chat/memory/rag-adapter.mjs',
  'examples/browser-model-chat/memory/structured-context.mjs', 'examples/browser-model-chat/memory/starter-facts.mjs',
  'tests/model-chat-quality-cases.mjs', 'tests/model-chat-quality-diagnostic.mjs'];

async function run() {
  const receiptBytes = await readFile(join(output, 'receipt.json'));
  assert.equal(sha256(receiptBytes), frozenReceiptSha256, 'Frozen acceptance packet must not change.');
  const frozen = JSON.parse(receiptBytes);
  const coreBytes = await readFile(join(memoryRoot, 'rag-core.mjs'));
  assert.equal(sha256(coreBytes), 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6');
  sourceIdentity.push({ path: 'prepared-core', sha256: sha256(coreBytes) });
  for (const path of guarded) sourceIdentity.push({ path, sha256: sha256(await readFile(join(root, path))) });
  const core = await import(pathToFileURL(join(memoryRoot, 'rag-core.mjs')).href);
  actualCases = await reconstructQualityCases(frozen, core);
  const distinct = actualCases.filter((value, index) => actualCases.findIndex(other => other.requestSha256 === value.requestSha256) === index);
  assert.equal(distinct.length, 2);
  baselineCases = [...distinct, ...heldOutQualityCases(distinct[0].messages[0].content)];
  candidateCases = baselineCases.map(withQualityHint);
  const oldDiagnostic = frozen.reviewPacket.localTests.sameRequestDiagnostic.exactDiagnosticRequest;
  assert.equal(sha256(JSON.stringify(oldDiagnostic.messages)), oldDiagnostic.requestSha256);
  setupChecks.push({ name: 'three-failures-two-unique-requests-production-reconstructed-and-hash-matched', pass: true,
    repeatedScenarioHash: actualCases[0].requestSha256, olderDiagnosticRequestPreserved: oldDiagnostic.requestSha256 });
  const modelPath = await realpath(resolve(process.env.BROWSER_MODEL_GGUF_FILE));
  const info = await stat(modelPath); assert.ok(info.isFile()); assert.equal(info.size, MODEL.bytes);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
  assert.equal(hash.digest('hex'), MODEL.sha256);
  for (const [name, identity] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) assert.equal(sha256(await readFile(join(runtimeRoot, name))), identity.sha256, name);
  checkpoint('requests-verified', { actualFailures: 3, distinctRequests: 2, heldOutCases: 2, maximumReplies: 12, receiptSha256: frozenReceiptSha256 });
  server = await startServer({ runtimeRoot }); profile = await mkdtemp(join(tmpdir(), 'rag-quality-diagnostic-'));
  let spawnError;
  chromeProcess = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  chromeProcess.once('error', error => { spawnError = error; });
  let port;
  for (let attempt = 0; attempt < 300 && !spawnError; attempt++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} await pause(100); }
  if (!port) throw spawnError || Error('Owned browser did not expose its same-machine CDP port.');
  const { chromium } = await import(pathToFileURL(playwright).href);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); context = browser.contexts()[0];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(server.url).origin && !['blob:', 'data:'].includes(url.protocol)) {
      externalRequests.push({ host: url.hostname, type: route.request().resourceType() }); return route.abort('internetdisconnected');
    }
    if (url.pathname === '/quality-diagnostic.html') return route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Native quality diagnostic</title><body><label>Retained diagnostic model <input id="quality-model" type="file" accept=".gguf"></label><p>Production adapter; diagnostic inputs; no application acceptance.</p></body></html>' });
    return route.continue();
  });
  page = context.pages()[0]; page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(server.url + 'quality-diagnostic.html');
  const cdp = await context.newCDPSession(page);
  try {
    const { root: doc } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#quality-model' });
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [modelPath] });
  } finally { await cdp.detach(); }
  assert.equal(await page.locator('#quality-model').evaluate(input => input.files[0]?.size), MODEL.bytes);
  await page.evaluate(async () => { window.__qualityAdapterFactory = (await import('/runtime-adapter.mjs')).createRuntimeAdapter; });
  const matrix = [
    ...baselineCases.slice(0, 2).flatMap(value => [1, 2].map(repeat => ({ value, repeat, variant: 'baseline' }))),
    ...baselineCases.slice(2).map(value => ({ value, repeat: 1, variant: 'baseline' })),
    ...candidateCases.slice(0, 2).flatMap(value => [1, 2].map(repeat => ({ value, repeat, variant: 'generic-hint' }))),
    ...candidateCases.slice(2).map(value => ({ value, repeat: 1, variant: 'generic-hint' })),
  ];
  assert.equal(matrix.length, 12);
  for (const { value, repeat, variant } of matrix) {
    assert.ok(Date.now() - started < hardLimitMs); assert.ok(nativeReplyCalls < 12);
    assert.equal(sha256(JSON.stringify(value.messages)), value.requestSha256);
    checkpoint('case-start', { id: value.id, repeat, variant, requestSha256: value.requestSha256 });
    nativeMeterCalls++; nativeReplyCalls++;
    const native = await page.evaluate(async messages => {
      const adapter = window.__qualityAdapterFactory(); window.__activeQualityAdapter = adapter;
      const at = performance.now(); let prepared, measurement, answer, error;
      try {
        prepared = await adapter.prepare({ source: 'file', file: document.getElementById('quality-model').files[0] });
        measurement = await adapter.measure(messages);
        const replyAt = performance.now(); answer = { text: await adapter.reply(messages), ms: Math.round(performance.now() - replyAt) };
      } catch (cause) { error = { name: cause.name, message: cause.message, code: cause.code || null }; }
      finally { await adapter.dispose(); window.__activeQualityAdapter = null; }
      return { prepared, measurement, answer, error, ms: Math.round(performance.now() - at) };
    }, value.messages);
    if (native.answer) { native.answer.sha256 = sha256(native.answer.text); native.answer.failures = qualityFailures(value, native.answer.text);
      native.answer.status = native.answer.failures.length ? 'fail' : 'pass';
      native.answer.equalsOriginalFailure = value.source ? native.answer.text === value.source.originalAnswer : null; }
    results.push({ id: value.id, baselineId: value.variantOf || value.id, requestSha256: value.requestSha256, repeat, variant, ...native });
    checkpoint('case-result', { id: value.id, repeat, variant, ...native });
    if (native.error) throw Error('Native case failed: ' + native.error.message);
    assert.equal(native.prepared.context.reported, 2048); assert.equal(native.measurement.contextTokens, 2048);
    assert.ok(native.measurement.promptTokens + 160 <= 2048); assert.equal(native.measurement.completionTokens, 1);
    if (variant === 'baseline' && value.source) assert.equal(native.measurement.promptTokens, value.source.promptTokens);
  }
  assert.deepEqual(externalRequests, []); assert.deepEqual(browserErrors, []);
}

try { await Promise.race([run(), new Promise((_, reject) => { hardTimer = setTimeout(() => reject(Error('Native quality ten-minute bound expired.')), hardLimitMs); })]); }
catch (error) { failure = error; checkpoint('failure', { name: error.name, message: error.message }); }
finally {
  clearTimeout(hardTimer);
  if (page && !page.isClosed()) try { await page.evaluate(async () => { await window.__activeQualityAdapter?.dispose(); }); cleanup.adaptersDisposed = true; } catch {}
  if (browser) { try { const cdp = await context.newCDPSession(page); await cdp.send('Browser.close'); } catch {} await browser.close().catch(() => {}); }
  if (chromeProcess) {
    for (let attempt = 0; attempt < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; attempt++) await pause(50);
    if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) { chromeProcess.kill(); for (let attempt = 0; attempt < 100 && chromeProcess.exitCode === null && chromeProcess.signalCode === null; attempt++) await pause(50); }
    cleanup.browserClosed = chromeProcess.exitCode !== null || chromeProcess.signalCode !== null;
  }
  if (server) try { await server.close(); cleanup.serverClosed = true; } catch (error) { failure ||= error; }
  if (profile && cleanup.browserClosed) try {
    assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('rag-quality-diagnostic-'));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); cleanup.profileRemoved = true;
  } catch (error) { failure ||= error; }
  for (const identity of sourceIdentity.filter(item => item.path !== 'prepared-core')) if (sha256(await readFile(join(root, identity.path))) !== identity.sha256) failure ||= Error('Guarded input changed: ' + identity.path);
  assert.equal(sha256(await readFile(join(output, 'receipt.json'))), frozenReceiptSha256, 'Prior acceptance receipt must remain byte-identical.');
  if (!Object.values(cleanup).every(Boolean)) failure ||= Error('Owned runtime cleanup was not fully confirmed.');
  const stability = [...new Set(results.map(value => value.requestSha256))].map(requestSha256 => {
    const runs = results.filter(value => value.requestSha256 === requestSha256);
    return { requestSha256, repeats: runs.length, answerHashes: [...new Set(runs.map(value => value.answer?.sha256 || null))],
      stableInThisFreshWorkerSample: runs.length < 2 ? null : new Set(runs.map(value => value.answer?.sha256)).size === 1 };
  });
  const result = { schema: 'native-browser-quality-matrix/v1', diagnosticOnly: true, applicationAcceptance: false,
    status: failure ? 'execution-failure' : 'completed-with-explicit-quality-results', durationMs: Date.now() - started, browser: browser?.version() || null,
    command: ['node', 'tests/model-chat-quality-diagnostic.mjs'], sourceIdentity, sourceReceipt: { path: '.artifacts/proof/space-journey/receipt.json', bytes: 163606, sha256: frozenReceiptSha256, preserved: true },
    model: MODEL, runtime: { version: RUNTIME.version, files: RUNTIME.files, compatibilityFiles: COMPAT.files },
    settings: { ctx: 2048, nBatch: 128, threads: 1, gpuLayers: 0, seed: 42, temperature: 0, replyMaxTokens: 160, meterMaxTokens: 1, freshWorkerPerReply: true },
    budget: { maximumReplies: 12, actualReplies: nativeReplyCalls, nativeMeterCalls, hardLimitMs },
    originalFailures: actualCases.map(value => ({ id: value.id, requestSha256: value.requestSha256, source: value.source })),
    requests: [...baselineCases, ...candidateCases].map(({ source, ...value }) => value),
    oneProposedDiff: { operation: 'append', field: 'first-system-content', exactText: ' ' + QUALITY_HINT, factsOrExpectedAnswersAdded: false, productApplied: false },
    results, stability, setupChecks, externalRequests, browserErrors, cleanup,
    datasetCandidate: { status: 'candidate-only-unintegrated-unadmitted', automaticIngest: false, trainingRuns: 0, uploads: 0, newRepositories: 0,
      observedFailureFamily: { id: 'observed-fred-mars-session-v1', partition: 'development-only', includesDuplicateScenarioRequest: true },
      heldOutFamilies: baselineCases.filter(value => value.partition === 'evaluation-only').map(({ familyGroup, id, requestSha256 }) => ({ familyGroup, partition: 'evaluation-only', id, requestSha256 })),
      trainingTargets: [], observedGeneratedRepliesAreUntrustedDiagnosticOutputs: true,
      splitPolicy: 'Keep each entire family and originating conversation in one partition. Held-out families remain evaluation-only; no row-wise split or automatic promotion to training. This single candidate comparison consumes these diagnostic hold-outs; future independent release qualification requires untouched families.' },
    limits: ['One fixed model/runtime/browser pair and one generic append; no parameter search.', 'Authored held-out contexts are diagnostic inputs, not a new full application conversation journey.',
      'Stability claims apply only to identical frozen requests under the recorded fresh-Worker sample; changed conversation prefixes are different requests.', 'No physical iOS proof or universal conversational-quality claim.'],
    boundaries: { productEdits: false, productionOperationsReplaced: false, modelDownloads: 0, protocolModelBytes: 0, paidCalls: 0, userBrowserProfileAccess: false },
    ...(failure ? { error: { name: failure.name, message: failure.message } } : {}) };
  const bytes = JSON.stringify(result) + '\n'; await writeFile(join(output, 'quality-result.tmp'), bytes);
  checkpoint('receipt', { file: 'quality-result.tmp', bytes: Buffer.byteLength(bytes), sha256: sha256(bytes), results: results.length, failures: results.filter(value => value.answer?.status === 'fail').length });
}
if (failure) process.exitCode = 1;
