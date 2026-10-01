import type {
  ComparisonObservation,
  SearchObservation,
  SearchResult,
} from "../types/rag";
import packageMetadata from "../../package.json";

export const LAB_REPORT_SCHEMA = "rag_method_lab_query_report_v1";
export const LAB_REPORT_FILENAME = "rag-method-lab-query-report.json";

function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function reportResult(result: SearchResult, rank: number) {
  const debug = result._debug;
  return {
    rank,
    id: result.id || result.chunk_id || null,
    chunk_id: result.chunk_id || result.id || null,
    source_id: result.source_id || null,
    path: result.path || result.source || null,
    heading: result.heading || null,
    pocket: result.pocket || null,
    scope: result.scope || result.provenance?.scope || null,
    authority: result.authority || result.provenance?.authority || null,
    tokens_est: nullable(result.tokens_est),
    score: nullable(result.score),
    score_micro: nullable(result.score_micro ?? debug?.score_micro),
    match_type: nullable(result.match_type),
    cross_reference_from_id: nullable(result.cross_reference_from_id),
    score_components_micro: {
      exact: nullable(debug?.exact_micro),
      keyword: nullable(debug?.keyword_micro),
      semantic: nullable(debug?.semantic_micro),
      scope: nullable(debug?.scope_micro),
      provenance: nullable(debug?.provenance_micro),
      authority: nullable(debug?.authority_micro),
      priority: nullable(debug?.priority_micro),
      aspect_coverage: nullable(debug?.aspect_coverage_micro),
      cross_reference: nullable(debug?.cross_reference_micro),
    },
    text: result.text || result.snippet || "",
  };
}

function reportResponse(observation: SearchObservation) {
  const { response } = observation;
  return {
    requested_mode: observation.settings.mode,
    duration_ms: Number(observation.durationMs.toFixed(3)),
    retrieval_mode: response.retrieval_mode,
    semantic_state: response.semantic_state,
    semantic_fallback_reason: response.semantic_fallback_reason,
    context_tokens: response.context_tokens,
    context_truncated: response.truncated,
    results: response.results.map((result, index) => reportResult(result, index + 1)),
  };
}

export function buildCurrentQueryReport(
  collectionId: string,
  observation: SearchObservation,
  comparisons: readonly ComparisonObservation[],
) {
  return {
    schema: LAB_REPORT_SCHEMA,
    generated_at_utc: new Date().toISOString(),
    application: {
      name: "RAG Method Lab",
      version: packageMetadata.version,
    },
    contracts: {
      retrieval: "rag-behavior-v2",
      indexing: "rag-indexing-v1",
      api: "v1",
    },
    collection: {
      id: collectionId,
      fingerprint: observation.response.fingerprint,
      generation: observation.response.generation,
    },
    query: observation.query,
    settings: {
      pockets: [...observation.settings.pockets],
      top_k: observation.settings.topK,
      max_context_tokens: observation.settings.maxContextTokens,
      detailed_score_evidence: observation.settings.debug,
    },
    current: reportResponse(observation),
    comparison: comparisons.map((entry) => ({
      mode: entry.mode,
      status: entry.status,
      duration_ms: Number(entry.durationMs.toFixed(3)),
      error: entry.error || null,
      observation: entry.response
        ? reportResponse({
            query: observation.query,
            settings: { ...observation.settings, mode: entry.mode, topK: Math.min(3, observation.settings.topK), debug: true },
            response: entry.response,
            durationMs: entry.durationMs,
          })
        : null,
    })),
    context_preview: observation.response.results.map((result, index) => ({
      rank: index + 1,
      id: result.id || result.chunk_id || null,
      tokens_est: nullable(result.tokens_est),
      text: result.text || result.snippet || "",
    })),
  };
}

export function serializeCurrentQueryReport(
  collectionId: string,
  observation: SearchObservation,
  comparisons: readonly ComparisonObservation[],
): string {
  return `${JSON.stringify(buildCurrentQueryReport(collectionId, observation, comparisons), null, 2)}\n`;
}
