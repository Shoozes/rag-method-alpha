import { IndexingContractError } from "../shared/errors.js";

export const MAX_SOURCE_UTF8_BYTES = 10 * 1024 * 1024;
export const MAX_CHUNK_CHARS = 2_400;
export const MAX_CHUNK_TOKENS = 600;
export const MAX_PATH_CHARS = 1_024;
export const MAX_SCOPES = 64;

export interface IndexingLimits {
  readonly max_chars: number;
  readonly max_tokens: number;
}

export const DEFAULT_INDEXING_LIMITS: IndexingLimits = Object.freeze({ max_chars: MAX_CHUNK_CHARS, max_tokens: MAX_CHUNK_TOKENS });

export function validateIndexingLimits(value: IndexingLimits | undefined): IndexingLimits {
  const limits = value ?? DEFAULT_INDEXING_LIMITS;
  for (const [name, maximum] of [["max_chars", MAX_CHUNK_CHARS], ["max_tokens", MAX_CHUNK_TOKENS]] as const) {
    const current = limits[name];
    if (!Number.isInteger(current) || current < 1 || current > maximum) {
      throw new IndexingContractError("invalid_limits", `${name} must be an integer between 1 and ${maximum}`);
    }
  }
  return limits;
}
