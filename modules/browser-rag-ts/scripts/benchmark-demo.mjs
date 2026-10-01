// Run after scripts/test.mjs compiles the Worker. Compare receipts on the same host.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ROOT } from './report-common.mjs';
import { resolveBuildSource } from '../../../scripts/public-source.mjs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { handleRequest } from '../.artifacts/test-dist/src/worker/rag.worker.js';

const label = process.argv[2] ?? 'candidate';
if (!/^[a-z0-9-]+$/u.test(label)) throw new Error('Use a simple receipt label');
const pack = JSON.parse(await readFile(new URL('../demo/public/corpora/threejs-docs.pack.json', import.meta.url), 'utf8'));
let sequence = 0;
async function request(operation, payload) {
  const start = performance.now();
  const response = await handleRequest({ version: 1, request_id: `bench-${++sequence}`, operation, payload });
  if (response.status !== 'ok') throw new Error(JSON.stringify(response));
  return { elapsed_ms: Math.round(performance.now() - start), result: response.result };
}
const runs = [];
for (let i = 0; i < 3; i++) {
  const loaded = await request('load-documents', { documents: pack.documents });
  const searched = await request('search', { query: 'TextureLoader loadAsync', options: { mode: 'keyword_only', top_k: 8, include_scopes: ['browser:local'], expand: true } });
  runs.push({ import_ms: loaded.elapsed_ms, query_ms: searched.elapsed_ms, records: loaded.result.records, output_sha256: createHash('sha256').update(JSON.stringify([loaded.result, searched.result])).digest('hex') });
  console.log(JSON.stringify(runs.at(-1)));
}
const receipt = { source: resolveBuildSource(ROOT), node: process.version, platform: process.platform, corpus_identity: pack.manifest.identity_sha256, label, runs };
const output = resolve('.artifacts/proof/demo-polish');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, `timing-${label}.json`), JSON.stringify(receipt, null, 2) + '\n');
await request('dispose');
