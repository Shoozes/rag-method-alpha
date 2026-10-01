import { ContractError } from "./errors.js";
import { FROZEN_RETRIEVAL_POLICY } from "./frozenBehaviorPolicy.js";
import { assertValidUnicodeScalars, trimPythonUnicodeWhitespace } from "./unicode.js";

export const CONTRACT_ID = FROZEN_RETRIEVAL_POLICY.contract;
export const PROFILE_ID = FROZEN_RETRIEVAL_POLICY.profile_id;
export const INDEXING_CONTRACT_ID = "rag-indexing-v1";
export const INDEXING_PROFILE_ID = "rag-indexing-v1-portable";
export const MAX_QUERY_CHARS = FROZEN_RETRIEVAL_POLICY.limits.max_query_chars;
export const MAX_QUERY_UTF8_BYTES = FROZEN_RETRIEVAL_POLICY.limits.max_query_utf8_bytes;
export const MAX_RECORDS = FROZEN_RETRIEVAL_POLICY.limits.max_records;
export const MAX_TOP_K = FROZEN_RETRIEVAL_POLICY.limits.max_top_k;
export const MAX_CONTEXT_TOKENS = FROZEN_RETRIEVAL_POLICY.context.max_rag_context_tokens;
export const MAX_REFERENCE_EXPANSION = FROZEN_RETRIEVAL_POLICY.references.max_expansions;
export const MAX_PER_SOURCE = FROZEN_RETRIEVAL_POLICY.selection.max_chunks_per_source;
export const DURABLE_CANDIDATE_LIMIT = FROZEN_RETRIEVAL_POLICY.selection.durable_candidate_limit;
export const MEMORY_CANDIDATE_LIMIT = FROZEN_RETRIEVAL_POLICY.selection.memory_candidate_limit;

export type Authority = "global_record" | "workspace_record" | "persona_vault" | "conversation_memory" | "unclassified";
export type SemanticState = "not_requested" | "ready" | "disabled_by_settings" | "lexical_fallback";
export type SemanticFallbackReason = "disabled_by_settings" | "no_compatible_vectors" | "embedding_failed";
export type RetrievalMode = "exact_only" | "semantic_only" | "keyword_only" | "hybrid" | "scoped_hybrid";

export interface RecordProvenance {
  readonly file_source: boolean;
  readonly chunk_source: boolean;
}

export interface RagRecordInput {
  readonly id: unknown;
  readonly text: unknown;
  readonly source_id: unknown;
  readonly source_name?: unknown;
  readonly path?: unknown;
  readonly pocket?: unknown;
  readonly scope?: unknown;
  readonly scopes?: unknown;
  readonly authority?: unknown;
  readonly priority?: unknown;
  readonly provenance?: unknown;
  readonly provenance_file?: unknown;
  readonly provenance_chunk?: unknown;
  readonly references?: unknown;
  readonly embedding_profile_id?: unknown;
  readonly metadata?: unknown;
}

export interface RagRecord {
  readonly id: string;
  readonly text: string;
  readonly source_id: string;
  readonly source_name: string;
  readonly path: string;
  readonly pocket: string;
  readonly scope: string;
  readonly scopes: readonly string[];
  readonly authority: Authority;
  readonly priority: number;
  readonly provenance: RecordProvenance;
  readonly references: readonly string[];
  readonly embedding_profile_id: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly is_memory: boolean;
}

const AUTHORITIES = new Set<Authority>(["global_record", "workspace_record", "persona_vault", "conversation_memory", "unclassified"]);
const LIMIT_KEYS = ["max_query_chars", "max_query_utf8_bytes", "max_records", "max_top_k", "max_context_tokens", "max_reference_expansion", "max_per_source", "durable_candidate_limit", "memory_candidate_limit"] as const;
const PROFILE_WEIGHT_KEYS = ["exact_weight", "semantic_weight", "keyword_weight", "scope_weight", "provenance_weight", "authority_weight", "priority_weight", "aspect_coverage_weight", "reference_weight"] as const;

function stringValue(value: unknown, name: string, required = true): string {
  if (typeof value !== "string") throw new ContractError(`${name} must be a string`);
  assertValidUnicodeScalars(value, name);
  const result = trimPythonUnicodeWhitespace(value);
  if (required && !result) throw new ContractError(`${name} must not be empty`);
  return result;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ContractError(`${name} must be an array of strings`);
  const output: string[] = [];
  for (const item of value) {
    const text = stringValue(item, name);
    if (!output.includes(text)) output.push(text);
  }
  return output;
}

export function recordFromMapping(value: unknown): RagRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError("record must be an object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["id", "text", "source_id", "source_name", "path", "pocket", "scope", "scopes", "authority", "priority", "provenance", "provenance_file", "provenance_chunk", "references", "embedding_profile_id", "metadata"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ContractError(`record contains unknown fields: ${unknown.sort().join(", ")}`);
  const id = stringValue(raw.id, "id");
  const text = stringValue(raw.text, "text");
  const sourceId = stringValue(raw.source_id, "source_id");
  const path = stringValue(raw.path ?? "", "path", false);
  const sourceName = stringValue(raw.source_name ?? "", "source_name", false) || path || sourceId;
  const pocket = stringValue(raw.pocket ?? "default", "pocket");
  const rawScopes = stringList(raw.scopes, "scopes");
  const scope = rawScopes[0] ?? stringValue(raw.scope ?? "global", "scope");
  const scopes = rawScopes.length ? rawScopes : [scope];
  const authority = stringValue(raw.authority ?? "unclassified", "authority") as Authority;
  if (!AUTHORITIES.has(authority)) throw new ContractError(`unsupported authority kind: ${authority}`);
  const priority = raw.priority ?? 0;
  if (!Number.isInteger(priority) || typeof priority === "boolean" || (priority as number) < -100 || (priority as number) > 100) throw new ContractError("priority must be an integer between -100 and 100");
  const provenanceValue = raw.provenance ?? {};
  if (!provenanceValue || typeof provenanceValue !== "object" || Array.isArray(provenanceValue)) throw new ContractError("provenance must be an object");
  const provenance = provenanceValue as Record<string, unknown>;
  const fileSource = provenance.file_source ?? raw.provenance_file ?? false;
  const chunkSource = provenance.chunk_source ?? raw.provenance_chunk ?? false;
  if (typeof fileSource !== "boolean" || typeof chunkSource !== "boolean") throw new ContractError("provenance values must be boolean");
  const references = stringList(raw.references, "references");
  const profile = raw.embedding_profile_id === null || raw.embedding_profile_id === undefined ? null : stringValue(raw.embedding_profile_id, "embedding_profile_id");
  const metadata = raw.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ContractError("metadata must be an object");
  return {
    id, text, source_id: sourceId, source_name: sourceName, path, pocket, scope, scopes,
    authority, priority: priority as number,
    provenance: { file_source: fileSource, chunk_source: chunkSource },
    references, embedding_profile_id: profile,
    metadata: Object.freeze({ ...(metadata as Record<string, unknown>) }),
    is_memory: authority === "conversation_memory",
  };
}

export function recordToMapping(record: RagRecord): Record<string, unknown> {
  return {
    id: record.id, text: record.text, source_id: record.source_id, source_name: record.source_name,
    path: record.path, pocket: record.pocket, scope: record.scope, scopes: [...record.scopes], authority: record.authority,
    priority: record.priority, provenance: { ...record.provenance }, references: [...record.references],
    embedding_profile_id: record.embedding_profile_id, metadata: { ...record.metadata },
  };
}

export interface RagLimits {
  readonly max_query_chars: number;
  readonly max_query_utf8_bytes: number;
  readonly max_records: number;
  readonly max_top_k: number;
  readonly max_context_tokens: number;
  readonly max_reference_expansion: number;
  readonly max_per_source: number;
  readonly durable_candidate_limit: number;
  readonly memory_candidate_limit: number;
}

export const DEFAULT_LIMITS: RagLimits = Object.freeze({
  max_query_chars: MAX_QUERY_CHARS, max_query_utf8_bytes: MAX_QUERY_UTF8_BYTES,
  max_records: MAX_RECORDS, max_top_k: MAX_TOP_K, max_context_tokens: MAX_CONTEXT_TOKENS,
  max_reference_expansion: MAX_REFERENCE_EXPANSION, max_per_source: MAX_PER_SOURCE,
  durable_candidate_limit: DURABLE_CANDIDATE_LIMIT, memory_candidate_limit: MEMORY_CANDIDATE_LIMIT,
});

export interface RagProfile {
  readonly name: string;
  readonly version: 2;
  readonly exact_weight: number;
  readonly semantic_weight: number;
  readonly keyword_weight: number;
  readonly scope_weight: number;
  readonly provenance_weight: number;
  readonly authority_weight: number;
  readonly priority_weight: number;
  readonly aspect_coverage_weight: number;
  readonly reference_weight: number;
  readonly semantic_min_score: number;
  readonly authority_scores: Readonly<Record<Authority, number>>;
}

export const DEFAULT_PROFILE: RagProfile = Object.freeze({
  name: PROFILE_ID, version: 2,
  exact_weight: FROZEN_RETRIEVAL_POLICY.scoring.exact_weight_micro,
  semantic_weight: FROZEN_RETRIEVAL_POLICY.scoring.semantic_weight_micro,
  keyword_weight: FROZEN_RETRIEVAL_POLICY.scoring.keyword_weight_micro,
  scope_weight: FROZEN_RETRIEVAL_POLICY.scoring.scope_weight_micro,
  provenance_weight: FROZEN_RETRIEVAL_POLICY.scoring.provenance_weight_micro,
  authority_weight: FROZEN_RETRIEVAL_POLICY.scoring.authority_weight_micro,
  priority_weight: FROZEN_RETRIEVAL_POLICY.scoring.priority_weight_micro,
  aspect_coverage_weight: FROZEN_RETRIEVAL_POLICY.scoring.aspect_coverage_weight_micro,
  reference_weight: FROZEN_RETRIEVAL_POLICY.scoring.cross_reference_weight_micro,
  semantic_min_score: FROZEN_RETRIEVAL_POLICY.embedding.semantic_min_score_micro,
  authority_scores: Object.freeze({ ...FROZEN_RETRIEVAL_POLICY.authority.component_micro }),
});

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in object));
  if (unknown.length || missing.length) throw new ContractError(`${label} fields are invalid`);
  return object;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ContractError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function validateRagLimits(value: RagLimits): RagLimits {
  const raw = exactObject(value, LIMIT_KEYS, "limits");
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => [key, boundedInteger(raw[key], key, 1, key === "max_records" ? MAX_RECORDS : MAX_QUERY_UTF8_BYTES)])) as unknown as RagLimits;
  if (limits.max_query_chars > MAX_QUERY_CHARS || limits.max_query_utf8_bytes > MAX_QUERY_UTF8_BYTES || limits.max_records > MAX_RECORDS || limits.max_top_k > MAX_TOP_K || limits.max_context_tokens > MAX_CONTEXT_TOKENS || limits.max_reference_expansion > MAX_REFERENCE_EXPANSION || limits.max_per_source > MAX_PER_SOURCE || limits.durable_candidate_limit > DURABLE_CANDIDATE_LIMIT || limits.memory_candidate_limit > MEMORY_CANDIDATE_LIMIT) {
    throw new ContractError("limits exceed the frozen contract maximums");
  }
  if (limits.memory_candidate_limit > limits.durable_candidate_limit || limits.max_top_k > limits.max_records) throw new ContractError("limits are internally inconsistent");
  return Object.freeze(limits);
}

export function validateRagProfile(value: RagProfile): RagProfile {
  const raw = exactObject(value, ["name", "version", ...PROFILE_WEIGHT_KEYS, "semantic_min_score", "authority_scores"], "profile");
  if (typeof raw.name !== "string") throw new ContractError("profile name must be a non-empty string");
  assertValidUnicodeScalars(raw.name, "profile name");
  const name = trimPythonUnicodeWhitespace(raw.name);
  if (!name) throw new ContractError("profile name must be a non-empty string");
  if (raw.version !== 2) throw new ContractError("profile version must be 2");
  const weights = PROFILE_WEIGHT_KEYS.map((key) => boundedInteger(raw[key], key, 0, 1_000_000));
  if (!weights.some((weight) => weight > 0) || weights.reduce((sum, weight) => sum + weight, 0) > 1_000_000) throw new ContractError("profile positive weight budget is invalid");
  const semanticMinScore = boundedInteger(raw.semantic_min_score, "semantic_min_score", 0, 1_000_000);
  const authorityRaw = exactObject(raw.authority_scores, [...AUTHORITIES].sort(), "profile authority_scores");
  const authorityScores = Object.fromEntries([...AUTHORITIES].sort().map((authority) => [authority, boundedInteger(authorityRaw[authority], `authority_scores.${authority}`, 0, 1_000_000)])) as RagProfile["authority_scores"];
  return Object.freeze({
    name, version: 2,
    ...Object.fromEntries(PROFILE_WEIGHT_KEYS.map((key, index) => [key, weights[index]!])) as Pick<RagProfile, typeof PROFILE_WEIGHT_KEYS[number]>,
    semantic_min_score: semanticMinScore,
    authority_scores: Object.freeze(authorityScores),
  });
}

export interface RetrievalResult {
  readonly record: RagRecord;
  readonly score_micro: number;
  readonly exact_micro: number;
  readonly semantic_micro: number;
  readonly keyword_micro: number;
  readonly scope_micro: number;
  readonly provenance_micro: number;
  readonly authority_micro: number;
  readonly priority_micro: number;
  readonly aspect_coverage_micro: number;
  readonly cross_reference_micro: number;
  readonly scope_priority: number;
  readonly cross_reference_from_id: string | null;
  readonly has_retrieval_signal: boolean;
}

export interface RetrievalResponse {
  readonly results: readonly RetrievalResult[];
  readonly mode: RetrievalMode;
  readonly eligible_ids: readonly string[];
  readonly candidate_ids: readonly string[];
  readonly context_tokens: number;
  readonly truncated: boolean;
  readonly semantic_state: SemanticState;
  readonly semantic_fallback_reason: SemanticFallbackReason | null;
  readonly errors: readonly string[];
}
