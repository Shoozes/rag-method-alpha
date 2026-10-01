from __future__ import annotations

import re
import unicodedata
from pathlib import Path, PurePosixPath, PureWindowsPath


class UnsafePathError(ValueError):
    """Raised when a client-controlled path leaves its allowed root."""


_COMPANION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_WINDOWS_INVALID_CHARS = re.compile(r'[\x00-\x1f<>:"|?*]')


def resolve_under(base: Path, candidate: Path) -> Path:
    base_resolved = base.resolve(strict=False)
    candidate_resolved = candidate.resolve(strict=False)
    try:
        candidate_resolved.relative_to(base_resolved)
    except ValueError as exc:
        raise UnsafePathError("path must remain under its allowed root") from exc
    return candidate_resolved


def is_under(base: Path, candidate: Path) -> bool:
    try:
        resolve_under(base, candidate)
    except UnsafePathError:
        return False
    return True


def _safe_upload_parts(raw_name: str) -> list[str]:
    """Normalize an upload path using the stricter Windows filename rules."""

    raw = raw_name or ""
    normalized = raw.replace("\\", "/")
    posix = PurePosixPath(normalized)
    windows = PureWindowsPath(raw)
    if (
        not normalized
        or "\x00" in raw
        or posix.is_absolute()
        or windows.is_absolute()
        or bool(windows.drive)
        or windows.root
        or ".." in posix.parts
        or ".." in windows.parts
    ):
        raise UnsafePathError("unsafe upload path")

    parts = [part for part in posix.parts if part not in ("", ".")]
    if not parts:
        raise UnsafePathError("upload path is empty")
    for part in parts:
        if (
            _WINDOWS_INVALID_CHARS.search(part)
            or part[-1] in {".", " "}
            or part.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES
        ):
            raise UnsafePathError("upload path contains an invalid Windows filename")
    return parts


def safe_upload_path(base: Path, raw_name: str) -> Path:
    """Resolve a browser upload name without POSIX or Windows escapes."""

    parts = _safe_upload_parts(raw_name)
    return resolve_under(base, base.joinpath(*parts))


def safe_upload_key(raw_name: str) -> str:
    """Return a case-folded key for cross-platform upload collision checks."""

    return "/".join(
        unicodedata.normalize("NFKC", part).casefold()
        for part in _safe_upload_parts(raw_name)
    )


def upload_keys_conflict(key: str, existing: set[str]) -> bool:
    """Detect exact, ancestor, or descendant collisions across OS filesystems."""

    return key in existing or any(
        key.startswith(candidate + "/") or candidate.startswith(key + "/")
        for candidate in existing
    )


def validate_companion_id(value: str) -> str:
    companion_id = (value or "").strip()
    if not _COMPANION_ID.fullmatch(companion_id):
        raise ValueError(
            "companion_id must use 1-64 letters, numbers, hyphens, or underscores"
        )
    return companion_id


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "").encode(
        "ascii", "ignore"
    ).decode("ascii")
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", normalized.lower()).strip("-_")
    candidate = normalized[:64]
    return candidate if _COMPANION_ID.fullmatch(candidate or "") else "companion"
