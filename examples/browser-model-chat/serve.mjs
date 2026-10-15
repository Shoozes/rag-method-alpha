import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_MIME } from '../../modules/browser-rag-ts/scripts/static-server.mjs';

const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(exampleDirectory, '../..');
const themeDirectory = join(repositoryDirectory, 'modules/browser-rag-ts/demo');
const runtimeFiles = new Set(['index.js', 'wllama.wasm', 'LICENSE', 'compat/wllama.js', 'compat/wllama.wasm']);

// Keep the CLI origin stable for browser-local model cache; callers/tests can still use port zero.
export function parseCliPort(args = process.argv.slice(2)) {
  if (args.length === 0) return 5187;
  if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) {
    throw new Error('Usage: node examples/browser-model-chat/serve.mjs [--port <0-65535>]');
  }
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  return port;
}

function contained(root, candidate) {
  const suffix = relative(root, candidate);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('..' + sep)
    && !isAbsolute(suffix) && !suffix.includes(':');
}

function safeSegments(segments) {
  return segments.every(part => part !== '' && !part.startsWith('.') && !part.includes(':'));
}

// Inspect the raw target before URL normalization can remove encoded dot segments.
function requestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null;
  let pathname;
  try { pathname = decodeURIComponent(target.split(/[?#]/, 1)[0]); }
  catch { return null; }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) return null;
  if (pathname === '/') return '/index.html';
  if (!safeSegments(pathname.slice(1).split('/'))) return null;
  return pathname;
}

async function resolveFile(root, suffix) {
  const candidate = resolve(root, suffix);
  if (!contained(root, candidate)) return null;
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!contained(canonicalRoot, canonicalFile)) return null;
  if (!safeSegments(relative(canonicalRoot, canonicalFile).split(sep))) return null;
  const info = await stat(canonicalFile);
  return info.isFile() ? { path: canonicalFile, size: info.size } : null;
}

/** Local preview only. Callers choose roots; request URLs cannot choose filesystem roots. */
export async function startServer({ port = 0, root = exampleDirectory,
  runtimeRoot = join(repositoryDirectory, '.artifacts/model-chat/runtime'), memoryCoreRoot, memoryGraphRoot } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const exampleRoot = await realpath(resolve(root));
  if (!(await stat(exampleRoot)).isDirectory()) throw new Error('Example root must be a directory.');
  const runtimeDirectory = resolve(runtimeRoot);

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = requestPath(request.url);
      if (!pathname) { response.writeHead(404).end(); return; }
      let mount = exampleRoot;
      let suffix = pathname.slice(1);
      let contentType;
      if (pathname === '/memory/graph-renderer.mjs') {
        if (!memoryGraphRoot) { response.writeHead(404).end(); return; }
        mount = await realpath(resolve(memoryGraphRoot));
        suffix = 'graph-renderer.mjs';
        contentType = 'application/javascript; charset=utf-8';
      } else if (pathname === '/memory/rag-core.mjs') {
        if (!memoryCoreRoot) { response.writeHead(404).end(); return; }
        mount = resolve(memoryCoreRoot);
        suffix = 'rag-core.mjs';
      } else if (pathname.startsWith('/runtime/')) {
        suffix = pathname.slice('/runtime/'.length);
        if (!runtimeFiles.has(suffix)) { response.writeHead(404).end(); return; }
        mount = runtimeDirectory;
        if (suffix === 'LICENSE') contentType = 'text/plain; charset=utf-8';
      } else if (pathname.startsWith('/theme/')) {
        if (pathname !== '/theme/aurel-gold.css') { response.writeHead(404).end(); return; }
        mount = themeDirectory;
        suffix = 'aurel-gold.css';
      }
      const file = await resolveFile(mount, suffix);
      if (!file) { response.writeHead(404).end(); return; }
      // MIME follows the public filename, so a symlink with an unknown suffix stays non-executable.
      contentType ??= STATIC_MIME[extname(suffix).toLowerCase()] ?? 'application/octet-stream';
      const bytes = request.method === 'HEAD' ? null : await readFile(file.path);
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': file.size });
      response.end(bytes);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    const failed = error => { server.off('listening', ready); rejectListen(error); };
    const ready = () => { server.off('error', failed); resolveListen(); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close();
    throw new Error('Preview server did not bind IPv4 loopback.');
  }
  return {
    url: 'http://127.0.0.1:' + address.port + '/',
    port: address.port,
    address,
    server,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close(error => error ? rejectClose(error) : resolveClose());
      server.closeIdleConnections();
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const preview = await startServer({ port: parseCliPort() });
    console.log(preview.url);
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      preview.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
