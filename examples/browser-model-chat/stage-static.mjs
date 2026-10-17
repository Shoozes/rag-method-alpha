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
  'capabilities.mjs', 'bootstrap.mjs', 'session-storage.mjs', 'message-renderer.mjs',
]);
const memoryFiles = Object.freeze([
  'memory/workspace.mjs', 'memory/store.mjs', 'memory/events.mjs', 'memory/context.mjs', 'memory/context-panel.mjs',
  'memory/structured-context.mjs', 'memory/automatic-context.mjs', 'memory/rag-adapter.mjs',
  'memory/restore-events.mjs', 'memory/citations.mjs', 'memory/panel.mjs', 'memory/panel.css', 'memory/navigation.mjs', 'memory/compaction-cue.mjs',
  'memory/retained-compaction.mjs', 'memory/summary-effects.mjs',
  'memory/rag-core.mjs', 'memory/graph-renderer.mjs',
  'memory/automatic-memory.mjs', 'memory/conversation-index.mjs',
  'memory/scoped-pockets.mjs', 'memory/starter-facts.mjs',
]);
const automaticMemoryFiles = new Set(['memory/automatic-memory.mjs', 'memory/conversation-index.mjs',
  'memory/scoped-pockets.mjs', 'memory/starter-facts.mjs']);
const summaryMemoryFiles = new Set(['memory/retained-compaction.mjs', 'memory/summary-effects.mjs']);
const memoryCoreSha256 = 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6';
const graphRendererSha256 = '6472ea58741464fff73401c640c094acb145adcbf732025329937e48f608c651';
const graphLicenses = Object.freeze({
  'LICENSES/forcegraph-tsl.txt': '1a897e0ee6f1fc65889976eadb848acefac9db7f9c97274a6c490f52390cd474',
  'LICENSES/three.txt': '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc',
});
const modelLicenseSource = 'examples/browser-model-chat/licenses/LFM-Open-License-1.0.txt';
const modelLicensePath = 'LICENSES/lfm-open-license-1.0.txt';
const modelLicenseSha256 = '30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b';
const runtimeIdentities = Object.freeze({ ...RUNTIME.files, ...COMPAT.files });
const runtimeFiles = Object.freeze(Object.keys(runtimeIdentities));
const payloadPaths = Object.freeze([...browserFiles, 'theme/aurel-gold.css',
  ...runtimeFiles.map(name => 'runtime/' + name), 'LICENSES/rag-method.txt', 'NOTICE.txt', 'README.txt'].sort());
// Each historical identity predates message rendering. Keep its exact path set
// independent of additions to the current browser payload.
const previousRendererPayloadPaths = payloadPaths.filter(name => name !== 'message-renderer.mjs');
const previousSessionPayloadPaths = previousRendererPayloadPaths.filter(name => name !== 'session-storage.mjs');
const preMemoryPayloadPaths = previousSessionPayloadPaths.filter(name => !['wasm-memory.mjs', 'runtime-profile.mjs'].includes(name));
const priorPayloadPaths = preMemoryPayloadPaths.filter(name => name !== 'runtime-errors.mjs');
const legacyPayloadPaths = priorPayloadPaths.filter(name => !name.startsWith('runtime/compat/'));
const previousContextMemoryFiles = memoryFiles.filter(name => !summaryMemoryFiles.has(name));
const previousMemoryFiles = previousContextMemoryFiles.filter(name => !['memory/navigation.mjs', 'memory/compaction-cue.mjs', 'memory/context-panel.mjs'].includes(name));
const previousMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousMemoryFiles.filter(name => name !== 'memory/graph-renderer.mjs' && !automaticMemoryFiles.has(name)), modelLicensePath].sort());
const previousGraphMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousMemoryFiles.filter(name => !automaticMemoryFiles.has(name)), modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousAutomaticMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousMemoryFiles, modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousNavigationMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousContextMemoryFiles.filter(name => !['memory/compaction-cue.mjs', 'memory/context-panel.mjs'].includes(name)), modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousCompactionMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousContextMemoryFiles.filter(name => name !== 'memory/context-panel.mjs'), modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousContextMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...previousContextMemoryFiles, modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousSummaryMemoryPayloadPaths = Object.freeze([...previousSessionPayloadPaths, ...memoryFiles, modelLicensePath, ...Object.keys(graphLicenses)].sort());
const previousRendererMemoryPayloadPaths = Object.freeze([...previousRendererPayloadPaths, ...memoryFiles, modelLicensePath, ...Object.keys(graphLicenses)].sort());
const memoryPayloadPaths = Object.freeze([...payloadPaths, ...memoryFiles, modelLicensePath, ...Object.keys(graphLicenses)].sort());
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
      || ![...(memoryPreview ? [memoryPayloadPaths, previousRendererMemoryPayloadPaths, previousSummaryMemoryPayloadPaths, previousContextMemoryPayloadPaths, previousCompactionMemoryPayloadPaths, previousNavigationMemoryPayloadPaths, previousAutomaticMemoryPayloadPaths, previousGraphMemoryPayloadPaths, previousMemoryPayloadPaths] : []), payloadPaths, previousRendererPayloadPaths, previousSessionPayloadPaths, preMemoryPayloadPaths, priorPayloadPaths, legacyPayloadPaths]
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
      const generated = name === 'memory/rag-core.mjs' || name === 'memory/graph-renderer.mjs';
      const sourcePath = generated ? '.artifacts/' + name : 'examples/browser-model-chat/' + name;
      const bytes = await ordinaryBytes(join(workspace, sourcePath), sourcePath, generated ? 4 * 1024 * 1024 : 1024 * 1024);
      if (name === 'memory/rag-core.mjs' && hash(bytes) !== memoryCoreSha256) throw new Error('Pinned memory core SHA-256 mismatch.');
      if (name === 'memory/graph-renderer.mjs' && hash(bytes) !== graphRendererSha256) throw new Error('Pinned graph renderer SHA-256 mismatch.');
      payload.set(name, bytes); source.set(sourcePath, bytes);
    }
    const modelLicense = await ordinaryBytes(join(workspace, modelLicenseSource), modelLicenseSource, 64 * 1024);
    if (hash(modelLicense) !== modelLicenseSha256) throw new Error('Pinned model license SHA-256 mismatch.');
    payload.set(modelLicensePath, modelLicense); source.set(modelLicenseSource, modelLicense);
    source.set('examples/browser-model-chat/memory/build-core.mjs', await ordinaryBytes(join(example, 'memory/build-core.mjs'), 'memory core build source'));
    for (const [path, expected] of Object.entries(graphLicenses)) {
      const sourcePath = '.artifacts/memory/' + path;
      const bytes = await ordinaryBytes(join(workspace, sourcePath), sourcePath, 64 * 1024);
      if (hash(bytes) !== expected) throw new Error('Pinned graph license SHA-256 mismatch: ' + path);
      payload.set(path, bytes); source.set(sourcePath, bytes);
    }
    for (const path of ['examples/browser-model-chat/memory/build-graph.mjs',
      'modules/browser-rag-ts/src/application/graphRenderer.ts', 'modules/browser-rag-ts/src/application/layoutGraph.ts',
      'modules/browser-rag-ts/src/application/memoryGraphLayout.ts',
      'modules/browser-rag-ts/src/application/graphPalette.ts', 'modules/browser-rag-ts/src/presentation/nodeSpawnMotion.js',
      'modules/browser-rag-ts/vendor/graph-package.json', 'modules/browser-rag-ts/vendor/ours-forcegraph-tsl-0.3.0-alpha.1.tgz',
      'modules/browser-rag-ts/package-lock.json']) source.set(path, await ordinaryBytes(join(workspace, path), path));
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
    ...(memoryPreview ? [
      '@ours/forcegraph-tsl 0.3.0-alpha.1: MIT. Complete retained text: LICENSES/forcegraph-tsl.txt.',
      'Three.js 0.185.0: MIT. Complete retained text: LICENSES/three.txt.',
      'The graph bundle reuses the existing admitted TSL renderer and local layout; no graph worker or remote dependency is required.',
    ] : []),
    'Model weights are not included in this static payload. Download is an explicit browser action.',
    'The model license applies to model use and redistribution; inspect its pinned terms before deployment.', '',
    ...(memoryPreview ? [
      'Automatic message nodes derive from canonical user and generated-assistant turns; assistant output is not admitted as user evidence.',
      'Global Space starters cite NASA Earth facts, Moon facts and Mars moons pages; they are separate from personal conversation history.',
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
      'Open ?memory=1 for this one-chat memory preview; add &graph=0 for its searchable HTML memory list without the optional TSL graph.',
      'The pinned TSL renderer uses Three WebGPU with a WebGL2 backend fallback; unavailable graphics retain accessible memory controls.',
      'Graph startup or device loss is not a guarantee of mobile GPU support. No new iOS qualification follows from this package.',
      'Graph supports orbit, expanded view and read-only Context inspection. Visual selection grants no additional permissions.',
      'Three 0.185.0 retains an internal frame clock while Graph is visible; the strict visible zero-RAF criterion remains unmet.',
      'Physical iOS, new native inference and full installed dependency parity remain unqualified; the source guide records the missing vite/client declaration limit.',
      'Older context is selected automatically as source-linked exact passages; no special markup is required.',
      'Each accepted message creates a canonical Conversation node. Generated-assistant text remains labeled and is excluded from retrieved user evidence.',
      'The pocket filter changes real retrieval: Global public Space starters, explicit Persona user excerpts, current Conversation, or All pockets.',
      'Scope bindings include actor, persona and conversation identities; visual selection grants no permissions.',
      'Space starters cite https://science.nasa.gov/earth/facts/, https://science.nasa.gov/moon/facts/ and https://science.nasa.gov/mars/moons/.',
      'Search highlights actual matches. Last-used nodes light only after dispatch. No automatic fact promotion or agent orchestration is included.',
      'The Context tab distinguishes latest prepared from last submitted requests; submission does not prove model use or answer truth.',
      'Exact memory/request text is session-only and unavailable when its inspection bound is exceeded; retained rows report supplied totals and omissions.',
      'Retrieval candidates are the supplied core-returned stage, not all indexed documents. Scores and reasons appear only when actually supplied.',
      'Automatic passage selection is lossy extractive context, not general semantic summarization or verified fact admission.',
      'Explicit Save stores selected exact user words separately for keyword retrieval; Forget does not erase the transcript.',
      'Remember for persona retains exact user-source proof. Forget/version exclusions persist when saving succeeds; quota failures report session-only state.',
      'The index refuses more than 512 turns or 512 KiB; Persona memory is bounded to 32 excerpts and 256 KiB including proof/history.',
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
    ...(memoryPreview ? { graph: { package: '@ours/forcegraph-tsl', version: '0.3.0-alpha.1', threeVersion: '0.185.0',
      bundlePath: 'memory/graph-renderer.mjs', bundleSha256: graphRendererSha256, layoutBackend: 'local', licenses: graphLicenses } } : {}),
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
