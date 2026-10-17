// Offline assembly of the existing admitted TSL renderer; no install or fetch.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInstalledGraph } from '../../../modules/browser-rag-ts/scripts/vendor-content.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const artifactRoot = join(repository, '.artifacts/memory');
const graphArchivePath = 'modules/browser-rag-ts/vendor/ours-forcegraph-tsl-0.3.0-alpha.1.tgz';
const graphArchiveSha256 = 'ff8fdd7167bf30dc0ab392c8054564bc83eb255c0f260b5a0a362f4b8fb9ebb8';
const threeFiles = Object.freeze({
  'LICENSE': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc',
  'package.json': '56403e5c6be3aafeb71240ea2b9def8a9a1862c0bcc3e8a3f431680ebecb619e',
  'build/three.core.js': '78b2c4218834ca8670547ed2315bfc21a00ff4dc3403bbffc8c31493d31d14de',
  'build/three.webgpu.js': 'eb77cbb7759853dd9cd8661c38795ff4fcd0182a8852f942f687b9954f87d5eb',
  'build/three.tsl.js': 'c3844718a7becd4d2d10fef29a503e6a8789bd1636e2e62767f2cf00fa56f8c1',
});
const entry = [
  "export { createTslRagGraphRenderer } from './modules/browser-rag-ts/src/application/graphRenderer.ts';",
  "export { layoutRagGraph } from './modules/browser-rag-ts/src/application/layoutGraph.ts';",
  "export { layoutMemoryGraph } from './modules/browser-rag-ts/src/application/memoryGraphLayout.ts';",
].join('\n');
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const portable = value => value.split(sep).join('/');
function descendant(root, candidate) {
  const suffix = relative(root, candidate);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix);
}
async function ordinary(path, limit = 8 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Graph input must be a bounded ordinary file.');
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('Graph input changed during its read.');
  return bytes;
}
async function safeOutput(path) {
  if (!descendant(artifactRoot, path)) throw new Error('Graph output must stay inside this checkout\'s .artifacts/memory directory.');
  let cursor = repository;
  for (const part of relative(repository, path).split(sep)) {
    cursor = join(cursor, part);
    let info;
    try { info = await lstat(cursor); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink() || (cursor !== path && !info.isDirectory()) || (cursor === path && (!info.isFile() || info.nlink !== 1))) {
      throw new Error('Graph output refuses linked or non-ordinary paths.');
    }
  }
}
async function writeArtifact(path, bytes) {
  await safeOutput(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { path: portable(relative(repository, path)), bytes: bytes.length, sha256: digest(bytes) };
}

export async function buildGraph({
  output = join(artifactRoot, 'graph-renderer.mjs'),
  dependencyRoot = process.env.BROWSER_MEMORY_GRAPH_DEPENDENCY_ROOT || join(artifactRoot, 'dependencies'),
  esbuildModule = process.env.BROWSER_MEMORY_ESBUILD_MODULE,
} = {}) {
  const graphPath = resolve(repository, output);
  if (!graphPath.endsWith('.mjs')) throw new Error('Graph output must be one .mjs module.');
  await safeOutput(graphPath);
  const dependencies = resolve(dependencyRoot);
  const dependencyInfo = await lstat(dependencies);
  if (!dependencyInfo.isDirectory() || dependencyInfo.isSymbolicLink()) throw new Error('Prepared graph dependencies must use an ordinary directory.');
  const lock = JSON.parse(await ordinary(join(repository, 'modules/browser-rag-ts/package-lock.json')));
  const archive = await ordinary(join(repository, graphArchivePath));
  if (archive.length !== 313331 || digest(archive) !== graphArchiveSha256
      || 'sha512-' + digest(archive, 'sha512', 'base64') !== lock.packages?.['node_modules/@ours/forcegraph-tsl']?.integrity) {
    throw new Error('Pinned graph archive integrity mismatch.');
  }
  const graphRoot = join(dependencies, '@ours/forcegraph-tsl');
  const graphFileCount = await verifyInstalledGraph(archive, graphRoot);
  const graphPackage = JSON.parse(await ordinary(join(graphRoot, 'package.json')));
  const threeRoot = join(dependencies, 'three');
  const threePackage = JSON.parse(await ordinary(join(threeRoot, 'package.json')));
  if (graphPackage.name !== '@ours/forcegraph-tsl' || graphPackage.version !== '0.3.0-alpha.1'
      || graphPackage.license !== 'MIT' || graphPackage.peerDependencies?.three !== '^0.185.0'
      || threePackage.name !== 'three' || threePackage.version !== '0.185.0' || threePackage.license !== 'MIT'
      || lock.packages?.['node_modules/three']?.version !== '0.185.0') throw new Error('Prepared graph package identity mismatch.');
  for (const [name, expected] of Object.entries(threeFiles)) {
    if (digest(await ordinary(join(threeRoot, name))) !== expected) throw new Error('Pinned Three input mismatch: ' + name);
  }
  if (typeof esbuildModule !== 'string' || !esbuildModule.trim()) {
    throw new Error('Set BROWSER_MEMORY_ESBUILD_MODULE to an already-prepared esbuild module; automatic installation is disabled.');
  }
  const esbuild = require(resolve(esbuildModule));
  const built = await esbuild.build({
    absWorkingDir: repository,
    stdin: { contents: entry, resolveDir: repository, sourcefile: 'memory-graph-renderer-entry.ts', loader: 'ts' },
    nodePaths: [dependencies], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, metafile: true, write: false, logLevel: 'silent',
  });
  if (built.outputFiles.length !== 1 || Object.values(built.metafile.outputs).some(item => item.imports.length)) {
    throw new Error('Graph renderer must be one self-contained module without external imports.');
  }
  const sources = [];
  for (const name of Object.keys(built.metafile.inputs).sort()) {
    if (name === 'memory-graph-renderer-entry.ts') continue;
    const path = resolve(repository, name);
    const local = descendant(repository, path);
    const prepared = descendant(graphRoot, path) || descendant(threeRoot, path);
    if (!local && !prepared) throw new Error('Graph bundle imported a file outside this checkout or its verified prepared dependencies.');
    sources.push({ path: local ? portable(relative(repository, path)) : 'prepared-dependencies/' + portable(relative(dependencies, path)),
      sha256: digest(await ordinary(path)) });
  }
  sources.push({ path: 'examples/browser-model-chat/memory/build-graph.mjs', sha256: digest(await ordinary(fileURLToPath(import.meta.url))) });
  sources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const bytes = built.outputFiles[0].contents;
  // The admitted graph library retains an optional worker URL. Both exported
  // consumer paths select local layout, so it is never a used browser dependency.
  const dormantWorkerUrls = [...new TextDecoder().decode(bytes).matchAll(/new URL\(["']([^"']*worker[^"']*)["'],\s*import\.meta\.url\)/g)].map(match => match[1]);
  const artifact = await writeArtifact(graphPath, bytes);
  const licenses = [];
  for (const [name, input] of [['forcegraph-tsl.txt', join(graphRoot, 'LICENSE')], ['three.txt', join(threeRoot, 'LICENSE')]]) {
    licenses.push(await writeArtifact(join(artifactRoot, 'LICENSES', name), await ordinary(input)));
  }
  return { graphPath, ...artifact, esbuildVersion: esbuild.version, entrySha256: digest(entry),
    exports: ['createTslRagGraphRenderer', 'layoutRagGraph', 'layoutMemoryGraph'], sources, licenses, dormantWorkerUrls,
    dependencies: { graph: { version: graphPackage.version, archiveSha256: graphArchiveSha256, verifiedFiles: graphFileCount },
      three: { version: threePackage.version, files: Object.keys(threeFiles) } },
    scope: 'existing renderer/layout assembly; local layout; no install, network, model or donor edits' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node examples/browser-model-chat/memory/build-graph.mjs');
    console.log(JSON.stringify(await buildGraph()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
