from __future__ import annotations

from collections.abc import Mapping, Sequence

from .types import RagRecord, RetrievalResult


def reference_signals(
    ordered_candidates: Sequence[RetrievalResult],
    records: Mapping[str, RagRecord],
    max_expansions: int,
    allowed_ids: set[str],
) -> dict[str, str]:
    """Return bounded, one-hop, candidate-only target-to-anchor signals."""

    targets: dict[str, str] = {}
    anchors = [candidate for candidate in ordered_candidates if candidate.has_retrieval_signal]
    for anchor in anchors:
        for target_id in anchor.record.references:
            if len(targets) >= max_expansions:
                return targets
            target = records.get(target_id)
            if (
                target is None
                or target_id not in allowed_ids
                or target.source_id == anchor.record.source_id
                or target_id in targets
            ):
                continue
            targets[target_id] = anchor.record.id
    return targets
