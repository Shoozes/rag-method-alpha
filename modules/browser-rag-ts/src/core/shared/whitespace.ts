/** The frozen rag-indexing-v1 whitespace set; retrieval uses Python-pinned properties. */
export const INDEXING_CONTRACT_WHITESPACE = new Set([
  "\u0009", "\u000A", "\u000B", "\u000C", "\u000D", "\u0020", "\u0085", "\u00A0",
  "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006",
  "\u2007", "\u2008", "\u2009", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F",
  "\u3000",
]);

export function isIndexingContractWhitespace(value: string): boolean {
  return INDEXING_CONTRACT_WHITESPACE.has(value);
}

export function trimIndexingContractWhitespace(value: string): string {
  const scalars = Array.from(value);
  let start = 0;
  let end = scalars.length;
  while (start < end && isIndexingContractWhitespace(scalars[start]!)) start += 1;
  while (end > start && isIndexingContractWhitespace(scalars[end - 1]!)) end -= 1;
  return scalars.slice(start, end).join("");
}

export function collapseIndexingContractWhitespace(value: string): string {
  const output: string[] = [];
  let pendingSpace = false;
  for (const scalar of Array.from(value)) {
    if (isIndexingContractWhitespace(scalar)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) output.push(" ");
    output.push(scalar);
    pendingSpace = false;
  }
  return output.join("");
}

// Compatibility names retained for existing rag-indexing-v1 imports.
export const CONTRACT_WHITESPACE = INDEXING_CONTRACT_WHITESPACE;
export const isContractWhitespace = isIndexingContractWhitespace;
export const trimContractWhitespace = trimIndexingContractWhitespace;
export const collapseContractWhitespace = collapseIndexingContractWhitespace;
