from __future__ import annotations

import math
import unicodedata
from collections.abc import Iterable, Sequence

from .types import MICRO_UNITS, RagProfile, RagRecord, RetrievalResult


def canonical_query_text(value: str) -> str:
    """Apply the v2 NFKC, Unicode-lowercase, collapsed-space policy."""

    return " ".join(unicodedata.normalize("NFKC", value or "").lower().split())


def tokens(value: str) -> tuple[str, ...]:
    """Return sorted unique Unicode alphanumeric terms."""

    normalized = unicodedata.normalize("NFKC", value or "").lower()
    terms: set[str] = set()
    current: list[str] = []
    for character in normalized:
        if character.isalnum():
            current.append(character)
        elif current:
            terms.add("".join(current))
            current = []
    if current:
        terms.add("".join(current))
    return tuple(sorted(terms))


def exact_score_normalized(normalized_query: str, normalized_record: str) -> int:
    if not normalized_query:
        return 0
    return MICRO_UNITS if normalized_query in normalized_record else 0


def keyword_score_terms(query_terms: set[str], record_terms: set[str]) -> int:
    if not query_terms:
        return 0
    overlap = len(query_terms & record_terms)
    return (overlap * MICRO_UNITS) // len(query_terms)


def validate_query_vector(query_vector: Iterable[float]) -> tuple[float, ...]:
    if isinstance(query_vector, (str, bytes)):
        raise ValueError("query vector must be an array of numbers")
    try:
        values = tuple(float(value) for value in query_vector)
    except (TypeError, ValueError) as exc:
        raise ValueError("query vector contains a non-numeric value") from exc
    if not values or any(not math.isfinite(value) for value in values):
        raise ValueError("query vector must be finite and non-empty")
    norm = math.sqrt(math.fsum(value * value for value in values))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise ValueError("query vector must have a non-zero finite norm")
    return values


def semantic_score(
    query_vector: Sequence[float],
    record_vector: Iterable[float] | None,
) -> int | None:
    if record_vector is None or isinstance(record_vector, (str, bytes)):
        return None
    try:
        record_values = tuple(float(value) for value in record_vector)
    except (TypeError, ValueError):
        return None
    if (
        not record_values
        or len(query_vector) != len(record_values)
        or any(not math.isfinite(value) for value in record_values)
    ):
        return None
    query_norm = math.sqrt(math.fsum(value * value for value in query_vector))
    record_norm = math.sqrt(math.fsum(value * value for value in record_values))
    if query_norm <= 1e-12 or record_norm <= 1e-12:
        return None
    cosine = math.fsum(
        left * right for left, right in zip(query_vector, record_values)
    ) / (query_norm * record_norm)
    bounded = max(0.0, min(1.0, cosine))
    return min(MICRO_UNITS, math.floor(bounded * MICRO_UNITS + 0.5))


def scope_score(record: RagRecord, include_scopes: Sequence[str]) -> int:
    if not include_scopes or "all" in include_scopes:
        return 0
    return (
        MICRO_UNITS
        if set(record.scopes).intersection(include_scopes)
        else 0
    )


def provenance_score(record: RagRecord) -> int:
    count = int(record.provenance_file) + int(record.provenance_chunk)
    return (count * MICRO_UNITS) // 2


def authority_score(record: RagRecord, profile: RagProfile) -> int:
    return profile.authority_scores[record.authority]


def priority_score(priority: int) -> int:
    return max(-MICRO_UNITS, min(MICRO_UNITS, priority * 10_000))


def aspect_coverage_score(
    query_terms: set[str],
    record_terms: set[str],
    covered_terms: set[str],
) -> int:
    if not query_terms:
        return 0
    new_terms = (record_terms & query_terms) - covered_terms
    return (len(new_terms) * MICRO_UNITS) // len(query_terms)


def total_score(result: RetrievalResult, profile: RagProfile) -> int:
    components = (
        (result.exact_micro, profile.exact_weight),
        (result.semantic_micro, profile.semantic_weight),
        (result.keyword_micro, profile.keyword_weight),
        (result.scope_micro, profile.scope_weight),
        (result.provenance_micro, profile.provenance_weight),
        (result.authority_micro, profile.authority_weight),
        (result.priority_micro, profile.priority_weight),
        (result.aspect_coverage_micro, profile.aspect_coverage_weight),
        (result.cross_reference_micro, profile.reference_weight),
    )
    numerator = sum(component * weight for component, weight in components)
    if numerator >= 0:
        score = numerator // MICRO_UNITS
    else:
        score = -((-numerator) // MICRO_UNITS)
    return max(0, min(MICRO_UNITS, score))
