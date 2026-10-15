import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME } from './model-contract.mjs';

const args = process.argv.slice(2);
if (!(args.length === 1 && args[0] === '--fetch') && !(args.length === 2 && args[0] === '--archive')) {
  console.error('Explicit setup: node examples/browser-model-chat/prepare-runtime.mjs --fetch\nOr reuse the exact npm archive: --archive <path>. No model is downloaded.');
  process.exit(2);
}
const output = fileURLToPath(new URL('../../.artifacts/model-chat/runtime/', import.meta.url));
let archive;
const archiveLimit = 8 * 1024 * 1024;
if (args[0] === '--archive') {
  if ((await stat(resolve(args[1]))).size > archiveLimit) throw new Error('Runtime archive exceeds bound');
  archive = await readFile(resolve(args[1]));
}
else {
  const response = await fetch(RUNTIME.tarball, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Runtime download failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > archiveLimit) throw new Error('Runtime archive exceeds bound');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > archiveLimit) throw new Error('Runtime archive exceeds bound');
    chunks.push(chunk);
  }
  archive = Buffer.concat(chunks, bytes);
}
if (archive.length > archiveLimit || createHash('sha512').update(archive).digest('base64') !== RUNTIME.integrity) {
  throw new Error('Runtime archive integrity mismatch; nothing extracted');
}
// Extract only the three pinned ordinary files. Never execute package scripts.
const tar = gunzipSync(archive, { maxOutputLength: 20 * 1024 * 1024 });
const selected = new Map();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
  if (!name) break;
  const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
  if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid bounded tar');
  const match = Object.entries(RUNTIME.files).find(([, item]) => item.entry === name);
  if (match) {
    if (![0, 48].includes(header[156])) throw new Error('Expected ordinary runtime file');
    const [target, identity] = match;
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    if (createHash('sha256').update(bytes).digest('hex') !== identity.sha256) throw new Error(`Runtime file mismatch: ${target}`);
    selected.set(target, bytes);
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (selected.size !== 3) throw new Error('Incomplete pinned runtime archive');
await mkdir(output, { recursive: true });
for (const [name, bytes] of selected) await writeFile(resolve(output, name), bytes);
console.log(JSON.stringify({ runtime: `@wllama/wllama@${RUNTIME.version}`, files: [...selected].map(([name, bytes]) => ({ name, bytes: bytes.length })), modelsDownloaded: 0 }));
