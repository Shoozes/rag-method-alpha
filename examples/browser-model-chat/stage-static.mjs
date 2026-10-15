import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, RUNTIME } from './model-contract.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const example = fileURLToPath(new URL('./', import.meta.url));
const schema = 'rag-model-chat-static/v1';
const managedBy = 'examples/browser-model-chat/stage-static.mjs';
const manifestName = 'site-manifest.json';
const browserFiles = Object.freeze([
  'index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'capabilities.mjs', 'bootstrap.mjs',
]);
const runtimeFiles = Object.freeze(['index.js', 'wllama.wasm', 'LICENSE']);
const payloadPaths = Object.freeze([...browserFiles, 'theme/aurel-gold.css',
  ...runtimeFiles.map(name => 'runtime/' + name), 'LICENSES/rag-method.txt', 'NOTICE.txt', 'README.txt'].sort());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = value => value.split(sep).join('/');
const table = payload => [...payload].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path));
const identity = value => hash(JSON.stringify(value));

function inside(root, candidate) {
  const suffix = relative(root, candidate);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix);
}

async function ordinaryBytes(path, label, limit = 1024 * 1024, singleLink = false) {
  let info;
  try { info = await lstat(path); } catch { throw new Error('Required ordinary file is missing: ' + label); }
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Required file is not a bounded ordinary file: ' + label);
  if (singleLink && info.nlink !== 1) {
    throw Object.assign(new Error('Refusing hard-linked managed output: ' + label), { code: 'LINKED_OUTPUT' });
  }
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('File changed while packaging: ' + label);
  return bytes;
}

async function outputPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Static output must be a workspace directory path.');
  const destination = resolve(value);
  const root = await realpath(workspace);
  if (!inside(resolve(workspace), destination)) throw new Error('Static output must stay strictly inside this workspace.');
  let cursor = resolve(workspace);
  for (const part of relative(cursor, destination).split(sep)) {
    if (['.git', '.tools', '.agents', '.codex', '.aws', '.secrets', 'node_modules'].includes(part.toLowerCase())) {
      throw new Error('Static output cannot use private or dependency directories.');
    }
    cursor = join(cursor, part);
    let info;
    try { info = await lstat(cursor); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !inside(root, await realpath(cursor))) {
      throw new Error('Static output must use ordinary workspace directories without links.');
    }
  }
  return destination;
}

async function managedOutput(destination) {
  try { await lstat(destination); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let previous;
  try { previous = JSON.parse(await ordinaryBytes(join(destination, manifestName), 'managed site manifest', 256 * 1024, true)); }
  catch (error) {
    if (error.code === 'LINKED_OUTPUT') throw error;
    throw new Error('Refusing existing output without an intact managed site manifest.');
  }
  const { identitySha256, ...body } = previous;
  if (previous.schema !== schema || previous.managedBy !== managedBy || identitySha256 !== identity(body)
      || previous.publicReleaseQualified !== false || !Array.isArray(previous.files)
      || JSON.stringify(previous.files.map(file => file.path).sort()) !== JSON.stringify(payloadPaths)) {
    throw new Error('Refusing output with a foreign or changed managed manifest.');
  }
  const permitted = new Set([...payloadPaths, manifestName]);
  const permittedDirectories = new Set(['theme', 'runtime', 'LICENSES']);
  const actual = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Refusing linked output content.');
      if (entry.isDirectory() && permittedDirectories.has(name)) await visit(join(directory, entry.name), name + '/');
      else if (entry.isFile() && permitted.has(name)) actual.push(name);
      else throw new Error('Refusing output with extra or foreign content.');
    }
  }
  await visit(destination);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...permitted].sort())) throw new Error('Refusing incomplete managed output.');
  for (const file of previous.files) {
    const bytes = await ordinaryBytes(join(destination, file.path), file.path, 16 * 1024 * 1024, true);
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Refusing modified managed output: ' + file.path);
  }
  return previous;
}

function gitIdentity() {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return { head: /^[0-9a-f]{40}$/.test(head) ? head : null, dirty: !!status.trim() };
  } catch { return { head: null, dirty: null }; }
}

/** Package existing verified assets only; never download, build, or deploy. */
export async function stageStatic({ output = join(workspace, '.artifacts/model-chat/site'),
  runtimeRoot = join(workspace, '.artifacts/model-chat/runtime') } = {}) {
  const destination = await outputPath(output);
  const previous = await managedOutput(destination);
  const payload = new Map(), source = new Map();
  for (const name of runtimeFiles) {
    const bytes = await ordinaryBytes(join(resolve(runtimeRoot), name), 'runtime/' + name, 16 * 1024 * 1024);
    if (hash(bytes) !== RUNTIME.files[name].sha256) throw new Error('Pinned runtime SHA-256 mismatch: ' + name);
    payload.set('runtime/' + name, bytes);
  }
  for (const name of browserFiles) {
    const bytes = await ordinaryBytes(join(example, name), 'examples/browser-model-chat/' + name);
    payload.set(name, bytes); source.set('examples/browser-model-chat/' + name, bytes);
  }
  const theme = await ordinaryBytes(join(workspace, 'modules/browser-rag-ts/demo/aurel-gold.css'), 'Aurel Gold stylesheet');
  payload.set('theme/aurel-gold.css', theme); source.set('modules/browser-rag-ts/demo/aurel-gold.css', theme);
  const license = await ordinaryBytes(join(workspace, 'LICENSE'), 'first-party LICENSE');
  payload.set('LICENSES/rag-method.txt', license); source.set('LICENSE', license);
  source.set(managedBy, await ordinaryBytes(fileURLToPath(import.meta.url), managedBy));
  payload.set('NOTICE.txt', Buffer.from([
    'RAG Method browser model chat notices', '',
    'First-party application and Aurel Gold theme: MIT. Complete text: LICENSES/rag-method.txt.',
    '@wllama/wllama ' + RUNTIME.version + ': MIT. Complete retained text: runtime/LICENSE.',
    'Pinned runtime files retain their verified upstream bytes.', '',
    'Model: ' + MODEL.id + ' / ' + MODEL.file,
    'Model revision: ' + MODEL.revision,
    'Model license: LFM Open License v1.0 (distinct from the application/runtime MIT licenses).',
    MODEL.license,
    'Model weights are not included in this static payload. Download is an explicit browser action.',
    'The model license applies to model use and redistribution; inspect its pinned terms before deployment.', '',
  ].join('\n')));
  payload.set('README.txt', Buffer.from([
    'RAG Method browser model chat static payload', '',
    'Mount this directory under any HTTPS directory URL ending in /. Open index.html.',
    'Serve .mjs and .js as application/javascript; .wasm as application/wasm;',
    '.css as text/css; .html as text/html; .json as application/json.',
    'Unknown files must return 404, never an HTML application fallback.',
    'No repository checkout, Node runtime, model file, credentials, or build tools are required by the site.',
    'Model loading requires a secure context. A local-file choice still verifies the pinned model bytes.',
    'Canonical wllama 3.5.1 requires WebAssembly Memory64 and the OPFS API for both local File and remote loading.',
    'Writable OPFS is required only for a new remote cache miss; an OPFS write failure does not itself block File or valid cached-byte loading.',
    'JSPI absence alone is not a loading gate.',
    'The model download, cache, and inference run only after an explicit browser action.',
    'Read NOTICE.txt, LICENSES/rag-method.txt, runtime/LICENSE, and the pinned model license.',
    'This package is a static preview, not full product-release or iOS qualification.', '',
  ].join('\n')));
  const sourceFiles = table(source);
  const body = {
    schema, managedBy, publicReleaseQualified: false,
    source: { ...gitIdentity(), reviewStatus: 'unreviewed',
      fingerprintScope: 'allowlisted browser sources, theme, first-party license and packager',
      fingerprintSha256: identity(sourceFiles), files: sourceFiles },
    model: { id: MODEL.id, file: MODEL.file, revision: MODEL.revision, bytes: MODEL.bytes,
      sha256: MODEL.sha256, url: MODEL.url, license: 'LFM Open License v1.0', licenseUrl: MODEL.license, weightsIncluded: false },
    runtime: { package: '@wllama/wllama', version: RUNTIME.version, license: 'MIT', licensePath: 'runtime/LICENSE' },
    files: table(payload),
  };
  const manifest = { ...body, identitySha256: identity(body) };
  // Validate the complete incoming payload before creating any output directory.
  if (JSON.stringify([...payload.keys()].sort()) !== JSON.stringify(payloadPaths)) throw new Error('Static payload allowlist mismatch.');
  await mkdir(destination, { recursive: true });
  for (const file of manifest.files) {
    const target = join(destination, file.path);
    const old = previous?.files.find(item => item.path === file.path);
    if (old?.sha256 === file.sha256 && old.bytes === file.bytes) continue;
    if (old && hash(await ordinaryBytes(target, file.path, 16 * 1024 * 1024, true)) !== old.sha256) {
      throw new Error('Managed output changed during refresh: ' + file.path);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, payload.get(file.path), { flag: old ? 'w' : 'wx' });
  }
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  if (!previous || previous.identitySha256 !== manifest.identitySha256) {
    if (previous && JSON.stringify(JSON.parse(await ordinaryBytes(join(destination, manifestName), 'managed site manifest', 256 * 1024, true))) !== JSON.stringify(previous)) {
      throw new Error('Managed site manifest changed during refresh.');
    }
    await writeFile(join(destination, manifestName), manifestBytes, { flag: previous ? 'w' : 'wx' });
  }
  return { output: destination, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!['--output', '--runtime-root'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('Usage: node examples/browser-model-chat/stage-static.mjs [--output <workspace directory>] [--runtime-root <prepared directory>]');
      }
      const key = args[index] === '--output' ? 'output' : 'runtimeRoot';
      if (options[key]) throw new Error('Duplicate staging option.');
      options[key] = args[index + 1];
    }
    const result = await stageStatic(options);
    console.log(JSON.stringify({ output: portable(relative(workspace, result.output)), files: result.manifest.files.length,
      identitySha256: result.manifest.identitySha256, modelWeightsIncluded: false, publicReleaseQualified: false }));
  } catch (error) { console.error(error.message.replaceAll(workspace, '<workspace>')); process.exitCode = 1; }
}
