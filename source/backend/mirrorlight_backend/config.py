from __future__ import annotations

import ipaddress
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar
from urllib.parse import urlsplit

from .rag_core.indexing import (
    MAX_CHUNK_CHARS,
    MAX_CHUNK_TOKENS,
    MAX_SOURCE_UTF8_BYTES,
)
from .rag_core.types import MAX_QUERY_CHARS, MAX_RECORDS, MAX_TOP_K


DEFAULT_TRUSTED_HOSTS = ("127.0.0.1", "localhost", "::1")
DEFAULT_TRUSTED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://[::1]:5173",
)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean (true/false, yes/no, on/off, or 1/0)")


def _env_csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None:
        return default
    values = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not values:
        raise ValueError(f"{name} must contain at least one comma-separated value")
    return values


def _normalize_hostname(value: str, *, allow_trailing_dot: bool, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} values must be strings")
    normalized = value.strip().lower().strip("[]")
    if allow_trailing_dot:
        normalized = normalized.rstrip(".")
    if not normalized or normalized == "*":
        raise ValueError(f"{label} values must be explicit hostnames or IP addresses")
    try:
        return ipaddress.ip_address(normalized).compressed
    except ValueError:
        pass
    if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for character in normalized):
        raise ValueError(f"invalid {label}: {value}")
    if normalized.startswith(".") or normalized.endswith(".") or ".." in normalized:
        raise ValueError(f"invalid {label}: {value}")
    return normalized


def normalize_trusted_host(value: str) -> str:
    """Return one exact hostname for request-boundary comparisons."""

    return _normalize_hostname(value, allow_trailing_dot=True, label="trusted host")


def normalize_host_header(value: str) -> str:
    """Parse a Host header without accepting userinfo, paths, or wildcards."""

    if not isinstance(value, str) or not value.strip():
        raise ValueError("Host header is required")
    try:
        parsed = urlsplit(f"//{value.strip()}")
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Host header is invalid") from exc
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.hostname is None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Host header is invalid")
    if port is not None and not 1 <= port <= 65_535:
        raise ValueError("Host header port is invalid")
    return normalize_trusted_host(parsed.hostname)


def normalize_trusted_origin(value: str) -> str:
    """Canonicalize one exact HTTP(S) browser origin for equality checks."""

    if not isinstance(value, str) or not value.strip() or value.strip().lower() == "null":
        raise ValueError("trusted origins must be explicit HTTP(S) origins")
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"invalid trusted origin: {value}") from exc
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"invalid trusted origin: {value}")
    scheme = parsed.scheme.lower()
    if port is not None and not 1 <= port <= 65_535:
        raise ValueError(f"invalid trusted origin port: {value}")
    resolved_port = port if port is not None else (443 if scheme == "https" else 80)
    host = _normalize_hostname(
        parsed.hostname,
        allow_trailing_dot=False,
        label="trusted origin host",
    )
    authority = f"[{host}]" if ":" in host else host
    return f"{scheme}://{authority}:{resolved_port}"


def _env_trusted_values(
    name: str,
    default: tuple[str, ...],
    normalizer: Callable[[str], str],
) -> tuple[str, ...]:
    values = _env_csv(name, default)
    try:
        return tuple(dict.fromkeys(normalizer(value) for value in values))
    except ValueError as exc:
        raise ValueError(f"{name} is invalid: {exc}") from exc


def is_loopback_host(host: str) -> bool:
    """Return whether a bind host is safely limited to the local machine."""

    normalized = (host or "").strip().lower().strip("[]")
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class Settings:
    """Explicit runtime configuration for the active backend.

    Mutable RAG data lives under ``runtime-data`` by default and never under
    the archived reference tree or the active source package.
    """

    project_root: Path
    data_root: Path
    host: str = "127.0.0.1"
    port: int = 8080
    max_upload_bytes: int = 50 * 1024 * 1024
    max_upload_files: int = 3000
    max_top_k: int = 100
    max_index_file_bytes: int = MAX_SOURCE_UTF8_BYTES
    max_index_files: int = 10000
    max_index_total_bytes: int = 256 * 1024 * 1024
    max_index_chunks: int = 50000
    max_chunk_chars: int = MAX_CHUNK_CHARS
    max_chunk_tokens: int = MAX_CHUNK_TOKENS
    max_serialized_index_bytes: int = 512 * 1024 * 1024
    max_vector_artifact_bytes: int = 512 * 1024 * 1024
    max_graph_nodes: int = 100000
    max_graph_links: int = 200000
    max_graph_response_nodes: int = 5000
    max_graph_response_links: int = 10000
    max_index_generations: int = 3
    index_lock_timeout_seconds: int = 60
    max_query_chars: int = 4000
    max_cached_indexes: int = 8
    max_embedding_batch: int = 256
    embedding_mode: str = "disabled"
    embedding_dimension: int = 64
    embedding_model: str = ""
    auth_token: str = ""
    trusted_hosts: tuple[str, ...] = DEFAULT_TRUSTED_HOSTS
    trusted_origins: tuple[str, ...] = DEFAULT_TRUSTED_ORIGINS
    debug_errors: bool = False

    _POSITIVE_INTEGER_FIELDS: ClassVar[tuple[str, ...]] = (
        "port",
        "max_upload_bytes",
        "max_upload_files",
        "max_top_k",
        "max_index_file_bytes",
        "max_index_files",
        "max_index_total_bytes",
        "max_index_chunks",
        "max_chunk_chars",
        "max_chunk_tokens",
        "max_serialized_index_bytes",
        "max_vector_artifact_bytes",
        "max_graph_nodes",
        "max_graph_links",
        "max_graph_response_nodes",
        "max_graph_response_links",
        "max_index_generations",
        "index_lock_timeout_seconds",
        "max_query_chars",
        "max_cached_indexes",
        "max_embedding_batch",
        "embedding_dimension",
    )

    def __post_init__(self) -> None:
        if not isinstance(self.project_root, Path) or not isinstance(self.data_root, Path):
            raise ValueError("project_root and data_root must be pathlib.Path values")
        if not isinstance(self.host, str) or not self.host.strip():
            raise ValueError("host must not be empty")
        object.__setattr__(self, "host", self.host.strip())
        for name in ("embedding_mode", "embedding_model", "auth_token"):
            value = getattr(self, name)
            if not isinstance(value, str):
                raise ValueError(f"{name} must be a string")
            normalized = (
                value.strip().lower()
                if name == "embedding_mode"
                else value.strip()
            )
            if name == "embedding_mode" and not normalized:
                raise ValueError("embedding_mode must not be empty")
            object.__setattr__(self, name, normalized)
        if not isinstance(self.trusted_hosts, tuple) or not self.trusted_hosts:
            raise ValueError("trusted_hosts must be a non-empty tuple")
        if not isinstance(self.trusted_origins, tuple) or not self.trusted_origins:
            raise ValueError("trusted_origins must be a non-empty tuple")
        object.__setattr__(
            self,
            "trusted_hosts",
            tuple(dict.fromkeys(normalize_trusted_host(value) for value in self.trusted_hosts)),
        )
        object.__setattr__(
            self,
            "trusted_origins",
            tuple(dict.fromkeys(normalize_trusted_origin(value) for value in self.trusted_origins)),
        )
        if not isinstance(self.debug_errors, bool):
            raise ValueError("debug_errors must be a boolean")
        for name in self._POSITIVE_INTEGER_FIELDS:
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        if self.port > 65_535:
            raise ValueError("port must be between 1 and 65535")
        contract_limits = {
            "max_query_chars": MAX_QUERY_CHARS,
            "max_index_chunks": MAX_RECORDS,
            "max_top_k": MAX_TOP_K,
        }
        for name, maximum in contract_limits.items():
            if getattr(self, name) > maximum:
                raise ValueError(
                    f"{name} must not exceed the rag-behavior-v2 limit of {maximum}"
                )
        indexing_limits = {
            "max_index_file_bytes": MAX_SOURCE_UTF8_BYTES,
            "max_chunk_chars": MAX_CHUNK_CHARS,
            "max_chunk_tokens": MAX_CHUNK_TOKENS,
        }
        for name, maximum in indexing_limits.items():
            if getattr(self, name) > maximum:
                raise ValueError(
                    f"{name} must not exceed the rag-indexing-v1 limit of {maximum}"
                )

    @classmethod
    def from_env(cls, project_root: Path | None = None) -> "Settings":
        raw_project_root = os.getenv("MIRRORLIGHT_PROJECT_ROOT")
        configured_root = Path(raw_project_root).expanduser() if raw_project_root else None
        root = (project_root or configured_root or Path(__file__).resolve().parents[3]).resolve()
        raw_data_root = os.getenv("MIRRORLIGHT_DATA_ROOT", "runtime-data/mirrorlight")
        data_root = Path(raw_data_root).expanduser()
        if not data_root.is_absolute():
            data_root = root / data_root
        return cls(
            project_root=root,
            data_root=data_root.resolve(),
            host=os.getenv("MIRRORLIGHT_HOST", "127.0.0.1").strip(),
            port=_env_int("MIRRORLIGHT_PORT", 8080),
            max_upload_bytes=_env_int("MIRRORLIGHT_MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
            max_upload_files=_env_int("MIRRORLIGHT_MAX_UPLOAD_FILES", 3000),
            max_top_k=_env_int("MIRRORLIGHT_MAX_TOP_K", 100),
            max_index_file_bytes=_env_int(
                "MIRRORLIGHT_MAX_INDEX_FILE_BYTES", MAX_SOURCE_UTF8_BYTES
            ),
            max_index_files=_env_int("MIRRORLIGHT_MAX_INDEX_FILES", 10000),
            max_index_total_bytes=_env_int(
                "MIRRORLIGHT_MAX_INDEX_TOTAL_BYTES", 256 * 1024 * 1024
            ),
            max_index_chunks=_env_int("MIRRORLIGHT_MAX_INDEX_CHUNKS", 50000),
            max_chunk_chars=_env_int("MIRRORLIGHT_MAX_CHUNK_CHARS", MAX_CHUNK_CHARS),
            max_chunk_tokens=_env_int("MIRRORLIGHT_MAX_CHUNK_TOKENS", MAX_CHUNK_TOKENS),
            max_serialized_index_bytes=_env_int(
                "MIRRORLIGHT_MAX_SERIALIZED_INDEX_BYTES", 512 * 1024 * 1024
            ),
            max_vector_artifact_bytes=_env_int(
                "MIRRORLIGHT_MAX_VECTOR_ARTIFACT_BYTES", 512 * 1024 * 1024
            ),
            max_graph_nodes=_env_int("MIRRORLIGHT_MAX_GRAPH_NODES", 100000),
            max_graph_links=_env_int("MIRRORLIGHT_MAX_GRAPH_LINKS", 200000),
            max_graph_response_nodes=_env_int("MIRRORLIGHT_MAX_GRAPH_RESPONSE_NODES", 5000),
            max_graph_response_links=_env_int("MIRRORLIGHT_MAX_GRAPH_RESPONSE_LINKS", 10000),
            max_index_generations=_env_int("MIRRORLIGHT_MAX_INDEX_GENERATIONS", 3),
            index_lock_timeout_seconds=_env_int(
                "MIRRORLIGHT_INDEX_LOCK_TIMEOUT_SECONDS", 60
            ),
            max_query_chars=_env_int("MIRRORLIGHT_MAX_QUERY_CHARS", 4000),
            max_cached_indexes=_env_int("MIRRORLIGHT_MAX_CACHED_INDEXES", 8),
            max_embedding_batch=_env_int("MIRRORLIGHT_MAX_EMBEDDING_BATCH", 256),
            embedding_mode=os.getenv("MIRRORLIGHT_EMBEDDING_MODE", "disabled").strip().lower(),
            embedding_dimension=_env_int("MIRRORLIGHT_EMBEDDING_DIMENSION", 64),
            embedding_model=os.getenv("MIRRORLIGHT_EMBEDDING_MODEL", "").strip(),
            auth_token=os.getenv("MIRRORLIGHT_AUTH_TOKEN", "").strip(),
            trusted_hosts=_env_trusted_values(
                "MIRRORLIGHT_TRUSTED_HOSTS", DEFAULT_TRUSTED_HOSTS, normalize_trusted_host
            ),
            trusted_origins=_env_trusted_values(
                "MIRRORLIGHT_TRUSTED_ORIGINS", DEFAULT_TRUSTED_ORIGINS, normalize_trusted_origin
            ),
            debug_errors=_env_bool("MIRRORLIGHT_DEBUG_ERRORS"),
        )

    @property
    def remote_mode(self) -> bool:
        return not is_loopback_host(self.host)

    def validate_network_boundary(self) -> None:
        """Refuse unauthenticated network exposure before the app starts."""

        if self.remote_mode and not self.auth_token.strip():
            raise ValueError(
                "non-loopback MIRRORLIGHT_HOST requires MIRRORLIGHT_AUTH_TOKEN"
            )

    @property
    def global_root(self) -> Path:
        return self.data_root / "global"

    @property
    def companions_root(self) -> Path:
        return self.data_root / "companions"

    @property
    def uploads_root(self) -> Path:
        return self.data_root / "uploads"

    @property
    def index_root(self) -> Path:
        return self.data_root / "rag_index"

    def ensure_runtime_dirs(self) -> None:
        for path in (
            self.data_root,
            self.global_root,
            self.companions_root,
            self.uploads_root,
            self.index_root,
        ):
            path.mkdir(parents=True, exist_ok=True)
