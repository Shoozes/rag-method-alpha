import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPAT, RUNTIME } from './model-contract.mjs';

const runtimeRoot = fileURLToPath(new URL('../../.artifacts/model-chat/runtime/', import.meta.url));
const profiles = [
  { id: 'main', package: '@wllama/wllama', contract: RUNTIME, archiveLimit: 8 * 1024 * 1024 },
  { id: 'compat', package: COMPAT.package, contract: COMPAT, archiveLimit: 16 * 1024 * 1024 },
];
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

/** Authenticate the complete archive, then select only pinned ordinary files. No scripts run. */
export function verifiedRuntimeFiles(archive, contract, archiveLimit = 16 * 1024 * 1024) {
  if (archive.length > archiveLimit || digest(archive, 'sha512', 'base64') !== contract.integrity) {
    throw new Error('Runtime archive integrity mismatch; nothing extracted');
  }
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  const selected = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid bounded tar');
    const match = Object.entries(contract.files).find(([, item]) => item.entry === name);
    if (match) {
      if (![0, 48].includes(header[156])) throw new Error('Expected ordinary runtime file');
      const [target, identity] = match;
      if (selected.has(target)) throw new Error('Duplicate pinned runtime file: ' + target);
      const bytes = tar.subarray(offset + 512, offset + 512 + size);
      if ((identity.bytes !== undefined && bytes.length !== identity.bytes) || digest(bytes) !== identity.sha256) {
        throw new Error('Runtime file mismatch: ' + target);
      }
      selected.set(target, bytes);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (selected.size !== Object.keys(contract.files).length) throw new Error('Incomplete pinned runtime archive');
  return selected;
}

async function archiveBytes(path, limit) {
  const info = await lstat(resolve(path));
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Runtime archive is not a bounded ordinary file');
  const bytes = await readFile(resolve(path));
  if (bytes.length !== info.size) throw new Error('Runtime archive changed while reading');
  return bytes;
}

async function downloadArchive(profile, fetchImpl) {
  const response = await fetchImpl(profile.contract.tarball, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Runtime download failed (' + response.status + ')');
  if (Number(response.headers.get('content-length')) > profile.archiveLimit) throw new Error('Runtime archive exceeds bound');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > profile.archiveLimit) throw new Error('Runtime archive exceeds bound');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

async function ordinaryParents(output, name, create = false) {
  for (const directory of [output, dirname(resolve(output, name))]) {
    let info;
    try { info = await lstat(directory); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (create) { await mkdir(directory, { recursive: true }); info = await lstat(directory); }
      else continue;
    }
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Runtime output must use ordinary directories');
  }
}

/** Keep verified files in place; authenticate every requested archive before any writes. */
export async function prepareRuntime({ output = runtimeRoot, archives = {}, fetchMissing = false, fetchImpl = fetch } = {}) {
  output = resolve(output);
  const retained = new Set(), incoming = new Map(), report = [];
  for (const profile of profiles) {
    const missing = [];
    for (const [name, identity] of Object.entries(profile.contract.files)) {
      await ordinaryParents(output, name);
      let info;
      try { info = await lstat(resolve(output, name)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        missing.push(name); continue;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('Invalid retained runtime file: ' + name);
      const bytes = await readFile(resolve(output, name));
      if (bytes.length !== info.size || (identity.bytes !== undefined && bytes.length !== identity.bytes) || digest(bytes) !== identity.sha256) {
        throw new Error('Retained runtime SHA-256 mismatch: ' + name);
      }
      retained.add(name);
    }
    let selected;
    if (archives[profile.id]) selected = verifiedRuntimeFiles(await archiveBytes(archives[profile.id], profile.archiveLimit), profile.contract, profile.archiveLimit);
    else if (missing.length && fetchMissing) selected = verifiedRuntimeFiles(await downloadArchive(profile, fetchImpl), profile.contract, profile.archiveLimit);
    else if (missing.length) throw new Error('Missing ' + profile.package + ' assets; provide ' + (profile.id === 'main' ? '--archive' : '--compat-archive') + ' or explicitly use --fetch');
    for (const name of missing) incoming.set(name, selected.get(name));
    report.push({ package: profile.package, version: profile.contract.version, retained: Object.keys(profile.contract.files).filter(name => retained.has(name)), prepared: missing });
  }
  for (const [name, bytes] of incoming) {
    await ordinaryParents(output, name, true);
    await writeFile(resolve(output, name), bytes, { flag: 'wx' });
  }
  return { profiles: report, filesWritten: incoming.size, modelsDownloaded: 0 };
}

export function parseSetupArgs(args) {
  const options = { archives: {} };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--fetch' && !options.fetchMissing) options.fetchMissing = true;
    else if (['--archive', '--compat-archive'].includes(name) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const id = name === '--archive' ? 'main' : 'compat';
      if (options.archives[id]) throw new Error('Duplicate setup option');
      options.archives[id] = args[++index];
    } else throw new Error('Usage: prepare-runtime.mjs --fetch OR --archive <main.tgz> [--compat-archive <compat.tgz>] OR --compat-archive <compat.tgz>');
  }
  if (!args.length || (options.fetchMissing && Object.keys(options.archives).length)) throw new Error('Choose --fetch or explicit archive files. No model is downloaded.');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareRuntime(parseSetupArgs(process.argv.slice(2))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
