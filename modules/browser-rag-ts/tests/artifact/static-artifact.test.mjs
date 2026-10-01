import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { artifactIdentity, assertArtifactNotices, sha256Bytes, STATIC_ARTIFACT_SCHEMA, validateStaticArtifactDirectory } from "../../scripts/static-artifact-common.mjs";

const digest = (digit) => digit.repeat(64);

function fixture() {
  const artifact = { name: "rag-method-documentation-vault-showcase", version: "0.1.0", subpath: "/rag-method/", entrypoint: "index.html" };
  const dependencies = {
    "@ours/forcegraph-tsl": { version: "0.3.0-alpha.1" },
    three: { version: "0.185.0" },
  };
  const notices = [
    { id: "rag-method", package_name: "@rag-method/browser-rag-ts", version: "0.1.0", license: "MIT", path: "LICENSES/rag-method.txt", sha256: digest("a") },
    { id: "@ours/forcegraph-tsl", package_name: "@ours/forcegraph-tsl", version: "0.3.0-alpha.1", license: "MIT", path: "LICENSES/forcegraph-tsl.txt", sha256: digest("b") },
    { id: "three", package_name: "three", version: "0.185.0", license: "MIT", path: "LICENSES/three.txt", sha256: digest("c") },
  ];
  const files = [
    ...notices.map(({ path, sha256 }) => ({ path, bytes: 100, sha256 })),
    { path: "LICENSES/NOTICE.txt", bytes: 100, sha256: digest("d") },
  ];
  return { artifact, dependencies, notices, files };
}

test("artifact notices require every complete, payload-bound license record", () => {
  const value = fixture();
  assert.doesNotThrow(() => assertArtifactNotices(value, {
    "rag-method": digest("a"),
    "@ours/forcegraph-tsl": digest("b"),
    three: digest("c"),
  }));
  assert.throws(() => assertArtifactNotices({ ...value, notices: value.notices.slice(1) }), /notice inventory is incomplete/);
  assert.throws(() => assertArtifactNotices({ ...value, files: value.files.filter((file) => file.path !== "LICENSES/three.txt") }), /missing from the hashed payload/);
  assert.throws(() => assertArtifactNotices(value, { three: digest("e") }), /notice text drifted/);
});

test("artifact identity changes when notice metadata changes", () => {
  const value = fixture();
  const input = { ...value, source: { kind: "source-snapshot", fingerprint_sha256: digest("f") }, launch: {}, exclusions: {} };
  const original = artifactIdentity(input);
  const changed = artifactIdentity({ ...input, notices: input.notices.map((notice) => notice.id === "three" ? { ...notice, sha256: digest("e") } : notice) });
  assert.notEqual(original, changed);
});

test("staged working-source artifacts require an explicit unreviewed label bound into identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rag-static-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = fixture();
  const files = [];
  const notices = [];
  for (const file of value.files) {
    const bytes = Buffer.from(`synthetic notice fixture: ${file.path}\n`);
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const sha256 = sha256Bytes(bytes);
    files.push({ path: file.path, bytes: bytes.length, sha256 });
    const notice = value.notices.find((item) => item.path === file.path);
    if (notice) notices.push({ ...notice, sha256 });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const launch = { unknown_paths: "404" };
  const exclusions = { repository_source: true };
  async function emit(source) {
    const input = { artifact: value.artifact, source, dependencies: value.dependencies, files, notices, launch, exclusions };
    await writeFile(join(root, "artifact-manifest.json"), JSON.stringify({
      schema: STATIC_ARTIFACT_SCHEMA, ...input,
      artifact: { ...value.artifact, identity_sha256: artifactIdentity(input) },
    }));
    return artifactIdentity(input);
  }
  const source = { kind: "working-source", review_status: "unreviewed", fingerprint_sha256: digest("f") };
  const workingIdentity = await emit(source);
  assert.deepEqual((await validateStaticArtifactDirectory(root)).source, source);
  await emit({ kind: "working-source", fingerprint_sha256: source.fingerprint_sha256 });
  await assert.rejects(validateStaticArtifactDirectory(root), /source identity is invalid/);
  await emit({ kind: "source-snapshot", review_status: "unreviewed", fingerprint_sha256: source.fingerprint_sha256 });
  await assert.rejects(validateStaticArtifactDirectory(root), /source identity is invalid/);
  const reviewedIdentity = await emit({ kind: "source-snapshot", fingerprint_sha256: source.fingerprint_sha256 });
  assert.notEqual(workingIdentity, reviewedIdentity);
  assert.equal((await validateStaticArtifactDirectory(root)).source.kind, "source-snapshot");
});
