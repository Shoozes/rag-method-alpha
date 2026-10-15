// Prepare this repository's retrieval implementation as one browser module.
// The output is ignored; dependencies must already be installed explicitly.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = [
  "export { indexDocument, RagEngine, recordFromMapping, recordToMapping } from './modules/browser-rag-ts/src/core/index.ts';",
  "export { assertContextMatches, formatContextPacket } from './modules/browser-rag-ts/src/application/contextPacket.ts';",
  "export { projectRagGraph } from './modules/browser-rag-ts/src/application/graphProjection.ts';",
].join('\n');

export async function buildCore({ output = join(repository, '.artifacts/memory/rag-core.mjs') } = {}) {
  const artifactRoot = join(repository, '.artifacts/memory');
  const corePath = resolve(repository, output);
  const suffix = relative(artifactRoot, corePath);
  if (!suffix || suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix) || !corePath.endsWith('.mjs')) {
    throw new Error('Memory core output must be one .mjs file inside this checkout\'s .artifacts/memory directory.');
  }
  const tool = process.env.BROWSER_MEMORY_ESBUILD_MODULE?.trim();
  if (!tool) throw new Error('Set BROWSER_MEMORY_ESBUILD_MODULE to an already-installed esbuild module file. Automatic installation is disabled.');
  let esbuild;
  try { esbuild = require(tool); }
  catch { throw new Error('The configured esbuild module is unavailable. Set BROWSER_MEMORY_ESBUILD_MODULE to an already-installed esbuild module file. Automatic installation is disabled.'); }
  const built = await esbuild.build({
    absWorkingDir: repository,
    stdin: { contents: entry, resolveDir: repository, sourcefile: 'memory-rag-core-entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    write: false, sourcemap: false, metafile: true, logLevel: 'silent',
  });
  if (built.outputFiles.length !== 1 || Object.values(built.metafile.outputs).some(item => item.imports.length)) {
    throw new Error('Memory core must be one self-contained module.');
  }
  const sources = [];
  for (const name of Object.keys(built.metafile.inputs).sort()) {
    if (name === 'memory-rag-core-entry.ts') continue;
    const path = resolve(repository, name);
    const local = relative(repository, path);
    if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Memory core imported a source outside this checkout.');
    sources.push({ path: local.split(sep).join('/'), sha256: digest(await readFile(path)) });
  }
  sources.push({ path: 'examples/browser-model-chat/memory/build-core.mjs', sha256: digest(await readFile(fileURLToPath(import.meta.url))) });
  sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const bytes = built.outputFiles[0].contents;
  await mkdir(dirname(corePath), { recursive: true });
  await writeFile(corePath, bytes);
  return { corePath, bytes: bytes.length, sha256: digest(bytes), esbuildVersion: esbuild.version, sources,
    entrySha256: digest(entry), scope: 'original rag-indexing-v1/rag-behavior-v2 implementations; generated browser module' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node examples/browser-model-chat/memory/build-core.mjs');
    console.log(JSON.stringify(await buildCore()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
