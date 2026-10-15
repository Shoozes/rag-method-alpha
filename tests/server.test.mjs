import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseCliPort, startServer } from '../examples/browser-model-chat/serve.mjs';

const temporaryPrefix = 'rag-preview-server-test-';
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const themePath = path.join(repositoryRoot, 'modules', 'browser-rag-ts', 'demo', 'aurel-gold.css');

function normalizedPath(value) {
  const absolute = path.resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function removeOwnFixture(directory) {
  const absolute = path.resolve(directory);
  assert.equal(normalizedPath(path.dirname(absolute)), normalizedPath(os.tmpdir()), 'cleanup stays directly inside the temporary directory');
  assert.ok(path.basename(absolute).startsWith(temporaryPrefix), 'cleanup targets only this test fixture prefix');
  await rm(absolute, { recursive: true, force: true });
}

// Pass the request target directly: URL/fetch clients normalize dot segments before
// transmission and would hide traversal handling defects in the server.
function request(url, requestPath, method = 'GET') {
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: requestPath,
      method,
    }, (response) => {
      const chunks = [];
      const remoteAddress = response.socket.remoteAddress;
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
        remoteAddress,
      }));
    });
    outgoing.setTimeout(5_000, () => outgoing.destroy(new Error('preview HTTP request timed out')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function assertType(response, expected) {
  assert.equal(String(response.headers['content-type']).toLowerCase().replace(/\s+/g, ''), expected);
}

function assertBlocked(response, label) {
  assert.equal(response.status, 404, `${label} is refused`);
  assert.ok(!response.body.includes(Buffer.from('OUTSIDE-SECRET')), `${label} does not disclose escaped bytes`);
  assert.ok(!response.body.includes(Buffer.from('DOTFILE-SECRET')), `${label} does not disclose dotfile bytes`);
}

test('CLI port parsing uses a stable default and validates overrides before listening', () => {
  assert.equal(parseCliPort([]), 5187);
  for (const port of [0, 1, 5187, 8192, 65535]) {
    assert.equal(parseCliPort(['--port', String(port)]), port);
  }
  for (const args of [
    ['--unknown'],
    ['--port', '8192', '--unknown'],
    ['--port'],
    ['--port', ''],
    ['--port', '1.5'],
    ['--port', 'not-a-number'],
    ['--port', '-1'],
    ['--port', '65536'],
  ]) {
    assert.throws(() => parseCliPort(args), `rejects ${JSON.stringify(args)}`);
  }
});

test('browser model preview serves only its bounded HTTP file surface', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  let server;
  t.after(async () => {
    try {
      if (server) await server.close();
    } finally {
      await removeOwnFixture(directory);
    }
  });

  const root = path.join(directory, 'public');
  const runtimeRoot = path.join(directory, 'runtime');
  const outside = path.join(directory, 'outside');
  await Promise.all([root, runtimeRoot, outside, path.join(root, 'theme'), path.join(root, '.git')].map((entry) => mkdir(entry, { recursive: true })));

  const html = '<!doctype html><title>Fixture preview</title><p>PREVIEW-INDEX</p>';
  const moduleSource = 'export const fixtureModule = "real-mjs";\n';
  const scriptSource = 'globalThis.fixtureScript = "real-js";\n';
  const runtimeSource = 'export const runtimeFixture = true;\n';
  const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const license = 'Runtime fixture license text\n';
  await Promise.all([
    writeFile(path.join(root, 'index.html'), html),
    writeFile(path.join(root, 'tiny.mjs'), moduleSource),
    writeFile(path.join(root, 'tiny.js'), scriptSource),
    writeFile(path.join(root, 'style.css'), 'body { color: teal; }\n'),
    writeFile(path.join(root, 'payload.unlisted'), 'non-executable fixture\n'),
    writeFile(path.join(root, '.env'), 'DOTFILE-SECRET'),
    writeFile(path.join(root, '.git', 'config'), 'DOTFILE-SECRET'),
    writeFile(path.join(root, 'theme', 'aurel-gold.css'), 'ROOT-THEME-OVERRIDE-MUST-NOT-APPEAR'),
    writeFile(path.join(outside, 'secret.js'), 'OUTSIDE-SECRET'),
    writeFile(path.join(runtimeRoot, 'index.js'), runtimeSource),
    writeFile(path.join(runtimeRoot, 'wllama.wasm'), wasm),
    writeFile(path.join(runtimeRoot, 'LICENSE'), license),
    writeFile(path.join(runtimeRoot, 'extra.js'), 'RUNTIME-EXTRA-MUST-NOT-APPEAR'),
  ]);

  server = await startServer({ port: 0, root, runtimeRoot });

  await t.test('binds the returned preview endpoint to IPv4 loopback', async () => {
    assert.equal(new URL(server.url).hostname, '127.0.0.1');
    assert.equal(server.address.address, '127.0.0.1');
    assert.ok(server.address.port > 0);
    const response = await request(server.url, '/');
    assert.equal(response.remoteAddress, '127.0.0.1');
    assert.equal(response.status, 200);
    assertType(response, 'text/html;charset=utf-8');
    assert.equal(response.body.toString(), html);
  });

  await t.test('serves actual .mjs and .js files with an executable JavaScript MIME type', async () => {
    for (const [route, body] of [['/tiny.mjs', moduleSource], ['/tiny.js', scriptSource]]) {
      const response = await request(server.url, route);
      assert.equal(response.status, 200, route);
      assertType(response, 'application/javascript;charset=utf-8');
      assert.equal(response.body.toString(), body, route);
    }
  });

  await t.test('serves CSS and unknown file extensions with distinct safe MIME types', async () => {
    const css = await request(server.url, '/style.css');
    assert.equal(css.status, 200);
    assertType(css, 'text/css;charset=utf-8');
    const unknown = await request(server.url, '/payload.unlisted');
    assert.equal(unknown.status, 200);
    assertType(unknown, 'application/octet-stream');
    assert.equal(unknown.body.toString(), 'non-executable fixture\n');
  });

  await t.test('mounts the fixed repository theme rather than the custom-root lookalike', async () => {
    const response = await request(server.url, '/theme/aurel-gold.css');
    assert.equal(response.status, 200);
    assertType(response, 'text/css;charset=utf-8');
    assert.deepEqual(response.body, await readFile(themePath));
  });

  await t.test('allows exactly the three runtime artifacts and preserves WebAssembly MIME', async () => {
    const js = await request(server.url, '/runtime/index.js');
    assert.equal(js.status, 200);
    assertType(js, 'application/javascript;charset=utf-8');
    assert.equal(js.body.toString(), runtimeSource);
    const binary = await request(server.url, '/runtime/wllama.wasm');
    assert.equal(binary.status, 200);
    assertType(binary, 'application/wasm');
    assert.deepEqual(binary.body, wasm);
    const notice = await request(server.url, '/runtime/LICENSE');
    assert.equal(notice.status, 200);
    assert.equal(notice.body.toString(), license);
    for (const route of ['/runtime/extra.js', '/runtime/', '/runtime/index.js/extra', '/runtime/%65xtra.js']) {
      const response = await request(server.url, route);
      assertBlocked(response, route);
      assert.ok(!response.body.includes(Buffer.from('RUNTIME-EXTRA-MUST-NOT-APPEAR')));
    }
  });

  await t.test('returns 404 for missing files without a single-page-app fallback', async () => {
    for (const route of ['/missing.mjs', '/missing/page', '/theme/missing.css', '/runtime/missing.wasm']) {
      const response = await request(server.url, route);
      assert.equal(response.status, 404, route);
      assert.ok(!response.body.includes(Buffer.from('PREVIEW-INDEX')), route);
    }
  });

  await t.test('refuses raw and encoded traversal and dotfile request targets', async () => {
    for (const route of [
      '/../outside/secret.js',
      '/%2e%2e/outside/secret.js',
      '/..%2foutside%2fsecret.js',
      '/%2e%2e%5coutside%5csecret.js',
      '/.env',
      '/%2eenv',
      '/.git/config',
      '/%2egit/config',
      '/nested/%2e%2e/.env',
      '/runtime/%2e%2e/.env',
    ]) {
      assertBlocked(await request(server.url, route), route);
    }
  });

  await t.test('refuses a directory symlink or Windows junction escaping the document root', async (symlinkTest) => {
    try {
      await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        symlinkTest.skip(`Platform cannot create the fixture directory link (${error.code})`);
        return;
      }
      throw error;
    }
    assertBlocked(await request(server.url, '/escape/secret.js'), 'directory link escape');
  });

  await t.test('starts without installed runtime assets and reports them as missing', async () => {
    const withoutRuntime = await startServer({ port: 0, root, runtimeRoot: path.join(directory, 'absent-runtime') });
    try {
      assert.equal((await request(withoutRuntime.url, '/')).status, 200);
      assert.equal((await request(withoutRuntime.url, '/runtime/index.js')).status, 404);
      assert.equal((await request(withoutRuntime.url, '/runtime/wllama.wasm')).status, 404);
    } finally {
      await withoutRuntime.close();
    }
  });
});
