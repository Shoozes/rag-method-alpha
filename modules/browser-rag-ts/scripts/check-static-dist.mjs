import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";
import { ROOT } from "./report-common.mjs";
import { resolveBuildSource } from "../../../scripts/public-source.mjs";
import { listenStatic } from "./static-server.mjs";
import { assertArtifactNotices, sha256Bytes, validateStaticArtifactDirectory } from "./static-artifact-common.mjs";
import { loadGraphReceipt } from "./vendor-receipt.mjs";

const artifactRoot = resolve(MODULE_ROOT, ".artifacts", "release", "browser-rag-ts");
const manifest = await validateStaticArtifactDirectory(artifactRoot);
const source = resolveBuildSource(ROOT);
if (JSON.stringify(manifest.source) !== JSON.stringify(source)) throw new Error("static artifact source differs from the current complete source inventory; rebuild it");
if (manifest.artifact.subpath !== "/rag-method/") throw new Error("static artifact subpath is invalid");
assertArtifactNotices(manifest, {
  "rag-method": sha256Bytes(await readFile(resolve(ROOT, "LICENSE"))),
  "@ours/forcegraph-tsl": sha256Bytes(await readFile(resolve(MODULE_ROOT, "node_modules", "@ours", "forcegraph-tsl", "LICENSE"))),
  three: sha256Bytes(await readFile(resolve(MODULE_ROOT, "node_modules", "three", "LICENSE"))),
});
const graphReceipt = await loadGraphReceipt();
const dependency = manifest.dependencies["@ours/forcegraph-tsl"];
if (dependency.version !== graphReceipt.package.version || dependency.license !== graphReceipt.package.license
    || JSON.stringify(dependency.source) !== JSON.stringify(graphReceipt.source)
    || dependency.archive_sha256 !== graphReceipt.archive.sha256 || dependency.archive_bytes !== graphReceipt.archive.bytes) {
  throw new Error("static artifact graph provenance differs from the pinned receipt");
}

const references = new Set();
for (const name of ["index.html", "browser/index.html"]) {
  const html = await readFile(resolve(artifactRoot, name), "utf8");
  const base = new URL(`https://artifact.invalid/${name}`);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/gu)) {
    const value = match[1];
    if (/^(?:data:|https?:|#)/u.test(value)) continue;
    const url = new URL(value, base);
    if (url.origin !== base.origin) throw new Error("static HTML reference escapes its origin");
    const normalized = url.pathname.slice(1);
    if (!normalized || normalized.endsWith("/")) continue;
    const path = resolve(artifactRoot, normalized);
    const contained = relative(artifactRoot, path);
    if (!contained || contained.startsWith("..") || !(await stat(path)).isFile()) throw new Error(`static HTML references a missing or unsafe asset: ${normalized}`);
    references.add(normalized);
  }
}
if (![...references].some((name) => name.endsWith(".js"))) throw new Error("static artifact has no JavaScript entrypoint");
const server = await listenStatic(artifactRoot, "/rag-method/");
try {
  const page = await fetch(server.baseUrl);
  if (!page.ok || !(page.headers.get("content-type") ?? "").startsWith("text/html")) throw new Error("static directory does not serve HTML safely");
  for (const reference of references) {
    const response = await fetch(new URL(reference, server.baseUrl));
    if (!response.ok) throw new Error(`static asset failed: ${reference}`);
    if (reference.endsWith(".js") && !(response.headers.get("content-type") ?? "").startsWith("application/javascript")) throw new Error(`static JavaScript MIME is invalid: ${reference}`);
    if (reference.endsWith(".css") && !(response.headers.get("content-type") ?? "").startsWith("text/css")) throw new Error(`static CSS MIME is invalid: ${reference}`);
  }
  const missing = await fetch(new URL("missing-module.js", server.baseUrl));
  if (missing.status !== 404 || (missing.headers.get("content-type") ?? "").startsWith("text/html")) throw new Error("missing static module did not fail with a non-HTML 404");
} finally {
  await server.close();
}
console.log(`browser-rag-ts static payload: ${manifest.files.length} files; ${source.kind} ${source.fingerprint_sha256}; browser journeys and release acceptance remain explicit`);
