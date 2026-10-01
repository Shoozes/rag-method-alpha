import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_COMMIT = "1a1c86699f9c38d4bef1cf51652e5f0e0680d745";
const CONVERSION_VERSION = 2;
const CORPUS_ROOT = resolve(ROOT, "corpora", "threejs-docs");
const VAULT_ROOT = resolve(CORPUS_ROOT, "vault");
const MANIFEST_PATH = resolve(CORPUS_ROOT, "manifest.json");
const LICENSE_PATH = resolve(CORPUS_ROOT, "THREEJS-LICENSE.txt");
const PACK_PATH = resolve(ROOT, "modules", "browser-rag-ts", "demo", "public", "corpora", "threejs-docs.pack.json");
const PUBLIC_MANIFEST_PATH = resolve(ROOT, "modules", "browser-rag-ts", "demo", "public", "corpora", "threejs-docs.manifest.json");
const MANUAL_PAGES = Object.freeze([
  "cleanup.html",
  "creating-a-scene.html",
  "fundamentals.html",
  "how-to-dispose-of-objects.html",
  "materials.html",
  "primitives.html",
  "responsive.html",
  "scenegraph.html",
  "textures.html",
  "webgpurenderer.html",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArguments(argv) {
  let upstream = "";
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") check = true;
    else if (argument === "--upstream") upstream = argv[++index] ?? "";
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!upstream) throw new Error("--upstream must name a checked-out three.js repository");
  return { upstream: resolve(upstream), check };
}

async function files(root, suffix) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(child, suffix));
    else if (entry.isFile() && child.endsWith(suffix)) output.push(child);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (_, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function cleanWhitespace(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function titleFromMarkdown(content, fallback) {
  return /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() || fallback;
}

function normalizeApiMarkdown(content) {
  return cleanWhitespace(content
    .replace(/\]\(([^)\s]+)\.html(#[^)]+)?\)/gu, "]($1.md$2)")
    .replace(/https:\/\/github\.com\/mrdoob\/three\.js\/blob\/master\//gu, `https://github.com/mrdoob/three.js/blob/${EXPECTED_COMMIT}/`)) + "\n";
}

function slug(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "page";
}

function splitTslGuide(content) {
  const documents = [];
  const stack = [];
  const token = /<page\s+name="([^"]+)">|<\/page>/gu;
  let cursor = 0;
  for (const match of content.matchAll(token)) {
    if (stack.length) stack.at(-1).parts.push(content.slice(cursor, match.index));
    if (match[1]) stack.push({ name: match[1], path: [...stack.map((entry) => entry.name), match[1]], parts: [] });
    else {
      const page = stack.pop();
      if (!page) throw new Error("TSL guide contains an unmatched closing page marker");
      const body = cleanWhitespace(page.parts.join(""));
      if (body) documents.push({ title: page.name, path: `tsl/${page.path.map(slug).join("/")}.md`, content: `# ${page.name}\n\n${body}\n` });
    }
    cursor = match.index + match[0].length;
  }
  if (stack.length) throw new Error("TSL guide contains an unclosed page marker");
  return documents;
}

export function htmlToMarkdown(html, sourceName) {
  const title = decodeEntities(/<title>(.*?)<\/title>/isu.exec(html)?.[1] ?? basename(sourceName, ".html"));
  let body = /<body[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1];
  if (!body) throw new Error(`manual page has no body: ${sourceName}`);
  body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/giu, "")
    .replace(/<img\b[^>]*>/giu, "");
  const blocks = [];
  body = body.replace(/<pre\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/pre>/giu, (_, classes, code) => {
    const language = /lang-([a-z0-9]+)/iu.exec(classes)?.[1] ?? "";
    const marker = `@@RAG_METHOD_CODE_${blocks.length}@@`;
    blocks.push(`\n\n\`\`\`${language}\n${decodeEntities(code.replace(/<[^>]+>/gu, "" )).trim()}\n\`\`\`\n\n`);
    return marker;
  });
  body = body.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu, (_, href, label) => {
    const text = decodeEntities(label.replace(/<[^>]+>/gu, "")).trim();
    if (!text) return "";
    let target = href;
    const api = /^\/docs\/#api\/en\/(?:[^/]+\/)*([^/#]+)(?:#(.+))?$/u.exec(href);
    if (api) target = `../api/${api[1]}.md${api[2] ? `#${api[2]}` : ""}`;
    else if (/^[^:/?#]+\.html(?:#.*)?$/u.test(href)) target = href.replace(/\.html(?=#|$)/u, ".md");
    return `[${text}](${target})`;
  });
  body = body.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, (_, code) => `\`${decodeEntities(code.replace(/<[^>]+>/gu, "")).trim()}\``)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_, level, text) => `\n\n${"#".repeat(Number(level))} ${decodeEntities(text.replace(/<[^>]+>/gu, "")).trim()}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_, text) => `\n- ${decodeEntities(text.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim()}\n`)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n\n")
    .replace(/<p\b[^>]*>/giu, "")
    .replace(/<[^>]+>/gu, " ");
  blocks.forEach((block, index) => { body = body.replace(`@@RAG_METHOD_CODE_${index}@@`, block); });
  body = cleanWhitespace(decodeEntities(body));
  if (!body.startsWith("# ")) body = `# ${title}\n\n${body}`;
  return { title, content: `${body}\n` };
}

const API_SOURCE_FALLBACKS = Object.freeze({
  "api/Lighting.md": "src/renderers/common/Lighting.js",
  "api/UniformBuffer.md": "src/renderers/common/UniformBuffer.js",
  "api/BitonicSort.md": "examples/jsm/gpgpu/BitonicSort.js",
});
const OUTSIDE_VAULT_NOTICE = " (upstream; outside the offline vault)";

export function resolveVaultLink(href, document, { includedPaths, upstreamPaths }) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(href)) return { href, outsideVault: false };
  const [pathname] = href.split(/[?#]/u);
  const target = posix.normalize(posix.join(posix.dirname(document.path), pathname));
  if (includedPaths.has(target)) return { href, outsideVault: false };
  const classPage = target.replace(/\.([^.\/]+)\.md$/u, ".md");
  if (target.startsWith("api/") && classPage !== target && includedPaths.has(classPage)) {
    return { href: posix.relative(posix.dirname(document.path), classPage), outsideVault: false };
  }
  let upstreamPath = API_SOURCE_FALLBACKS[target];
  if (!upstreamPath && document.original_path.startsWith("manual/pages/")) {
    const originalRelative = pathname.replace(/\.md$/u, ".html");
    const candidates = [
      posix.normalize(posix.join(posix.dirname(document.original_path), originalRelative)),
      posix.normalize(posix.join("manual", originalRelative)),
    ];
    upstreamPath = candidates.find((candidate) => upstreamPaths.has(candidate));
  }
  if (!upstreamPath || !upstreamPaths.has(upstreamPath)) {
    throw new Error(`document link has no bundled or verified upstream target: ${document.path} -> ${target}`);
  }
  return { href: `https://github.com/mrdoob/three.js/blob/${EXPECTED_COMMIT}/${upstreamPath}`, outsideVault: true };
}

export function rewriteVaultLinks(content, document, context) {
  let fence = null;
  const output = [];
  let prose = [];
  const flush = () => {
    if (!prose.length) return;
    // Inline code is source text, even when it contains Markdown-shaped syntax.
    output.push(prose.join("\n").replace(/(`+)([\s\S]*?)\1|(!?\[[^\]]*\]\(([^)]+)\))/gu, (match, code, _body, link, href) => {
      if (code) return match;
      const resolved = resolveVaultLink(href, document, context);
      if (resolved.href === href && !resolved.outsideVault) return link;
      return link.slice(0, link.lastIndexOf("(") + 1) + resolved.href + ")" + (resolved.outsideVault ? OUTSIDE_VAULT_NOTICE : "");
    }));
    prose = [];
  };
  for (const line of content.split("\n")) {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) { flush(); fence = marker; }
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      output.push(line);
    } else if (fence) {
      output.push(line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return output.join("\n");
}

function documentRecord(kind, outputPath, title, originalPath, content) {
  const bytes = Buffer.byteLength(content, "utf8");
  return Object.freeze({
    id: `threejs:${kind}:${outputPath.slice(kind.length + 1, -3)}`,
    kind,
    path: outputPath,
    title,
    original_path: originalPath,
    source_url: `https://github.com/mrdoob/three.js/blob/${EXPECTED_COMMIT}/${originalPath}`,
    content_sha256: sha256(content),
    bytes,
    license: "MIT",
    content,
  });
}

async function buildCorpus(upstream) {
  const commit = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (commit !== EXPECTED_COMMIT) throw new Error(`upstream checkout must be ${EXPECTED_COMMIT}; received ${commit}`);
  const upstreamPaths = new Set(execFileSync("git", ["-C", upstream, "ls-tree", "-r", "--name-only", EXPECTED_COMMIT], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim().split("\n"));
  const documents = [];
  const apiRoot = resolve(upstream, "docs", "pages");
  for (const source of await files(apiRoot, ".md")) {
    const originalPath = relative(upstream, source).replaceAll("\\", "/");
    const outputPath = `api/${basename(source).replace(/\.html\.md$/u, ".md")}`;
    const content = normalizeApiMarkdown(await readFile(source, "utf8"));
    documents.push(documentRecord("api", outputPath, titleFromMarkdown(content, basename(outputPath, ".md")), originalPath, content));
  }
  const guidePath = resolve(upstream, "tsl", "content", "Guide.md");
  for (const page of splitTslGuide(await readFile(guidePath, "utf8"))) {
    documents.push(documentRecord("tsl", page.path, page.title, "tsl/content/Guide.md", page.content));
  }
  for (const name of MANUAL_PAGES) {
    const source = resolve(upstream, "manual", "pages", name);
    const converted = htmlToMarkdown(await readFile(source, "utf8"), name);
    documents.push(documentRecord("manual", `manual/${name.replace(/\.html$/u, ".md")}`, converted.title, `manual/pages/${name}`, converted.content));
  }
  const context = { includedPaths: new Set(documents.map((document) => document.path)), upstreamPaths };
  for (const [index, document] of documents.entries()) {
    const content = rewriteVaultLinks(document.content, document, context);
    documents[index] = documentRecord(document.kind, document.path, document.title, document.original_path, content);
  }
  documents.sort((left, right) => left.path.localeCompare(right.path));
  const paths = new Set();
  const ids = new Set();
  for (const document of documents) {
    if (paths.has(document.path) || ids.has(document.id)) throw new Error(`duplicate normalized document: ${document.path}`);
    paths.add(document.path);
    ids.add(document.id);
  }
  const metadata = documents.map(({ content, ...entry }) => entry);
  const totalBytes = metadata.reduce((total, entry) => total + entry.bytes, 0);
  const identity = sha256(JSON.stringify({ conversion_version: CONVERSION_VERSION, upstream_commit: EXPECTED_COMMIT, documents: metadata }));
  const manifest = {
    schema: "rag-method-threejs-docs-manifest-v1",
    corpus_id: `threejs-docs-${EXPECTED_COMMIT.slice(0, 12)}`,
    identity_sha256: identity,
    conversion_version: CONVERSION_VERSION,
    upstream: { repository: "https://github.com/mrdoob/three.js", commit: EXPECTED_COMMIT, license: "MIT" },
    counts: {
      documents: documents.length,
      api: documents.filter((entry) => entry.kind === "api").length,
      tsl: documents.filter((entry) => entry.kind === "tsl").length,
      manual: documents.filter((entry) => entry.kind === "manual").length,
      source_utf8_bytes: totalBytes,
    },
    conversion: {
      api_markdown: "all checked-in docs/pages/*.md files; bundled local destinations retained, omitted destinations linked to verified pinned upstream sources and labeled outside the offline vault",
      tsl_guide: "direct text of each checked-in <page> section; nested page text is not duplicated",
      manual_html: `selected checked-in lessons: ${MANUAL_PAGES.join(", ")}; scripts, embeds, images, and page chrome removed`,
      refresh: "explicit only; runtime and offline tests never fetch upstream",
    },
    documents: metadata,
  };
  const pack = {
    schema: "rag-method-browser-vault-pack-v1",
    manifest: { corpus_id: manifest.corpus_id, identity_sha256: identity, upstream: manifest.upstream, counts: manifest.counts },
    documents: documents.map((entry) => ({
      path: entry.path,
      format: "markdown",
      content: entry.content,
      metadata: { title: entry.title, original_path: entry.original_path, source_url: entry.source_url, content_sha256: entry.content_sha256 },
    })),
  };
  return { documents, manifest, pack };
}

async function expectedOutputs(upstream) {
  const corpus = await buildCorpus(upstream);
  const outputs = new Map();
  outputs.set(MANIFEST_PATH, json(corpus.manifest));
  outputs.set(PACK_PATH, json(corpus.pack));
  outputs.set(PUBLIC_MANIFEST_PATH, json(corpus.pack.manifest));
  outputs.set(LICENSE_PATH, (await readFile(resolve(upstream, "LICENSE"), "utf8")).replace(/\r\n?/gu, "\n"));
  for (const document of corpus.documents) outputs.set(resolve(VAULT_ROOT, document.path), document.content);
  return { corpus, outputs };
}

async function verify(outputs) {
  for (const [path, expected] of outputs) {
    let actual;
    try { actual = await readFile(path, "utf8"); }
    catch { throw new Error(`generated corpus file is missing: ${relative(ROOT, path)}`); }
    if (actual !== expected) throw new Error(`generated corpus file is stale: ${relative(ROOT, path)}`);
  }
  const trackedVaultFiles = (await files(VAULT_ROOT, ".md")).map((path) => resolve(path));
  const expectedVaultFiles = new Set([...outputs.keys()].filter((path) => path.startsWith(`${VAULT_ROOT}\\`) || path.startsWith(`${VAULT_ROOT}/`)));
  const extras = trackedVaultFiles.filter((path) => !expectedVaultFiles.has(path));
  if (extras.length) throw new Error(`generated corpus contains ${extras.length} unexpected Markdown file(s)`);
}

async function write(outputs) {
  if (!VAULT_ROOT.startsWith(`${ROOT}\\`) || !PACK_PATH.startsWith(`${ROOT}\\`)) throw new Error("refusing to write outside the repository");
  await rm(VAULT_ROOT, { recursive: true, force: true });
  for (const [path, content] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2));
  const { corpus, outputs } = await expectedOutputs(options.upstream);
  if (options.check) await verify(outputs);
  else await write(outputs);
  console.log(JSON.stringify({ status: options.check ? "verified" : "written", corpus_id: corpus.manifest.corpus_id, identity_sha256: corpus.manifest.identity_sha256, ...corpus.manifest.counts }));
}
