#!/usr/bin/env node
// Local curated-package proof: production bootstrap, then an explicitly labeled
// provider fixture. No repository server mounts, model execution, or downloads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(process.env.BROWSER_MEMORY_PREVIEW_SITE || join(root, '.artifacts/model-chat/memory-preview-site'));
const resultPath = join(root, '.artifacts/proof/local-memory/package-result.json');
const profilePrefix = 'rag-memory-package-';
const chrome = process.env.BROWSER_RAG_CHROMIUM_PATH || process.env.MODEL_CHAT_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const playwright = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE?.trim() || process.env.PLAYWRIGHT_MODULE?.trim();
if (!playwright) throw new Error('Set BROWSER_MODEL_PLAYWRIGHT_MODULE (or PLAYWRIGHT_MODULE) to an already-installed Playwright module file. Automatic installation is disabled.');
const prefix = '/portable/preview/';
const memoryAssets = ['workspace', 'store', 'events', 'context', 'structured-context', 'automatic-context', 'automatic-memory',
  'conversation-index', 'scoped-pockets', 'starter-facts', 'rag-adapter',
  'restore-events', 'citations', 'panel', 'rag-core', 'graph-renderer'].map(name => `memory/${name}.mjs`).concat('memory/panel.css');
const payloadPaths = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs',
  'capabilities.mjs', 'bootstrap.mjs', 'theme/aurel-gold.css', 'runtime/index.js', 'runtime/wllama.wasm',
  'runtime/LICENSE', 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm', 'LICENSES/rag-method.txt',
  'LICENSES/lfm-open-license-1.0.txt', 'LICENSES/forcegraph-tsl.txt', 'LICENSES/three.txt', 'NOTICE.txt', 'README.txt', ...memoryAssets].sort();
const expectedFiles = [...payloadPaths, 'site-manifest.json'].sort();
const pinned = {
  'memory/graph-renderer.mjs': 'c85fda05a2a6ac5596dc41f5f197064eb3063932eaf574ae93f5f7141d179edd',
  'LICENSES/forcegraph-tsl.txt': '1a897e0ee6f1fc65889976eadb848acefac9db7f9c97274a6c490f52390cd474',
  'LICENSES/three.txt': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc',
  'LICENSES/lfm-open-license-1.0.txt': '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b',
  'runtime/LICENSE': '5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720',
  'runtime/index.js': '2ed031e8d61cebd1d4c7d4956a6350f5afc7fa7c678c3a324d66f6df958f67db',
  'runtime/wllama.wasm': '4197ce6d3dc9240c42ee52b4197dc99638875a06b0083901f8a57767338a0cfa',
  'runtime/compat/wllama.js': '011e11f2c2a4a94d1764a4f45993e01ae5c48f72d78d59464972b26606afd6ac',
  'runtime/compat/wllama.wasm': '9ea153d9396db12c385d53e9a8330b1638ca3e8805159a762ce8859d92d2ac8b',
};
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = value => value.split(sep).join('/');
const checks = [], observations = [], externalRequests = [], pageErrors = [], failedResponses = [], browserRequests = [];
const priorAttempts = [];
const cleanup = { browserContextClosed: false, loopbackServerClosed: false, ownedTemporaryProfileRemoved: false };
let manifest, packageIdentity, sourceIdentity, fixture, server, context, profile, origin, browserVersion, failure, workers = 0;
const started = Date.now();
function required(name, pattern) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`Set ${name} explicitly to the reviewed value.`);
  return value;
}

function inside(base, target) {
  const suffix = relative(base, target);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix);
}
async function check(name, run) {
  const at = Date.now();
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at }); console.log('PASS curated memory package: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message }); throw error; }
}
async function filesBelow(directory) {
  const names = [];
  async function visit(current, relativePath = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name), name = relativePath + entry.name;
      const info = await lstat(path);
      assert.ok(!info.isSymbolicLink(), 'package contains no symbolic links');
      if (entry.isDirectory()) await visit(path, name + '/');
      else { assert.ok(info.isFile() && info.nlink === 1, 'package contains only ordinary single-link files'); names.push(name); }
    }
  }
  await visit(directory); return names.sort();
}
async function startIsolatedServer() {
  const allowed = new Set(expectedFiles);
  // Deliberately standalone. No repository server, dependency directory, or
  // parent-path fallback is reachable from this HTTP surface.
  const owned = createServer(async (request, response) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); } catch { pathname = ''; }
      const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || 'index.html' : '';
      if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(name)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : 'Not found'); return;
      }
      const bytes = await readFile(join(packageRoot, name));
      const type = mime[extname(name)] || 'text/plain';
      response.writeHead(200, { 'Content-Type': type + (type.startsWith('text/') || type === 'application/javascript' || type === 'application/json' ? '; charset=utf-8' : ''),
        'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }); response.end('Package read failed');
    }
  });
  await new Promise((accept, reject) => { owned.once('error', reject); owned.listen(0, '127.0.0.1', accept); });
  return owned;
}

try {
  const expectedManifest = required('BROWSER_MEMORY_EXPECTED_MANIFEST_SHA256', /^[a-f0-9]{64}$/);
  const expectedHead = required('BROWSER_MEMORY_EXPECTED_SOURCE_HEAD', /^[a-f0-9]{40}$/);
  const expectedFingerprint = required('BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT', /^[a-f0-9]{64}$/);
  // Keep bounded failed verifier attempts when correcting proof-only defects.
  // This never treats an earlier attempt as evidence for the current package.
  const previous = await readFile(resultPath, 'utf8').then(text => {
    assert.ok(text.length <= 128 * 1024, 'prior package proof remains compact'); return JSON.parse(text);
  }).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous?.schema === 'local-memory-curated-package-proof/v1' && previous.status === 'fail') {
    priorAttempts.push(...(previous.priorAttempts || []).slice(-2), { status: 'fail', startedAt: previous.startedAt,
      durationMs: previous.durationMs, verifierSha256: previous.verifierSha256,
      sourceHead: previous.observations?.find(item => item.sourceHead)?.sourceHead,
      passedChecks: previous.checks?.filter(item => item.status === 'pass').length,
      failedCheck: previous.checks?.find(item => item.status === 'fail')?.name,
      error: String(previous.error || '').slice(0, 400), cleanup: previous.cleanup,
      boundary: { actualNativeCalls: previous.boundary?.actualNativeCalls, runtimeWorkersCreated: previous.boundary?.runtimeWorkersCreated,
        externalRequestCount: previous.boundary?.externalRequests?.length, pageErrorCount: previous.boundary?.pageErrors?.length } });
  }
  await check('exact 41-file payload, complete license pins, source and manifest identities', async () => {
    assert.ok(inside(resolve(root, '.artifacts/model-chat'), packageRoot), 'package stays in its explicitly owned artifact parent');
    assert.equal(await realpath(packageRoot), packageRoot, 'package root has no linked ancestor');
    assert.deepEqual(await filesBelow(packageRoot), expectedFiles);
    assert.equal(payloadPaths.length, 41); assert.equal(expectedFiles.length, 42);
    const manifestBytes = await readFile(join(packageRoot, 'site-manifest.json'));
    assert.equal(digest(manifestBytes), expectedManifest, 'expected reviewed manifest bytes');
    manifest = JSON.parse(manifestBytes);
    const { identitySha256, ...body } = manifest;
    assert.equal(manifest.schema, 'rag-model-chat-static/v1'); assert.equal(manifest.memoryPreview, true);
    assert.equal(manifest.publicReleaseQualified, false); assert.equal(identitySha256, digest(JSON.stringify(body)));
    assert.deepEqual(manifest.files.map(file => file.path).sort(), payloadPaths);
    assert.equal(manifest.graph.bundleSha256, pinned['memory/graph-renderer.mjs']); assert.equal(manifest.graph.layoutBackend, 'local');
    assert.equal(manifest.model.weightsIncluded, false);
    assert.equal(manifest.model.licensePath, 'LICENSES/lfm-open-license-1.0.txt');
    assert.equal(manifest.model.licenseSha256, pinned[manifest.model.licensePath]);
    assert.match(manifest.source.head || '', /^[a-f0-9]{40}$/); assert.equal(typeof manifest.source.dirty, 'boolean');
    assert.equal(manifest.source.head, expectedHead, 'expected tested revision'); assert.equal(manifest.source.dirty, false);
    assert.equal(manifest.source.fingerprintSha256, digest(JSON.stringify(manifest.source.files)));
    assert.equal(manifest.source.fingerprintSha256, expectedFingerprint, 'expected reviewed source closure');
    packageIdentity = [];
    for (const file of manifest.files) {
      const bytes = await readFile(join(packageRoot, file.path));
      assert.equal(bytes.length, file.bytes, file.path); assert.equal(digest(bytes), file.sha256, file.path);
      if (pinned[file.path]) assert.equal(file.sha256, pinned[file.path], 'upstream pin ' + file.path);
      if (/\.(?:mjs|js|css|html|txt|json)$/.test(file.path)) {
        assert.doesNotMatch(bytes.toString(), /(?:[A-Z]:[\\/]Users[\\/]|[A-Z]:[\\/]DevStuff[\\/]|sk-proj-[A-Za-z0-9_-]{8})/i, 'no machine path/credential leakage in ' + file.path);
      }
      packageIdentity.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
    }
    sourceIdentity = [];
    for (const file of manifest.source.files) {
      const target = resolve(root, file.path);
      assert.ok(inside(root, target), 'source fingerprint stays in checkout');
      const bytes = await readFile(target);
      assert.equal(bytes.length, file.bytes, file.path); assert.equal(digest(bytes), file.sha256, file.path);
      sourceIdentity.push(file);
    }
    const notice = await readFile(join(packageRoot, 'NOTICE.txt'), 'utf8');
    assert.match(notice, /Complete pinned model license: LICENSES\/lfm-open-license-1\.0\.txt/);
    assert.match(notice, /First-party.*MIT/); assert.match(notice, /@wllama\/wllama 3\.5\.1: MIT/);
    assert.match(notice, /@ours\/forcegraph-tsl 0\.3\.0-alpha\.1: MIT/); assert.match(notice, /Three\.js 0\.185\.0: MIT/);
    const readme = await readFile(join(packageRoot, 'README.txt'), 'utf8');
    assert.match(readme, /no special markup is required/); assert.match(readme, /lossy extractive context, not general semantic summarization/);
    assert.match(readme, /not full product-release or iOS qualification/);
    observations.push({ packagePath: portable(relative(root, packageRoot)), filesIncludingManifest: 42,
      manifestSha256: digest(manifestBytes), manifestIdentitySha256: identitySha256, sourceHead: manifest.source.head,
      sourceDirtyAtStage: manifest.source.dirty, sourceFingerprintSha256: manifest.source.fingerprintSha256,
      packageBytes: packageIdentity.reduce((sum, file) => sum + file.bytes, 0) + manifestBytes.length });
  });
  server = await startIsolatedServer(); origin = `http://127.0.0.1:${server.address().port}`;
  await check('standalone nested static GET/HEAD serves exact hashes and executable MIME', async () => {
    for (const name of expectedFiles) {
      const expected = name === 'site-manifest.json' ? { sha256: digest(await readFile(join(packageRoot, name))) } : manifest.files.find(file => file.path === name);
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + prefix + name, { method });
        assert.equal(response.status, 200, method + ' ' + name);
        assert.equal(response.headers.get('content-type').split(';')[0], mime[extname(name)] || 'text/plain', name);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (method === 'GET') assert.equal(digest(bytes), expected.sha256, 'HTTP bytes ' + name);
        else assert.equal(bytes.length, 0, 'HEAD has no body');
      }
    }
  });
  await check('private paths, models, source roots and unknown routes have no mount or HTML fallback', async () => {
    const probes = ['/index.html', '/memory/workspace.mjs', '/examples/browser-model-chat/index.html',
      prefix + 'PRIVATE_LOCAL_ONLY', prefix + 'memory/PRIVATE_LOCAL_ONLY', prefix + 'memory/PREVIEW_READINESS.md',
      prefix + 'memory/build-graph.mjs', prefix + 'worker/force-worker-entry.js',
      prefix + '.git/config', prefix + '.aws/credentials', prefix + '.env', prefix + 'node_modules/playwright/index.mjs',
      prefix + 'tests/model-chat-memory-package.mjs', prefix + 'modules/browser-rag-ts/src/index.ts',
      prefix + 'source/workspace.html', prefix + 'runtime/model.gguf', prefix + manifest.model.file,
      prefix + 'app.mjs.map', prefix + '../.git/config', prefix + '%2e%2e/%2e%2e/.git/config', prefix + 'unknown.mjs'];
    for (const path of probes) for (const method of ['GET', 'HEAD']) {
      const response = await fetch(origin + path, { method });
      assert.equal(response.status, 404, method + ' ' + path);
      assert.equal(response.headers.get('content-type').split(';')[0], 'text/plain');
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'Not found');
    }
    observations.push({ forbiddenRouteProbes: probes.length, sourceDirectoriesMounted: false, dependencyDirectoriesMounted: false,
      modelFilesMounted: false, siteCopiedForProof: false });
  });
  await access(chrome); await access(playwright);
  const { chromium } = await import(pathToFileURL(resolve(playwright)).href);
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, chromiumSandbox: true,
    serviceWorkers: 'block', ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] });
  context.setDefaultTimeout(8000); browserVersion = context.browser()?.version() || 'installed Chromium';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const runtimeOrWorker = /(?:\/runtime\/|\/engine-worker\.mjs$|\.gguf$)/i.test(url.pathname) || route.request().resourceType() === 'worker';
    if (url.origin !== origin || runtimeOrWorker) { externalRequests.push({ origin: url.origin, path: url.pathname, ...(runtimeOrWorker ? { reason: 'runtime-or-model-blocked' } : {}) }); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  context.on('page', page => {
    page.on('worker', () => workers++);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => browserRequests.push(new URL(request.url()).pathname));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Network.clearBrowserCache'); await session.send('Network.clearBrowserCookies'); await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await check('fresh-profile offline production bootstrap initializes its complete memory closure without model calls', async () => {
    await page.goto(origin + prefix + '?memory=1', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.localMemoryPreview?.workspace && document.getElementById('memory-dialog'));
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    assert.equal(await page.locator('#memory-dialog').count(), 1); assert.equal(await page.locator('#memory-query').getAttribute('type'), 'search');
    assert.equal(await page.locator('#memory-recall').textContent(), 'Search'); assert.equal(await page.locator('#memory-graph').count(), 1);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="global"]').count(), 3, 'only explicitly labeled Global starters exist before chat');
    assert.equal(await page.locator('#memory-graph [data-memory-kind="message"]').count(), 0, 'no fabricated conversation messages');
    assert.equal(await page.locator('[role="alert"]:visible').filter({ hasText: /\S/ }).count(), 0);
    const state = await page.evaluate(() => ({ turns: window.localMemoryPreview.workspace.conversation.snapshot().turns.length,
      records: window.localMemoryPreview.workspace.memory.snapshot().records.length, retained: localStorage.length,
      pocket: window.localMemoryPreview.workspace.automaticMemory.getScope(),
      roles: window.localMemoryPreview.workspace.automaticMemory.snapshot().nodes.map(node => node.role) }));
    assert.deepEqual(state, { turns: 0, records: 0, retained: 0, pocket: 'all', roles: ['source', 'source', 'source'] });
    const loaded = new Set(browserRequests);
    for (const name of memoryAssets.filter(name => name.endsWith('.mjs') && name !== 'memory/graph-renderer.mjs')) assert.ok(loaded.has(prefix + name), 'production module closure: ' + name);
    assert.equal(workers, 0); assert.ok(!browserRequests.some(path => path.includes('/runtime/') || path.endsWith('/engine-worker.mjs')));
    observations.push({ originalBootstrapResponse: true, bootstrapResponseReplaced: false, initialStorageEmpty: true, globalStarterNodes: 3, automaticMemoryDefault: true,
      freshTemporaryProfile: true, cacheClearedAndDisabled: true, nonLoopbackRequestsBlocked: true });
  });
  await check('packaged unmarked exact-passage fixture persists source-bound citations and untouched originals', async () => {
    fixture = await page.evaluate(async () => {
      const { createWorkspace } = await import('./memory/workspace.mjs');
      const core = await import('./memory/rag-core.mjs');
      const { hashText } = await import('./memory/context.mjs');
      const label = 'PACKAGE FIXTURE - deterministic meter/provider; no native model execution';
      const calls = []; let measures = 0;
      const adapter = {
        async measure(messages) { calls.push({ operation: 'measure', messageCount: messages.length }); return { promptTokens: ++measures === 1 ? 2300 : 300, contextTokens: 2048, overflow: measures === 1 }; },
        async reply(messages, options = {}) { options.beforeDispatch?.(); options.onDispatch?.(); calls.push({ operation: 'reply', messageCount: messages.length }); return label; },
        async dispose() {},
      };
      window.localMemoryPreview.workspace.dispose();
      const workspace = await createWorkspace({ adapter, core, storage: localStorage });
      const authored = 'An ordinary travel note follows a long introduction. '.repeat(9)
        + '\r\n\r\nThe café 🧭 destination city is Bristol, and the delivery day is Thursday.\r\nNo fact markup is present.';
      const original = workspace.conversation.append({ role: 'user', content: authored });
      workspace.conversation.append({ role: 'assistant', content: 'Earlier assistant response is not source authority.' });
      workspace.conversation.append({ role: 'user', content: 'What are the destination city and delivery day?' });
      const before = workspace.conversation.exportState();
      const prepared = await workspace.prepare();
      const answer = await workspace.provider.reply(prepared.messages);
      const accepted = workspace.conversation.append({ role: 'assistant', content: answer });
      const citations = await workspace.captureAnswerSources({ answerTurnId: accepted.id, requestSha256: prepared.measurement.requestSha256 });
      const persisted = await workspace.persist();
      return { label, calls, original, before, after: workspace.conversation.exportState(), answerTurnId: accepted.id,
        strategy: prepared.compaction?.strategy, sources: citations, savedRecords: workspace.memory.snapshot().records,
        memorySources: prepared.memorySources, automaticNodes: workspace.automaticMemory.snapshot().nodes,
        usedNodeIds: workspace.automaticMemory.snapshot().usedNodeIds,
        durable: persisted.durable, originalHash: await hashText(authored), requestSha256: prepared.measurement.requestSha256,
        eventTypes: workspace.events.list().map(event => event.type) };
    });
    assert.match(fixture.label, /FIXTURE/); assert.equal(fixture.strategy, 'source-linked-automatic-extractive-v1');
    assert.deepEqual(fixture.calls.map(call => call.operation), ['measure', 'measure', 'reply']);
    assert.equal(fixture.savedRecords.length, 0); assert.equal(fixture.durable, true);
    assert.deepEqual(JSON.parse(fixture.after).turns.slice(0, 3), JSON.parse(fixture.before).turns, 'all originals survive fixture compaction');
    assert.ok(fixture.sources.length > 0 && fixture.sources.every(source => source.kind === 'extractive'));
    assert.ok(fixture.memorySources.some(source => source.nodeId === 'turn:' + fixture.original.id && source.role === 'user'));
    assert.ok(fixture.memorySources.every(source => source.role !== 'assistant'), 'generated text is never quoted as authored memory evidence');
    assert.ok(fixture.usedNodeIds.includes('turn:' + fixture.original.id), 'only the actual dispatched memory source is marked used');
    assert.equal(fixture.automaticNodes.filter(node => node.kind === 'message').length, 4, 'all canonical user and generated turns become real nodes');
    assert.ok(fixture.sources.some(source => source.offsets.start > 120));
    for (const source of fixture.sources) {
      assert.equal(source.turnId, fixture.original.id); assert.equal(source.turnHash, fixture.originalHash); assert.equal(source.offsets.unit, 'utf16');
      assert.equal(source.lineHash, digest(fixture.original.content.slice(source.offsets.start, source.offsets.end)));
    }
    assert.ok(fixture.eventTypes.includes('compacted')); assert.ok(fixture.eventTypes.includes('context-dispatched'));
    observations.push({ fixtureLabel: fixture.label, fixtureOperations: fixture.calls, actualNativeCalls: 0,
      savedRecordsCreated: 0, strategy: fixture.strategy, sourceCount: fixture.sources.length, originalHash: fixture.originalHash,
      requestSha256: fixture.requestSha256, usedNodeIds: fixture.usedNodeIds, automaticMessageNodes: 4,
      fixtureMeterIsNotNativeTokenProof: true });
  });
  await check('production bootstrap restores exact answer links and automatic message nodes without manual saves', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.localMemoryPreview?.workspace && document.getElementById('memory-dialog'));
    assert.equal(await page.locator('#app').getAttribute('data-phase'), 'idle');
    const restored = await page.evaluate(answerTurnId => ({ conversation: window.localMemoryPreview.workspace.conversation.exportState(),
      records: window.localMemoryPreview.workspace.memory.snapshot().records,
      sources: window.localMemoryPreview.workspace.sourcesForAnswer(answerTurnId),
      automaticNodes: window.localMemoryPreview.workspace.automaticMemory.snapshot().nodes,
      graphNodeCount: window.localMemoryPreview.workspace.graph.snapshot().nodes.length }), fixture.answerTurnId);
    assert.equal(restored.conversation, fixture.after); assert.deepEqual(restored.sources, fixture.sources); assert.deepEqual(restored.records, []);
    assert.ok(restored.graphNodeCount > 0, 'internal execution history remains separate from saved memory presentation');
    const links = await page.locator(`#turn-${fixture.answerTurnId} .memory-sources a`).evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    assert.deepEqual(links, fixture.sources.map(source => '#turn-' + source.turnId));
    assert.equal(await page.locator(`#turn-${fixture.original.id} .content`).textContent(), fixture.original.content);
    assert.equal(restored.automaticNodes.filter(node => node.kind === 'message').length, 4);
    assert.equal(restored.automaticNodes.filter(node => node.kind === 'global').length, 3);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="message"]').count(), 4, 'canonical turns, not event-history nodes');
    assert.equal(await page.locator('#memory-graph [data-memory-kind="global"]').count(), 3);
    assert.equal(await page.locator('#memory-graph [data-memory-kind="record"]').count(), 0, 'automatic nodes do not manufacture manual saved records');
    assert.equal(await page.locator('#memory-graph svg').count(), 0, 'no substitute SVG renderer');
    assert.equal(workers, 0); assert.equal(await page.locator('[role="alert"]:visible').filter({ hasText: /\S/ }).count(), 0);
  });
  await check('offline browser and immutable package boundaries remain intact after reload', async () => {
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(failedResponses, []); assert.equal(workers, 0);
    assert.ok(browserRequests.every(path => path.startsWith(prefix)));
    assert.ok(!browserRequests.some(path => /(?:\.gguf$|\/runtime\/|\/engine-worker\.mjs$)/.test(path)));
    assert.deepEqual(await filesBelow(packageRoot), expectedFiles);
    for (const file of packageIdentity) assert.equal(digest(await readFile(join(packageRoot, file.path))), file.sha256, file.path);
    const current = JSON.parse(await readFile(join(packageRoot, 'site-manifest.json'), 'utf8'));
    assert.deepEqual(current, manifest);
  });
} catch (error) { failure = error; }
finally {
  try { if (context) { await context.close(); cleanup.browserContextClosed = true; } } catch (error) { failure ||= error; }
  try { if (server) { server.closeAllConnections(); await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); cleanup.loopbackServerClosed = true; } } catch (error) { failure ||= error; }
  try {
    if (profile) {
      assert.equal(resolve(dirname(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith(profilePrefix));
      await rm(profile, { recursive: true, force: true }); cleanup.ownedTemporaryProfileRemoved = true;
    }
  } catch (error) { failure ||= error; }
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify({ schema: 'local-memory-curated-package-proof/v1', status: failure ? 'fail' : 'pass',
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, node: process.version, browser: browserVersion,
    verifierSha256: digest(await readFile(fileURLToPath(import.meta.url))), sourceIdentity, checks, observations, priorAttempts,
    boundary: { externalRequests, pageErrors, failedResponses, runtimeWorkersCreated: workers, actualNativeCalls: 0,
      browserPaths: [...new Set(browserRequests)].sort(), packageCopiedForProof: false, modelFilesMounted: false,
      repositoryServerUsed: false, sourceDirectoriesMounted: false, dependencyDirectoriesMounted: false },
    limitations: ['Fresh profile and source-free browser package proof, not fresh OS/npm installation.',
      'Fixture provider and token meter are labeled; no native inference or model quality proof.',
      'Loopback static route proof is not live HTTPS, physical iOS, network recovery or model-loading qualification.'],
    cleanup, ...(failure ? { error: failure.message } : {}) }, null, 2) + '\n');
}
if (failure) { console.error('FAIL curated memory package: ' + failure.stack); process.exitCode = 1; }
else console.log(`PASS: ${checks.length} curated-package checks; no model calls or package copies.`);
