from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from .engine import RagEngine
from .types import RagLimits, RagRecord, RetrievalResponse, RetrievalResult


_WIKI_LINK_RE = re.compile(r"\[\[([^\]]+?)\]\]")


@dataclass(frozen=True)
class ApplicationRagIndex:
    engine: RagEngine
    vectors: Mapping[str, Iterable[float]]
    embedding_profile_id: str | None


class _AlignedVectors(Mapping[str, Iterable[float]]):
    """Expose index-aligned rows by record ID without copying a vector matrix."""

    def __init__(self, record_ids: Sequence[str], rows: object) -> None:
        self._positions = {record_id: index for index, record_id in enumerate(record_ids)}
        self._rows = rows

    def __getitem__(self, record_id: str) -> Iterable[float]:
        return self._rows[self._positions[record_id]]  # type: ignore[index, no-any-return]

    def __iter__(self) -> Iterator[str]:
        return iter(self._positions)

    def __len__(self) -> int:
        return len(self._positions)


def _vectors_are_aligned(rows: object, expected_count: int) -> bool:
    if rows is None or isinstance(rows, (str, bytes, bytearray, Mapping)):
        return False
    try:
        return len(rows) == expected_count and hasattr(rows, "__getitem__")  # type: ignore[arg-type]
    except TypeError:
        return False


def _priority_for_chunk(chunk: Mapping[str, object]) -> int:
    value = chunk.get("priority", 0)
    return (
        value
        if isinstance(value, int)
        and not isinstance(value, bool)
        and -100 <= value <= 100
        else 0
    )


def _authority_for_chunk(chunk: dict[str, object]) -> str:
    authority = str(chunk.get("authority") or "").strip().lower().replace("-", "_")
    if authority in {
        "global_record",
        "workspace_record",
        "persona_vault",
        "conversation_memory",
        "unclassified",
    }:
        return authority
    pocket = str(chunk.get("pocket") or "default")
    scope = str(chunk.get("scope") or "global")
    if pocket == "memories" or scope.startswith("thread:"):
        return "conversation_memory"
    if pocket == "global" or scope == "global":
        return "global_record"
    if scope.startswith("persona:"):
        return "persona_vault"
    if scope.startswith(("workspace:", "project:", "pocket:")):
        return "workspace_record"
    return "unclassified"


def _reference_key(value: str) -> str:
    target = value.split("|", 1)[0].split("#", 1)[0]
    normalized = unicodedata.normalize("NFKC", target).lower()
    terms: list[str] = []
    current: list[str] = []
    for character in normalized:
        if character.isalnum():
            current.append(character)
        elif current:
            terms.append("".join(current))
            current = []
    if current:
        terms.append("".join(current))
    return " ".join(terms)


def _source_reference_key(record: RagRecord) -> str:
    source_name = Path(record.source_name).stem or record.source_name
    return _reference_key(source_name)


def _record_references(
    record: RagRecord,
    records_by_reference: dict[str, list[RagRecord]],
) -> tuple[str, ...]:
    references = list(record.references)
    for match in _WIKI_LINK_RE.finditer(record.text):
        key = _reference_key(match.group(1))
        for target in records_by_reference.get(key, ()):
            if target.source_id != record.source_id and target.id not in references:
                references.append(target.id)
                break
    return tuple(references)


def build_application_index(
    index: dict[str, object],
    *,
    max_query_chars: int,
    max_records: int,
    max_top_k: int,
) -> ApplicationRagIndex:
    chunks = [
        chunk
        for document in index.get("docs", [])
        if isinstance(document, dict)
        for chunk in document.get("chunks", [])
        if isinstance(chunk, dict)
    ]
    embedding = index.get("embedding")
    embedding = embedding if isinstance(embedding, dict) else {}
    profile_id = (
        str(embedding.get("profile") or "").strip()
        if embedding.get("status") == "ready"
        else ""
    )
    raw_vectors = index.get("embeddings")
    vectors_available = (
        bool(profile_id)
        and _vectors_are_aligned(raw_vectors, len(chunks))
    )
    records: list[RagRecord] = []
    for position, chunk in enumerate(chunks):
        scopes = chunk.get("scopes")
        if not isinstance(scopes, list) or not scopes:
            scopes = [str(chunk.get("scope") or "global")]
        chunk_id = str(chunk.get("id") or "").strip()
        source_id = str(chunk.get("source_id") or chunk.get("source") or "").strip()
        path = str(chunk.get("path") or "")
        record = RagRecord(
            id=chunk_id,
            text=str(chunk.get("text") or ""),
            source_id=source_id or f"source::{path or chunk_id}",
            source_name=path or source_id or chunk_id,
            path=path,
            pocket=str(chunk.get("pocket") or "default"),
            scopes=tuple(str(scope) for scope in scopes),
            authority=_authority_for_chunk(chunk),
            priority=_priority_for_chunk(chunk),
            provenance_file=bool(source_id or path),
            provenance_chunk=bool(chunk_id),
            references=tuple(
                str(reference)
                for reference in chunk.get("references", ())
            )
            if isinstance(chunk.get("references"), (list, tuple))
            else (),
            embedding_profile_id=profile_id if vectors_available else None,
            metadata={"app_chunk": dict(chunk)},
        )
        records.append(record)

    records_by_reference: dict[str, list[RagRecord]] = {}
    for record in sorted(records, key=lambda item: (item.source_id, item.id)):
        records_by_reference.setdefault(_source_reference_key(record), []).append(record)
    records = [
        replace(
            record,
            references=_record_references(record, records_by_reference),
        )
        for record in records
    ]
    limits = RagLimits(
        max_query_chars=max_query_chars,
        max_records=max_records,
        max_top_k=max_top_k,
    )
    return ApplicationRagIndex(
        engine=RagEngine(records, limits=limits),
        vectors=_AlignedVectors([record.id for record in records], raw_vectors)
        if vectors_available
        else {},
        embedding_profile_id=profile_id if vectors_available else None,
    )


def application_result(
    result: RetrievalResult,
    rank_index: int,
    response: RetrievalResponse,
    *,
    debug: bool,
    fallback_error: str | None,
) -> dict[str, object]:
    raw = result.record.metadata.get("app_chunk", {})
    item = dict(raw) if isinstance(raw, dict) else {}
    item.update(
        {
            "id": result.record.id,
            "score": result.score,
            "score_micro": result.score_micro,
            "match_type": result.match_type,
            "cross_reference_from_id": result.cross_reference_from_id,
            "scope": result.record.scope,
            "authority": result.record.authority,
            "source_id": result.record.source_id,
            "provenance": {
                "scope": result.record.scope,
                "authority": result.record.authority,
                "source_id": result.record.source_id,
            },
        }
    )
    if debug:
        item["_debug"] = {
            "rank_index": rank_index,
            "mode": response.mode,
            "fallback_error": fallback_error,
            "score_micro": result.score_micro,
            "semantic_state": response.semantic_state,
            "semantic_fallback_reason": response.semantic_fallback_reason,
            **result.component_mapping(),
        }
    return item


def result_scopes(records: Iterable[RagRecord]) -> tuple[str, ...]:
    return tuple(sorted({scope for record in records for scope in record.scopes}))
