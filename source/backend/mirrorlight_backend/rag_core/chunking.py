from __future__ import annotations

import re

from .identity import content_id, source_chunk_id
from .types import ContractError, RagRecord


def chunk_text(
    text: str,
    *,
    source_id: str,
    path: str,
    scope: str = "global",
    authority: str = "unclassified",
    max_chars: int = 32_000,
    max_tokens: int = 8_000,
) -> tuple[RagRecord, ...]:
    """Split text with deterministic character and token ceilings."""

    if not isinstance(text, str):
        raise ContractError("text must be a string")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ContractError("source_id must not be empty")
    if (
        not isinstance(max_chars, int)
        or isinstance(max_chars, bool)
        or not isinstance(max_tokens, int)
        or isinstance(max_tokens, bool)
        or max_chars < 1
        or max_tokens < 1
    ):
        raise ContractError("chunk limits must be positive")
    pieces: list[tuple[str, int, int]] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        candidate = text[start:end]
        matches = list(re.finditer(r"\S+", candidate))
        if len(matches) > max_tokens:
            end = start + matches[max_tokens - 1].end()
        if end < len(text):
            boundary = max(text.rfind("\n", start, end), text.rfind(" ", start, end))
            if boundary > start:
                end = boundary
        raw_piece = text[start:end]
        left_trim = len(raw_piece) - len(raw_piece.lstrip())
        right_trim = len(raw_piece.rstrip())
        piece = raw_piece[left_trim:right_trim]
        if piece:
            pieces.append((piece, start + left_trim, start + right_trim))
        start = end
        while start < len(text) and text[start].isspace():
            start += 1
    return tuple(
        RagRecord(
            id=source_chunk_id(
                source_id,
                index,
                text_start,
                text_end,
                content_id(piece),
            ),
            text=piece,
            source_id=source_id,
            path=path,
            scope=scope,
            authority=authority,
        )
        for index, (piece, text_start, text_end) in enumerate(pieces)
    )
