import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stageStatic } from '../examples/browser-model-chat/stage-static.mjs';
import { COMPAT, MODEL, RUNTIME } from '../examples/browser-model-chat/model-contract.mjs';
import { listenStatic } from '../modules/browser-rag-ts/scripts/static-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, '.artifacts/model-chat');
const site = join(artifacts, 'site');
const prefix = '/prefix/model-chat/';
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const browserFiles = ['index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'capabilities.mjs', 'bootstrap.mjs'];

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

test('one retained-runtime site has an exact hashed allowlist, notices, unreviewed identity and safe refresh', async t => {
  // The intended delivery site is the sole delivery output. No second runtime tree
  // or model is created; failure cases above use only a few fixture bytes.
  const staged = await stageStatic();
  assert.equal(staged.output, site);
  const manifest = JSON.parse(await readFile(join(site, 'site-manifest.json'), 'utf8'));
  const { identitySha256, ...body } = manifest;
  assert.equal(identitySha256, hash(JSON.stringify(body)));
  assert.equal(manifest.publicReleaseQualified, false);
  assert.equal(manifest.source.reviewStatus, 'unreviewed');
  assert.ok(manifest.source.head === null || /^[0-9a-f]{40}$/.test(manifest.source.head));
  assert.ok(manifest.source.dirty === null || typeof manifest.source.dirty === 'boolean');
  assert.equal(manifest.source.fingerprintSha256, hash(JSON.stringify(manifest.source.files)));
  assert.equal(manifest.model.weightsIncluded, false);
  assert.equal(manifest.model.sha256, MODEL.sha256);
  assert.equal(manifest.model.licenseUrl, MODEL.license);
  const expected = [...browserFiles, 'theme/aurel-gold.css', 'runtime/index.js', 'runtime/wllama.wasm',
    'runtime/LICENSE', 'runtime/compat/wllama.js', 'runtime/compat/wllama.wasm', 'LICENSES/rag-method.txt', 'NOTICE.txt', 'README.txt'].sort();
  assert.deepEqual(manifest.files.map(file => file.path).sort(), expected);
  for (const file of manifest.files) {
    const bytes = await readFile(join(site, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
    assert.ok(!file.path.includes('..') && !file.path.startsWith('/'));
  }
  for (const [name, contract] of Object.entries({ ...RUNTIME.files, ...COMPAT.files })) {
    assert.equal(hash(await readFile(join(site, 'runtime', name))), contract.sha256, 'retained runtime: ' + name);
  }
  const helperPath = 'runtime-errors.mjs';
  const helperSource = await readFile(join(root, 'examples/browser-model-chat', helperPath));
  const helperManifest = manifest.files.find(file => file.path === helperPath);
  assert.equal(helperManifest.bytes, helperSource.length);
  assert.equal(helperManifest.sha256, hash(helperSource));
  assert.deepEqual(await readFile(join(site, helperPath)), helperSource);
  assert.equal(hash(await readFile(join(site, 'theme/aurel-gold.css'))), hash(await readFile(join(root, 'modules/browser-rag-ts/demo/aurel-gold.css'))));
  assert.equal(hash(await readFile(join(site, 'LICENSES/rag-method.txt'))), hash(await readFile(join(root, 'LICENSE'))));
  const notices = await readFile(join(site, 'NOTICE.txt'), 'utf8');
  assert.match(notices, /@wllama\/wllama 3\.5\.1: MIT/);
  assert.match(notices, /@wllama\/wllama-compat 3\.5\.1: MIT/);
  assert.ok(notices.includes(COMPAT.gitHead));
  assert.match(notices, /LFM Open License v1\.0 \(distinct/);
  assert.ok(notices.includes(MODEL.license));
  assert.match(notices, /weights are not included/);
  const launch = await readFile(join(site, 'README.txt'), 'utf8');
  assert.match(launch, /main wllama 3\.5\.1 runtime requires WebAssembly Memory64/);
  assert.match(launch, /compatibility runtime uses Memory32 and Asyncify/);
  assert.match(launch, /Both runtime profiles require the OPFS API/);
  assert.match(launch, /Writable OPFS is required only for a new remote cache miss/);
  assert.match(launch, /JSPI absence alone is not a loading gate/);
  assert.doesNotMatch(JSON.stringify(manifest), /[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\//);
  assert.deepEqual((await stageStatic()).manifest, manifest, 'an intact managed site refreshes deterministically without another output tree');
  const foreign = join(await privateFixture(t), 'extra-content');
  await mkdir(foreign);
  await writeFile(join(foreign, 'site-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(foreign, '.env'), 'PRIVATE-FIXTURE-KEEP');
  await assert.rejects(stageStatic({ output: foreign }), /extra or foreign content/);
  assert.equal(await readFile(join(foreign, '.env'), 'utf8'), 'PRIVATE-FIXTURE-KEEP');
});

test('the sole managed site refreshes an exact previous payload without the new helper', async () => {
  const manifestBytes = await readFile(join(site, 'site-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const helper = await readFile(join(site, 'runtime-errors.mjs'));
  const { identitySha256, ...previous } = structuredClone(manifest);
  previous.files = previous.files.filter(file => file.path !== 'runtime-errors.mjs');
  previous.source.files = previous.source.files.filter(file => file.path !== 'examples/browser-model-chat/runtime-errors.mjs');
  previous.source.fingerprintSha256 = hash(JSON.stringify(previous.source.files));
  const previousManifest = { ...previous, identitySha256: hash(JSON.stringify(previous)) };
  await rm(join(site, 'runtime-errors.mjs'));
  await writeFile(join(site, 'site-manifest.json'), JSON.stringify(previousManifest));
  try {
    const refreshed = await stageStatic();
    assert.deepEqual(refreshed.manifest, manifest);
    assert.deepEqual(await readFile(join(site, 'runtime-errors.mjs')), helper);
  } finally {
    // Keep the single intended output recoverable even if this regression fails.
    await writeFile(join(site, 'runtime-errors.mjs'), helper);
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
    await link(join(artifacts, 'runtime', name), join(runtimeRoot, name));
  }
  assert.ok((await lstat(join(runtimeRoot, 'index.js'))).nlink > 1);
  assert.deepEqual((await stageStatic({ runtimeRoot })).manifest, originalManifest, 'read-only verified runtime inputs may be hard-linked');
});

test('staged modules, Worker, theme and WASM serve with correct GET/HEAD MIME under a nested prefix', async () => {
  // Node's default test concurrency is sequential: the single staging test above
  // leaves this intended artifact for HTTP checks and operator inspection.
  const server = await listenStatic(site, prefix);
  try {
    const helperSha256 = hash(await readFile(join(site, 'runtime-errors.mjs')));
    const expected = [
      ['', 'text/html; charset=utf-8'], ...browserFiles.filter(name => name.endsWith('.mjs')).map(name => [name, 'application/javascript; charset=utf-8']),
      ['style.css', 'text/css; charset=utf-8'], ['theme/aurel-gold.css', 'text/css; charset=utf-8'],
      ['runtime/index.js', 'application/javascript; charset=utf-8'], ['runtime/wllama.wasm', 'application/wasm'],
      ['runtime/compat/wllama.js', 'application/javascript; charset=utf-8'], ['runtime/compat/wllama.wasm', 'application/wasm'],
      ['site-manifest.json', 'application/json; charset=utf-8'],
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
          if (asset === 'runtime-errors.mjs') assert.equal(hash(Buffer.from(bytes)), helperSha256, 'nested helper delivery retains exact source bytes');
        }
      }
    }
    const html = await (await fetch(server.baseUrl)).text();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      assert.ok(new URL(match[1], server.baseUrl).pathname.startsWith(prefix), 'HTML asset retains nested prefix: ' + match[1]);
    }
    for (const module of browserFiles.filter(name => name.endsWith('.mjs'))) {
      const text = await readFile(join(site, module), 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"]\s*,/g)) {
        const target = match[1] || match[2];
        if (/^(?:https?:|data:|node:)/.test(target)) continue;
        const resolved = new URL(target, new URL(module, server.baseUrl));
        assert.ok(resolved.pathname.startsWith(prefix), 'module asset retains nested prefix: ' + module + ' -> ' + target);
        assert.equal((await fetch(resolved, { method: 'HEAD' })).status, 200, 'module asset exists: ' + target);
      }
    }
    for (const missing of ['missing.mjs', 'missing.js', 'missing.wasm', 'serve.mjs', 'prepare-runtime.mjs', 'stage-static.mjs',
      'tests/loader-controller.test.mjs', '.git/config', '.env', 'runtime/private.txt', 'runtime/compat/private.js', MODEL.file, 'cache/model.gguf']) {
      const response = await fetch(new URL(missing, server.baseUrl));
      assert.equal(response.status, 404, missing);
      assert.ok(!(response.headers.get('content-type') || '').startsWith('text/html'), missing + ' has no HTML fallback');
    }
    const outside = await fetch(new URL('/runtime/index.js', server.baseUrl));
    assert.equal(outside.status, 404, 'root route cannot mask a broken subpath reference');
  } finally { server.server.closeIdleConnections(); await server.close(); }
});
