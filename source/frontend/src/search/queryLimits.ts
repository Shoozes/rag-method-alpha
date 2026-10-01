import type { QueryMetrics } from "../types/rag";

export const QUERY_LIMITS = {
  maxScalars: 4_000,
  maxUtf8Bytes: 16_384,
} as const;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

export function measureQuery(value: string): QueryMetrics {
  const invalidUnicode = hasUnpairedSurrogate(value);
  return {
    scalarCount: Array.from(value).length,
    utf8Bytes: new TextEncoder().encode(value).byteLength,
    invalidUnicode,
  };
}

export function queryValidationMessage(value: string): string | null {
  if (!value) return null;
  const metrics = measureQuery(value);
  if (metrics.invalidUnicode) return "Query contains an invalid Unicode scalar.";
  if (metrics.scalarCount > QUERY_LIMITS.maxScalars) {
    return `Query exceeds ${QUERY_LIMITS.maxScalars.toLocaleString()} Unicode scalar values.`;
  }
  if (metrics.utf8Bytes > QUERY_LIMITS.maxUtf8Bytes) {
    return `Query exceeds ${QUERY_LIMITS.maxUtf8Bytes.toLocaleString()} UTF-8 bytes.`;
  }
  return null;
}
