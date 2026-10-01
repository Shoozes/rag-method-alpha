import { ContractError } from "./errors.js";
import {
  PYTHON_UNICODE_V1_ALPHANUMERIC_RANGES,
  PYTHON_UNICODE_V1_ASSIGNED_RANGES,
  PYTHON_UNICODE_V1_WHITESPACE_RANGES,
} from "./generated/python-unicode-v1.js";

export function assertValidUnicodeScalars(value: string, fieldName = "value"): void {
  if (typeof value !== "string") throw new ContractError(`${fieldName} must be a string`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new ContractError(`${fieldName} must contain valid Unicode scalar values`, "invalid_unicode");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ContractError(`${fieldName} must contain valid Unicode scalar values`, "invalid_unicode");
    }
  }
}

export function unicodeScalarArray(value: string, fieldName = "value"): readonly string[] {
  assertValidUnicodeScalars(value, fieldName);
  return Array.from(value);
}

export function unicodeScalarCount(value: string, fieldName = "value"): number {
  return unicodeScalarArray(value, fieldName).length;
}

export function sliceByScalars(value: string, start: number, end?: number): string {
  const scalars = unicodeScalarArray(value);
  if (!Number.isSafeInteger(start) || start < 0 || start > scalars.length) {
    throw new ContractError("scalar start is out of range", "invalid_range");
  }
  if (end !== undefined && (!Number.isSafeInteger(end) || end < start || end > scalars.length)) {
    throw new ContractError("scalar end is out of range", "invalid_range");
  }
  return scalars.slice(start, end).join("");
}

function codepointInRanges(codepoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle]!;
    if (codepoint < range[0]) high = middle - 1;
    else if (codepoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function isPythonUnicodeAssigned(codepoint: number): boolean {
  return codepoint <= 0x377 || codepointInRanges(codepoint, PYTHON_UNICODE_V1_ASSIGNED_RANGES);
}

function assertUnicodeScalarCodepoint(codepoint: number): void {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
    throw new ContractError("codepoint must be a valid Unicode scalar value", "invalid_unicode");
  }
}

export function isPythonUnicodeAlphanumericCodepoint(codepoint: number): boolean {
  assertUnicodeScalarCodepoint(codepoint);
  if ((codepoint >= 0x30 && codepoint <= 0x39) || (codepoint >= 0x41 && codepoint <= 0x5a) || (codepoint >= 0x61 && codepoint <= 0x7a)) return true;
  return codepointInRanges(codepoint, PYTHON_UNICODE_V1_ALPHANUMERIC_RANGES);
}

function pythonUnicodeWhitespaceContains(codepoint: number): boolean {
  return codepointInRanges(codepoint, PYTHON_UNICODE_V1_WHITESPACE_RANGES);
}

export function isPythonUnicodeWhitespaceCodepoint(codepoint: number): boolean {
  assertUnicodeScalarCodepoint(codepoint);
  return pythonUnicodeWhitespaceContains(codepoint);
}

function transformPythonUnicodeRuns(value: string, transform: (run: string) => string): string {
  let output = "";
  let run = "";
  for (const scalar of value) {
    if (isPythonUnicodeAssigned(scalar.codePointAt(0)!)) {
      run += scalar;
      continue;
    }
    if (run) output += transform(run);
    output += scalar;
    run = "";
  }
  return output + (run ? transform(run) : "");
}

export function normalizeNfkc(value: string): string {
  assertValidUnicodeScalars(value);
  return transformPythonUnicodeRuns(value, (run) => run.normalize("NFKC"));
}

export function lowercasePythonUnicode(value: string): string {
  assertValidUnicodeScalars(value);
  return transformPythonUnicodeRuns(value, (run) => run.toLowerCase());
}

export function trimPythonUnicodeWhitespace(value: string): string {
  const scalars = unicodeScalarArray(value);
  let start = 0;
  let end = scalars.length;
  while (start < end && pythonUnicodeWhitespaceContains(scalars[start]!.codePointAt(0)!)) start += 1;
  while (end > start && pythonUnicodeWhitespaceContains(scalars[end - 1]!.codePointAt(0)!)) end -= 1;
  return scalars.slice(start, end).join("");
}

export function collapsePythonUnicodeWhitespace(value: string): string {
  const output: string[] = [];
  let pendingSpace = false;
  for (const scalar of unicodeScalarArray(value)) {
    if (pythonUnicodeWhitespaceContains(scalar.codePointAt(0)!)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) output.push(" ");
    output.push(scalar);
    pendingSpace = false;
  }
  return output.join("");
}

export function trimAndCollapseWhitespace(value: string): string {
  return collapsePythonUnicodeWhitespace(value);
}

export function compareUnicodeScalars(left: string, right: string): number {
  const a = unicodeScalarArray(left);
  const b = unicodeScalarArray(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftCode = a[index]!.codePointAt(0)!;
    const rightCode = b[index]!.codePointAt(0)!;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
  return a.length - b.length;
}
