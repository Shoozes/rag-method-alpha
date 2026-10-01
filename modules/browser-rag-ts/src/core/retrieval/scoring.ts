import { MICRO_UNITS, quantizeCosine } from "../shared/fixedPoint.js";
import { lowercaseContractText } from "../shared/lowercase.js";
import { RagProfile, RagRecord, RetrievalResult } from "../shared/types.js";
import { ContractError } from "../shared/errors.js";
import { isPythonUnicodeAlphanumericCodepoint } from "../shared/unicode.js";

export function canonicalQueryText(value: string): string {
  return lowercaseContractText(value);
}

export function tokens(value: string): readonly string[] {
  const normalized = lowercaseContractText(value);
  const terms = new Set<string>();
  let current = "";
  for (const scalar of Array.from(normalized)) {
    if (isPythonUnicodeAlphanumericCodepoint(scalar.codePointAt(0)!)) current += scalar;
    else if (current) { terms.add(current); current = ""; }
  }
  if (current) terms.add(current);
  return [...terms].sort();
}

export function exactScoreNormalized(query: string, record: string): number {
  return query && record.includes(query) ? MICRO_UNITS : 0;
}

export function keywordScoreTerms(queryTerms: ReadonlySet<string>, recordTerms: ReadonlySet<string>): number {
  if (!queryTerms.size) return 0;
  let overlap = 0;
  for (const term of queryTerms) if (recordTerms.has(term)) overlap += 1;
  return Math.floor((overlap * MICRO_UNITS) / queryTerms.size);
}

export function validateQueryVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new ContractError("query vector must be a finite non-empty array of numbers");
  }
  const values = [...value];
  const norm = Math.sqrt(values.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new ContractError("query vector must have a non-zero finite norm");
  return values;
}

export function semanticScore(query: readonly number[], recordVector: readonly number[] | undefined): number | null {
  if (!recordVector || recordVector.length !== query.length || recordVector.some((item) => !Number.isFinite(item))) return null;
  const queryNorm = Math.sqrt(query.reduce((sum, item) => sum + item * item, 0));
  const recordNorm = Math.sqrt(recordVector.reduce((sum, item) => sum + item * item, 0));
  if (queryNorm <= 1e-12 || recordNorm <= 1e-12) return null;
  const cosine = query.reduce((sum, item, index) => sum + item * recordVector[index]!, 0) / (queryNorm * recordNorm);
  return quantizeCosine(cosine);
}

export function scopeScore(record: RagRecord, includeScopes: readonly string[]): number {
  if (!includeScopes.length || includeScopes.includes("all")) return 0;
  return record.scopes.some((scope) => includeScopes.includes(scope)) ? MICRO_UNITS : 0;
}

export function provenanceScore(record: RagRecord): number {
  return ((Number(record.provenance.file_source) + Number(record.provenance.chunk_source)) * MICRO_UNITS) / 2;
}

export function authorityScore(record: RagRecord, profile: RagProfile): number {
  return profile.authority_scores[record.authority];
}

export function priorityScore(priority: number): number {
  return Math.max(-MICRO_UNITS, Math.min(MICRO_UNITS, priority * 10_000));
}

export function aspectCoverageScore(queryTerms: ReadonlySet<string>, recordTerms: ReadonlySet<string>, coveredTerms: ReadonlySet<string>): number {
  if (!queryTerms.size) return 0;
  let fresh = 0;
  for (const term of recordTerms) if (queryTerms.has(term) && !coveredTerms.has(term)) fresh += 1;
  return Math.floor((fresh * MICRO_UNITS) / queryTerms.size);
}

export function totalScore(result: Pick<RetrievalResult, "exact_micro" | "semantic_micro" | "keyword_micro" | "scope_micro" | "provenance_micro" | "authority_micro" | "priority_micro" | "aspect_coverage_micro" | "cross_reference_micro">, profile: RagProfile): number {
  const components: Array<[number, number]> = [
    [result.exact_micro, profile.exact_weight], [result.semantic_micro, profile.semantic_weight],
    [result.keyword_micro, profile.keyword_weight], [result.scope_micro, profile.scope_weight],
    [result.provenance_micro, profile.provenance_weight], [result.authority_micro, profile.authority_weight],
    [result.priority_micro, profile.priority_weight], [result.aspect_coverage_micro, profile.aspect_coverage_weight],
    [result.cross_reference_micro, profile.reference_weight],
  ];
  const numerator = components.reduce((sum, [component, weight]) => sum + component * weight, 0);
  const score = numerator < 0 ? Math.ceil(numerator / MICRO_UNITS) : Math.floor(numerator / MICRO_UNITS);
  return Math.max(0, Math.min(MICRO_UNITS, score));
}
