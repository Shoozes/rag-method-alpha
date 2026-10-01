import { IndexingContractError } from "../shared/errors.js";
import { isIndexingContractWhitespace } from "../shared/whitespace.js";
import { trimBounds } from "./normalize.js";
import { DEFAULT_INDEXING_LIMITS, IndexingLimits, validateIndexingLimits } from "./types.js";

export interface TextRange { readonly text: string; readonly start: number; readonly end: number; }

function tokenLimitEnd(value: readonly string[], start: number, end: number, maximum: number, checkpoint?: () => void): number | null {
  let tokenCount = 0;
  let inToken = false;
  let previousTokenEnd = start;
  for (let position = start; position < end; position += 1) {
    if (checkpoint && (position - start) % 1024 === 0) checkpoint();
    if (isIndexingContractWhitespace(value[position]!)) {
      inToken = false;
      continue;
    }
    if (!inToken) {
      tokenCount += 1;
      if (tokenCount > maximum) return previousTokenEnd;
      inToken = true;
    }
    previousTokenEnd = position + 1;
  }
  return null;
}

export function splitTextRanges(value: string, start = 0, end = Array.from(value).length, limits: IndexingLimits = DEFAULT_INDEXING_LIMITS, checkpoint?: () => void): readonly TextRange[] {
  if (typeof value !== "string") throw new IndexingContractError("invalid_text", "content must be a string");
  const scalars = Array.from(value);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > scalars.length) throw new IndexingContractError("invalid_range", "chunk range is invalid");
  const checked = validateIndexingLimits(limits);
  const pieces: TextRange[] = [];
  let cursor = trimBounds(scalars, start, end)[0];
  const rangeEnd = trimBounds(scalars, start, end)[1];
  while (cursor < rangeEnd) {
    checkpoint?.();
    const hardEnd = Math.min(rangeEnd, cursor + checked.max_chars);
    const tokenEnd = tokenLimitEnd(scalars, cursor, hardEnd, checked.max_tokens, checkpoint);
    let pieceEnd = tokenEnd ?? hardEnd;
    if (tokenEnd === null && pieceEnd < rangeEnd) {
      for (let position = pieceEnd - 1; position > cursor; position -= 1) {
        if (isIndexingContractWhitespace(scalars[position]!)) { pieceEnd = position; break; }
      }
    }
    if (pieceEnd <= cursor) pieceEnd = hardEnd;
    const [textStart, textEnd] = trimBounds(scalars, cursor, pieceEnd);
    if (textStart < textEnd) pieces.push({ text: scalars.slice(textStart, textEnd).join(""), start: textStart, end: textEnd });
    cursor = pieceEnd;
    while (cursor < rangeEnd && isIndexingContractWhitespace(scalars[cursor]!)) cursor += 1;
  }
  return pieces;
}
