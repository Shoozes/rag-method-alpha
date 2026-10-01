import { RetrievalObservation } from "./reportTypes.js";

export function retrievalObservation(response: { readonly results: ReadonlyArray<{ readonly record: { readonly id: string }; readonly score_micro: number; readonly exact_micro: number; readonly semantic_micro: number; readonly keyword_micro: number; readonly scope_micro: number; readonly provenance_micro: number; readonly authority_micro: number; readonly priority_micro: number; readonly aspect_coverage_micro: number; readonly cross_reference_micro: number; readonly cross_reference_from_id: string | null }>; readonly eligible_ids: readonly string[]; readonly candidate_ids: readonly string[]; readonly context_tokens: number; readonly truncated: boolean; readonly semantic_state: RetrievalObservation["semantic_state"]; readonly semantic_fallback_reason: RetrievalObservation["semantic_fallback_reason"]; readonly errors: readonly string[] }): RetrievalObservation {
  return {
    eligible_ids: [...response.eligible_ids], candidate_ids: [...response.candidate_ids], ordered_ids: response.results.map((result) => result.record.id),
    scores: response.results.map((result) => ({ id: result.record.id, score_micro: result.score_micro, components: {
      exact_micro: result.exact_micro, semantic_micro: result.semantic_micro, keyword_micro: result.keyword_micro, scope_micro: result.scope_micro,
      provenance_micro: result.provenance_micro, authority_micro: result.authority_micro, priority_micro: result.priority_micro,
      aspect_coverage_micro: result.aspect_coverage_micro, cross_reference_micro: result.cross_reference_micro,
    }, cross_reference_from_id: result.cross_reference_from_id })),
    context_selected_ids: response.results.map((result) => result.record.id), context_tokens: response.context_tokens, truncated: response.truncated,
    semantic_state: response.semantic_state, semantic_fallback_reason: response.semantic_fallback_reason, errors: [...response.errors],
  };
}
