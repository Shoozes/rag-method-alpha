export const DEFAULT_POCKETS = ["global", "vault", "lore", "memories"] as const;
export const RAG_BEHAVIOR_MODES = [
  "exact_only",
  "keyword_only",
  "semantic_only",
  "hybrid",
  "scoped_hybrid",
] as const;
export const COMPARISON_MODES = [
  "exact_only",
  "keyword_only",
  "semantic_only",
  "scoped_hybrid",
] as const;
export const MAX_CONTEXT_TOKENS = 1_800;
export const MAX_UI_TOP_K = 20;

export type PocketName = (typeof DEFAULT_POCKETS)[number];

export type GraphNode = {
  id: string;
  label?: string;
  color?: string;
  text?: string;
  pocket?: string;
  type?: string;
  path?: string;
  source?: string;
  scope?: string;
  authority?: string;
  source_id?: string;
  provenance?: {
    scope?: string;
    authority?: string;
    source_id?: string;
  };
};

export type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
};

export type GraphMeta = {
  total_nodes: number;
  total_links: number;
  returned_nodes: number;
  returned_links: number;
  node_limit: number;
  link_limit: number;
  truncated: boolean;
};

export type RagMetadata = {
  companion_id: string | null;
  pockets: string[];
  paths: string[];
  fingerprint: string;
  generation: string | null;
  embedding: EmbeddingInfo;
};

export type GraphData = RagMetadata & {
  nodes: GraphNode[];
  links: GraphLink[];
  graph_meta: GraphMeta;
};

export type EmbeddingInfo = {
  mode: string;
  status: string;
  profile?: string | null;
  dimension?: number;
  error?: string;
};

export type SearchResult = {
  id?: string;
  chunk_id?: string;
  score?: number;
  score_micro?: number;
  match_type?: "exact" | "semantic" | "keyword" | "cross_reference";
  cross_reference_from_id?: string | null;
  pocket?: string;
  heading?: string;
  text?: string;
  snippet?: string;
  keywords?: string[];
  tokens_est?: number;
  timestamp?: number | string;
  path?: string;
  source?: string;
  scope?: string;
  authority?: string;
  source_id?: string;
  provenance?: {
    scope?: string;
    authority?: string;
    source_id?: string;
  };
  _debug?: {
    rank_index?: number;
    mode?: RagBehaviorMode;
    fallback_error?: string | null;
    score_micro?: number;
    semantic_state?: SemanticState;
    semantic_fallback_reason?: SemanticFallbackReason;
    exact_micro?: number;
    semantic_micro?: number;
    keyword_micro?: number;
    scope_micro?: number;
    provenance_micro?: number;
    authority_micro?: number;
    priority_micro?: number;
    aspect_coverage_micro?: number;
    cross_reference_micro?: number;
  };
};

export type SemanticState =
  | "not_requested"
  | "ready"
  | "disabled_by_settings"
  | "lexical_fallback";

export type SemanticFallbackReason =
  | "disabled_by_settings"
  | "no_compatible_vectors"
  | "embedding_failed"
  | null;

export type RagBehaviorMode = (typeof RAG_BEHAVIOR_MODES)[number];

export type SearchSettings = {
  mode: RagBehaviorMode;
  pockets: PocketName[];
  topK: number;
  maxContextTokens: number;
  debug: boolean;
};

export type QueryMetrics = {
  scalarCount: number;
  utf8Bytes: number;
  invalidUnicode: boolean;
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  mode: "scoped_hybrid",
  pockets: [...DEFAULT_POCKETS],
  topK: 5,
  maxContextTokens: MAX_CONTEXT_TOKENS,
  debug: true,
};

export type RetrievalMode = "lexical-hybrid" | "vector-hybrid" | "lexical-fallback";

export type CompanionsResponse = {
  companions: string[];
};

export type SearchResponse = RagMetadata & {
  results: SearchResult[];
  retrieval_mode: RetrievalMode;
  fallback_error?: string | null;
  retrieval_method: "rag-behavior-v2";
  semantic_state: SemanticState;
  semantic_fallback_reason: SemanticFallbackReason;
  context_tokens: number;
  truncated: boolean;
};

export type SearchSummary = {
  retrieval_mode: RetrievalMode | "";
  retrieval_method: "rag-behavior-v2" | "";
  semantic_state: SemanticState;
  semantic_fallback_reason: SemanticFallbackReason;
  context_tokens: number;
  truncated: boolean;
};

export type SearchObservation = {
  query: string;
  settings: SearchSettings;
  response: SearchResponse;
  durationMs: number;
};

export type ComparisonObservation = {
  mode: (typeof COMPARISON_MODES)[number];
  status: "pass" | "error";
  durationMs: number;
  response?: SearchResponse;
  error?: string;
};

export type ImportResponse = {
  status: string;
  id: string;
  persona?: string;
  vault_path?: string;
  lore_path?: string | null;
  memory_file?: string;
  fingerprint?: string;
};
