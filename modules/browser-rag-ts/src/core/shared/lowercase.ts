import { collapsePythonUnicodeWhitespace, lowercasePythonUnicode, normalizeNfkc } from "./unicode.js";

/** Retrieval normalization is contract lowercase, not identity casefolding. */
export function lowercaseContractText(value: string): string {
  return collapsePythonUnicodeWhitespace(lowercasePythonUnicode(normalizeNfkc(value)));
}
