import { RagRecord, recordToMapping } from "../shared/types.js";
import { IndexingLimits } from "./types.js";

export interface IndexedDocument {
  readonly format: "markdown" | "text";
  readonly path: string;
  readonly pocket: string;
  readonly scopes: readonly string[];
  readonly authority: string;
  readonly priority: number;
  readonly source_id: string;
  readonly source_content_id: string;
  readonly source_utf8_bytes: number;
  readonly canonical_content_id: string;
  readonly canonical_text: string;
  readonly bom_removed: boolean;
  readonly line_endings_changed: boolean;
  readonly frontmatter_removed: boolean;
  readonly limits: IndexingLimits;
  readonly records: readonly RagRecord[];
}

export function documentObservation(document: IndexedDocument): Record<string, unknown> {
  return {
    format: document.format, path: document.path, pocket: document.pocket, scopes: [...document.scopes], authority: document.authority,
    priority: document.priority, source_id: document.source_id, source_content_id: document.source_content_id,
    source_utf8_bytes: document.source_utf8_bytes, canonical_content_id: document.canonical_content_id,
    canonical_scalar_count: Array.from(document.canonical_text).length,
    normalization: { bom_removed: document.bom_removed, line_endings_changed: document.line_endings_changed, frontmatter_removed: document.frontmatter_removed },
    limits: { max_chars: document.limits.max_chars, max_tokens: document.limits.max_tokens },
    records: document.records.map(recordToMapping),
  };
}

export const indexingObservation = documentObservation;
