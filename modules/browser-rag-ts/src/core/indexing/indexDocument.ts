import { IndexingContractError } from "../shared/errors.js";
import { encodeUtf8 } from "../shared/utf8.js";
import { assertValidUnicodeScalars } from "../shared/unicode.js";
import { contentId, sourceChunkId, sourceId } from "../shared/identity.js";
import { RagRecord, INDEXING_CONTRACT_ID, INDEXING_PROFILE_ID } from "../shared/types.js";
import { sections } from "./markdown.js";
import { canonicalizeDocument, boundedText, normalizeSourcePath, trim, validatedScopes } from "./normalize.js";
import { splitTextRanges } from "./chunks.js";
import { DEFAULT_INDEXING_LIMITS, IndexingLimits, validateIndexingLimits, MAX_SOURCE_UTF8_BYTES } from "./types.js";
import { IndexedDocument } from "./observations.js";

const WIKI_LINK = /\[\[([^\[\]]+?)\]\]/gu;

function referenceTargets(value: string): readonly string[] {
  const result: string[] = [];
  for (const match of value.matchAll(WIKI_LINK)) {
    const target = trim(match[1]!.split("|", 1)[0]!);
    if (target && !result.includes(target)) result.push(target);
  }
  return result;
}

function recordFromChunk(chunk: { readonly text: string; readonly start: number; readonly end: number }, ownerSourceId: string, path: string, pocket: string, scopes: readonly string[], authority: string, priority: number, index: number, sectionIndex: number, heading: string, headingLevel: number): Promise<RagRecord> {
  return contentId(chunk.text).then(async (chunkContentId) => ({
    id: await sourceChunkId(ownerSourceId, index, chunk.start, chunk.end, chunkContentId),
    text: chunk.text,
    source_id: ownerSourceId,
    source_name: path.split("/").at(-1) ?? path,
    path,
    pocket,
    scope: scopes[0]!,
    scopes: [...scopes],
    authority: authority as RagRecord["authority"],
    priority,
    provenance: { file_source: true, chunk_source: true },
    references: [],
    embedding_profile_id: null,
    metadata: {
      indexing_contract: INDEXING_CONTRACT_ID,
      indexing_profile: INDEXING_PROFILE_ID,
      content_id: chunkContentId,
      chunk_index: index,
      text_start: chunk.start,
      text_end: chunk.end,
      section_index: sectionIndex,
      heading,
      heading_level: headingLevel,
      token_estimate: Math.max(1, Math.floor((Array.from(chunk.text).length + 3) / 4)),
      reference_targets: [...referenceTargets(chunk.text)],
    },
    is_memory: authority === "conversation_memory",
  }));
}

export async function indexDocument(content: string, options: { readonly format: "markdown" | "text"; readonly path: string; readonly pocket: string; readonly scopes: readonly string[]; readonly authority: string; readonly priority?: number; readonly limits?: IndexingLimits; readonly checkpoint?: () => void }): Promise<IndexedDocument> {
  options.checkpoint?.();
  if (options.format !== "markdown" && options.format !== "text") throw new IndexingContractError("unsupported_format", "format must be markdown or text");
  const path = normalizeSourcePath(options.path);
  const pocket = boundedText(options.pocket, "pocket");
  const scopes = validatedScopes(options.scopes);
  const allowedAuthorities = new Set(["global_record", "workspace_record", "persona_vault", "conversation_memory", "unclassified"]);
  if (!allowedAuthorities.has(options.authority)) throw new IndexingContractError("invalid_authority", "authority is not supported by rag-behavior-v2");
  const priority = options.priority ?? 0;
  if (!Number.isInteger(priority) || priority < -100 || priority > 100) throw new IndexingContractError("invalid_priority", "priority must be an integer between -100 and 100");
  const limits = validateIndexingLimits(options.limits ?? DEFAULT_INDEXING_LIMITS);
  assertValidUnicodeScalars(content, "content");
  const sourceBytes = encodeUtf8(content);
  if (sourceBytes.byteLength > MAX_SOURCE_UTF8_BYTES) throw new IndexingContractError("source_too_large", "content exceeds 10485760 strict UTF-8 bytes");
  const canonical = canonicalizeDocument(content, options.format);
  const ownerSourceId = await sourceId("file", pocket, path);
  const records: RagRecord[] = [];
  for (const section of sections(canonical.canonical, options.format)) {
    options.checkpoint?.();
    for (const chunk of splitTextRanges(canonical.canonical, section.start, section.end, limits, options.checkpoint)) {
      records.push(await recordFromChunk(chunk, ownerSourceId, path, pocket, scopes, options.authority, priority, records.length, section.index, section.heading, section.heading_level));
    }
  }
  return {
    format: options.format, path, pocket, scopes, authority: options.authority, priority,
    source_id: ownerSourceId, source_content_id: await contentId(content), source_utf8_bytes: sourceBytes.byteLength,
    canonical_content_id: await contentId(canonical.canonical), canonical_text: canonical.canonical,
    bom_removed: canonical.bom_removed, line_endings_changed: canonical.line_endings_changed, frontmatter_removed: canonical.frontmatter_removed,
    limits, records,
  };
}

export async function indexDocumentBytes(content: Uint8Array, options: Omit<Parameters<typeof indexDocument>[1], never>): Promise<IndexedDocument> {
  let decoded: string;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch { throw new IndexingContractError("invalid_utf8", "content must contain valid UTF-8"); }
  return indexDocument(decoded, options);
}
