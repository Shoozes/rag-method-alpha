import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assertCaptureSource } from '../../../../scripts/capture_source.mjs';
import { resolveBuildSource } from '../../../../scripts/public-source.mjs';
import { artifactIdentity, sha256Bytes, STATIC_ARTIFACT_SCHEMA } from '../../scripts/static-artifact-common.mjs';

test('capture rejects stale source and changed payload without promoting media', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rag-capture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, '.artifacts/site');
  await writeFile(join(root, 'source.txt'), 'current source');
  const source = resolveBuildSource(root);
  const artifact = { name: 'rag-method-documentation-vault-showcase', version: '0.1.0', subpath: '/rag-method/', entrypoint: 'index.html' };
  const dependencies = { '@ours/forcegraph-tsl': { version: '0.3.0-alpha.1' }, three: { version: '0.185.0' } };
  const files = [], notices = [];
  for (const [id, version, path] of [
    ['rag-method', '0.1.0', 'LICENSES/rag-method.txt'],
    ['@ours/forcegraph-tsl', '0.3.0-alpha.1', 'LICENSES/forcegraph-tsl.txt'],
    ['three', '0.185.0', 'LICENSES/three.txt'],
    ['', '', 'LICENSES/NOTICE.txt'], ['', '', 'index.html'],
  ]) {
    const bytes = Buffer.from(`Test fixture: ${path}`);
    await mkdir(dirname(join(site, path)), { recursive: true });
    await writeFile(join(site, path), bytes);
    const sha256 = sha256Bytes(bytes);
    files.push({ path, bytes: bytes.length, sha256 });
    if (id) notices.push({ id, package_name: id === 'rag-method' ? '@rag-method/browser-rag-ts' : id, version, license: 'MIT', path, sha256 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const input = { artifact, source, dependencies, files, notices, launch: { unknown_paths: '404' }, exclusions: { repository_source: true } };
  await writeFile(join(site, 'artifact-manifest.json'), JSON.stringify({ schema: STATIC_ARTIFACT_SCHEMA, ...input, artifact: { ...artifact, identity_sha256: artifactIdentity(input) } }));
  assert.equal((await assertCaptureSource(root, site)).fingerprint_sha256, source.fingerprint_sha256);
  await writeFile(join(root, 'source.txt'), 'modified source');
  await assert.rejects(assertCaptureSource(root, site), /capture source differs/u);
  await writeFile(join(root, 'source.txt'), 'current source');
  await writeFile(join(site, 'index.html'), 'modified payload');
  await assert.rejects(assertCaptureSource(root, site), /file inventory or hash differs/u);
});
