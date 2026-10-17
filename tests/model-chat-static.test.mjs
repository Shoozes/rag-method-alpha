import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { stageStatic as stageSource } from '../examples/browser-model-chat/stage-static.mjs';
import { COMPAT, MODEL, RUNTIME } from '../examples/browser-model-chat/model-contract.mjs';
import { listenStatic } from '../modules/browser-rag-ts/scripts/static-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, '.artifacts/model-chat');
const site = resolve(process.env.BROWSER_MEMORY_PREVIEW_SITE || join(artifacts, 'memory-preview-site'));
const preparedRuntime = resolve(process.env.BROWSER_MODEL_RUNTIME_ROOT || join(artifacts, 'runtime'));
const stageStatic = options => stageSource({ output: site, memoryPreview: true, runtimeRoot: preparedRuntime, ...options });
const prefix = '/prefix/model-chat/';
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const browserFiles = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs',
  'capabilities.mjs', 'bootstrap.mjs'];
const helperFiles = ['runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs'];
const memoryFiles = ['memory/workspace.mjs', 'memory/store.mjs', 'memory/events.mjs', 'memory/context.mjs', 'memory/context-panel.mjs',
  'memory/structured-context.mjs', 'memory/automatic-context.mjs', 'memory/rag-adapter.mjs', 'memory/restore-events.mjs',
  'memory/citations.mjs', 'memory/panel.mjs', 'memory/panel.css', 'memory/navigation.mjs', 'memory/compaction-cue.mjs', 'memory/rag-core.mjs', 'memory/graph-renderer.mjs',
  'memory/retained-compaction.mjs', 'memory/summary-effects.mjs',
  'memory/automatic-memory.mjs', 'memory/conversation-index.mjs', 'memory/scoped-pockets.mjs', 'memory/starter-facts.mjs'];
const automaticAdded = ['memory/automatic-memory.mjs', 'memory/conversation-index.mjs', 'memory/scoped-pockets.mjs', 'memory/starter-facts.mjs'];
const navigationAdded = ['memory/navigation.mjs'];
const compactionAdded = ['memory/compaction-cue.mjs'];
const contextAdded = ['memory/context-panel.mjs'];
const summaryAdded = ['memory/retained-compaction.mjs', 'memory/summary-effects.mjs'];
const modelLicensePath = 'LICENSES/lfm-open-license-1.0.txt';
const graphAdded = ['memory/graph-renderer.mjs', 'LICENSES/forcegraph-tsl.txt', 'LICENSES/three.txt'];
const previewAdded = [...memoryFiles, modelLicensePath, ...graphAdded.filter(name => name.startsWith('LICENSES/'))];
const graphPins = { 'memory/graph-renderer.mjs': 'b4283ce805072898247381732481a47d30ba38d5373e6becda17a7ff0a9c7f13',
  'LICENSES/forcegraph-tsl.txt': '1a897e0ee6f1fc65889976eadb848acefac9db7f9c97274a6c490f52390cd474',
  'LICENSES/three.txt': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc' };
const modelLicenseSha256 = '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b';

async function privateFixture(t) {
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'static-test-'));
  t.after(async () => {
    assert.equal(resolve(dirname(directory)), resolve(artifacts));
    assert.ok(relative(artifacts, directory).startsWith('static-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('an isolated private marker refuses default staging before runtime reads or output; opt-in must be boolean', async t => {
  const fixtureRoot = join(await privateFixture(t), 'guard-source');
  const fixtureExample = join(fixtureRoot, 'examples/browser-model-chat');
  await mkdir(join(fixtureExample, 'memory'), { recursive: true });
  // Copy only the two tiny stager inputs. Never add/remove a real source marker
  // or copy the application/runtime/model tree to exercise this guard.
  for (const name of ['stage-static.mjs', 'model-contract.mjs']) {
    await copyFile(join(root, 'examples/browser-model-chat', name), join(fixtureExample, name));
  }
  await writeFile(join(fixtureExample, 'memory/PRIVATE_LOCAL_ONLY'), 'Isolated test fixture only.\n');
  const { stageStatic: stagePrivate } = await import(pathToFileURL(join(fixtureExample, 'stage-static.mjs')).href);
  const output = join(fixtureRoot, 'default-must-not-exist');
  await assert.rejects(stagePrivate({ output, runtimeRoot: 'missing-runtime' }), /Private memory preview is local only/);
  await assert.rejects(stagePrivate({ output, memoryPreview: false }), /Private memory preview is local only/);
  for (const memoryPreview of ['true', 1, {}]) await assert.rejects(stagePrivate({ output, memoryPreview }), /explicit boolean/);
  assert.equal(await exists(output), false);
});

test('static staging refuses unsafe, linked, existing foreign and forged output without overwriting', async t => {
  const fixture = await privateFixture(t);
  const foreign = join(fixture, 'foreign');
  await mkdir(foreign);
  await writeFile(join(foreign, 'keep.txt'), 'PRIVATE-FIXTURE-KEEP');
  for (const output of [root, dirname(root), join(tmpdir(), 'outside-model-chat-site'), join(root, '.git/site')]) {
    await assert.rejects(stageStatic({ output }), /workspace|private|dependency/);
  }
  await assert.rejects(stageStatic({ output: foreign }), /managed site manifest/);
  assert.equal(await readFile(join(foreign, 'keep.txt'), 'utf8'), 'PRIVATE-FIXTURE-KEEP');
  const forged = join(fixture, 'forged');
  await mkdir(forged);
  await writeFile(join(forged, 'site-manifest.json'), JSON.stringify({ schema: 'rag-model-chat-static/v1', managedBy: 'examples/browser-model-chat/stage-static.mjs', files: [] }));
  await assert.rejects(stageStatic({ output: forged }), /foreign or changed/);
  const linked = join(fixture, 'linked');
  try { await symlink(foreign, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; t.diagnostic('Directory-link creation unavailable; other destination refusal checks passed.'); return; }
  await assert.rejects(stageStatic({ output: join(linked, 'nested-site') }), /without links/);
  assert.deepEqual(await readdir(foreign), ['keep.txt']);
});

test('missing or wrong pinned runtime bytes fail before creating output', async t => {
  const fixture = await privateFixture(t);
  const output = join(fixture, 'must-not-exist');
  await assert.rejects(stageStatic({ output, runtimeRoot: join(fixture, 'missing-runtime') }), /missing: runtime\/index\.js/);
  assert.equal(await exists(output), false);
  const runtimeRoot = join(fixture, 'bad-runtime');
  await mkdir(runtimeRoot);
  await writeFile(join(runtimeRoot, 'index.js'), 'export const wrongFixture = true;');
  await writeFile(join(runtimeRoot, 'wllama.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  await writeFile(join(runtimeRoot, 'LICENSE'), 'Fixture license only');
  await assert.rejects(stageStatic({ output, runtimeRoot }), /Pinned runtime SHA-256 mismatch: index\.js/);
  assert.equal(await exists(output), false);
});

test('explicit preview export has exactly 46 hashed payload files plus manifest, complete licenses and safe refresh', async t => {
  // The intended delivery site is the sole delivery output. No second runtime tree
  // or model is created; failure cases above use only a few fixture bytes.
  const staged = await stageStatic();
  assert.equal(staged.output, site);
  const manifest = JSON.parse(await readFile(join(site, 'site-manifest.json'), 'utf8'));
  const { identitySha256, ...body } = manifest;
  assert.equal(identitySha256, hash(JSON.stringify(body)));
  assert.equal(manifest.publicReleaseQualified, false);
  assert.equal(manifest.memoryPreview, true, 'opt-in is an export mode, not release approval');
  assert.equal(manifest.source.reviewStatus, 'unreviewed');
  assert.ok(manifest.source.head === null || /^[0-9a-f]{40}$/.test(manifest.source.head));
  assert.ok(manifest.source.dirty === null || typeof manifest.source.dirty === 'boolean');
  assert.equal(manifest.source.fingerprintSha256, hash(JSON.stringify(manifest.source.files)));
  assert.equal(manifest.model.weightsIncluded, false);
  assert.equal(manifest.model.sha256, MODEL.sha256);
  assert.equal(manifest.model.licenseUrl, MODEL.license);
  assert.equal(manifest.model.licensePath, modelLicensePath);
  assert.equal(manifest.model.licenseSha256, modelLicenseSha256);
  const expected = [...browserFiles, 'theme/aurel-gold.css', 'runtime/index.js', 'runtime/wllama.wasm',
    'runtime/LICENSE', 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm', 'LICENSES/rag-method.txt', 'NOTICE.txt', 'README.txt',
    ...previewAdded].sort();
  assert.deepEqual(manifest.files.map(file => file.path).sort(), expected);
  assert.equal(manifest.files.length, 46);
  const actual = [];
  async function visit(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) await visit(join(directory, item.name), prefix + item.name + '/');
      else { assert.equal(item.isFile(), true); actual.push(prefix + item.name); }
    }
  }
  await visit(site);
  assert.deepEqual(actual.sort(), [...expected, 'site-manifest.json'].sort());
  assert.equal(actual.length, 47, 'no additional files, source, models or private products');
  for (const file of manifest.files) {
    const bytes = await readFile(join(site, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
    assert.ok(!file.path.includes('..') && !file.path.startsWith('/'));
  }
  for (const [name, contract] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) {
    assert.equal(hash(await readFile(join(site, 'runtime', name))), contract.sha256, 'retained runtime: ' + name);
  }
  for (const helperPath of [...helperFiles, ...memoryFiles]) {
    const helperSource = await readFile(['memory/rag-core.mjs', 'memory/graph-renderer.mjs'].includes(helperPath)
      ? join(root, '.artifacts', helperPath) : join(root, 'examples/browser-model-chat', helperPath));
    const helperManifest = manifest.files.find(file => file.path === helperPath);
    assert.equal(helperManifest.bytes, helperSource.length, helperPath);
    assert.equal(helperManifest.sha256, hash(helperSource), helperPath);
    assert.deepEqual(await readFile(join(site, helperPath)), helperSource, helperPath);
  }
  assert.equal(hash(await readFile(join(site, 'theme/aurel-gold.css'))), hash(await readFile(join(root, 'modules/browser-rag-ts/demo/aurel-gold.css'))));
  assert.equal(hash(await readFile(join(site, 'LICENSES/rag-method.txt'))), hash(await readFile(join(root, 'LICENSE'))));
  const modelLicense = await readFile(join(site, modelLicensePath));
  assert.equal(hash(modelLicense), modelLicenseSha256);
  assert.deepEqual(modelLicense, await readFile(join(root, 'examples/browser-model-chat/licenses/LFM-Open-License-1.0.txt')));
  assert.match(modelLicense.toString(), /LFM Open License v1\.0/);
  assert.match(modelLicense.toString(), /END OF TERMS/);
  for (const [name, expectedHash] of Object.entries(graphPins)) assert.equal(hash(await readFile(join(site, name))), expectedHash, name);
  assert.equal(manifest.graph.bundleSha256, graphPins['memory/graph-renderer.mjs']);
  assert.equal(manifest.graph.layoutBackend, 'local');
  assert.ok(manifest.source.files.some(file => file.path === 'examples/browser-model-chat/memory/build-graph.mjs'));
  assert.ok(manifest.source.files.some(file => file.path === 'modules/browser-rag-ts/src/application/memoryGraphLayout.ts'));
  assert.ok(manifest.source.files.some(file => file.path === 'examples/browser-model-chat/memory/context-panel.mjs'));
  const notices = await readFile(join(site, 'NOTICE.txt'), 'utf8');
  assert.match(notices, /@wllama\/wllama 3\.5\.1: MIT/);
  assert.match(notices, /@wllama\/wllama-compat 3\.5\.1: MIT/);
  assert.ok(notices.includes(COMPAT.gitHead));
  assert.match(notices, /LFM Open License v1\.0 \(distinct/);
  assert.ok(notices.includes(MODEL.license));
  assert.ok(notices.includes(modelLicensePath));
  assert.match(notices, /weights are not included/);
  assert.match(notices, /used Thursday instead of Tuesday but omitted the codename and city/);
  assert.match(notices, /@ours\/forcegraph-tsl 0\.3\.0-alpha\.1: MIT/);
  assert.match(notices, /Three\.js 0\.185\.0: MIT/);
  const launch = await readFile(join(site, 'README.txt'), 'utf8');
  assert.match(launch, /main wllama 3\.5\.1 runtime requires WebAssembly Memory64/);
  assert.match(launch, /compatibility runtime uses Memory32 and Asyncify/);
  assert.match(launch, /Both runtime profiles require the OPFS API/);
  assert.match(launch, /Writable OPFS is required only for a new remote cache miss/);
  assert.match(launch, /JSPI absence alone is not a loading gate/);
  assert.match(launch, /selected automatically as source-linked exact passages; no special markup is required/);
  assert.match(launch, /Each accepted message creates a canonical Conversation node/);
  assert.match(launch, /Global public Space starters, explicit Persona user excerpts, current Conversation/);
  assert.match(launch, /Generated-assistant text remains labeled and is excluded from retrieved user evidence/);
  assert.match(launch, /https:\/\/science\.nasa\.gov\/earth\/facts\//);
  assert.match(launch, /lossy extractive context, not general semantic summarization/);
  assert.match(launch, /Sources sent at the time, not answer truth/);
  assert.match(launch, /failed unrelated-question abstention and answer-format adherence/);
  assert.match(launch, /omitted the codename and city in a multi-field answer; answer completeness is not guaranteed/);
  assert.match(launch, /Three WebGPU with a WebGL2 backend fallback/);
  assert.match(launch, /Context tab distinguishes latest prepared from last submitted/);
  assert.match(launch, /retained rows report supplied totals and omissions/);
  assert.match(launch, /Scores and reasons appear only when actually supplied/);
  assert.doesNotMatch(launch, /must write|Fact\[key\]/);
  assert.doesNotMatch(JSON.stringify(manifest), /[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\//);
  assert.deepEqual((await stageStatic()).manifest, manifest, 'an intact managed site refreshes deterministically without another output tree');
  const foreign = join(await privateFixture(t), 'extra-content');
  await mkdir(foreign);
  await writeFile(join(foreign, 'site-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(foreign, '.env'), 'PRIVATE-FIXTURE-KEEP');
  await assert.rejects(stageStatic({ output: foreign }), /extra or foreign content/);
  assert.equal(await readFile(join(foreign, '.env'), 'utf8'), 'PRIVATE-FIXTURE-KEEP');
});

test('the sole managed site migrates exact 44-file Context, 43-file compaction, 42-file navigation, 41-file automatic and older previews; partial summary and memory sets are refused', async () => {
  const manifestBytes = await readFile(join(site, 'site-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const retained = new Map();
  for (const name of [...previewAdded, ...helperFiles, 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm']) {
    retained.set(name, await readFile(join(site, name)));
  }
  try {
    for (const { absent, previousCount, kind } of [
      { absent: summaryAdded, previousCount: 44, kind: 'summary' },
      { absent: [...summaryAdded, ...contextAdded], previousCount: 43, kind: 'context' },
      { absent: [...summaryAdded, ...contextAdded, ...compactionAdded], previousCount: 42, kind: 'compaction' },
      { absent: [...summaryAdded, ...contextAdded, ...compactionAdded, ...navigationAdded], previousCount: 41 },
      { absent: [...summaryAdded, ...contextAdded, ...compactionAdded, ...navigationAdded, ...automaticAdded] },
      { absent: [...summaryAdded, ...contextAdded, ...compactionAdded, ...navigationAdded, ...automaticAdded, ...graphAdded] },
      { absent: previewAdded },
      { absent: [...previewAdded, 'wasm-memory.mjs', 'runtime-profile.mjs'] },
      { absent: [...previewAdded, ...helperFiles] },
      { absent: [...previewAdded, ...helperFiles, 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm'] },
    ]) {
      const { identitySha256, ...previous } = structuredClone(manifest);
      previous.files = previous.files.filter(file => !absent.includes(file.path));
      previous.source.files = previous.source.files.filter(file => !absent.some(name => file.path === 'examples/browser-model-chat/' + name));
      previous.source.fingerprintSha256 = hash(JSON.stringify(previous.source.files));
      const previousManifest = { ...previous, identitySha256: hash(JSON.stringify(previous)) };
      if (previousCount !== undefined) assert.equal(previous.files.length, previousCount, 'exact historical preview path table');
      for (const name of absent) await rm(join(site, name));
      await writeFile(join(site, 'site-manifest.json'), JSON.stringify(previousManifest));
      const refreshed = await stageStatic();
      assert.deepEqual(refreshed.manifest, manifest, absent.join(', '));
      for (const name of absent) assert.deepEqual(await readFile(join(site, name)), retained.get(name), name);
      if (kind === 'summary') {
        assert.equal(refreshed.manifest.files.length, 46, 'old 44-file managed site adds exactly the two summary modules');
        for (const [name, exportName] of [['retained-compaction', 'validateRetainedCompaction'], ['summary-effects', 'createSummaryEffects']]) {
          const dependency = await import(pathToFileURL(join(site, 'memory/' + name + '.mjs')).href);
          assert.equal(typeof dependency[exportName], 'function', 'new summary dependency is an executable packaged module');
        }
      }
      if (kind === 'context') {
        assert.equal(refreshed.manifest.files.length, 46, 'old 43-file managed site adds Context and both summary modules');
        const inspectorPath = new URL('./context-panel.mjs', pathToFileURL(join(site, 'memory/panel.mjs')));
        assert.match(await readFile(join(site, 'memory/panel.mjs'), 'utf8'), /from ['"]\.\/context-panel\.mjs['"]/);
        const inspector = await import(inspectorPath.href);
        assert.equal(typeof inspector.createContextInspector, 'function');
        assert.equal(inspector.contextInspectionView({ phase: 'unmeasured', latestPrepared: null, lastSubmitted: null }).record, null,
          'packaged Context dependency imports without inventing request inspection');
      }
      if (kind === 'compaction') {
        const panel = await readFile(join(site, 'memory/panel.mjs'), 'utf8');
        assert.match(panel, /^import \{ createCompactionCue \} from '\.\/compaction-cue\.mjs';/m);
        const cuePath = new URL('./compaction-cue.mjs', pathToFileURL(join(site, 'memory/panel.mjs')));
        assert.equal(cuePath.href, pathToFileURL(join(site, 'memory/compaction-cue.mjs')).href);
        const cue = await import(cuePath.href);
        assert.equal(typeof cue.createCompactionCue, 'function', 'new panel dependency is an executable packaged module');
        assert.equal(cue.createCompactionCue().take([]), null, 'module import creates no fabricated compaction activity');
      }
    }
    for (const missing of [...summaryAdded, 'memory/navigation.mjs', 'memory/automatic-context.mjs']) {
      const { identitySha256, ...partial } = structuredClone(manifest);
      partial.files = partial.files.filter(file => file.path !== missing);
      await rm(join(site, missing));
      await writeFile(join(site, 'site-manifest.json'), JSON.stringify({ ...partial, identitySha256: hash(JSON.stringify(partial)) }));
      await assert.rejects(stageStatic(), /foreign or changed/, 'partial summary or memory subset is not an accepted historical payload: ' + missing);
      await writeFile(join(site, missing), retained.get(missing));
      await writeFile(join(site, 'site-manifest.json'), manifestBytes);
    }
  } finally {
    // Keep the single intended output recoverable even if this regression fails.
    for (const [name, bytes] of retained) await writeFile(join(site, name), bytes);
    await writeFile(join(site, 'site-manifest.json'), manifestBytes);
  }
});

test('hard-linked managed files and manifest are refused while linked read-only runtime inputs remain usable', async t => {
  const fixture = await privateFixture(t);
  const originalManifest = JSON.parse(await readFile(join(site, 'site-manifest.json'), 'utf8'));
  const outside = join(fixture, 'outside.txt');
  const outsideBytes = Buffer.from('Outside linked bytes must remain untouched.\n');
  await writeFile(outside, outsideBytes);
  const output = join(fixture, 'linked-output');
  await mkdir(output);
  const files = [];
  for (const file of originalManifest.files) {
    const target = join(output, file.path);
    await mkdir(dirname(target), { recursive: true });
    const bytes = file.path === 'app.mjs' ? outsideBytes : Buffer.from('x');
    if (file.path === 'app.mjs') await link(outside, target);
    else await writeFile(target, bytes);
    files.push({ path: file.path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const { identitySha256, ...body } = originalManifest;
  body.files = files;
  const manifestBytes = JSON.stringify({ ...body, identitySha256: hash(JSON.stringify(body)) });
  await writeFile(join(output, 'site-manifest.json'), manifestBytes);
  assert.equal((await lstat(join(output, 'app.mjs'))).nlink, 2);
  await assert.rejects(stageStatic({ output }), /hard-linked managed output: app\.mjs/);
  assert.deepEqual(await readFile(outside), outsideBytes);
  assert.equal(await readFile(join(output, 'site-manifest.json'), 'utf8'), manifestBytes);

  const linkedManifestOutput = join(fixture, 'linked-manifest-output');
  await mkdir(linkedManifestOutput);
  const outsideManifest = join(fixture, 'outside-manifest.json');
  await writeFile(outsideManifest, JSON.stringify(originalManifest));
  await link(outsideManifest, join(linkedManifestOutput, 'site-manifest.json'));
  const manifestBefore = await readFile(outsideManifest);
  await assert.rejects(stageStatic({ output: linkedManifestOutput }), /hard-linked managed output: managed site manifest/);
  assert.deepEqual(await readFile(outsideManifest), manifestBefore);

  const runtimeRoot = join(fixture, 'linked-runtime-input');
  await mkdir(runtimeRoot);
  for (const name of Object.keys({ ...RUNTIME.files, ...COMPAT.files })) {
    await mkdir(dirname(join(runtimeRoot, name)), { recursive: true });
    await link(join(preparedRuntime, name), join(runtimeRoot, name));
  }
  assert.ok((await lstat(join(runtimeRoot, 'index.js'))).nlink > 1);
  assert.deepEqual((await stageStatic({ runtimeRoot })).manifest, originalManifest, 'read-only verified runtime inputs may be hard-linked');
});

test('curated output alone serves every module and dynamic import with exact GET/HEAD MIME under a nested prefix', async () => {
  // Node's default test concurrency is sequential: the single staging test above
  // leaves this intended artifact for HTTP checks and operator inspection.
  const server = await listenStatic(site, prefix);
  try {
    const helperHashes = new Map();
    for (const name of [...browserFiles, ...memoryFiles, modelLicensePath]) helperHashes.set(name, hash(await readFile(join(site, name))));
    const expected = [
      ['', 'text/html; charset=utf-8'], ...browserFiles.filter(name => name.endsWith('.mjs')).map(name => [name, 'application/javascript; charset=utf-8']),
      ['style.css', 'text/css; charset=utf-8'], ['theme/aurel-gold.css', 'text/css; charset=utf-8'],
      ['runtime/index.js', 'application/javascript; charset=utf-8'], ['runtime/wllama.wasm', 'application/wasm'],
      ['runtime/compat/wllama.js', 'application/javascript; charset=utf-8'], ['runtime/compat/wllama.wasm', 'application/wasm'],
      ['site-manifest.json', 'application/json; charset=utf-8'],
      ...memoryFiles.map(name => [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8']),
      [modelLicensePath, 'application/octet-stream'],
      ...graphAdded.filter(name => name.startsWith('LICENSES/')).map(name => [name, 'application/octet-stream']),
    ];
    for (const [asset, mime] of expected) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(new URL(asset, server.baseUrl), { method });
        assert.equal(response.status, 200, method + ' ' + asset);
        assert.equal(response.headers.get('content-type'), mime, method + ' ' + asset);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        if (method === 'HEAD') assert.equal((await response.arrayBuffer()).byteLength, 0);
        else {
          const bytes = await response.arrayBuffer();
          if (helperHashes.has(asset)) assert.equal(hash(Buffer.from(bytes)), helperHashes.get(asset), 'nested helper delivery retains exact source bytes: ' + asset);
        }
      }
    }
    const html = await (await fetch(server.baseUrl)).text();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      assert.ok(new URL(match[1], server.baseUrl).pathname.startsWith(prefix), 'HTML asset retains nested prefix: ' + match[1]);
    }
    const dynamicImports = [];
    let dormantWorkerReferences = 0;
    for (const module of [...browserFiles, ...memoryFiles].filter(name => name.endsWith('.mjs'))) {
      const text = await readFile(join(site, module), 'utf8');
      // A quoted "from" argument in the minified renderer is not an import
      // keyword. Valid import/export keywords cannot begin after a quote.
      for (const match of text.matchAll(/(?<!['"`])(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"]\s*,/g)) {
        const target = match[1] || match[2];
        if (/^(?:https?:|data:|node:)/.test(target)) continue;
        if (module === 'memory/graph-renderer.mjs' && target === '../worker/force-worker-entry.js') {
          dormantWorkerReferences++;
          assert.match(await readFile(join(root, 'modules/browser-rag-ts/src/application/graphRenderer.ts'), 'utf8'), /layout: \{ backend: "local", autoStart: false/);
          continue;
        }
        const resolved = new URL(target, new URL(module, server.baseUrl));
        assert.ok(resolved.pathname.startsWith(prefix), 'module asset retains nested prefix: ' + module + ' -> ' + target);
        assert.equal((await fetch(resolved, { method: 'HEAD' })).status, 200, 'module asset exists: ' + target);
        if (/^import\s*\(/.test(match[0])) dynamicImports.push(resolved.pathname.slice(prefix.length));
      }
    }
    assert.deepEqual(dynamicImports.sort(), ['memory/graph-renderer.mjs', 'memory/panel.mjs', 'memory/rag-core.mjs', 'memory/workspace.mjs']);
    assert.equal(dormantWorkerReferences, 1, 'only the exact admitted unused worker branch is exempted');
    const graph = await import(pathToFileURL(join(site, 'memory/graph-renderer.mjs')).href);
    assert.deepEqual(Object.keys(graph).sort(), ['createTslRagGraphRenderer', 'layoutMemoryGraph', 'layoutRagGraph']);
    const previousWorker = globalThis.Worker; let workers = 0;
    globalThis.Worker = class { constructor() { workers++; throw new Error('Local graph layout must not start a Worker.'); } };
    try {
      const positioned = graph.layoutRagGraph({ view: 'evidence', nodes: [{ id: 'fixture', kind: 'source', path: 'fixture', source_id: 'fixture', record_id: null }],
        links: [], total_nodes: 1, total_links: 0, omitted_nodes: 0, omitted_links: 0 });
      assert.equal(positioned.nodes.length, 1); assert.equal(workers, 0);
      const spatial = graph.layoutMemoryGraph({ view: 'evidence', nodes: ['conversation', 'persona', 'global'].map(id => ({ id,
        kind: id === 'global' ? 'source' : 'chunk', path: 'fixture/' + id, source_id: id, record_id: null })),
        links: [], total_nodes: 3, total_links: 0, omitted_nodes: 0, omitted_links: 0 }, [], { aspect: 320 / 568 });
      assert.deepEqual(spatial.nodes.map(node => node.id).sort(), ['conversation', 'global', 'persona']);
      assert.ok(spatial.nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite)));
      assert.ok(new Set(spatial.nodes.map(node => node.z)).size > 1, 'spatial export preserves real force-layout depth');
      assert.equal(workers, 0, 'both admitted layout exports stay local without starting a Worker');
    } finally { if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker; }
    for (const missing of ['missing.mjs', 'missing.js', 'missing.wasm', 'serve.mjs', 'prepare-runtime.mjs', 'stage-static.mjs',
      'tests/loader-controller.test.mjs', '.git/config', '.env', 'runtime/private.txt', 'runtime/compat/private.js', MODEL.file, 'cache/model.gguf',
      'memory/PRIVATE_LOCAL_ONLY', 'memory/README.md', 'memory/PREVIEW_READINESS.md', 'memory/build-core.mjs', 'memory/build-graph.mjs', 'memory/serve-local.mjs',
      'memory/context-inspection.json', 'memory/context-panel.mjs.map',
      'worker/force-worker-entry.js',
      'memory-proof/runtime-probe.mjs', 'examples/browser-model-chat/licenses/LFM-Open-License-1.0.txt', '.artifacts/proof/local-memory/receipt.json',
      'agent-workspace/source/workspace.html', 'modules/browser-rag-ts/src/core/index.ts']) {
      const response = await fetch(new URL(missing, server.baseUrl));
      assert.equal(response.status, 404, missing);
      assert.ok(!(response.headers.get('content-type') || '').startsWith('text/html'), missing + ' has no HTML fallback');
    }
    const outside = await fetch(new URL('/runtime/index.js', server.baseUrl));
    assert.equal(outside.status, 404, 'root route cannot mask a broken subpath reference');
  } finally { server.server.closeIdleConnections(); await server.close(); }
});
