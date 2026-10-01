import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODULE_ROOT } from "./tool.mjs";

const REPO_ROOT = resolve(MODULE_ROOT, "../..");
const TABLE_PATH = join(
  MODULE_ROOT,
  "src",
  "core",
  "shared",
  "generated",
  "casefold-v1.ts",
);
const PYTHON_UNICODE_PATH = join(
  MODULE_ROOT,
  "src",
  "core",
  "shared",
  "generated",
  "python-unicode-v1.ts",
);
const FIXTURE_PATH = join(
  MODULE_ROOT,
  "tests",
  "fixtures",
  "unicode-conformance-v1.json",
);
const PROFILE_PATH = join(
  REPO_ROOT,
  "contracts",
  "rag-behavior-v2",
  "retrieval-profile.json",
);
const EXPECTED_METADATA_KEYS = [
  "generator",
  "generator_version",
  "python_version",
  "unicode_version",
  "mapping_entries",
  "table_sha256",
];
const EXPECTED_PYTHON_UNICODE_METADATA_KEYS = [
  "generator",
  "generator_version",
  "python_version",
  "unicode_version",
  "assigned_ranges",
  "assigned_scalars",
  "ranges_sha256",
  "alphanumeric_ranges",
  "alphanumeric_scalars",
  "alphanumeric_sha256",
  "whitespace_ranges",
  "whitespace_scalars",
  "whitespace_sha256",
];
const EXPECTED_FIXTURE_KEYS = [
  "schema",
  "metadata",
  "cases",
  "distinctions",
  "identity_test_vectors",
  "scope_cases",
  "invalid_utf16_code_units",
];
const EXPECTED_CASE_IDS = [
  "street_sharp_s",
  "street_ascii",
  "greek_final_sigma",
  "cyrillic",
  "cherokee",
  "contract_whitespace",
  "combining",
  "supplementary",
];
function fail(message) {
  throw new Error(`generated Unicode conformance drift: ${message}`);
}

function decodeScalars(encoded) {
  const pattern = /\\u\{([0-9A-F]+)\}/g;
  let decoded = "";
  let cursor = 0;
  for (const match of encoded.matchAll(pattern)) {
    if (match.index !== cursor) fail("casefold row contains a non-scalar escape");
    const codepoint = Number.parseInt(match[1], 16);
    if (codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
      fail("casefold row contains an invalid scalar");
    }
    decoded += String.fromCodePoint(codepoint);
    cursor = match.index + match[0].length;
  }
  if (cursor !== encoded.length) fail("casefold row contains trailing data");
  return decoded;
}

function parseMetadata(source, constantName, expectedKeys, label) {
  const match = source.match(new RegExp(
    `export const ${constantName} = Object\\.freeze\\(\\{\\r?\\n([\\s\\S]*?)\\r?\\n\\} as const\\);`,
  ));
  if (!match) fail(`${label} metadata block is missing or malformed`);
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^  ([a-z0-9_]+): (.+),$/);
    if (!field) fail(`${label} metadata field is malformed: ${JSON.stringify(line)}`);
    if (Object.hasOwn(metadata, field[1])) fail(`duplicate ${label} metadata field '${field[1]}'`);
    try {
      metadata[field[1]] = JSON.parse(field[2]);
    } catch {
      fail(`${label} metadata field '${field[1]}' is not canonical JSON`);
    }
  }
  if (JSON.stringify(Object.keys(metadata)) !== JSON.stringify(expectedKeys)) {
    fail(`${label} metadata fields or order changed`);
  }
  return metadata;
}

function parseRanges(source, constantName, label) {
  const match = source.match(new RegExp(
    `export const ${constantName}: ReadonlyArray<readonly \\[number, number\\]> = Object\\.freeze\\(\\[\\r?\\n([\\s\\S]*?)\\r?\\n\\] as const\\);`,
  ));
  if (!match) fail(`${label} range block is missing or malformed`);
  const ranges = [];
  let previousEnd = -1;
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^  \[0x([0-9A-F]+), 0x([0-9A-F]+)\],$/);
    if (!row) fail(`${label} range is malformed`);
    const start = Number.parseInt(row[1], 16);
    const end = Number.parseInt(row[2], 16);
    if (start <= previousEnd || end < start || end > 0x10ffff) fail(`${label} ranges overlap or are unordered`);
    ranges.push([start, end]);
    previousEnd = end;
  }
  return ranges;
}

function parseTable(source) {
  const match = source.match(
    /export const CASEFOLD_V1: Readonly<Record<string, string>> = Object\.freeze\(\{\r?\n([\s\S]*?)\r?\n\}\);/,
  );
  if (!match) fail("casefold table block is missing or malformed");
  const table = {};
  let previous = -1;
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^  "\\u\{([0-9A-F]+)\}": "((?:\\u\{[0-9A-F]+\})*)",$/);
    if (!row) fail("casefold row is malformed");
    const codepoint = Number.parseInt(row[1], 16);
    if (
      codepoint > 0x10ffff
      || (codepoint >= 0xd800 && codepoint <= 0xdfff)
      || row[1] !== codepoint.toString(16).toUpperCase()
    ) {
      fail("casefold key is not a canonical scalar");
    }
    if (codepoint <= previous) fail("casefold rows are not in scalar order");
    previous = codepoint;
    const key = row[1];
    if (Object.hasOwn(table, key)) fail(`duplicate casefold scalar '${key}'`);
    table[key] = decodeScalars(row[2]);
  }
  return table;
}

function codepointInRanges(codepoint, ranges) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (codepoint < range[0]) high = middle - 1;
    else if (codepoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function collapseWhitespace(value, whitespaceRanges) {
  let output = "";
  let pendingSpace = false;
  for (const scalar of value) {
    if (codepointInRanges(scalar.codePointAt(0), whitespaceRanges)) {
      pendingSpace = output.length > 0;
    } else {
      if (pendingSpace) output += " ";
      output += scalar;
      pendingSpace = false;
    }
  }
  return output;
}

function identityCasefold(value, table, whitespaceRanges) {
  const folded = [...value.normalize("NFKC")]
    .map((scalar) => table[scalar.codePointAt(0).toString(16).toUpperCase()] ?? scalar)
    .join("");
  return collapseWhitespace(folded, whitespaceRanges);
}

function retrievalLowercase(value, whitespaceRanges) {
  return collapseWhitespace(value.normalize("NFKC").toLowerCase(), whitespaceRanges);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const tableSource = await readFile(TABLE_PATH, "utf8");
const pythonUnicodeSource = await readFile(PYTHON_UNICODE_PATH, "utf8");
const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
const metadata = parseMetadata(tableSource, "CASEFOLD_V1_METADATA", EXPECTED_METADATA_KEYS, "casefold");
const pythonUnicodeMetadata = parseMetadata(
  pythonUnicodeSource,
  "PYTHON_UNICODE_V1_METADATA",
  EXPECTED_PYTHON_UNICODE_METADATA_KEYS,
  "Python Unicode",
);
const table = parseTable(tableSource);
const assignedRanges = parseRanges(pythonUnicodeSource, "PYTHON_UNICODE_V1_ASSIGNED_RANGES", "Python Unicode assigned");
const alphanumericRanges = parseRanges(pythonUnicodeSource, "PYTHON_UNICODE_V1_ALPHANUMERIC_RANGES", "Python Unicode alphanumeric");
const whitespaceRanges = parseRanges(pythonUnicodeSource, "PYTHON_UNICODE_V1_WHITESPACE_RANGES", "Python Unicode whitespace");
const digest = createHash("sha256").update(stableJson(table)).digest("hex");
const rangesDigest = createHash("sha256").update(stableJson(assignedRanges)).digest("hex");
const alphanumericDigest = createHash("sha256").update(stableJson(alphanumericRanges)).digest("hex");
const whitespaceDigest = createHash("sha256").update(stableJson(whitespaceRanges)).digest("hex");

if (metadata.generator !== "scripts/browser_rag_unicode_conformance.py") {
  fail("generator identity changed");
}
if (metadata.generator_version !== "casefold-v1") fail("generator version changed");
if (typeof metadata.python_version !== "string" || !metadata.python_version) {
  fail("Python generator version is missing");
}
if (typeof metadata.unicode_version !== "string" || !metadata.unicode_version) {
  fail("Unicode data version is missing");
}
if (!Number.isInteger(metadata.mapping_entries) || metadata.mapping_entries < 1_000) {
  fail("mapping count metadata is invalid");
}
if (!/^[0-9a-f]{64}$/.test(metadata.table_sha256)) fail("table digest metadata is invalid");
if (metadata.mapping_entries !== Object.keys(table).length) fail("mapping count is wrong");
if (metadata.table_sha256 !== digest) fail("table digest is wrong");
if (pythonUnicodeMetadata.generator !== "scripts/browser_rag_nfkc_conformance.py") {
  fail("Python Unicode generator identity changed");
}
if (pythonUnicodeMetadata.generator_version !== "python-unicode-v1") {
  fail("Python Unicode generator version changed");
}
if (typeof pythonUnicodeMetadata.python_version !== "string" || !pythonUnicodeMetadata.python_version) {
  fail("Python Unicode generator runtime is missing");
}
if (typeof pythonUnicodeMetadata.unicode_version !== "string" || !pythonUnicodeMetadata.unicode_version) {
  fail("Python Unicode data version is missing");
}
if (pythonUnicodeMetadata.assigned_ranges !== assignedRanges.length) {
  fail("Python Unicode assigned-range count is wrong");
}
const assignedScalars = assignedRanges.reduce((total, [start, end]) => total + end - start + 1, 0);
if (pythonUnicodeMetadata.assigned_scalars !== assignedScalars) {
  fail("Python Unicode assigned-scalar count is wrong");
}
if (pythonUnicodeMetadata.ranges_sha256 !== rangesDigest) {
  fail("Python Unicode assigned-range digest is wrong");
}
if (pythonUnicodeMetadata.alphanumeric_ranges !== alphanumericRanges.length) {
  fail("Python Unicode alphanumeric-range count is wrong");
}
const alphanumericScalars = alphanumericRanges.reduce((total, [start, end]) => total + end - start + 1, 0);
if (pythonUnicodeMetadata.alphanumeric_scalars !== alphanumericScalars) {
  fail("Python Unicode alphanumeric-scalar count is wrong");
}
if (pythonUnicodeMetadata.alphanumeric_sha256 !== alphanumericDigest) {
  fail("Python Unicode alphanumeric-range digest is wrong");
}
if (pythonUnicodeMetadata.whitespace_ranges !== whitespaceRanges.length) {
  fail("Python Unicode whitespace-range count is wrong");
}
const whitespaceScalars = whitespaceRanges.reduce((total, [start, end]) => total + end - start + 1, 0);
if (pythonUnicodeMetadata.whitespace_scalars !== whitespaceScalars) {
  fail("Python Unicode whitespace-scalar count is wrong");
}
if (pythonUnicodeMetadata.whitespace_sha256 !== whitespaceDigest) {
  fail("Python Unicode whitespace-range digest is wrong");
}
if (fixture.schema !== "browser-rag-ts-unicode-conformance-v1") {
  fail("fixture schema changed");
}
if (JSON.stringify(Object.keys(fixture)) !== JSON.stringify(EXPECTED_FIXTURE_KEYS)) {
  fail("fixture fields or order changed");
}
if (stableJson(fixture.metadata) !== stableJson(metadata)) fail("fixture metadata differs");
if (
  !Array.isArray(fixture.cases)
  || stableJson(fixture.cases.map((entry) => entry?.id)) !== stableJson(EXPECTED_CASE_IDS)
) {
  fail("fixture cases are missing, extra, or reordered");
}
const cases = new Map();
for (const entry of fixture.cases) {
  if (
    !entry
    || stableJson(Object.keys(entry))
      !== stableJson(["id", "input", "retrieval_lowercase", "identity_casefold"])
    || typeof entry.id !== "string"
    || typeof entry.input !== "string"
    || retrievalLowercase(entry.input, whitespaceRanges) !== entry.retrieval_lowercase
    || identityCasefold(entry.input, table, whitespaceRanges) !== entry.identity_casefold
  ) {
    fail(`fixture case '${entry?.id ?? "unknown"}' differs from the generated table`);
  }
  cases.set(entry.id, entry);
}
const expectedDistinctions = {
  street_retrieval_values_must_differ: [
    cases.get("street_sharp_s").retrieval_lowercase,
    cases.get("street_ascii").retrieval_lowercase,
  ],
  street_identity_values_must_match: cases.get("street_sharp_s").identity_casefold,
};
if (stableJson(fixture.distinctions) !== stableJson(expectedDistinctions)) {
  fail("fixture distinctions differ from the case observations");
}
if (stableJson(fixture.identity_test_vectors) !== stableJson(profile?.identity?.test_vectors)) {
  fail("fixture identity vectors differ from the frozen retrieval profile");
}
if (!Array.isArray(fixture.scope_cases) || fixture.scope_cases.length !== 2) {
  fail("fixture scope cases are missing");
}
for (const entry of fixture.scope_cases) {
  if (
    !entry
    || stableJson(Object.keys(entry)) !== stableJson(["input", "normalized"])
    || typeof entry.input !== "string"
    || collapseWhitespace(entry.input.normalize("NFKC"), whitespaceRanges) !== entry.normalized
  ) {
    fail("fixture scope normalization differs");
  }
}
if (stableJson(fixture.invalid_utf16_code_units) !== stableJson(["D800", "DC00"])) {
  fail("fixture invalid UTF-16 cases differ");
}

console.log(
  `browser-rag Unicode conformance: check passed (${metadata.mapping_entries} casefold mappings, ${assignedRanges.length} assigned ranges, ${alphanumericRanges.length} alphanumeric ranges, ${whitespaceRanges.length} whitespace ranges, Unicode ${pythonUnicodeMetadata.unicode_version})`,
);
