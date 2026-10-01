from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import replace

from .scoring import aspect_coverage_score, tokens, total_score
from .types import MICRO_UNITS, RagLimits, RagProfile, RetrievalResult


def deterministic_order(results: Iterable[RetrievalResult]) -> list[RetrievalResult]:
    return sorted(
        results,
        key=lambda result: (
            -result.score_micro,
            -result.scope_priority,
            result.record.source_name,
            result.record.text,
            result.record.source_id,
            result.record.id,
        ),
    )


def candidate_pool(
    results: Iterable[RetrievalResult],
    limits: RagLimits,
) -> tuple[list[RetrievalResult], bool]:
    values = list(results)
    durable = deterministic_order(result for result in values if not result.record.is_memory)
    memory = deterministic_order(result for result in values if result.record.is_memory)
    retained = (
        durable[: limits.durable_candidate_limit]
        + memory[: limits.memory_candidate_limit]
    )
    return deterministic_order(retained), len(retained) < len(values)


def estimated_context_tokens(result: RetrievalResult) -> int:
    record = result.record
    metadata_chars = (
        len(record.source_name)
        + len(record.pocket)
        + sum(len(scope) for scope in record.scopes)
        + 96
    )
    return (len(record.text) + metadata_chars + 3) // 4


def select_results(
    results: Iterable[RetrievalResult],
    query_terms: set[str],
    known_record_terms: Mapping[str, set[str]],
    top_k: int,
    max_context_tokens: int,
    limits: RagLimits,
    profile: RagProfile,
) -> tuple[tuple[RetrievalResult, ...], bool, int]:
    candidates = list(results)
    record_terms = {
        candidate.record.id: known_record_terms.get(candidate.record.id)
        or set(tokens(candidate.record.text))
        for candidate in candidates
    }
    covered_terms: set[str] = set()
    source_counts: defaultdict[str, int] = defaultdict(int)
    selected: list[RetrievalResult] = []
    used_tokens = 0

    while len(selected) < top_k and candidates:
        has_new_source = any(
            source_counts[candidate.record.source_id] == 0
            and used_tokens + estimated_context_tokens(candidate) <= max_context_tokens
            for candidate in candidates
        )
        best: tuple[tuple[int, int, str, str], int, int] | None = None
        for index, candidate in enumerate(candidates):
            source_count = source_counts[candidate.record.source_id]
            if source_count >= limits.max_per_source or (has_new_source and source_count > 0):
                continue
            estimated_tokens = estimated_context_tokens(candidate)
            if used_tokens + estimated_tokens > max_context_tokens:
                continue
            aspect = aspect_coverage_score(
                query_terms,
                record_terms[candidate.record.id],
                covered_terms,
            )
            rank_score = min(
                MICRO_UNITS,
                candidate.score_micro
                + (aspect * profile.aspect_coverage_weight) // MICRO_UNITS,
            )
            # Negated numeric fields make the lexicographically smallest key the winner.
            key = (
                -rank_score,
                -candidate.score_micro,
                candidate.record.source_id,
                candidate.record.id,
            )
            if best is None or key < best[0]:
                best = (key, index, aspect)
        if best is None:
            break
        _, index, aspect = best
        candidate = candidates.pop(index)
        candidate = replace(candidate, aspect_coverage_micro=aspect)
        candidate = replace(candidate, score_micro=total_score(candidate, profile))
        used_tokens += estimated_context_tokens(candidate)
        covered_terms.update(record_terms[candidate.record.id] & query_terms)
        source_counts[candidate.record.source_id] += 1
        selected.append(candidate)

    return tuple(selected), bool(candidates), used_tokens
