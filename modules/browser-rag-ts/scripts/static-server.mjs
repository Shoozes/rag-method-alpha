import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

export const STATIC_MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
});

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !path.includes(":");
}

export function createStaticServer(rootPath, prefix = "/") {
  const root = resolve(rootPath);
  if (!prefix.startsWith("/") || !prefix.endsWith("/") || prefix.includes("\\")) throw new Error("static prefix must be an absolute directory path");
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!requestUrl.pathname.startsWith(prefix)) {
        response.writeHead(404).end();
        return;
      }
      const requestedSuffix = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
      const suffix = !requestedSuffix ? "index.html" : requestedSuffix.endsWith("/") ? `${requestedSuffix}index.html` : requestedSuffix;
      if (suffix.includes("\\") || suffix.includes("\0")) {
        response.writeHead(404).end();
        return;
      }
      const candidate = resolve(root, suffix);
      if (!inside(root, candidate)) {
        response.writeHead(404).end();
        return;
      }
      const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
      if (!inside(canonicalRoot, canonicalCandidate) || !(await stat(canonicalCandidate)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", STATIC_MIME[extname(canonicalCandidate).toLowerCase()] ?? "application/octet-stream");
      if (canonicalCandidate.endsWith(".html")) response.setHeader("Cache-Control", "no-cache");
      response.writeHead(200).end(await readFile(canonicalCandidate));
    } catch {
      response.writeHead(404).end();
    }
  });
}

export async function listenStatic(root, prefix = "/") {
  const server = createStaticServer(root, prefix);
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("static server did not expose a TCP port");
  return {
    server,
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}${prefix}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  };
}
