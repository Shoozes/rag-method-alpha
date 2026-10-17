import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertDistinctReceiptOwner } from './receipt-owner.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'receipt-owner-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test('independent baseline and output retain their own bytes', () => fixture(async root => {
  const baseline = join(root, 'baseline.json'), output = join(root, 'output.json');
  await writeFile(baseline, '{"before":true}'); await writeFile(output, '{"after":true}');
  await assertDistinctReceiptOwner(baseline, output);
  assert.equal(await readFile(baseline, 'utf8'), '{"before":true}');
  await assertDistinctReceiptOwner(baseline, join(root, 'new.json'));
}));
test('normalized aliases cannot overwrite the only baseline body', () => fixture(async root => {
  const baseline = join(root, 'receipt.json'); await writeFile(baseline, '{"before":true}');
  await mkdir(join(root, 'nested'));
  await assert.rejects(assertDistinctReceiptOwner(baseline, join(root, 'nested', '..', 'receipt.json')), /own output/);
  assert.equal(await readFile(baseline, 'utf8'), '{"before":true}');
}));
test('a second hard-link name cannot masquerade as an external owner', () => fixture(async root => {
  const baseline = join(root, 'baseline.json'), output = join(root, 'alias.json');
  await writeFile(baseline, '{"before":true}'); await link(baseline, output);
  await assert.rejects(assertDistinctReceiptOwner(baseline, output), /hard links/);
  assert.equal(await readFile(baseline, 'utf8'), '{"before":true}');
}));
