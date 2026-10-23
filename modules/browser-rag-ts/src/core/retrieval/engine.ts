import { ContractError } from "../shared/errors.js";
import { DEFAULT_LIMITS, DEFAULT_PROFILE, RagLimits, RagProfile, RagRecord, RetrievalMode, RetrievalResponse, RetrievalResult, recordFromMapping, recordToMapping, validateRagLimits, validateRagProfile } from "../shared/types.js";
import { canonicalQueryText, exactScoreNormalized, keywordScoreTerms, semanticScore, tokens, scopeScore, provenanceScore, authorityScore, priorityScore, totalScore, validateQueryVector } from "./scoring.js";
import { allowedByAuthority, allowedByScope, matchingScopePriority } from "./scopes.js";
import { candidatePool, deterministicOrder, selectResults } from "./selection.js";
import { referenceSignals } from "./references.js";
import { validateQuery } from "./query.js";
import { CancellationCheckpoint, SearchStep, checkpoint } from "./cancellation.js";
import { assertValidUnicodeScalars, compareUnicodeScalars, trimPythonUnicodeWhitespace } from "../shared/unicode.js";
import { FROZEN_RETRIEVAL_POLICY } from "../shared/frozenBehaviorPolicy.js";

export const MODES: readonly RetrievalMode[] = FROZEN_RETRIEVAL_POLICY.modes as readonly RetrievalMode[];
const AUTHORITY_POLICIES = new Set(FROZEN_RETRIEVAL_POLICY.authority.policy_values);
const FALLBACKS = new Set(FROZEN_RETRIEVAL_POLICY.fallback_reasons);
const COOPERATIVE_BATCH_SIZE = 64;

export interface SearchOptions {
  readonly mode?: RetrievalMode;
  readonly top_k?: number;
  readonly include_scopes?: readonly string[];
  readonly exclude_scopes?: readonly string[];
  readonly scope_priorities?: Readonly<Record<string, number>>;
  readonly authority_policy?: string;
  readonly vectors?: Readonly<Record<string, readonly number[]>>;
  readonly query_vector?: readonly number[];
  readonly query_embedding_profile_id?: string;
  readonly semantic_enabled?: boolean;
  readonly semantic_fallback_reason?: string;
  readonly expand?: boolean;
  readonly max_context_tokens?: number;
  readonly checkpoint?: CancellationCheckpoint;
}

export type SearchScheduler = (step: SearchStep) => Promise<void>;

function scopeValues(values: readonly string[] | undefined, field: string): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new ContractError(`${field} must be an array of strings`);
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") throw new ContractError(`${field} must contain non-empty strings`);
    assertValidUnicodeScalars(value, field);
    const normalized = trimPythonUnicodeWhitespace(value);
    if (!normalized) throw new ContractError(`${field} must contain non-empty strings`);
    if (!output.includes(normalized)) output.push(normalized);
  }
  return output;
}

function scopePriorities(values: Readonly<Record<string, number>> | undefined): Readonly<Record<string, number>> {
  if (values === undefined) return {};
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ContractError("scope_priorities must be an object");
  const output: Record<string, number> = Object.create(null);
  for (const [scope, priority] of Object.entries(values)) {
    assertValidUnicodeScalars(scope, "scope priority scope");
    const normalized = trimPythonUnicodeWhitespace(scope);
    if (!normalized || !Number.isInteger(priority) || priority < -100 || priority > 100) throw new ContractError("scope_priorities is invalid");
    if (Object.hasOwn(output, normalized)) throw new ContractError("scope_priorities contains duplicate normalized scopes");
    output[normalized] = priority;
  }
  return output;
}

function resultWithSignal(result: Omit<RetrievalResult, "has_retrieval_signal">): RetrievalResult {
  return { ...result, has_retrieval_signal: Boolean(result.exact_micro || result.semantic_micro || result.keyword_micro || result.cross_reference_micro) };
}

export class RagEngine {
  readonly profile: RagProfile;
  readonly limits: RagLimits;
  readonly records: readonly RagRecord[];
  private readonly recordsById: ReadonlyMap<string, RagRecord>;

  constructor(records: readonly RagRecord[], profile: RagProfile = DEFAULT_PROFILE, limits: RagLimits = DEFAULT_LIMITS) {
    this.profile = validateRagProfile(profile);
    this.limits = validateRagLimits(limits);
    const validatedRecords = records.map((record) => recordFromMapping(recordToMapping(record)));
    if (validatedRecords.length > this.limits.max_records) throw new ContractError("record limit exceeded");
    if (new Set(validatedRecords.map((record) => record.id)).size !== validatedRecords.length) throw new ContractError("record IDs must be unique");
    this.records = validatedRecords.sort((left, right) => compareUnicodeScalars(left.source_id, right.source_id) || compareUnicodeScalars(left.id, right.id));
    this.recordsById = new Map(this.records.map((record) => [record.id, record]));
  }

  search(query: string, options: SearchOptions = {}): RetrievalResponse {
    const steps = this.searchSteps(query, options);
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
    }
  }

  async searchAsync(query: string, options: SearchOptions, scheduler: SearchScheduler): Promise<RetrievalResponse> {
    const steps = this.searchSteps(query, options);
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
      await scheduler(next.value);
    }
  }

  private *searchSteps(query: string, options: SearchOptions): Generator<SearchStep, RetrievalResponse, void> {
    const validatedQuery = validateQuery(query, this.limits.max_query_chars, this.limits.max_query_utf8_bytes);
    const modeInput = options.mode ?? "hybrid";
    assertValidUnicodeScalars(modeInput, "mode");
    const mode = trimPythonUnicodeWhitespace(modeInput).toLowerCase() as RetrievalMode;
    if (!MODES.includes(mode)) throw new ContractError(`unsupported retrieval mode: ${mode}`);
    const topK = options.top_k ?? 5;
    if (!Number.isInteger(topK) || topK < 1) throw new ContractError("top_k must be a positive integer");
    const requestedTopK = Math.min(topK, this.limits.max_top_k);
    const includes = scopeValues(options.include_scopes, "include_scopes");
    const excludes = scopeValues(options.exclude_scopes, "exclude_scopes");
    const priorities = scopePriorities(options.scope_priorities);
    const authorityInput = options.authority_policy ?? "all";
    assertValidUnicodeScalars(authorityInput, "authority_policy");
    const authorityPolicy = trimPythonUnicodeWhitespace(authorityInput).toLowerCase();
    if (!AUTHORITY_POLICIES.has(authorityPolicy)) throw new ContractError(`unsupported authority policy: ${authorityPolicy}`);
    const semanticEnabled = options.semantic_enabled ?? true;
    if (typeof semanticEnabled !== "boolean") throw new ContractError("semantic_enabled must be a boolean");
    const fallbackInput = options.semantic_fallback_reason;
    if (fallbackInput !== undefined && !FALLBACKS.has(fallbackInput)) throw new ContractError("semantic_fallback_reason is invalid");
    const expand = options.expand ?? true;
    if (typeof expand !== "boolean") throw new ContractError("expand must be a boolean");
    const contextLimit = options.max_context_tokens === undefined ? this.limits.max_context_tokens : Math.min(options.max_context_tokens, this.limits.max_context_tokens);
    if (!Number.isInteger(contextLimit) || contextLimit < 1) throw new ContractError("max_context_tokens must be a positive integer");
    const normalizedQuery = canonicalQueryText(validatedQuery);
    if (!normalizedQuery) return { results: [], mode, eligible_ids: [], candidate_ids: [], context_tokens: 0, truncated: false, semantic_state: "not_requested", semantic_fallback_reason: null, errors: [] };

    checkpoint(options.checkpoint, "filter.start");
    yield "filter.start";
    const eligible: RagRecord[] = [];
    for (let index = 0; index < this.records.length; index += 1) {
      if (index % COOPERATIVE_BATCH_SIZE === 0) {
        checkpoint(options.checkpoint, "filter.scan");
        yield "filter.batch";
      }
      const record = this.records[index]!;
      if (allowedByScope(record, includes, excludes) && allowedByAuthority(record, authorityPolicy)) eligible.push(record);
    }
    const eligibleIds = eligible.map((record) => record.id).sort(compareUnicodeScalars);
    const exactEnabled = ["exact_only", "hybrid", "scoped_hybrid"].includes(mode);
    const keywordEnabled = ["keyword_only", "hybrid", "scoped_hybrid"].includes(mode);
    const semanticRequested = ["semantic_only", "hybrid", "scoped_hybrid"].includes(mode);
    const errors: string[] = [];
    let semanticState: RetrievalResponse["semantic_state"] = "not_requested";
    let fallbackReason: RetrievalResponse["semantic_fallback_reason"] = null;
    let validQueryVector: readonly number[] | null = null;
    if (!semanticRequested) semanticState = "not_requested";
    else if (!semanticEnabled) { semanticState = "disabled_by_settings"; fallbackReason = (fallbackInput as RetrievalResponse["semantic_fallback_reason"]) ?? "disabled_by_settings"; }
    else if (!options.query_vector || !options.query_embedding_profile_id) { semanticState = "lexical_fallback"; fallbackReason = (fallbackInput as RetrievalResponse["semantic_fallback_reason"]) ?? "no_compatible_vectors"; }
    else {
      try { validQueryVector = validateQueryVector(options.query_vector); }
      catch (error) { semanticState = "lexical_fallback"; fallbackReason = "embedding_failed"; errors.push(error instanceof Error ? error.message : String(error)); }
      if (validQueryVector) {
        const compatible = eligible.some((record) => record.embedding_profile_id === options.query_embedding_profile_id && options.vectors !== undefined && semanticScore(validQueryVector!, options.vectors[record.id]) !== null);
        if (compatible) semanticState = "ready";
        else { semanticState = "lexical_fallback"; fallbackReason = "no_compatible_vectors"; validQueryVector = null; }
      }
    }
    if (mode === "semantic_only" && semanticState !== "ready") errors.push(`semantic retrieval unavailable: ${fallbackReason}`);
    const queryTerms = new Set(tokens(normalizedQuery));
    const recordTerms = new Map<string, ReadonlySet<string>>();
    const candidates: RetrievalResult[] = [];
    checkpoint(options.checkpoint, "rank.start");
    yield "rank.start";
    for (let index = 0; index < eligible.length; index += 1) {
      if (index % COOPERATIVE_BATCH_SIZE === 0) {
        checkpoint(options.checkpoint, "rank.scan");
        yield "rank.batch";
      }
      const record = eligible[index]!;
      const normalizedRecord = canonicalQueryText(record.text);
      const terms = keywordEnabled ? new Set(tokens(normalizedRecord)) : new Set<string>();
      if (terms.size) recordTerms.set(record.id, terms);
      const exact = exactEnabled ? exactScoreNormalized(normalizedQuery, normalizedRecord) : 0;
      const keyword = keywordEnabled ? keywordScoreTerms(queryTerms, terms) : 0;
      let semantic = 0;
      if (semanticRequested && semanticState === "ready" && validQueryVector && record.embedding_profile_id === options.query_embedding_profile_id && options.vectors) {
        const score = semanticScore(validQueryVector, options.vectors[record.id]);
        if (score !== null && score >= this.profile.semantic_min_score) semantic = score;
      }
      const scopePriority = matchingScopePriority(record, priorities);
      const initial = { record, score_micro: 0, exact_micro: exact, semantic_micro: semantic, keyword_micro: keyword, scope_micro: scopeScore(record, includes), provenance_micro: provenanceScore(record), authority_micro: authorityScore(record, this.profile), priority_micro: priorityScore(record.priority + scopePriority), aspect_coverage_micro: 0, cross_reference_micro: 0, scope_priority: scopePriority, cross_reference_from_id: null };
      candidates.push(resultWithSignal({ ...initial, score_micro: totalScore(initial, this.profile) }));
    }
    if (expand && candidates.length) {
      checkpoint(options.checkpoint, "cross_reference.before");
      yield "cross_reference.before";
      const signals = referenceSignals(deterministicOrder(candidates), this.recordsById, this.limits.max_reference_expansion, new Set(eligibleIds));
      for (let index = 0; index < candidates.length; index += 1) {
        if (index % COOPERATIVE_BATCH_SIZE === 0) {
          yield "cross_reference.batch";
        }
        const anchor = signals.get(candidates[index]!.record.id);
        if (!anchor) continue;
        const updated = { ...candidates[index]!, cross_reference_micro: 1_000_000, cross_reference_from_id: anchor };
        candidates[index] = resultWithSignal({ ...updated, score_micro: totalScore(updated, this.profile) });
      }
      checkpoint(options.checkpoint, "cross_reference.after");
      yield "cross_reference.after";
    }
    const pooled = candidatePool(candidates.filter((candidate) => candidate.has_retrieval_signal), this.limits);
    const candidateIds = pooled.values.map((candidate) => candidate.record.id);
    checkpoint(options.checkpoint, "selection.start");
    yield "selection.start";
    const selected = selectResults(pooled.values, queryTerms, recordTerms, requestedTopK, contextLimit, this.limits, this.profile);
    checkpoint(options.checkpoint, "return");
    yield "return";
    return { results: selected.selected, mode, eligible_ids: eligibleIds, candidate_ids: candidateIds, context_tokens: selected.contextTokens, truncated: pooled.truncated || selected.truncated, semantic_state: semanticState, semantic_fallback_reason: fallbackReason, errors: [...new Set(errors)] };
  }
}
