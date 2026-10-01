from __future__ import annotations

import hashlib
import struct
import unicodedata
from collections.abc import Sequence


def canonical_text(value: str) -> str:
    """Normalize identity inputs without changing the stored source text."""

    if not isinstance(value, str):
        raise ValueError("identity text must be a string")
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


IDENTITY_VERSION = 2


def canonical_hash(parts: Sequence[str]) -> str:
    """Match the frozen length-prefixed SHA-256 identity encoding."""

    if isinstance(parts, (str, bytes)) or any(not isinstance(part, str) for part in parts):
        raise ValueError("identity parts must be an array of strings")
    digest = hashlib.sha256()
    for part in parts:
        encoded = part.encode("utf-8")
        digest.update(struct.pack("<Q", len(encoded)))
        digest.update(encoded)
    return digest.hexdigest()


def content_id(text: str) -> str:
    if not isinstance(text, str):
        raise ValueError("content text must be a string")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def source_id(source_kind: str, pocket: str, source_key: str) -> str:
    if any(
        not isinstance(value, str) or not value.strip()
        for value in (source_kind, pocket, source_key)
    ):
        raise ValueError("source identity fields must be non-empty strings")
    return canonical_hash(
        (
            "rag-source",
            str(IDENTITY_VERSION),
            (source_kind or "").strip().lower(),
            canonical_text(pocket),
            (source_key or "").strip().replace("\\", "/").lower(),
        )
    )


def source_chunk_id(
    owner_source_id: str,
    chunk_index: int,
    text_start: int | None,
    text_end: int | None,
    chunk_content_id: str,
) -> str:
    if not isinstance(owner_source_id, str) or not owner_source_id.strip():
        raise ValueError("owner_source_id must be a non-empty string")
    if not isinstance(chunk_index, int) or isinstance(chunk_index, bool) or chunk_index < 0:
        raise ValueError("chunk_index must be a non-negative integer")
    for name, value in (("text_start", text_start), ("text_end", text_end)):
        if value is not None and (
            not isinstance(value, int) or isinstance(value, bool) or value < 0
        ):
            raise ValueError(f"{name} must be a non-negative integer or null")
    if text_start is not None and text_end is not None and text_end < text_start:
        raise ValueError("text_end must not precede text_start")
    if (
        not isinstance(chunk_content_id, str)
        or len(chunk_content_id) != 64
        or any(character not in "0123456789abcdef" for character in chunk_content_id)
    ):
        raise ValueError("chunk_content_id must be a lowercase SHA-256 digest")
    return canonical_hash(
        (
            "rag-source-chunk",
            str(IDENTITY_VERSION),
            owner_source_id,
            str(chunk_index),
            "" if text_start is None else str(text_start),
            "" if text_end is None else str(text_end),
            chunk_content_id,
        )
    )


def embedding_id(chunk_id: str, profile_id: str) -> str:
    if any(
        not isinstance(value, str) or not value.strip()
        for value in (chunk_id, profile_id)
    ):
        raise ValueError("embedding identity fields must be non-empty strings")
    return canonical_hash(
        ("rag-embedding", str(IDENTITY_VERSION), chunk_id, profile_id)
    )
