import { fullContractCasefold } from "./casefold.js";
import { canonicalHash, sha256Text } from "./sha256.js";
import { assertValidUnicodeScalars, lowercasePythonUnicode, trimPythonUnicodeWhitespace } from "./unicode.js";

export const IDENTITY_VERSION = 2;

export async function contentId(text: string): Promise<string> {
  assertValidUnicodeScalars(text, "content");
  return sha256Text(text);
}

export async function sourceId(sourceKind: string, pocket: string, sourceKey: string): Promise<string> {
  for (const [name, value] of [["source_kind", sourceKind], ["pocket", pocket], ["source_key", sourceKey]] as const) {
    if (typeof value !== "string") throw new Error(`${name} must be a non-empty string`);
    assertValidUnicodeScalars(value, name);
    if (!trimPythonUnicodeWhitespace(value)) throw new Error(`${name} must be a non-empty string`);
  }
  return canonicalHash([
    "rag-source",
    String(IDENTITY_VERSION),
    lowercasePythonUnicode(trimPythonUnicodeWhitespace(sourceKind)),
    fullContractCasefold(pocket),
    lowercasePythonUnicode(trimPythonUnicodeWhitespace(sourceKey).replaceAll("\\", "/")),
  ]);
}

export async function sourceChunkId(ownerSourceId: string, chunkIndex: number, textStart: number | null, textEnd: number | null, chunkContentId: string): Promise<string> {
  assertValidUnicodeScalars(ownerSourceId, "owner_source_id");
  if (!trimPythonUnicodeWhitespace(ownerSourceId)) throw new Error("owner_source_id must be a non-empty string");
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new Error("chunk_index must be a non-negative integer");
  for (const [name, value] of [["text_start", textStart], ["text_end", textEnd]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} must be a non-negative integer or null`);
  }
  if (textStart !== null && textEnd !== null && textEnd < textStart) throw new Error("text_end must not precede text_start");
  if (!/^[0-9a-f]{64}$/.test(chunkContentId)) throw new Error("chunk_content_id must be a lowercase SHA-256 digest");
  return canonicalHash([
    "rag-source-chunk", String(IDENTITY_VERSION), ownerSourceId, String(chunkIndex),
    textStart === null ? "" : String(textStart), textEnd === null ? "" : String(textEnd), chunkContentId,
  ]);
}

export async function embeddingId(chunkId: string, profileId: string): Promise<string> {
  assertValidUnicodeScalars(chunkId, "chunk_id");
  assertValidUnicodeScalars(profileId, "profile_id");
  if (!trimPythonUnicodeWhitespace(chunkId) || !trimPythonUnicodeWhitespace(profileId)) throw new Error("embedding identity fields must be non-empty strings");
  return canonicalHash(["rag-embedding", String(IDENTITY_VERSION), chunkId, profileId]);
}
