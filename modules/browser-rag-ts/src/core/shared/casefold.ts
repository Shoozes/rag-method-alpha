import { CASEFOLD_V1 } from "./generated/casefold-v1.js";
import { collapsePythonUnicodeWhitespace, normalizeNfkc } from "./unicode.js";

export function fullContractCasefold(value: string): string {
  const normalized = normalizeNfkc(value);
  let output = "";
  for (const scalar of Array.from(normalized)) output += CASEFOLD_V1[scalar] ?? scalar;
  return collapsePythonUnicodeWhitespace(output);
}
