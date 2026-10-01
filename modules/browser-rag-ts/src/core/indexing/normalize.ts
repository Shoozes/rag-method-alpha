import { IndexingContractError } from "../shared/errors.js";
import { encodeUtf8 } from "../shared/utf8.js";
import { assertValidUnicodeScalars, unicodeScalarCount } from "../shared/unicode.js";
import { INDEXING_CONTRACT_WHITESPACE, isIndexingContractWhitespace } from "../shared/whitespace.js";
import { MAX_PATH_CHARS, MAX_SCOPES } from "./types.js";

const DRIVE_PATH = /^[A-Za-z]:/;

export function trimBounds(value: readonly string[], start = 0, end = value.length): [number, number] {
  let left = start;
  let right = end;
  while (left < right && isIndexingContractWhitespace(value[left]!)) left += 1;
  while (right > left && isIndexingContractWhitespace(value[right - 1]!)) right -= 1;
  return [left, right];
}

export function trim(value: string): string {
  const scalars = Array.from(value);
  const [start, end] = trimBounds(scalars);
  return scalars.slice(start, end).join("");
}

export function normalizeSourcePath(value: string): string {
  if (typeof value !== "string") throw new IndexingContractError("invalid_path", "path must be a string");
  assertValidUnicodeScalars(value, "path");
  const trimmed = trim(value).replaceAll("\\", "/");
  if (!trimmed || unicodeScalarCount(trimmed) > MAX_PATH_CHARS || trimmed.startsWith("/") || DRIVE_PATH.test(trimmed) || trimmed.includes("\0")) {
    throw new IndexingContractError("invalid_path", "path must be a bounded relative text path");
  }
  const parts: string[] = [];
  for (const part of trimmed.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new IndexingContractError("invalid_path", "path must not contain parent traversal");
    parts.push(part);
  }
  if (!parts.length) throw new IndexingContractError("invalid_path", "path must name a source file");
  return parts.join("/");
}

export function boundedText(value: unknown, fieldName: string, maximum = 256): string {
  if (typeof value !== "string") throw new IndexingContractError(`invalid_${fieldName}`, `${fieldName} must be a string`);
  assertValidUnicodeScalars(value, fieldName);
  const result = trim(value);
  if (!result || unicodeScalarCount(result) > maximum || result.includes("\0")) throw new IndexingContractError(`invalid_${fieldName}`, `${fieldName} must be a bounded non-empty string`);
  return result;
}

export function validatedScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new IndexingContractError("invalid_scopes", "scopes must be an array");
  const scopes: string[] = [];
  for (const raw of value) {
    const scope = boundedText(raw, "scope");
    if (scopes.includes(scope)) throw new IndexingContractError("invalid_scopes", "scopes must be unique");
    scopes.push(scope);
  }
  if (!scopes.length || scopes.length > MAX_SCOPES) throw new IndexingContractError("invalid_scopes", `scopes must contain between 1 and ${MAX_SCOPES} values`);
  return scopes;
}

function stripFrontmatter(value: string): [string, boolean] {
  if (!value.startsWith("---\n")) return [value, false];
  let cursor = 4;
  while (cursor <= value.length) {
    const lineEnd = value.indexOf("\n", cursor);
    const line = lineEnd < 0 ? value.slice(cursor) : value.slice(cursor, lineEnd);
    const next = lineEnd < 0 ? value.length : lineEnd + 1;
    if (line === "---") return [value.slice(next), true];
    if (lineEnd < 0) break;
    cursor = next;
  }
  return [value, false];
}

export interface CanonicalDocument {
  readonly canonical: string;
  readonly bom_removed: boolean;
  readonly line_endings_changed: boolean;
  readonly frontmatter_removed: boolean;
}

export function canonicalizeDocument(content: string, format: "markdown" | "text"): CanonicalDocument {
  if (typeof content !== "string") throw new IndexingContractError("invalid_text", "content must be a string");
  assertValidUnicodeScalars(content, "content");
  if (content.includes("\0")) throw new IndexingContractError("invalid_text", "content must not contain NUL");
  const bytes = encodeUtf8(content);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new IndexingContractError("source_too_large", "content exceeds 10485760 strict UTF-8 bytes");
  const bomRemoved = content.startsWith("\uFEFF");
  let value = bomRemoved ? content.slice(1) : content;
  const lineEndingsChanged = value.includes("\r");
  value = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let frontmatterRemoved = false;
  if (format === "markdown") [value, frontmatterRemoved] = stripFrontmatter(value);
  const scalars = Array.from(value);
  const [start, end] = trimBounds(scalars);
  return { canonical: scalars.slice(start, end).join(""), bom_removed: bomRemoved, line_endings_changed: lineEndingsChanged, frontmatter_removed: frontmatterRemoved };
}

export { INDEXING_CONTRACT_WHITESPACE as CONTRACT_WHITESPACE };
