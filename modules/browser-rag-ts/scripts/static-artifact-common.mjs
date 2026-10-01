import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { stable } from "./report-common.mjs";

export const STATIC_ARTIFACT_SCHEMA = "browser-rag-ts-static-artifact-v3";
export const REQUIRED_NOTICE_IDS = Object.freeze(["rag-method", "@ours/forcegraph-tsl", "three"]);

const PRIVATE_PATH = /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/|file:\/\/|\.tools[\\/]\.secrets|gt\.txt)/iu;

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function containsPrivatePath(value) {
  return PRIVATE_PATH.test(typeof value === "string" ? value : value.toString("utf8"));
}

export function assertPrivacyClassifier() {
  for (const value of ["C:\\Users\\operator\\file.txt", "/Users/operator/file.txt", "/home/operator/file.txt", "file:///private.txt", ".tools/.secrets/key", "gt.txt"]) {
    if (!containsPrivatePath(value)) throw new Error("static artifact privacy classifier missed a private path class: " + value);
  }
  if (containsPrivatePath("RAG Method browser workbench")) throw new Error("static artifact privacy classifier rejected ordinary content");
}

export function assertArtifactNotices({ artifact, dependencies, files, notices }, expectedHashes = {}) {
  if (!Array.isArray(notices) || notices.length !== REQUIRED_NOTICE_IDS.length) throw new Error("static artifact notice inventory is incomplete");
  const expected = new Map([
    ["rag-method", { package_name: "@rag-method/browser-rag-ts", version: artifact?.version }],
    ["@ours/forcegraph-tsl", { package_name: "@ours/forcegraph-tsl", version: dependencies?.["@ours/forcegraph-tsl"]?.version }],
    ["three", { package_name: "three", version: dependencies?.three?.version }],
  ]);
  const fileByPath = new Map((files ?? []).map((file) => [file.path, file]));
  const seen = new Set();
  for (const notice of notices) {
    const wanted = expected.get(notice?.id);
    if (!wanted || seen.has(notice.id)) throw new Error("static artifact notice identity is invalid");
    seen.add(notice.id);
    if (notice.package_name !== wanted.package_name || notice.version !== wanted.version || notice.license !== "MIT") throw new Error(`static artifact notice metadata is invalid: ${notice.id}`);
    if (typeof notice.path !== "string" || !notice.path.startsWith("LICENSES/") || !/^[0-9a-f]{64}$/.test(notice.sha256 ?? "")) throw new Error(`static artifact notice path or digest is invalid: ${notice.id}`);
    const file = fileByPath.get(notice.path);
    if (!file || file.sha256 !== notice.sha256) throw new Error(`static artifact notice is missing from the hashed payload: ${notice.id}`);
    if (expectedHashes[notice.id] !== undefined && expectedHashes[notice.id] !== notice.sha256) throw new Error(`static artifact notice text drifted: ${notice.id}`);
  }
  if (seen.size !== expected.size || !fileByPath.has("LICENSES/NOTICE.txt")) throw new Error("static artifact required notices are incomplete");
}

export function artifactIdentity({ artifact, source, dependencies, files, launch, exclusions, notices }) {
  return sha256Bytes(JSON.stringify(stable({ artifact, source, dependencies, files, launch, exclusions, notices })));
}

export async function validateStaticArtifactDirectory(root) {
  const manifest = JSON.parse(await readFile(join(root, "artifact-manifest.json"), "utf8"));
  if (manifest.schema !== STATIC_ARTIFACT_SCHEMA || manifest.artifact?.entrypoint !== "index.html") throw new Error("static artifact manifest identity is invalid");
  const source = manifest.source;
  const validSource = (source?.kind === "source-snapshot" && source.review_status === undefined)
    || (source?.kind === "working-source" && source.review_status === "unreviewed");
  if (!/^[0-9a-f]{64}$/.test(manifest.artifact?.identity_sha256 ?? "") || !validSource || !/^[0-9a-f]{64}$/.test(source?.fingerprint_sha256 ?? "")) throw new Error("static artifact source identity is invalid");
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.launch?.unknown_paths !== "404") throw new Error("static artifact manifest is incomplete");
  if (!Object.values(manifest.exclusions ?? {}).length || !Object.values(manifest.exclusions).every((value) => value === true)) throw new Error("static artifact exclusions are incomplete");

  const actual = [];
  for (const path of await artifactFiles(root)) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (name === "artifact-manifest.json") continue;
    const value = await readFile(path);
    if (containsPrivatePath(value)) throw new Error(`static artifact leaks a private path: ${name}`);
    actual.push({ path: name, bytes: value.byteLength, sha256: sha256Bytes(value) });
  }
  actual.sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("static artifact file inventory or hash differs from emitted bytes");
  assertArtifactNotices(manifest);
  const { identity_sha256: declaredIdentity, ...artifact } = manifest.artifact;
  const computedIdentity = artifactIdentity({ artifact, source: manifest.source, dependencies: manifest.dependencies, files: manifest.files, launch: manifest.launch, exclusions: manifest.exclusions, notices: manifest.notices });
  if (computedIdentity !== declaredIdentity) throw new Error("static artifact identity does not bind its complete manifest metadata and payload inventory");
  return manifest;
}

async function artifactFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await artifactFiles(child));
    else if (entry.isFile()) output.push(child);
    else throw new Error(`static artifact contains an unsupported filesystem entry: ${relative(root, child)}`);
  }
  return output;
}
