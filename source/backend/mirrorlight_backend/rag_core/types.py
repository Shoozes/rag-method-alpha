from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping, Sequence


MICRO_UNITS = 1_000_000
CONTRACT_ID = "rag-behavior-v2"
PROFILE_ID = "rag-behavior-v2-edge-derived"
MAX_QUERY_CHARS = 4_000
MAX_QUERY_UTF8_BYTES = 16_384
MAX_RECORDS = 50_000
MAX_TOP_K = 100
MAX_CONTEXT_TOKENS = 1_800
MAX_REFERENCE_EXPANSION = 4
MAX_PER_SOURCE = 2
DURABLE_CANDIDATE_LIMIT = 48
MEMORY_CANDIDATE_LIMIT = 16

AUTHORITY_KINDS = frozenset(
    {
        "global_record",
        "workspace_record",
        "persona_vault",
        "conversation_memory",
        "unclassified",
    }
)
SEMANTIC_STATES = frozenset(
    {"not_requested", "ready", "disabled_by_settings", "lexical_fallback"}
)
SEMANTIC_FALLBACK_REASONS = frozenset(
    {"disabled_by_settings", "no_compatible_vectors", "embedding_failed"}
)


class ContractError(ValueError):
    """Raised when a RAG behavior input violates the frozen contract."""


def validate_query(
    value: object,
    *,
    max_chars: int = MAX_QUERY_CHARS,
    max_utf8_bytes: int = MAX_QUERY_UTF8_BYTES,
) -> str:
    """Validate the shared query boundary before any retrieval work starts."""

    if not isinstance(value, str):
        raise ContractError("query must be a string")
    if len(value) > max_chars:
        raise ContractError("query exceeds the configured character limit")
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError as exc:
        raise ContractError("query must contain valid Unicode scalar values") from exc
    if len(encoded) > max_utf8_bytes:
        raise ContractError("query exceeds the configured UTF-8 byte limit")
    return value


def _string(value: object, field_name: str, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{field_name} must be a string")
    result = value.strip()
    if required and not result:
        raise ContractError(f"{field_name} must not be empty")
    try:
        result.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ContractError(
            f"{field_name} must contain valid Unicode scalar values"
        ) from exc
    return result


def _optional_string(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    result = _string(value, field_name, required=False)
    return result or None


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ContractError(f"{field_name} must be an array of strings")
    values: list[str] = []
    for item in value:
        text = _string(item, field_name)
        if text not in values:
            values.append(text)
    return tuple(values)


@dataclass(frozen=True)
class RagRecord:
    """A source-grounded retrieval unit with portable v2 metadata."""

    id: str
    text: str
    source_id: str
    path: str = ""
    source_name: str = ""
    pocket: str = "default"
    scope: str = "global"
    scopes: tuple[str, ...] = ()
    authority: str = "unclassified"
    priority: int = 0
    provenance_file: bool = False
    provenance_chunk: bool = False
    references: tuple[str, ...] = ()
    embedding_profile_id: str | None = None
    metadata: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _string(self.id, "id"))
        object.__setattr__(self, "text", _string(self.text, "text"))
        object.__setattr__(self, "source_id", _string(self.source_id, "source_id"))
        object.__setattr__(self, "path", _string(self.path, "path", required=False))
        source_name = _string(
            self.source_name,
            "source_name",
            required=False,
        ) or self.path or self.source_id
        object.__setattr__(self, "source_name", source_name)
        object.__setattr__(self, "pocket", _string(self.pocket, "pocket"))

        primary_scope = _string(self.scope, "scope")
        scopes = _string_tuple(self.scopes, "scopes")
        if not scopes:
            scopes = (primary_scope,)
        else:
            primary_scope = scopes[0]
        object.__setattr__(self, "scope", primary_scope)
        object.__setattr__(self, "scopes", scopes)

        authority = _string(self.authority, "authority")
        if authority not in AUTHORITY_KINDS:
            raise ContractError(f"unsupported authority kind: {authority}")
        object.__setattr__(self, "authority", authority)

        if (
            not isinstance(self.priority, int)
            or isinstance(self.priority, bool)
            or not -100 <= self.priority <= 100
        ):
            raise ContractError("priority must be an integer between -100 and 100")
        for field_name in ("provenance_file", "provenance_chunk"):
            if not isinstance(getattr(self, field_name), bool):
                raise ContractError(f"{field_name} must be a boolean")
        object.__setattr__(self, "references", _string_tuple(self.references, "references"))
        object.__setattr__(
            self,
            "embedding_profile_id",
            _optional_string(self.embedding_profile_id, "embedding_profile_id"),
        )
        if not isinstance(self.metadata, Mapping):
            raise ContractError("metadata must be an object")
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))

    @property
    def is_memory(self) -> bool:
        return self.authority == "conversation_memory"

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "RagRecord":
        if not isinstance(value, Mapping):
            raise ContractError("record must be an object")
        allowed_fields = {
            "id",
            "text",
            "source_id",
            "source_name",
            "path",
            "pocket",
            "scope",
            "scopes",
            "authority",
            "priority",
            "provenance",
            "provenance_file",
            "provenance_chunk",
            "references",
            "embedding_profile_id",
            "metadata",
        }
        unknown_fields = set(value) - allowed_fields
        if unknown_fields:
            raise ContractError(
                "record contains unknown fields: "
                + ", ".join(sorted(str(field) for field in unknown_fields))
            )
        raw_scopes = value.get("scopes")
        scope = value.get("scope", "global")
        if raw_scopes is not None and isinstance(raw_scopes, Sequence) and not isinstance(
            raw_scopes, (str, bytes)
        ):
            scope = raw_scopes[0] if raw_scopes else scope
        provenance = value.get("provenance", {})
        if provenance is None:
            provenance = {}
        if not isinstance(provenance, Mapping):
            raise ContractError("provenance must be an object")
        return cls(
            id=value.get("id"),
            text=value.get("text"),
            source_id=value.get("source_id"),
            path=value.get("path", ""),
            source_name=value.get("source_name", ""),
            pocket=value.get("pocket", "default"),
            scope=scope,
            scopes=raw_scopes or (),
            authority=value.get("authority", "unclassified"),
            priority=value.get("priority", 0),
            provenance_file=provenance.get(
                "file_source",
                value.get("provenance_file", False),
            ),
            provenance_chunk=provenance.get(
                "chunk_source",
                value.get("provenance_chunk", False),
            ),
            references=value.get("references", ()),
            embedding_profile_id=value.get("embedding_profile_id"),
            metadata=value.get("metadata", {}),
        )

    def to_mapping(self) -> dict[str, object]:
        return {
            "id": self.id,
            "text": self.text,
            "source_id": self.source_id,
            "source_name": self.source_name,
            "path": self.path,
            "pocket": self.pocket,
            "scope": self.scope,
            "scopes": list(self.scopes),
            "authority": self.authority,
            "priority": self.priority,
            "provenance": {
                "file_source": self.provenance_file,
                "chunk_source": self.provenance_chunk,
            },
            "references": list(self.references),
            "embedding_profile_id": self.embedding_profile_id,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class RagLimits:
    max_query_chars: int = MAX_QUERY_CHARS
    max_query_utf8_bytes: int = MAX_QUERY_UTF8_BYTES
    max_records: int = MAX_RECORDS
    max_top_k: int = MAX_TOP_K
    max_context_tokens: int = MAX_CONTEXT_TOKENS
    max_reference_expansion: int = MAX_REFERENCE_EXPANSION
    max_per_source: int = MAX_PER_SOURCE
    durable_candidate_limit: int = DURABLE_CANDIDATE_LIMIT
    memory_candidate_limit: int = MEMORY_CANDIDATE_LIMIT

    def __post_init__(self) -> None:
        for name in (
            "max_query_chars",
            "max_query_utf8_bytes",
            "max_records",
            "max_top_k",
            "max_context_tokens",
            "max_reference_expansion",
            "max_per_source",
            "durable_candidate_limit",
            "memory_candidate_limit",
        ):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ContractError(f"{name} must be a positive integer")
        maximums = {
            "max_query_chars": MAX_QUERY_CHARS,
            "max_query_utf8_bytes": MAX_QUERY_UTF8_BYTES,
            "max_records": MAX_RECORDS,
            "max_top_k": MAX_TOP_K,
            "max_context_tokens": MAX_CONTEXT_TOKENS,
            "max_reference_expansion": MAX_REFERENCE_EXPANSION,
            "max_per_source": MAX_PER_SOURCE,
            "durable_candidate_limit": DURABLE_CANDIDATE_LIMIT,
            "memory_candidate_limit": MEMORY_CANDIDATE_LIMIT,
        }
        for name, maximum in maximums.items():
            if getattr(self, name) > maximum:
                raise ContractError(f"{name} must not exceed {maximum}")


@dataclass(frozen=True)
class RagProfile:
    """Fixed-point Edge-derived scoring profile shared by all v2 adapters."""

    name: str = PROFILE_ID
    version: int = 2
    exact_weight: int = 250_000
    semantic_weight: int = 250_000
    keyword_weight: int = 150_000
    scope_weight: int = 50_000
    provenance_weight: int = 50_000
    authority_weight: int = 50_000
    priority_weight: int = 50_000
    aspect_coverage_weight: int = 50_000
    reference_weight: int = 50_000
    semantic_min_score: int = 200_000
    authority_scores: Mapping[str, int] = field(
        default_factory=lambda: {
            "global_record": 1_000_000,
            "workspace_record": 1_000_000,
            "conversation_memory": 900_000,
            "persona_vault": 800_000,
            "unclassified": 250_000,
        }
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.version, int)
            or isinstance(self.version, bool)
            or self.version != 2
        ):
            raise ContractError("unsupported RAG profile version")
        object.__setattr__(self, "name", _string(self.name, "profile name"))
        weight_names = (
            "exact_weight",
            "semantic_weight",
            "keyword_weight",
            "scope_weight",
            "provenance_weight",
            "authority_weight",
            "priority_weight",
            "aspect_coverage_weight",
            "reference_weight",
        )
        weights = tuple(getattr(self, name) for name in weight_names)
        if any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0
            for value in weights
        ):
            raise ContractError("profile weights must be non-negative integers")
        if sum(weights) > MICRO_UNITS:
            raise ContractError("profile weights must not exceed 1000000")
        if (
            not isinstance(self.semantic_min_score, int)
            or isinstance(self.semantic_min_score, bool)
            or not 0 <= self.semantic_min_score <= MICRO_UNITS
        ):
            raise ContractError("semantic_min_score must be between 0 and 1000000")
        if not isinstance(self.authority_scores, Mapping):
            raise ContractError("authority_scores must be an object")
        scores: dict[str, int] = {}
        for raw_name, score in self.authority_scores.items():
            name = _string(raw_name, "authority score name")
            if name not in AUTHORITY_KINDS:
                raise ContractError(f"unsupported authority score kind: {name}")
            if (
                not isinstance(score, int)
                or isinstance(score, bool)
                or not 0 <= score <= MICRO_UNITS
            ):
                raise ContractError("authority scores must be fixed-point integers")
            scores[name] = score
        if set(scores) != AUTHORITY_KINDS:
            raise ContractError("authority_scores must define every authority kind")
        object.__setattr__(self, "authority_scores", MappingProxyType(scores))


@dataclass(frozen=True)
class RetrievalResult:
    record: RagRecord
    score_micro: int
    exact_micro: int = 0
    semantic_micro: int = 0
    keyword_micro: int = 0
    scope_micro: int = 0
    provenance_micro: int = 0
    authority_micro: int = 0
    priority_micro: int = 0
    aspect_coverage_micro: int = 0
    cross_reference_micro: int = 0
    scope_priority: int = 0
    cross_reference_from_id: str | None = None

    @property
    def score(self) -> float:
        return self.score_micro / MICRO_UNITS

    @property
    def match_type(self) -> str:
        if self.exact_micro:
            return "exact"
        if self.semantic_micro:
            return "semantic"
        if self.keyword_micro:
            return "keyword"
        if self.cross_reference_micro:
            return "cross_reference"
        return "none"

    @property
    def has_retrieval_signal(self) -> bool:
        return any(
            (
                self.exact_micro,
                self.semantic_micro,
                self.keyword_micro,
                self.cross_reference_micro,
            )
        )

    def component_mapping(self) -> dict[str, int]:
        return {
            "exact_micro": self.exact_micro,
            "semantic_micro": self.semantic_micro,
            "keyword_micro": self.keyword_micro,
            "scope_micro": self.scope_micro,
            "provenance_micro": self.provenance_micro,
            "authority_micro": self.authority_micro,
            "priority_micro": self.priority_micro,
            "aspect_coverage_micro": self.aspect_coverage_micro,
            "cross_reference_micro": self.cross_reference_micro,
        }

    def to_mapping(self) -> dict[str, object]:
        return {
            "record": self.record.to_mapping(),
            "score_micro": self.score_micro,
            "score": self.score,
            "match_type": self.match_type,
            "scope_priority": self.scope_priority,
            "cross_reference_from_id": self.cross_reference_from_id,
            "components": self.component_mapping(),
        }


@dataclass(frozen=True)
class RetrievalResponse:
    results: tuple[RetrievalResult, ...]
    mode: str
    eligible_ids: tuple[str, ...]
    candidate_ids: tuple[str, ...]
    context_tokens: int
    truncated: bool
    semantic_state: str
    semantic_fallback_reason: str | None = None
    errors: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.semantic_state not in SEMANTIC_STATES:
            raise ContractError(f"unsupported semantic state: {self.semantic_state}")
        if (
            self.semantic_fallback_reason is not None
            and self.semantic_fallback_reason not in SEMANTIC_FALLBACK_REASONS
        ):
            raise ContractError(
                f"unsupported semantic fallback reason: {self.semantic_fallback_reason}"
            )

    def to_mapping(self) -> dict[str, object]:
        selected_ids = [result.record.id for result in self.results]
        return {
            "contract": CONTRACT_ID,
            "mode": self.mode,
            "eligible_ids": list(self.eligible_ids),
            "candidate_ids": list(self.candidate_ids),
            "results": [result.to_mapping() for result in self.results],
            "context_selected_ids": selected_ids,
            "context_tokens": self.context_tokens,
            "truncated": self.truncated,
            "semantic_state": self.semantic_state,
            "semantic_fallback_reason": self.semantic_fallback_reason,
            "errors": list(self.errors),
        }
