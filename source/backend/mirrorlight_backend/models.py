"""Validated HTTP models for the stable Mirrorlight API contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr


API_CONTRACT_VERSION = "v1"
SemanticState = Literal[
    "not_requested",
    "ready",
    "disabled_by_settings",
    "lexical_fallback",
]
SemanticFallbackReason = Literal[
    "disabled_by_settings",
    "no_compatible_vectors",
    "embedding_failed",
]
RagBehaviorMode = Literal[
    "exact_only",
    "semantic_only",
    "keyword_only",
    "hybrid",
    "scoped_hybrid",
]


class RequestModel(BaseModel):
    """Strict request boundary so misspelled fields cannot change behavior."""

    model_config = ConfigDict(extra="forbid")


class ResponseModel(BaseModel):
    """Response base that preserves additive diagnostic fields."""

    model_config = ConfigDict(extra="allow")


class ErrorResponse(ResponseModel):
    error: str
    detail: Any


class HealthResponse(ResponseModel):
    status: str
    version: str


class CompanionListResponse(ResponseModel):
    companions: list[str]


class CreateCompanionRequest(RequestModel):
    id: StrictStr | None = None
    persona: StrictStr | None = None


class CompanionResponse(ResponseModel):
    status: str
    id: str


class MemoryRequest(RequestModel):
    enabled: StrictBool = True


class MemoryResponse(ResponseModel):
    enabled: bool
    persistence: str


class VaultRequest(RequestModel):
    id: StrictStr | None = None
    path: StrictStr | None = None


class VaultResponse(ResponseModel):
    status: str
    id: str
    path: str


class VaultRegistryResponse(ResponseModel):
    registry: dict[str, str]


class AssignmentRequest(RequestModel):
    companion_id: StrictStr | None = None
    vault_ids: list[StrictStr] = Field(default_factory=list)


class AssignmentResponse(ResponseModel):
    status: str
    companion_id: str
    vault_ids: list[str]


class AssignmentRegistryResponse(ResponseModel):
    assignments: dict[str, list[str]]


class EmbeddingInfo(ResponseModel):
    mode: str
    status: str
    profile: str | None = None
    dimension: int = 0
    error: str | None = None


class ProvenanceInfo(ResponseModel):
    scope: str | None = None
    authority: str | None = None
    source_id: str | None = None


class GraphNode(ResponseModel):
    id: str
    label: str | None = None
    color: str | None = None
    text: str | None = None
    pocket: str | None = None
    type: str | None = None
    path: str | None = None
    source: str | None = None
    scope: str | None = None
    authority: str | None = None
    source_id: str | None = None
    provenance: ProvenanceInfo | None = None


class GraphLink(ResponseModel):
    source: str
    target: str


class GraphMeta(ResponseModel):
    total_nodes: int
    total_links: int
    returned_nodes: int
    returned_links: int
    node_limit: int
    link_limit: int
    truncated: bool


class GraphResponse(ResponseModel):
    nodes: list[GraphNode]
    links: list[GraphLink]
    graph_meta: GraphMeta
    companion_id: str | None = None
    pockets: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)
    fingerprint: str | None = None
    generation: str | None = None
    embedding: EmbeddingInfo


class SearchDebug(ResponseModel):
    rank_index: int | None = None
    mode: RagBehaviorMode | None = None
    fallback_error: str | None = None
    score_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    semantic_state: SemanticState | None = None
    semantic_fallback_reason: SemanticFallbackReason | None = None
    exact_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    semantic_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    keyword_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    scope_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    provenance_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    authority_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    priority_micro: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    aspect_coverage_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    cross_reference_micro: int | None = Field(default=None, ge=0, le=1_000_000)


class SearchResult(ResponseModel):
    id: str | None = None
    chunk_id: str | None = None
    score: float | None = None
    score_micro: int | None = Field(default=None, ge=0, le=1_000_000)
    match_type: Literal["exact", "semantic", "keyword", "cross_reference"] | None = None
    cross_reference_from_id: str | None = None
    pocket: str | None = None
    heading: str | None = None
    text: str | None = None
    snippet: str | None = None
    keywords: list[str] | None = None
    tokens_est: int | None = None
    timestamp: int | float | str | None = None
    path: str | None = None
    source: str | None = None
    scope: str | None = None
    authority: str | None = None
    source_id: str | None = None
    provenance: ProvenanceInfo | None = None
    debug: SearchDebug | None = Field(
        default=None,
        alias="_debug",
        exclude_if=lambda value: value is None,
    )


class SearchResponse(ResponseModel):
    results: list[SearchResult]
    companion_id: str | None = None
    pockets: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)
    fingerprint: str | None = None
    generation: str | None = None
    embedding: EmbeddingInfo
    retrieval_mode: Literal["lexical-hybrid", "vector-hybrid", "lexical-fallback"]
    fallback_error: str | None = None
    retrieval_method: Literal["rag-behavior-v2"] = "rag-behavior-v2"
    semantic_state: SemanticState = "not_requested"
    semantic_fallback_reason: SemanticFallbackReason | None = None
    context_tokens: int = Field(default=0, ge=0, le=1_800)
    truncated: bool = False


class ImportResponse(ResponseModel):
    status: str
    id: str
    persona: str | None = None
    vault_path: str | None = None
    lore_path: str | None = None
    memory_file: str | None = None
    fingerprint: str | None = None
