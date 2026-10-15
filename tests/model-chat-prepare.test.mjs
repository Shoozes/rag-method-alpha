import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { COMPAT, RUNTIME } from '../examples/browser-model-chat/model-contract.mjs';
import { parseSetupArgs, prepareRuntime, verifiedRuntimeFiles } from '../examples/browser-model-chat/prepare-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = join(root, '.artifacts/model-chat/runtime');
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rag-runtime-prepare-test-'));
  t.after(async () => {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('rag-runtime-prepare-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function archive(entries) {
  const blocks = [];
  for (const { name, bytes, type = 48 } of entries) {
    const header = Buffer.alloc(512);
    header.write(name); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header[156] = type;
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('setup accepts explicit fetch or exact main/compat archives and rejects ambiguity', () => {
  assert.deepEqual(parseSetupArgs(['--fetch']), { archives: {}, fetchMissing: true });
  assert.deepEqual(parseSetupArgs(['--archive', 'main.tgz', '--compat-archive', 'compat.tgz']), { archives: { main: 'main.tgz', compat: 'compat.tgz' } });
  assert.deepEqual(parseSetupArgs(['--compat-archive', 'compat.tgz']), { archives: { compat: 'compat.tgz' } });
  for (const args of [[], ['--fetch', '--fetch'], ['--fetch', '--archive', 'x'], ['--archive'], ['--compat-archive'], ['--archive', 'x', '--archive', 'y'], ['--unknown']]) {
    assert.throws(() => parseSetupArgs(args));
  }
});

test('archive verification selects pinned ordinary bytes and rejects bad integrity, content, links and duplicates', () => {
  const bytes = Buffer.from('small fixture only'), entry = 'package/wasm/fixture.wasm';
  const good = archive([{ name: entry, bytes }, { name: 'package/install.js', bytes: Buffer.from('must never execute') }]);
  const contract = { integrity: hash(good, 'sha512', 'base64'), files: { 'compat/fixture.wasm': { entry, bytes: bytes.length, sha256: hash(bytes) } } };
  assert.deepEqual([...verifiedRuntimeFiles(good, contract)], [['compat/fixture.wasm', bytes]]);
  assert.throws(() => verifiedRuntimeFiles(Buffer.from('bad archive'), contract), /integrity mismatch/);
  assert.throws(() => verifiedRuntimeFiles(good, { ...contract, files: { 'compat/fixture.wasm': { entry, sha256: '0'.repeat(64) } } }), /file mismatch/);
  for (const entries of [[{ name: entry, bytes, type: 50 }], [{ name: entry, bytes }, { name: entry, bytes }], []]) {
    const bad = archive(entries);
    assert.throws(() => verifiedRuntimeFiles(bad, { ...contract, integrity: hash(bad, 'sha512', 'base64') }), /ordinary|Duplicate|Incomplete/);
  }
});

test('bad explicit archive fails before output writes and retained mismatches are never overwritten', async t => {
  const directory = await fixture(t), badArchive = join(directory, 'bad.tgz'), output = join(directory, 'missing-output');
  await writeFile(badArchive, 'not an authenticated archive');
  await assert.rejects(prepareRuntime({ output, archives: { main: badArchive } }), /integrity mismatch/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  await mkdir(output);
  await writeFile(join(output, 'index.js'), 'retained wrong fixture');
  let fetches = 0;
  await assert.rejects(prepareRuntime({ output, fetchMissing: true, fetchImpl() { fetches++; throw new Error('must not fetch'); } }), /Retained runtime SHA-256 mismatch/);
  assert.equal(fetches, 0);
  assert.equal(await readFile(join(output, 'index.js'), 'utf8'), 'retained wrong fixture');
  assert.deepEqual(await readdir(output), ['index.js']);
});

test('verified retained profiles skip all fetches and writes, including explicit --fetch', async t => {
  const identities = { ...RUNTIME.files, ...COMPAT.files }, before = new Map();
  for (const [name, identity] of Object.entries(identities)) {
    const path = join(runtimeRoot, name), bytes = await readFile(path);
    assert.equal(hash(bytes), identity.sha256, name);
    before.set(name, (await lstat(path)).mtimeMs);
  }
  let fetches = 0;
  const result = await prepareRuntime({ fetchMissing: true, fetchImpl() { fetches++; throw new Error('retained assets must not be fetched'); } });
  assert.equal(fetches, 0); assert.equal(result.filesWritten, 0); assert.equal(result.modelsDownloaded, 0);
  assert.deepEqual(result.profiles.map(item => item.prepared), [[], []]);
  assert.equal(result.profiles.flatMap(item => item.retained).length, 5);
  const directory = await fixture(t), bad = join(directory, 'compat-bad.tgz');
  await writeFile(bad, 'bad explicit compatibility archive');
  await assert.rejects(prepareRuntime({ archives: { compat: bad } }), /integrity mismatch/);
  for (const name of Object.keys(identities)) assert.equal((await lstat(join(runtimeRoot, name))).mtimeMs, before.get(name), name + ' retained without rewriting');
});
