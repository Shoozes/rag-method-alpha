import { compareUnicodeScalars } from "../shared/unicode.js";
import { MICRO_UNITS } from "../shared/fixedPoint.js";
import { RagLimits, RagProfile, RetrievalResult } from "../shared/types.js";
import { aspectCoverageScore, tokens, totalScore } from "./scoring.js";

function compareText(left: string, right: string): number { return compareUnicodeScalars(left, right); }

export function deterministicOrder(results: Iterable<RetrievalResult>): RetrievalResult[] {
  return [...results].sort((left, right) => left.score_micro !== right.score_micro ? right.score_micro - left.score_micro : left.scope_priority !== right.scope_priority ? right.scope_priority - left.scope_priority : compareText(left.record.source_name, right.record.source_name) || compareText(left.record.text, right.record.text) || compareText(left.record.source_id, right.record.source_id) || compareText(left.record.id, right.record.id));
}

export function candidatePool(results: Iterable<RetrievalResult>, limits: RagLimits): { readonly values: RetrievalResult[]; readonly truncated: boolean } {
  const values = [...results];
  const durable = deterministicOrder(values.filter((result) => !result.record.is_memory)).slice(0, limits.durable_candidate_limit);
  const memory = deterministicOrder(values.filter((result) => result.record.is_memory)).slice(0, limits.memory_candidate_limit);
  const retained = deterministicOrder([...durable, ...memory]);
  return { values: retained, truncated: retained.length < values.length };
}

export function estimatedContextTokens(result: RetrievalResult): number {
  const record = result.record;
  return Math.floor((Array.from(record.text).length + Array.from(record.source_name).length + Array.from(record.pocket).length + record.scopes.reduce((sum, scope) => sum + Array.from(scope).length, 0) + 99) / 4);
}

export function selectResults(results: Iterable<RetrievalResult>, queryTerms: ReadonlySet<string>, knownRecordTerms: ReadonlyMap<string, ReadonlySet<string>>, topK: number, maxContextTokens: number, limits: RagLimits, profile: RagProfile): { readonly selected: RetrievalResult[]; readonly truncated: boolean; readonly contextTokens: number } {
  const candidates = [...results];
  const recordTerms = new Map(candidates.map((candidate) => [candidate.record.id, knownRecordTerms.get(candidate.record.id) ?? new Set(tokens(candidate.record.text))]));
  const covered = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const selected: RetrievalResult[] = [];
  let usedTokens = 0;
  while (selected.length < topK && candidates.length) {
    const hasNewSource = candidates.some((candidate) => (sourceCounts.get(candidate.record.source_id) ?? 0) === 0 && usedTokens + estimatedContextTokens(candidate) <= maxContextTokens);
    let best: { key: [number, number, string, string]; index: number; aspect: number } | null = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const sourceCount = sourceCounts.get(candidate.record.source_id) ?? 0;
      if (sourceCount >= limits.max_per_source || (hasNewSource && sourceCount > 0)) continue;
      const estimated = estimatedContextTokens(candidate);
      if (usedTokens + estimated > maxContextTokens) continue;
      const aspect = aspectCoverageScore(queryTerms, recordTerms.get(candidate.record.id)!, covered);
      const rankScore = Math.min(MICRO_UNITS, candidate.score_micro + Math.floor((aspect * profile.aspect_coverage_weight) / MICRO_UNITS));
      const key: [number, number, string, string] = [-rankScore, -candidate.score_micro, candidate.record.source_id, candidate.record.id];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && (compareText(key[2], best.key[2]) < 0 || (key[2] === best.key[2] && compareText(key[3], best.key[3]) < 0)))))) best = { key, index, aspect };
    }
    if (!best) break;
    const candidate = candidates.splice(best.index, 1)[0]!;
    const selectedCandidate: RetrievalResult = { ...candidate, aspect_coverage_micro: best.aspect, score_micro: totalScore({ ...candidate, aspect_coverage_micro: best.aspect }, profile) };
    selected.push(selectedCandidate);
    usedTokens += estimatedContextTokens(selectedCandidate);
    for (const term of recordTerms.get(selectedCandidate.record.id)!) if (queryTerms.has(term)) covered.add(term);
    sourceCounts.set(selectedCandidate.record.source_id, (sourceCounts.get(selectedCandidate.record.source_id) ?? 0) + 1);
  }
  return { selected, truncated: candidates.length > 0, contextTokens: usedTokens };
}
