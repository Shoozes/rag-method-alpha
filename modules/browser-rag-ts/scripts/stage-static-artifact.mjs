import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";
import { ROOT } from "./report-common.mjs";
import { resolveBuildSource } from "../../../scripts/public-source.mjs";
import { artifactIdentity, assertArtifactNotices, assertPrivacyClassifier, containsPrivatePath, sha256Bytes, STATIC_ARTIFACT_SCHEMA } from "./static-artifact-common.mjs";
import { graphArchivePath, loadGraphReceipt } from "./vendor-receipt.mjs";

const DIST = resolve(MODULE_ROOT, ".artifacts", "dist");
const RELEASE_ROOT = resolve(MODULE_ROOT, ".artifacts", "release");
const ARTIFACT = resolve(RELEASE_ROOT, "browser-rag-ts");
const STAGING = resolve(RELEASE_ROOT, `browser-rag-ts.staging-${process.pid}`);
const MANIFEST_NAME = "artifact-manifest.json";
const FORBIDDEN_PATH_PARTS = new Set([".git", ".tools", ".agents", ".workspace", ".runtime", "node_modules", "runtime-data", ".secrets", "coverage"]);

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(child));
    else if (entry.isFile()) output.push(child);
    else throw new Error(`static artifact contains an unsupported filesystem entry: ${relative(root, child)}`);
  }
  return output;
}

async function sha256(path) {
  return sha256Bytes(await readFile(path));
}

assertPrivacyClassifier();
const sourceEntries = await files(DIST);
if (!sourceEntries.length) throw new Error("production output is empty; run the Vite build before staging the static artifact");

await mkdir(RELEASE_ROOT, { recursive: true });
await rm(STAGING, { recursive: true, force: true });
let promoted = false;
try {
await cp(DIST, STAGING, { recursive: true, force: false, errorOnExist: true });

const launchText = [
  "RAG Method Documentation Vault Showcase static artifact",
  "",
  "Mount this directory at /rag-method/ on a static HTTP server.",
  "The landing page is index.html; the explorer is browser/index.html.",
  "Serve index.html for the directory route only; unknown files must return 404.",
  "Serve .js files as JavaScript, .css files as text/css, and .html files as text/html.",
  "No repository checkout, Node.js runtime, node_modules, mutable data, or credentials are required at runtime.",
  "The application stores its accepted corpus only in the current browser Worker session.",
  "Complete first-party and shipped runtime dependency license texts are under LICENSES/.",
  "",
].join("\n");
await writeFile(join(STAGING, "README.txt"), launchText, "utf8");

const packageManifest = JSON.parse(await readFile(join(MODULE_ROOT, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(join(MODULE_ROOT, "package-lock.json"), "utf8"));
const graphReceipt = await loadGraphReceipt();
const installedGraph = packageLock.packages?.["node_modules/@ours/forcegraph-tsl"];
const installedThree = packageLock.packages?.["node_modules/three"];
if (graphReceipt.package.version !== installedGraph?.version
  || graphReceipt.package?.license !== installedGraph?.license
  || !installedGraph?.integrity
  || !installedThree?.version
  || installedThree.license !== "MIT"
  || !installedThree.integrity) {
  throw new Error("locked graph dependency identities are incomplete");
}
const vendorArchive = graphArchivePath(graphReceipt);
const vendorBytes = (await stat(vendorArchive)).size;
if (vendorBytes !== graphReceipt.archive.bytes || await sha256(vendorArchive) !== graphReceipt.archive.sha256) throw new Error("vendored graph archive differs from its canonical receipt");

const noticeSources = [
  { id: "rag-method", package_name: "@rag-method/browser-rag-ts", version: packageManifest.version, license: "MIT", path: "LICENSES/rag-method.txt", source: resolve(ROOT, "LICENSE") },
  { id: "@ours/forcegraph-tsl", package_name: "@ours/forcegraph-tsl", version: installedGraph.version, license: "MIT", path: "LICENSES/forcegraph-tsl.txt", source: resolve(MODULE_ROOT, "node_modules", "@ours", "forcegraph-tsl", "LICENSE") },
  { id: "three", package_name: "three", version: installedThree.version, license: "MIT", path: "LICENSES/three.txt", source: resolve(MODULE_ROOT, "node_modules", "three", "LICENSE") },
];
await mkdir(join(STAGING, "LICENSES"), { recursive: true });
const notices = [];
for (const notice of noticeSources) {
  const bytes = await readFile(notice.source);
  await writeFile(resolve(STAGING, notice.path), bytes);
  notices.push({ id: notice.id, package_name: notice.package_name, version: notice.version, license: notice.license, path: notice.path, sha256: sha256Bytes(bytes) });
}
const noticeIndex = [
  "RAG Method Documentation Vault Showcase notices",
  "",
  ...notices.flatMap((notice) => [`${notice.package_name}@${notice.version} — ${notice.license}`, `  ${notice.path}`, ""]),
  "These files preserve the complete license text for the application, the pinned Three.js documentation corpus, and runtime dependencies incorporated into the browser bundle.",
  "",
].join("\n");
await writeFile(join(STAGING, "LICENSES", "NOTICE.txt"), noticeIndex, "utf8");

const source = resolveBuildSource(ROOT);
const artifactFiles = [];
for (const path of await files(STAGING)) {
  const name = relative(STAGING, path).replaceAll("\\", "/");
  const parts = name.split("/");
  if (parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) throw new Error(`static artifact includes a forbidden path: ${name}`);
  const bytes = await readFile(path);
  if (containsPrivatePath(bytes)) throw new Error(`static artifact leaks a private path: ${name}`);
  artifactFiles.push(Object.freeze({ path: name, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) }));
}
artifactFiles.sort((left, right) => left.path.localeCompare(right.path));

const artifact = {
  name: "rag-method-documentation-vault-showcase",
  version: packageManifest.version,
  subpath: "/rag-method/",
  entrypoint: "index.html",
};
const dependencies = {
    "@ours/forcegraph-tsl": {
      version: installedGraph.version,
      license: installedGraph.license,
      integrity: installedGraph.integrity,
      source: graphReceipt.source,
      archive_sha256: graphReceipt.archive.sha256,
      archive_bytes: vendorBytes,
    },
    three: { version: installedThree.version, license: installedThree.license, integrity: installedThree.integrity },
};
const launch = {
  document: "README.txt",
  runtime: "static HTTP server",
  mount_path: artifact.subpath,
  unknown_paths: "404",
};
const exclusions = {
  repository_source: true,
  node_modules: true,
  operator_documents: true,
  credentials: true,
  mutable_runtime_data: true,
  development_caches: true,
};
assertArtifactNotices({ artifact, dependencies, files: artifactFiles, notices });
const identityInput = { artifact, source, dependencies, files: artifactFiles, launch, exclusions, notices };
const manifest = {
  schema: STATIC_ARTIFACT_SCHEMA,
  artifact: {
    ...artifact,
    identity_sha256: artifactIdentity(identityInput),
  },
  source,
  dependencies,
  notices,
  files: artifactFiles,
  launch,
  exclusions,
};
await writeFile(join(STAGING, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

await rm(ARTIFACT, { recursive: true, force: true });
await mkdir(dirname(ARTIFACT), { recursive: true });
await rename(STAGING, ARTIFACT);
promoted = true;
console.log(`browser-rag-ts static artifact: ${artifactFiles.length} payload files; identity ${manifest.artifact.identity_sha256}`);
console.log(`source ${source.fingerprint_sha256}: ${source.kind === "source-snapshot" ? "matches reviewed public snapshot" : "unreviewed working source; no release acceptance"}`);
} finally {
  if (!promoted) await rm(STAGING, { recursive: true, force: true });
}
