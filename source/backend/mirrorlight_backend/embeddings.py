from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol, Sequence


class EmbeddingError(ValueError):
    """Raised when an embedding provider cannot produce a safe vector."""


class EmbeddingProvider(Protocol):
    @property
    def profile(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def validate_vectors(
    vectors: Sequence[Sequence[float]],
    expected_dimension: int | None = None,
) -> list[list[float]]:
    """Validate and normalize provider output before it enters an index."""

    normalized: list[list[float]] = []
    dimension = expected_dimension if expected_dimension and expected_dimension > 0 else None
    for raw_vector in vectors:
        try:
            vector = [float(value) for value in raw_vector]
        except (TypeError, ValueError) as exc:
            raise EmbeddingError("embedding output contains a non-numeric value") from exc
        if not vector or any(not math.isfinite(value) for value in vector):
            raise EmbeddingError("embedding output must be finite and non-empty")
        if dimension is None:
            dimension = len(vector)
        if len(vector) != dimension:
            raise EmbeddingError("embedding output dimension changed within one batch")
        norm = math.sqrt(sum(value * value for value in vector))
        if norm <= 1e-12 or not math.isfinite(norm):
            raise EmbeddingError("embedding output has a zero or invalid norm")
        normalized.append([value / norm for value in vector])
    if expected_dimension and dimension != expected_dimension:
        raise EmbeddingError("embedding output dimension does not match the configured profile")
    return normalized


class HashEmbeddingProvider:
    """Deterministic local vector provider for tests and lightweight prototypes."""

    _TOKEN_RE = re.compile(r"(?u)\b\w{2,}\b")

    def __init__(self, dimension: int = 64):
        if dimension < 2:
            raise EmbeddingError("embedding dimension must be at least 2")
        self._dimension = dimension

    @property
    def profile(self) -> str:
        return f"hash-v1:{self._dimension}"

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            values = [0.0] * self._dimension
            tokens = self._TOKEN_RE.findall((text or "").casefold())
            for token in tokens or [text or ""]:
                digest = hashlib.blake2b(
                    f"{self.profile}\0{token}".encode("utf-8"), digest_size=32
                ).digest()
                for offset in range(0, len(digest), 4):
                    bucket = int.from_bytes(digest[offset : offset + 2], "big") % self._dimension
                    sign = 1.0 if digest[offset + 2] & 1 else -1.0
                    weight = 0.5 + digest[offset + 3] / 255.0
                    values[bucket] += sign * weight
            vectors.append(values)
        return validate_vectors(vectors, self._dimension)


class SentenceTransformerEmbeddingProvider:
    """Optional lazy adapter; the model package is never a default dependency."""

    def __init__(self, model_name: str):
        if not model_name:
            raise EmbeddingError("MIRRORLIGHT_EMBEDDING_MODEL is required for sentence-transformers mode")
        self.model_name = model_name
        self._model = None
        self._dimension: int | None = None

    @property
    def profile(self) -> str:
        return f"sentence-transformers-v1:{self.model_name}"

    @property
    def dimension(self) -> int:
        return self._dimension or 0

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingError(
                "sentence-transformers is not installed; install the optional vector extra"
            ) from exc
        self._model = SentenceTransformer(self.model_name)
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        try:
            encoded = self._load().encode(list(texts), convert_to_numpy=True, normalize_embeddings=False)
            rows = encoded.tolist()
        except EmbeddingError:
            raise
        except Exception as exc:
            raise EmbeddingError(f"embedding provider failed: {exc}") from exc
        vectors = validate_vectors(rows, self._dimension)
        self._dimension = len(vectors[0]) if vectors else self._dimension
        return vectors


def create_embedding_provider(mode: str, dimension: int, model_name: str) -> EmbeddingProvider | None:
    normalized = (mode or "disabled").strip().lower()
    if normalized in {"", "disabled", "off", "none"}:
        return None
    if normalized == "hash":
        return HashEmbeddingProvider(dimension)
    if normalized in {"sentence-transformers", "sentence_transformers", "transformers"}:
        return SentenceTransformerEmbeddingProvider(model_name)
    raise EmbeddingError(f"unknown embedding mode: {mode}")
