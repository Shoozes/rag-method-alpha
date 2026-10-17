// Local-only source build with explicitly reused, read-only prepared dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInstalledGraph } from '../modules/browser-rag-ts/scripts/vendor-content.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shared = resolve(process.env.BROWSER_MEMORY_GRAPH_DEPENDENCY_ROOT || join(root, '.artifacts/memory/dependencies'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const archive = await readFile(join(root, 'modules/browser-rag-ts/vendor/ours-forcegraph-tsl-0.3.0-alpha.1.tgz'));
assert.equal(hash(archive), 'ff8fdd7167bf30dc0ab392c8054564bc83eb255c0f260b5a0a362f4b8fb9ebb8');
const verifiedFiles = await verifyInstalledGraph(archive, join(shared, '@ours/forcegraph-tsl'));
const threePins = {
  'LICENSE': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc',
  'package.json': '56403e5c6be3aafeb71240ea2b9def8a9a1862c0bcc3e8a3f431680ebecb619e',
  'build/three.core.js': '78b2c4218834ca8670547ed2315bfc21a00ff4dc3403bbffc8c31493d31d14de',
  'build/three.webgpu.js': 'eb77cbb7759853dd9cd8661c38795ff4fcd0182a8852f942f687b9954f87d5eb',
  'build/three.tsl.js': 'c3844718a7becd4d2d10fef29a503e6a8789bd1636e2e62767f2cf00fa56f8c1',
};
for (const [path, expected] of Object.entries(threePins)) assert.equal(hash(await readFile(join(shared, 'three', path))), expected);
assert.ok(process.env.BROWSER_MEMORY_ESBUILD_MODULE, 'Use an explicitly prepared esbuild module; no automatic install.');
const esbuild = createRequire(import.meta.url)(process.env.BROWSER_MEMORY_ESBUILD_MODULE);
const builder = await readFile(join(root, 'examples/browser-model-chat/memory/build-graph.mjs'), 'utf8');
const entryText = /const entry = \[([\s\S]+?)\]\.join\('\\n'\);/.exec(builder)?.[1];
assert.ok(entryText);
const exports = [...entryText.matchAll(/"(export [^\r\n]+)"/g)].map(match => match[1]);
assert.equal(exports.length, 3);
const entry = exports.join('\n');
const built = await esbuild.build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: root, sourcefile: 'memory-graph-renderer-entry.ts', loader: 'ts' },
  nodePaths: [shared], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false, metafile: true, write: false, logLevel: 'silent' });
assert.equal(built.outputFiles.length, 1);
assert.ok(Object.values(built.metafile.outputs).every(value => !value.imports.length));
const sources = [], dependencies = [];
for (const path of Object.keys(built.metafile.inputs).sort()) {
  if (path === 'memory-graph-renderer-entry.ts') continue;
  const absolute = resolve(root, path), bytes = await readFile(absolute);
  const dependency = absolute.startsWith(shared + '/') || absolute.startsWith(shared + '\\');
  const base = dependency ? shared : root, name = relative(base, absolute).replaceAll('\\', '/');
  assert.ok(!name.startsWith('../'));
  (dependency ? dependencies : sources).push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
const bytes = built.outputFiles[0].contents;
await mkdir(join(root, '.artifacts/memory'), { recursive: true });
await writeFile(join(root, '.artifacts/memory/graph-renderer.mjs'), bytes);
const result = { status: 'built', esbuildVersion: esbuild.version, bytes: bytes.length, sha256: hash(bytes), entrySha256: hash(entry),
  sourceFiles: sources, sourcesSha256: hash(JSON.stringify(sources)), sharedDependencyFiles: dependencies.length,
  sharedDependencyInventorySha256: hash(JSON.stringify(dependencies)), verifiedGraphFiles: verifiedFiles, graphArchiveSha256: hash(archive), threeVersion: '0.185.0',
  reuse: 'read-only sibling prepared dependencies; zero dependency/runtime/model copies', generatedGraphCount: 1, normalProductionBuildEntryUsed: true };
console.log(JSON.stringify(result));
