import assert from 'node:assert/strict';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// A reference-only baseline must survive writing the new receipt, including
// when two different names resolve to a symlink or hard link of the same file.
export async function assertDistinctReceiptOwner(baselinePath, outputPath) {
  const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
  assert.notEqual(normalize(resolve(baselinePath)), normalize(resolve(outputPath)),
    'An external baseline receipt cannot be its own output.');
  const owner = await realpath(baselinePath);
  const output = await realpath(outputPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!output) return;
  assert.notEqual(normalize(owner), normalize(output), 'Baseline and output resolve to the same receipt.');
  const [ownerInfo, outputInfo] = await Promise.all([stat(owner, { bigint: true }), stat(output, { bigint: true })]);
  assert.ok(!(ownerInfo.ino !== 0n && ownerInfo.dev === outputInfo.dev && ownerInfo.ino === outputInfo.ino),
    'Baseline and output are hard links of the same receipt.');
}
