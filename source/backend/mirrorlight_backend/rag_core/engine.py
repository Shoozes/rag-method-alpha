from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import replace

from .references import reference_signals
from .scopes import allowed_by_authority, allowed_by_scope, matching_scope_priority
from .scoring import (
    authority_score,
    canonical_query_text,
    exact_score_normalized,
    keyword_score_terms,
    priority_score,
    provenance_score,
    scope_score,
    semantic_score,
    tokens,
    total_score,
    validate_query_vector,
)
from .selection import candidate_pool, deterministic_order, select_results
from .types import (
    ContractError,
    RagLimits,
    RagProfile,
    RagRecord,
    RetrievalResponse,
    RetrievalResult,
    SEMANTIC_FALLBACK_REASONS,
    validate_query,
)


MODES = frozenset(
    {"exact_only", "semantic_only", "keyword_only", "hybrid", "scoped_hybrid"}
)
AUTHORITY_POLICIES = frozenset({"all", "recorded_only"})


def _scope_values(values: Iterable[str], field_name: str) -> tuple[str, ...]:
    if isinstance(values, (str, bytes)):
        raise ContractError(f"{field_name} must be an array of strings")
    try:
        raw_values = tuple(values)
    except TypeError as exc:
        raise ContractError(f"{field_name} must be an array of strings") from exc
    normalized: list[str] = []
    for value in raw_values:
        if not isinstance(value, str) or not value.strip():
            raise ContractError(f"{field_name} must contain non-empty strings")
        scope = value.strip()
        if scope not in normalized:
            normalized.append(scope)
    return tuple(normalized)


def _scope_priorities(values: Mapping[str, int] | None) -> dict[str, int]:
    if values is None:
        return {}
    if not isinstance(values, Mapping):
        raise ContractError("scope_priorities must be an object")
    result: dict[str, int] = {}
    for raw_scope, priority in values.items():
        if not isinstance(raw_scope, str) or not raw_scope.strip():
            raise ContractError("scope_priorities keys must be non-empty strings")
        if (
            not isinstance(priority, int)
            or isinstance(priority, bool)
            or not -100 <= priority <= 100
        ):
            raise ContractError(
                "scope_priorities values must be integers between -100 and 100"
            )
        normalized_scope = raw_scope.strip()
        if normalized_scope in result:
            raise ContractError("scope_priorities contains duplicate normalized scopes")
        result[normalized_scope] = priority
    return result


def _checkpoint(callback: Callable[[str], None] | None, phase: str) -> None:
    if callback is not None:
        callback(phase)


class RagEngine:
    """Pure deterministic rag-behavior-v2 reference retrieval engine."""

    def __init__(
        self,
        records: Iterable[RagRecord | Mapping[str, object]],
        profile: RagProfile | None = None,
        limits: RagLimits | None = None,
    ) -> None:
        if profile is not None and not isinstance(profile, RagProfile):
            raise ContractError("profile must be a RagProfile")
        if limits is not None and not isinstance(limits, RagLimits):
            raise ContractError("limits must be RagLimits")
        self.profile = profile or RagProfile()
        self.limits = limits or RagLimits()
        normalized = [
            record if isinstance(record, RagRecord) else RagRecord.from_mapping(record)
            for record in records
        ]
        if len(normalized) > self.limits.max_records:
            raise ContractError("record limit exceeded")
        ids = [record.id for record in normalized]
        if len(set(ids)) != len(ids):
            raise ContractError("record IDs must be unique")
        self.records = tuple(
            sorted(normalized, key=lambda record: (record.source_id, record.id))
        )
        self._records_by_id = {record.id: record for record in self.records}

    def search(
        self,
        query: str,
        *,
        mode: str = "hybrid",
        top_k: int = 5,
        include_scopes: Iterable[str] = (),
        exclude_scopes: Iterable[str] = (),
        scope_priorities: Mapping[str, int] | None = None,
        authority_policy: str = "all",
        vectors: Mapping[str, Iterable[float]] | None = None,
        query_vector: Iterable[float] | None = None,
        query_embedding_profile_id: str | None = None,
        semantic_enabled: bool = True,
        semantic_fallback_reason: str | None = None,
        expand: bool = True,
        max_context_tokens: int | None = None,
        checkpoint: Callable[[str], None] | None = None,
    ) -> RetrievalResponse:
        query = validate_query(
            query,
            max_chars=self.limits.max_query_chars,
            max_utf8_bytes=self.limits.max_query_utf8_bytes,
        )
        normalized_mode = str(mode).strip().lower()
        if normalized_mode not in MODES:
            raise ContractError(f"unsupported retrieval mode: {normalized_mode}")
        if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1:
            raise ContractError("top_k must be a positive integer")
        requested_top_k = min(top_k, self.limits.max_top_k)
        include_scope_values = _scope_values(include_scopes, "include_scopes")
        exclude_scope_values = _scope_values(exclude_scopes, "exclude_scopes")
        priorities = _scope_priorities(scope_priorities)
        authority_policy = str(authority_policy).strip().lower()
        if authority_policy not in AUTHORITY_POLICIES:
            raise ContractError(f"unsupported authority policy: {authority_policy}")
        if not isinstance(semantic_enabled, bool):
            raise ContractError("semantic_enabled must be a boolean")
        if (
            semantic_fallback_reason is not None
            and semantic_fallback_reason not in SEMANTIC_FALLBACK_REASONS
        ):
            raise ContractError("semantic_fallback_reason is invalid")
        if query_embedding_profile_id is not None and (
            not isinstance(query_embedding_profile_id, str)
            or not query_embedding_profile_id.strip()
            or query_embedding_profile_id != query_embedding_profile_id.strip()
        ):
            raise ContractError(
                "query_embedding_profile_id must be a non-empty string or null"
            )
        if not isinstance(expand, bool):
            raise ContractError("expand must be a boolean")
        if checkpoint is not None and not callable(checkpoint):
            raise ContractError("checkpoint must be callable or null")
        if vectors is not None and not isinstance(vectors, Mapping):
            raise ContractError("vectors must be an object keyed by record ID")
        if max_context_tokens is None:
            context_limit = self.limits.max_context_tokens
        elif (
            not isinstance(max_context_tokens, int)
            or isinstance(max_context_tokens, bool)
            or max_context_tokens < 1
        ):
            raise ContractError("max_context_tokens must be a positive integer")
        else:
            context_limit = min(max_context_tokens, self.limits.max_context_tokens)

        normalized_query = canonical_query_text(query)
        if not normalized_query:
            return RetrievalResponse(
                results=(),
                mode=normalized_mode,
                eligible_ids=(),
                candidate_ids=(),
                context_tokens=0,
                truncated=False,
                semantic_state="not_requested",
            )

        _checkpoint(checkpoint, "filter.start")
        eligible: list[RagRecord] = []
        for index, record in enumerate(self.records):
            if index % 64 == 0:
                _checkpoint(checkpoint, "filter.scan")
            if allowed_by_scope(
                record,
                include_scope_values,
                exclude_scope_values,
            ) and allowed_by_authority(record, authority_policy):
                eligible.append(record)
        eligible_ids = tuple(sorted(record.id for record in eligible))

        exact_enabled = normalized_mode in {"exact_only", "hybrid", "scoped_hybrid"}
        keyword_enabled = normalized_mode in {"keyword_only", "hybrid", "scoped_hybrid"}
        semantic_requested = normalized_mode in {
            "semantic_only",
            "hybrid",
            "scoped_hybrid",
        }
        errors: list[str] = []
        valid_query_vector: tuple[float, ...] | None = None
        if not semantic_requested:
            semantic_state = "not_requested"
            fallback_reason = None
        elif not semantic_enabled:
            semantic_state = "disabled_by_settings"
            fallback_reason = semantic_fallback_reason or "disabled_by_settings"
        elif query_vector is None or not query_embedding_profile_id:
            semantic_state = "lexical_fallback"
            fallback_reason = semantic_fallback_reason or "no_compatible_vectors"
        else:
            try:
                valid_query_vector = validate_query_vector(query_vector)
            except ValueError as exc:
                semantic_state = "lexical_fallback"
                fallback_reason = "embedding_failed"
                errors.append(str(exc))
            else:
                compatible = any(
                    record.embedding_profile_id == query_embedding_profile_id
                    and vectors is not None
                    and semantic_score(valid_query_vector, vectors.get(record.id))
                    is not None
                    for record in eligible
                )
                if compatible:
                    semantic_state = "ready"
                    fallback_reason = None
                else:
                    semantic_state = "lexical_fallback"
                    fallback_reason = "no_compatible_vectors"
                    valid_query_vector = None

        if normalized_mode == "semantic_only" and semantic_state != "ready":
            errors.append(f"semantic retrieval unavailable: {fallback_reason}")

        candidates: list[RetrievalResult] = []
        query_terms = set(tokens(normalized_query))
        record_terms: dict[str, set[str]] = {}
        _checkpoint(checkpoint, "rank.start")
        for index, record in enumerate(eligible):
            if index % 64 == 0:
                _checkpoint(checkpoint, "rank.scan")
            normalized_record = canonical_query_text(record.text)
            terms = set(tokens(normalized_record)) if keyword_enabled else set()
            if terms:
                record_terms[record.id] = terms
            exact = (
                exact_score_normalized(normalized_query, normalized_record)
                if exact_enabled
                else 0
            )
            keyword = (
                keyword_score_terms(query_terms, terms) if keyword_enabled else 0
            )
            semantic = 0
            if (
                semantic_requested
                and semantic_state == "ready"
                and valid_query_vector is not None
                and record.embedding_profile_id == query_embedding_profile_id
                and vectors is not None
            ):
                score = semantic_score(valid_query_vector, vectors.get(record.id))
                if score is not None and score >= self.profile.semantic_min_score:
                    semantic = score
            scope_priority = matching_scope_priority(record, priorities)
            result = RetrievalResult(
                record=record,
                score_micro=0,
                exact_micro=exact,
                semantic_micro=semantic,
                keyword_micro=keyword,
                scope_micro=scope_score(record, include_scope_values),
                provenance_micro=provenance_score(record),
                authority_micro=authority_score(record, self.profile),
                priority_micro=priority_score(record.priority + scope_priority),
                scope_priority=scope_priority,
            )
            candidates.append(replace(result, score_micro=total_score(result, self.profile)))

        if expand and candidates:
            _checkpoint(checkpoint, "cross_reference.before")
            signals = reference_signals(
                deterministic_order(candidates),
                self._records_by_id,
                self.limits.max_reference_expansion,
                set(eligible_ids),
            )
            for index, result in enumerate(candidates):
                anchor_id = signals.get(result.record.id)
                if anchor_id is None:
                    continue
                updated = replace(
                    result,
                    cross_reference_micro=1_000_000,
                    cross_reference_from_id=anchor_id,
                )
                candidates[index] = replace(
                    updated,
                    score_micro=total_score(updated, self.profile),
                )
            _checkpoint(checkpoint, "cross_reference.after")

        signaled = [candidate for candidate in candidates if candidate.has_retrieval_signal]
        pooled, pool_truncated = candidate_pool(signaled, self.limits)
        candidate_ids = tuple(candidate.record.id for candidate in pooled)
        _checkpoint(checkpoint, "selection.start")
        selected, selection_truncated, context_tokens = select_results(
            pooled,
            query_terms,
            record_terms,
            requested_top_k,
            context_limit,
            self.limits,
            self.profile,
        )
        _checkpoint(checkpoint, "return")
        return RetrievalResponse(
            results=selected,
            mode=normalized_mode,
            eligible_ids=eligible_ids,
            candidate_ids=candidate_ids,
            context_tokens=context_tokens,
            truncated=pool_truncated or selection_truncated,
            semantic_state=semantic_state,
            semantic_fallback_reason=fallback_reason,
            errors=tuple(dict.fromkeys(errors)),
        )
