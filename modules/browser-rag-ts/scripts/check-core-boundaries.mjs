import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";

const CORE = resolve(MODULE_ROOT, "src", "core");
const SPECIFIER_PATTERNS = Object.freeze([
  /(?:import|export)\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu,
  /import\s*\(\s*["']([^"']+)["']\s*\)/gu,
  /require\s*\(\s*["']([^"']+)["']\s*\)/gu,
]);

async function files(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await files(child));
    else if (entry.name.endsWith(".ts")) output.push(child);
  }
  return output;
}

export function importedSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function resolveTypeScriptImport(owner, specifier) {
  const unresolved = resolve(dirname(owner), specifier);
  const candidates = extname(unresolved)
    ? [unresolved, unresolved.replace(/\.js$/u, ".ts")]
    : [`${unresolved}.ts`, join(unresolved, "index.ts")];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return resolve(candidate);
    } catch {
      // Continue to the next deterministic TypeScript resolution candidate.
    }
  }
  return null;
}

export async function boundaryViolation(owner, specifier) {
  if (!specifier.startsWith(".")) return `uses non-core dependency ${specifier}`;
  const target = await resolveTypeScriptImport(owner, specifier);
  if (!target) return `has unresolved relative dependency ${specifier}`;
  if (!isInside(CORE, target)) return `escapes src/core through ${specifier}`;
  return null;
}

const fixtureOwner = join(CORE, "fixture.ts");
const parserFixtures = [
  ['import value from "three";', "three"],
  ['export { value } from "../application/value.js";', "../application/value.js"],
  ['const value = import("vite");', "vite"],
  ['const value = require("node:fs");', "node:fs"],
];
for (const [source, expected] of parserFixtures) {
  if (!importedSpecifiers(source).includes(expected)) throw new Error(`core boundary parser missed ${expected}`);
}
if (!(await boundaryViolation(fixtureOwner, "three"))) throw new Error("core boundary self-test admitted a package import");
if (!(await boundaryViolation(fixtureOwner, "../application/value.js"))) throw new Error("core boundary self-test admitted an escaping relative import");

const coreFiles = await files(CORE);
const violations = [];
for (const path of coreFiles) {
  const source = await readFile(path, "utf8");
  for (const specifier of importedSpecifiers(source)) {
    const violation = await boundaryViolation(path, specifier);
    if (violation) violations.push(`${relative(MODULE_ROOT, path)} ${violation}`);
  }
}
if (violations.length) throw new Error(`core boundary violations:\n${violations.join("\n")}`);
console.log(`browser-rag-ts core boundaries: ${coreFiles.length} files checked; parser escape fixtures rejected`);
