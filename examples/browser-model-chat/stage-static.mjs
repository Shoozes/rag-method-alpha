import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPAT, MODEL, RUNTIME } from './model-contract.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const example = fileURLToPath(new URL('./', import.meta.url));
const schema = 'rag-model-chat-static/v1';
const managedBy = 'examples/browser-model-chat/stage-static.mjs';
const manifestName = 'site-manifest.json';
const browserFiles = Object.freeze([
  'index.html', 'style.css', 'app.mjs', 'loader-controller.mjs', 'model-contract.mjs',
  'runtime-adapter.mjs', 'engine-worker.mjs', 'runtime-errors.mjs', 'wasm-memory.mjs', 'runtime-profile.mjs',
  'capabilities.mjs', 'bootstrap.mjs',
]);
const memoryFiles = Object.freeze([
  'memory/workspace.mjs', 'memory/store.mjs', 'memory/events.mjs', 'memory/context.mjs',
  'memory/structured-context.mjs', 'memory/automatic-context.mjs', 'memory/rag-adapter.mjs',
  'memory/restore-events.mjs', 'memory/citations.mjs', 'memory/panel.mjs', 'memory/panel.css',
  'memory/rag-core.mjs',
]);
const memoryCoreSha256 = 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6';
const modelLicenseSource = 'examples/browser-model-chat/licenses/LFM-Open-License-1.0.txt';
const modelLicensePath = 'LICENSES/lfm-open-license-1.0.txt';
const modelLicenseSha256 = '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b';
const runtimeIdentities = Object.freeze({ ...RUNTIME.files, ...COMPAT.files });
const runtimeFiles = Object.freeze(Object.keys(runtimeIdentities));
const payloadPaths = Object.freeze([...browserFiles, 'theme/aurel-gold.css',
  ...runtimeFiles.map(name => 'runtime/' + name), 'LICENSES/rag-method.txt', 'NOTICE.txt', 'README.txt'].sort());
const preMemoryPayloadPaths = payloadPaths.filter(name => !['wasm-memory.mjs', 'runtime-profile.mjs'].includes(name));
const priorPayloadPaths = preMemoryPayloadPaths.filter(name => name !== 'runtime-errors.mjs');
const legacyPayloadPaths = priorPayloadPaths.filter(name => !name.startsWith('runtime/compat/'));
const memoryPayloadPaths = Object.freeze([...payloadPaths, ...memoryFiles, modelLicensePath].sort());
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

async function managedOutput(destination, memoryPreview) {
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
  const previousPaths = previous.files?.map(file => file.path).sort();
  if (previous.schema !== schema || previous.managedBy !== managedBy || identitySha256 !== identity(body)
      || previous.publicReleaseQualified !== false || !Array.isArray(previous.files)
      || ![...(memoryPreview ? [memoryPayloadPaths] : []), payloadPaths, preMemoryPayloadPaths, priorPayloadPaths, legacyPayloadPaths]
        .some(paths => JSON.stringify(previousPaths) === JSON.stringify(paths))) {
    throw new Error('Refusing output with a foreign or changed managed manifest.');
  }
  const permitted = new Set([...previousPaths, manifestName]);
  const permittedDirectories = new Set(['theme', 'runtime', 'runtime/compat', 'LICENSES', ...(memoryPreview ? ['memory'] : [])]);
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
  runtimeRoot = join(workspace, '.artifacts/model-chat/runtime'), memoryPreview = false } = {}) {
  if (typeof memoryPreview !== 'boolean') throw new Error('memoryPreview must be an explicit boolean.');
  const privateMarker = await lstat(join(example, 'memory/PRIVATE_LOCAL_ONLY')).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (privateMarker && !memoryPreview) throw new Error('Private memory preview is local only');
  const destination = await outputPath(output);
  const previous = await managedOutput(destination, memoryPreview);
  const payload = new Map(), source = new Map();
  for (const name of runtimeFiles) {
    const bytes = await ordinaryBytes(join(resolve(runtimeRoot), name), 'runtime/' + name, 16 * 1024 * 1024);
    if (hash(bytes) !== runtimeIdentities[name].sha256) throw new Error('Pinned runtime SHA-256 mismatch: ' + name);
    payload.set('runtime/' + name, bytes);
  }
  for (const name of browserFiles) {
    const bytes = await ordinaryBytes(join(example, name), 'examples/browser-model-chat/' + name);
    payload.set(name, bytes); source.set('examples/browser-model-chat/' + name, bytes);
  }
  if (memoryPreview) {
    for (const name of memoryFiles) {
      const sourcePath = name === 'memory/rag-core.mjs' ? '.artifacts/memory/rag-core.mjs' : 'examples/browser-model-chat/' + name;
      const bytes = await ordinaryBytes(join(workspace, sourcePath), sourcePath);
      if (name === 'memory/rag-core.mjs' && hash(bytes) !== memoryCoreSha256) throw new Error('Pinned memory core SHA-256 mismatch.');
      payload.set(name, bytes); source.set(sourcePath, bytes);
    }
    const modelLicense = await ordinaryBytes(join(workspace, modelLicenseSource), modelLicenseSource, 64 * 1024);
    if (hash(modelLicense) !== modelLicenseSha256) throw new Error('Pinned model license SHA-256 mismatch.');
    payload.set(modelLicensePath, modelLicense); source.set(modelLicenseSource, modelLicense);
    source.set('examples/browser-model-chat/memory/build-core.mjs', await ordinaryBytes(join(example, 'memory/build-core.mjs'), 'memory core build source'));
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
    COMPAT.package + ' ' + COMPAT.version + ': MIT. Complete retained text: runtime/LICENSE.',
    'Compatibility package upstream source: https://github.com/ngxson/wllama/tree/' + COMPAT.gitHead,
    'The compatibility npm package omits a license file; runtime/LICENSE matches its exact upstream LICENCE.',
    'Pinned runtime files retain their verified upstream bytes.', '',
    'Model: ' + MODEL.id + ' / ' + MODEL.file,
    'Model revision: ' + MODEL.revision,
    'Model license: LFM Open License v1.0 (distinct from the application/runtime MIT licenses).',
    MODEL.license,
    ...(memoryPreview ? ['Complete pinned model license: ' + modelLicensePath + '.'] : []),
    'Model weights are not included in this static payload. Download is an explicit browser action.',
    'The model license applies to model use and redistribution; inspect its pinned terms before deployment.', '',
    ...(memoryPreview ? [
      'Experimental model limitation: after a correction, the model used Thursday instead of Tuesday but omitted the codename and city in a multi-field answer.',
      'Automatic passage/provenance checks do not establish generated-answer completeness or truth.', '',
    ] : []),
  ].join('\n')));
  payload.set('README.txt', Buffer.from([
    'RAG Method browser model chat static payload', '',
    'Mount this directory under any HTTPS directory URL ending in /. Open index.html.',
    'Serve .mjs and .js as application/javascript; .wasm as application/wasm;',
    '.css as text/css; .html as text/html; .json as application/json.',
    'Unknown files must return 404, never an HTML application fallback.',
    'No repository checkout, Node runtime, model file, credentials, or build tools are required by the site.',
    'Model loading requires a secure context. A local-file choice still verifies the pinned model bytes.',
    'The main wllama 3.5.1 runtime requires WebAssembly Memory64; the pinned maintained compatibility runtime uses Memory32 and Asyncify.',
    'Missing Memory64 or JSPI selects the compatibility runtime automatically; the model identity stays unchanged.',
    'Both runtime profiles require the OPFS API for local File and remote loading.',
    'Writable OPFS is required only for a new remote cache miss; an OPFS write failure does not itself block File or valid cached-byte loading.',
    'JSPI absence alone is not a loading gate.',
    'The model download, cache, and inference run only after an explicit browser action.',
    ...(memoryPreview ? [
      'Open ?memory=1 for this one-chat memory preview; add &graph=0 to omit the optional read-only SVG event graph.',
      'Older context is selected automatically as source-linked exact passages; no special markup is required.',
      'Automatic passage selection is lossy extractive context, not general semantic summarization or verified fact admission.',
      'Explicit Save stores selected exact user words separately for keyword retrieval; Forget does not erase the transcript.',
      'Historical answer links describe Sources sent at the time, not answer truth, current record eligibility or authenticated execution.',
      'Known 230M model limits include failed unrelated-question abstention and answer-format adherence.',
      'After correction, a native test used Thursday instead of Tuesday but omitted the codename and city in a multi-field answer; answer completeness is not guaranteed.',
      'The complete model license is included at ' + modelLicensePath + '; inspect its commercial eligibility and redistribution terms.',
    ] : []),
    'Read NOTICE.txt, LICENSES/rag-method.txt, runtime/LICENSE, and the pinned model license.',
    'This package is a static preview, not full product-release or iOS qualification.', '',
  ].join('\n')));
  const sourceFiles = table(source);
  const body = {
    schema, managedBy, publicReleaseQualified: false, ...(memoryPreview ? { memoryPreview: true } : {}),
    source: { ...gitIdentity(), reviewStatus: 'unreviewed',
      fingerprintScope: memoryPreview ? 'allowlisted browser sources, generated memory core, build source, theme, licenses and packager'
        : 'allowlisted browser sources, theme, first-party license and packager',
      fingerprintSha256: identity(sourceFiles), files: sourceFiles },
    model: { id: MODEL.id, file: MODEL.file, revision: MODEL.revision, bytes: MODEL.bytes,
      sha256: MODEL.sha256, url: MODEL.url, license: 'LFM Open License v1.0', licenseUrl: MODEL.license,
      ...(memoryPreview ? { licensePath: modelLicensePath, licenseSha256: modelLicenseSha256 } : {}), weightsIncluded: false },
    runtime: { package: '@wllama/wllama', version: RUNTIME.version, license: 'MIT', licensePath: 'runtime/LICENSE' },
    compatibilityRuntime: { package: COMPAT.package, version: COMPAT.version, gitHead: COMPAT.gitHead,
      profile: 'Memory32/Asyncify', license: 'MIT', licensePath: 'runtime/LICENSE' },
    files: table(payload),
  };
  const manifest = { ...body, identitySha256: identity(body) };
  // Validate the complete incoming payload before creating any output directory.
  if (JSON.stringify([...payload.keys()].sort()) !== JSON.stringify(memoryPreview ? memoryPayloadPaths : payloadPaths)) throw new Error('Static payload allowlist mismatch.');
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
    for (let index = 0; index < args.length;) {
      if (args[index] === '--memory-preview') {
        if (options.memoryPreview) throw new Error('Duplicate staging option.');
        options.memoryPreview = true; index++; continue;
      }
      if (!['--output', '--runtime-root'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('Usage: node examples/browser-model-chat/stage-static.mjs [--output <workspace directory>] [--runtime-root <prepared directory>] [--memory-preview]');
      }
      const key = args[index] === '--output' ? 'output' : 'runtimeRoot';
      if (options[key]) throw new Error('Duplicate staging option.');
      options[key] = args[index + 1];
      index += 2;
    }
    const result = await stageStatic(options);
    console.log(JSON.stringify({ output: portable(relative(workspace, result.output)), files: result.manifest.files.length,
      identitySha256: result.manifest.identitySha256, modelWeightsIncluded: false, publicReleaseQualified: false }));
  } catch (error) { console.error(error.message.replaceAll(workspace, '<workspace>')); process.exitCode = 1; }
}
