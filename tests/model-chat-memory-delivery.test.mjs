import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const prefix = 'rag-memory-delivery-';
const coreSource = 'export const memoryDeliveryFixture = "bounded-local-core";\n';
const graphSource = 'export const graphDeliveryFixture = "bounded-local-graph";\n';
const wasmBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const root = join(directory, 'example');
  const runtimeRoot = join(directory, 'runtime');
  const memoryCoreRoot = join(directory, 'generated');
  const outside = join(directory, 'outside');
  const servers = [];
  t.after(async () => {
    try { for (const server of servers) await server.close(); }
    finally {
      assert.equal(normalize(dirname(directory)), normalize(tmpdir()), 'cleanup stays directly within Temp');
      assert.ok(basename(directory).startsWith(prefix), 'cleanup targets this test fixture only');
      await rm(directory, { recursive: true, force: true });
    }
  });
  await Promise.all([root, runtimeRoot, memoryCoreRoot, outside, join(root, 'memory')].map(path => mkdir(path, { recursive: true })));
  await Promise.all([
    writeFile(join(root, 'index.html'), '<!doctype html><title>Local memory fixture</title>'),
    writeFile(join(root, 'ordinary.mjs'), 'export const ordinary = true;\n'),
    writeFile(join(root, 'payload.unlisted'), 'A non-executable fixture.'),
    writeFile(join(root, 'memory', 'rag-core.mjs'), 'ROOT-LOOKALIKE-MUST-NOT-APPEAR'),
    writeFile(join(root, 'memory', 'graph-renderer.mjs'), 'ROOT-LOOKALIKE-MUST-NOT-APPEAR'),
    writeFile(join(root, 'memory', 'citations.mjs'), 'export const historicalCitationFixture = true;\n'),
    writeFile(join(runtimeRoot, 'wllama.wasm'), wasmBytes),
    writeFile(join(memoryCoreRoot, 'rag-core.mjs'), coreSource),
    writeFile(join(memoryCoreRoot, 'graph-renderer.mjs'), graphSource),
    writeFile(join(memoryCoreRoot, 'private.mjs'), 'GENERATED-EXTRA-MUST-NOT-APPEAR'),
    writeFile(join(outside, 'rag-core.mjs'), 'OUTSIDE-SECRET-MUST-NOT-APPEAR'),
  ]);
  const start = async options => {
    const server = await startServer({ port: 0, root, runtimeRoot, ...options });
    servers.push(server);
    return server;
  };
  return { directory, root, runtimeRoot, memoryCoreRoot, outside, start };
}

// Raw targets matter: URL and fetch normalize dot segments before transmission.
function request(base, path, method = 'GET') {
  const endpoint = new URL(base);
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = http.request({ hostname: endpoint.hostname, port: endpoint.port, path, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', rejectRequest);
      response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Memory delivery HTTP request timed out.')));
    outgoing.on('error', rejectRequest);
    outgoing.end();
  });
}

function blocked(response, path) {
  assert.equal(response.status, 404, path);
  assert.ok(!response.body.includes(Buffer.from('OUTSIDE-SECRET')), path + ' does not expose escaped bytes');
  assert.ok(!response.body.includes(Buffer.from('ROOT-LOOKALIKE')), path + ' does not fall back to the example lookalike');
  assert.ok(!response.body.includes(Buffer.from('GENERATED-EXTRA')), path + ' does not expose other generated files');
}

test('the explicit memory core mount serves real GET/HEAD JavaScript and preserves other MIME boundaries', async t => {
  const files = await fixture(t);
  const server = await files.start({ memoryCoreRoot: files.memoryCoreRoot });
  for (const method of ['GET', 'HEAD']) {
    const response = await request(server.url, '/memory/rag-core.mjs', method);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(coreSource));
    assert.equal(response.body.toString(), method === 'GET' ? coreSource : '');
  }
  const ordinary = await request(server.url, '/ordinary.mjs');
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers['content-type'], 'application/javascript; charset=utf-8');
  for (const method of ['GET', 'HEAD']) {
    const citations = await request(server.url, '/memory/citations.mjs', method);
    assert.equal(citations.status, 200);
    assert.equal(citations.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(citations.body.toString(), method === 'GET' ? 'export const historicalCitationFixture = true;\n' : '');
  }
  const wasm = await request(server.url, '/runtime/wllama.wasm');
  assert.equal(wasm.status, 200); assert.equal(wasm.headers['content-type'], 'application/wasm');
  assert.deepEqual(wasm.body, wasmBytes);
  const unknown = await request(server.url, '/payload.unlisted');
  assert.equal(unknown.status, 200); assert.equal(unknown.headers['content-type'], 'application/octet-stream');
});

test('the memory core mount is disabled by default, including example-root lookalikes', async t => {
  const files = await fixture(t);
  const server = await files.start({});
  for (const path of ['/memory/rag-core.mjs', '/memory/rag-core.mjs?cache=1']) blocked(await request(server.url, path), path);
});

test('the graph mount is independently explicit with exact GET/HEAD JavaScript and no missing-file fallback', async t => {
  const files = await fixture(t);
  const disabled = await files.start({ memoryCoreRoot: files.memoryCoreRoot });
  blocked(await request(disabled.url, '/memory/graph-renderer.mjs'), 'core mount cannot enable graph');
  const enabled = await files.start({ memoryGraphRoot: files.memoryCoreRoot });
  blocked(await request(enabled.url, '/memory/rag-core.mjs'), 'graph mount cannot enable core');
  for (const method of ['GET', 'HEAD']) {
    const response = await request(enabled.url, '/memory/graph-renderer.mjs?cache=1', method);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(graphSource));
    assert.equal(response.body.toString(), method === 'GET' ? graphSource : '');
  }
  for (const path of ['/memory/graph-renderer.mjs.map', '/memory/graph-renderer.mjs/missing', '/memory/private.mjs']) {
    blocked(await request(enabled.url, path), path);
  }
  await rm(join(files.memoryCoreRoot, 'graph-renderer.mjs'));
  blocked(await request(enabled.url, '/memory/graph-renderer.mjs'), 'missing generated graph');
});

test('the generated graph mount refuses canonical-root escape', async t => {
  const files = await fixture(t), path = join(files.memoryCoreRoot, 'graph-renderer.mjs');
  await rm(path);
  try { await symlink(join(files.outside, 'rag-core.mjs'), path, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    await symlink(files.outside, path, 'junction');
  }
  const server = await files.start({ memoryGraphRoot: files.memoryCoreRoot });
  blocked(await request(server.url, '/memory/graph-renderer.mjs'), 'generated graph escape');
});

test('only the generated core filename is mounted and missing files never fall back to the example root', async t => {
  const files = await fixture(t);
  const server = await files.start({ memoryCoreRoot: files.memoryCoreRoot });
  for (const path of ['/memory/private.mjs', '/memory/missing.mjs', '/memory/rag-core.mjs/missing', '/memory/rag-core.mjs.map']) {
    blocked(await request(server.url, path), path);
  }
  await rm(join(files.memoryCoreRoot, 'rag-core.mjs'));
  blocked(await request(server.url, '/memory/rag-core.mjs'), 'missing generated core');
});

test('raw, encoded, malformed and double-encoded traversal requests are refused', async t => {
  const files = await fixture(t);
  const server = await files.start({ memoryCoreRoot: files.memoryCoreRoot });
  for (const path of [
    '/memory/../rag-core.mjs', '/memory/./rag-core.mjs', '/memory/%2e%2e/outside/rag-core.mjs',
    '/memory/%2e/rag-core.mjs', '/memory/%252e%252e/outside/rag-core.mjs',
    '/memory%2f..%2foutside%2frag-core.mjs', '/memory/%5c..%5coutside%5crag-core.mjs',
    '/memory/rag-core.mjs%00', '/memory/%', '//memory/rag-core.mjs',
  ]) blocked(await request(server.url, path), path);
});

test('a generated core symlink cannot escape its selected root', async t => {
  const files = await fixture(t);
  const core = join(files.memoryCoreRoot, 'rag-core.mjs');
  await rm(core);
  try { await symlink(join(files.outside, 'rag-core.mjs'), core, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    // Windows file-symlink privilege is optional; a directory junction still
    // exercises canonical-root escape refusal rather than lexical containment.
    await symlink(files.outside, core, 'junction');
    t.diagnostic('File symlink unavailable; canonical-root escape exercised with a Windows directory junction.');
  }
  assert.ok((await lstat(core)).isSymbolicLink());
  const server = await files.start({ memoryCoreRoot: files.memoryCoreRoot });
  blocked(await request(server.url, '/memory/rag-core.mjs'), 'generated symlink escape');
  assert.equal(await readFile(join(files.outside, 'rag-core.mjs'), 'utf8'), 'OUTSIDE-SECRET-MUST-NOT-APPEAR');
});

test('an isolated private marker refuses static staging before runtime validation or output creation', async t => {
  const files = await fixture(t);
  const fixtureRoot = join(files.directory, 'guard-source');
  const fixtureExample = join(fixtureRoot, 'examples/browser-model-chat');
  await mkdir(join(fixtureExample, 'memory'), { recursive: true });
  const sourceExample = fileURLToPath(new URL('../examples/browser-model-chat/', import.meta.url));
  for (const name of ['stage-static.mjs', 'model-contract.mjs']) {
    await copyFile(join(sourceExample, name), join(fixtureExample, name));
  }
  await writeFile(join(fixtureExample, 'memory/PRIVATE_LOCAL_ONLY'), 'Isolated test fixture only.\n');
  const { stageStatic } = await import(pathToFileURL(join(fixtureExample, 'stage-static.mjs')).href);
  const output = join(fixtureRoot, 'must-not-stage');
  await assert.rejects(stageStatic({ output, runtimeRoot: join(files.directory, 'missing-runtime') }), {
    message: 'Private memory preview is local only',
  });
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});
