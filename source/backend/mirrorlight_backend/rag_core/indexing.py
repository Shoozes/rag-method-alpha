from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Sequence

from .identity import content_id, source_chunk_id, source_id
from .types import AUTHORITY_KINDS, RagRecord


INDEXING_CONTRACT_ID = "rag-indexing-v1"
INDEXING_PROFILE_ID = "rag-indexing-v1-portable"
MAX_SOURCE_UTF8_BYTES = 10 * 1024 * 1024
MAX_CHUNK_CHARS = 2_400
MAX_CHUNK_TOKENS = 600
MAX_PATH_CHARS = 1_024
MAX_SCOPES = 64

# Explicit Unicode White_Space 15.1 code points. Keeping this table in the
# contract avoids runtime-specific regex, trim, and token-boundary behavior.
_WHITESPACE = frozenset(
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+)$")
_WIKI_LINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")
_DRIVE_PATH_RE = re.compile(r"^[A-Za-z]:")


class IndexingContractError(ValueError):
    """A stable, machine-classifiable indexing input failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _validate_scalars(value: str, field_name: str) -> None:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise IndexingContractError(
            "invalid_unicode",
            f"{field_name} must contain valid Unicode scalar values",
        ) from exc


def _trim_bounds(value: str, start: int = 0, end: int | None = None) -> tuple[int, int]:
    end = len(value) if end is None else end
    while start < end and value[start] in _WHITESPACE:
        start += 1
    while end > start and value[end - 1] in _WHITESPACE:
        end -= 1
    return start, end


def _trim(value: str) -> str:
    start, end = _trim_bounds(value)
    return value[start:end]


def normalize_source_path(value: str) -> str:
    """Return one portable relative source path or fail closed."""

    if not isinstance(value, str):
        raise IndexingContractError("invalid_path", "path must be a string")
    _validate_scalars(value, "path")
    value = _trim(value).replace("\\", "/")
    if (
        not value
        or len(value) > MAX_PATH_CHARS
        or value.startswith("/")
        or _DRIVE_PATH_RE.match(value)
        or "\x00" in value
    ):
        raise IndexingContractError(
            "invalid_path",
            "path must be a bounded relative text path",
        )
    parts: list[str] = []
    for part in value.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            raise IndexingContractError(
                "invalid_path",
                "path must not contain parent traversal",
            )
        parts.append(part)
    if not parts:
        raise IndexingContractError("invalid_path", "path must name a source file")
    return "/".join(parts)


def _bounded_text(value: object, field_name: str, maximum: int = 256) -> str:
    if not isinstance(value, str):
        raise IndexingContractError(
            f"invalid_{field_name}",
            f"{field_name} must be a string",
        )
    _validate_scalars(value, field_name)
    result = _trim(value)
    if not result or len(result) > maximum or "\x00" in result:
        raise IndexingContractError(
            f"invalid_{field_name}",
            f"{field_name} must be a bounded non-empty string",
        )
    return result


def _validated_scopes(value: object) -> tuple[str, ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise IndexingContractError("invalid_scopes", "scopes must be an array")
    scopes: list[str] = []
    for raw_scope in value:
        try:
            scope = _bounded_text(raw_scope, "scope")
        except IndexingContractError as exc:
            raise IndexingContractError("invalid_scopes", str(exc)) from exc
        if scope in scopes:
            raise IndexingContractError("invalid_scopes", "scopes must be unique")
        scopes.append(scope)
    if not scopes or len(scopes) > MAX_SCOPES:
        raise IndexingContractError(
            "invalid_scopes",
            f"scopes must contain between 1 and {MAX_SCOPES} values",
        )
    return tuple(scopes)


@dataclass(frozen=True)
class IndexingLimits:
    max_chars: int = MAX_CHUNK_CHARS
    max_tokens: int = MAX_CHUNK_TOKENS

    def __post_init__(self) -> None:
        for name, maximum in (
            ("max_chars", MAX_CHUNK_CHARS),
            ("max_tokens", MAX_CHUNK_TOKENS),
        ):
            value = getattr(self, name)
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or not 1 <= value <= maximum
            ):
                raise IndexingContractError(
                    "invalid_limits",
                    f"{name} must be an integer between 1 and {maximum}",
                )


@dataclass(frozen=True)
class _Section:
    index: int
    start: int
    end: int
    heading: str
    heading_level: int


@dataclass(frozen=True)
class IndexedDocument:
    format: str
    path: str
    pocket: str
    scopes: tuple[str, ...]
    authority: str
    priority: int
    source_id: str
    source_content_id: str
    source_utf8_bytes: int
    canonical_content_id: str
    canonical_text: str
    bom_removed: bool
    line_endings_changed: bool
    frontmatter_removed: bool
    limits: IndexingLimits
    records: tuple[RagRecord, ...]

    def to_observation(self) -> dict[str, object]:
        return {
            "format": self.format,
            "path": self.path,
            "pocket": self.pocket,
            "scopes": list(self.scopes),
            "authority": self.authority,
            "priority": self.priority,
            "source_id": self.source_id,
            "source_content_id": self.source_content_id,
            "source_utf8_bytes": self.source_utf8_bytes,
            "canonical_content_id": self.canonical_content_id,
            "canonical_scalar_count": len(self.canonical_text),
            "normalization": {
                "bom_removed": self.bom_removed,
                "line_endings_changed": self.line_endings_changed,
                "frontmatter_removed": self.frontmatter_removed,
            },
            "limits": {
                "max_chars": self.limits.max_chars,
                "max_tokens": self.limits.max_tokens,
            },
            "records": [record.to_mapping() for record in self.records],
        }


def _strip_frontmatter(value: str) -> tuple[str, bool]:
    if not value.startswith("---\n"):
        return value, False
    cursor = 4
    while cursor <= len(value):
        line_end = value.find("\n", cursor)
        if line_end < 0:
            line = value[cursor:]
            next_cursor = len(value)
        else:
            line = value[cursor:line_end]
            next_cursor = line_end + 1
        if line == "---":
            return value[next_cursor:], True
        if line_end < 0:
            break
        cursor = next_cursor
    return value, False


def canonicalize_document(value: str, format: str) -> tuple[str, bool, bool, bool]:
    if not isinstance(value, str):
        raise IndexingContractError("invalid_text", "content must be a string")
    _validate_scalars(value, "content")
    if "\x00" in value:
        raise IndexingContractError("invalid_text", "content must not contain NUL")
    if len(value.encode("utf-8")) > MAX_SOURCE_UTF8_BYTES:
        raise IndexingContractError(
            "source_too_large",
            f"content exceeds {MAX_SOURCE_UTF8_BYTES} strict UTF-8 bytes",
        )
    bom_removed = value.startswith("\ufeff")
    if bom_removed:
        value = value[1:]
    line_endings_changed = "\r" in value
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    frontmatter_removed = False
    if format == "markdown":
        value, frontmatter_removed = _strip_frontmatter(value)
    start, end = _trim_bounds(value)
    return value[start:end], bom_removed, line_endings_changed, frontmatter_removed


def _markdown_heading(line: str) -> tuple[str, int] | None:
    match = _HEADING_RE.fullmatch(line)
    if match is None:
        return None
    title = _trim(match.group(2))
    if not title:
        return None
    return title, len(match.group(1))


def _sections(value: str, format: str) -> tuple[_Section, ...]:
    if not value:
        return ()
    if format == "text":
        return (_Section(0, 0, len(value), "Overview", 0),)

    headings: list[tuple[int, int, str, int]] = []
    line_start = 0
    while line_start <= len(value):
        line_end = value.find("\n", line_start)
        if line_end < 0:
            line_end = len(value)
        heading = _markdown_heading(value[line_start:line_end])
        if heading is not None:
            body_start = line_end + 1 if line_end < len(value) else line_end
            headings.append((line_start, body_start, heading[0], heading[1]))
        if line_end == len(value):
            break
        line_start = line_end + 1

    if not headings:
        return (_Section(0, 0, len(value), "Overview", 0),)

    sections: list[_Section] = []
    first_heading_start = headings[0][0]
    preamble_start, preamble_end = _trim_bounds(value, 0, first_heading_start)
    if preamble_start < preamble_end:
        sections.append(
            _Section(len(sections), preamble_start, preamble_end, "Overview", 0)
        )
    for position, (start, body_start, heading, level) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(value)
        body_trim_start, body_trim_end = _trim_bounds(value, body_start, end)
        if body_trim_start >= body_trim_end:
            continue
        section_start, section_end = _trim_bounds(value, start, end)
        if section_start < section_end:
            sections.append(
                _Section(
                    len(sections),
                    section_start,
                    section_end,
                    heading,
                    level,
                )
            )
    return tuple(sections)


def _token_limit_end(
    value: str,
    start: int,
    end: int,
    maximum: int,
    checkpoint: Callable[[], None] | None = None,
) -> int | None:
    token_count = 0
    in_token = False
    previous_token_end = start
    for position in range(start, end):
        if checkpoint is not None and (position - start) % 1_024 == 0:
            checkpoint()
        if value[position] in _WHITESPACE:
            in_token = False
            continue
        if not in_token:
            token_count += 1
            if token_count > maximum:
                return previous_token_end
            in_token = True
        previous_token_end = position + 1
    return None


def split_text_ranges(
    value: str,
    *,
    start: int = 0,
    end: int | None = None,
    limits: IndexingLimits | None = None,
    checkpoint: Callable[[], None] | None = None,
) -> tuple[tuple[str, int, int], ...]:
    """Split one canonical range into bounded, non-overlapping scalar spans."""

    if not isinstance(value, str):
        raise IndexingContractError("invalid_text", "content must be a string")
    _validate_scalars(value, "content")
    end = len(value) if end is None else end
    if (
        not isinstance(start, int)
        or isinstance(start, bool)
        or not isinstance(end, int)
        or isinstance(end, bool)
        or not 0 <= start <= end <= len(value)
    ):
        raise IndexingContractError("invalid_range", "chunk range is invalid")
    limits = limits or IndexingLimits()
    pieces: list[tuple[str, int, int]] = []
    cursor, range_end = _trim_bounds(value, start, end)
    while cursor < range_end:
        if checkpoint is not None:
            checkpoint()
        hard_end = min(range_end, cursor + limits.max_chars)
        token_end = _token_limit_end(
            value,
            cursor,
            hard_end,
            limits.max_tokens,
            checkpoint,
        )
        piece_end = token_end if token_end is not None else hard_end
        if token_end is None and piece_end < range_end:
            for position in range(piece_end - 1, cursor, -1):
                if value[position] in _WHITESPACE:
                    piece_end = position
                    break
        if piece_end <= cursor:
            piece_end = hard_end
        text_start, text_end = _trim_bounds(value, cursor, piece_end)
        if text_start < text_end:
            pieces.append((value[text_start:text_end], text_start, text_end))
        cursor = piece_end
        while cursor < range_end and value[cursor] in _WHITESPACE:
            cursor += 1
    return tuple(pieces)


def _reference_targets(value: str) -> tuple[str, ...]:
    targets: list[str] = []
    for match in _WIKI_LINK_RE.finditer(value):
        target = _trim(match.group(1).split("|", 1)[0])
        if target and target not in targets:
            targets.append(target)
    return tuple(targets)


def index_document(
    content: str,
    *,
    format: str,
    path: str,
    pocket: str,
    scopes: Sequence[str],
    authority: str,
    priority: int = 0,
    limits: IndexingLimits | None = None,
    checkpoint: Callable[[], None] | None = None,
) -> IndexedDocument:
    """Convert one strict text document into portable v2 retrieval records."""

    if checkpoint is not None:
        checkpoint()
    if format not in {"markdown", "text"}:
        raise IndexingContractError(
            "unsupported_format",
            "format must be markdown or text",
        )
    path = normalize_source_path(path)
    pocket = _bounded_text(pocket, "pocket")
    scopes = _validated_scopes(scopes)
    if authority not in AUTHORITY_KINDS:
        raise IndexingContractError(
            "invalid_authority",
            "authority is not supported by rag-behavior-v2",
        )
    if (
        not isinstance(priority, int)
        or isinstance(priority, bool)
        or not -100 <= priority <= 100
    ):
        raise IndexingContractError(
            "invalid_priority",
            "priority must be an integer between -100 and 100",
        )
    limits = limits or IndexingLimits()
    canonical, bom_removed, line_endings_changed, frontmatter_removed = (
        canonicalize_document(content, format)
    )
    owner_source_id = source_id("file", pocket, path)
    records: list[RagRecord] = []
    for section in _sections(canonical, format):
        if checkpoint is not None:
            checkpoint()
        for text, text_start, text_end in split_text_ranges(
            canonical,
            start=section.start,
            end=section.end,
            limits=limits,
            checkpoint=checkpoint,
        ):
            chunk_index = len(records)
            chunk_content_id = content_id(text)
            record_id = source_chunk_id(
                owner_source_id,
                chunk_index,
                text_start,
                text_end,
                chunk_content_id,
            )
            records.append(
                RagRecord(
                    id=record_id,
                    text=text,
                    source_id=owner_source_id,
                    source_name=path.rsplit("/", 1)[-1],
                    path=path,
                    pocket=pocket,
                    scopes=scopes,
                    authority=authority,
                    priority=priority,
                    provenance_file=True,
                    provenance_chunk=True,
                    references=(),
                    embedding_profile_id=None,
                    metadata={
                        "indexing_contract": INDEXING_CONTRACT_ID,
                        "indexing_profile": INDEXING_PROFILE_ID,
                        "content_id": chunk_content_id,
                        "chunk_index": chunk_index,
                        "text_start": text_start,
                        "text_end": text_end,
                        "section_index": section.index,
                        "heading": section.heading,
                        "heading_level": section.heading_level,
                        "token_estimate": max(1, (len(text) + 3) // 4),
                        "reference_targets": list(_reference_targets(text)),
                    },
                )
            )
    source_bytes = content.encode("utf-8")
    return IndexedDocument(
        format=format,
        path=path,
        pocket=pocket,
        scopes=scopes,
        authority=authority,
        priority=priority,
        source_id=owner_source_id,
        source_content_id=content_id(content),
        source_utf8_bytes=len(source_bytes),
        canonical_content_id=content_id(canonical),
        canonical_text=canonical,
        bom_removed=bom_removed,
        line_endings_changed=line_endings_changed,
        frontmatter_removed=frontmatter_removed,
        limits=limits,
        records=tuple(records),
    )
