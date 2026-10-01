from __future__ import annotations

import hashlib
import errno
import json
import logging
import math
import os
import re
import shutil
import struct
import sys
import time
import uuid
from pathlib import Path

import numpy as np

from .config import Settings


_LOGGER = logging.getLogger(__name__)


def _edge_identity(left: str, right: str) -> tuple[str, str]:
    return (left, right) if left <= right else (right, left)


class _ProcessFileLock:
    """Held cross-process writer lease using the host operating system."""

    def __init__(self, path: Path, timeout_seconds: int):
        self.path = path
        self.timeout_seconds = max(1, int(timeout_seconds))
        self._stream = None
        self._owned = False

    def __enter__(self) -> "_ProcessFileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                self._open()
                self._try_lock()
                self._owned = True
                self._write_metadata()
                return self
            except OSError as exc:
                self._close()
                if not self._is_contention(exc):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"timed out waiting for index writer lock: {self.path}")
                time.sleep(0.05)

    def __exit__(self, _exc_type: object, _exc_value: object, _traceback: object) -> None:
        try:
            if self._owned:
                self._unlock()
        finally:
            self._owned = False
            self._close()

    def _open(self) -> None:
        self.path.touch(exist_ok=True)
        self._stream = self.path.open("r+b")
        self._stream.seek(0, os.SEEK_END)
        if self._stream.tell() == 0:
            self._stream.write(b"\0")
            self._stream.flush()
        self._stream.seek(0)

    def _close(self) -> None:
        if self._stream is not None:
            self._stream.close()
            self._stream = None

    def _try_lock(self) -> None:
        if self._stream is None:
            raise OSError("writer lock stream is not open")
        descriptor = self._stream.fileno()
        if sys.platform == "win32":
            import msvcrt

            self._stream.seek(0)
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            return
        import fcntl

        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock(self) -> None:
        if self._stream is None:
            return
        descriptor = self._stream.fileno()
        if sys.platform == "win32":
            import msvcrt

            self._stream.seek(0)
            msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            return
        import fcntl

        fcntl.flock(descriptor, fcntl.LOCK_UN)

    @staticmethod
    def _is_contention(exc: OSError) -> bool:
        if isinstance(exc, (BlockingIOError, PermissionError)):
            return True
        return exc.errno in {
            errno.EACCES,
            errno.EAGAIN,
            getattr(errno, "EDEADLK", errno.EAGAIN),
            getattr(errno, "EWOULDBLOCK", errno.EAGAIN),
        }

    def _write_metadata(self) -> None:
        if self._stream is None:
            return
        metadata = f"pid={os.getpid()} acquired={time.time():.6f}\n".encode("ascii")
        self._stream.seek(0)
        self._stream.write(metadata)
        self._stream.truncate()
        self._stream.flush()


class IndexStoreLimitError(ValueError):
    """Raised when a serialized generation exceeds its storage budget."""


class IndexStore:
    """Small JSON generation store with atomic promotion and bounded retention."""

    _SCHEMA_VERSION = 1
    _GENERATION_RE = re.compile(r"^\d+-[0-9a-f]+$")
    _VECTOR_HEADER = struct.Struct("<4sII")
    _VECTOR_MAGIC = b"MRV1"

    def __init__(self, settings: Settings):
        self.settings = settings

    @staticmethod
    def scope_key(key: str) -> str:
        """Return the stable scope portion of a fingerprinted cache key."""

        parts = key.split("::")
        if len(parts) >= 4:
            return "::".join(parts[:2])
        return key

    def _key_root(self, key: str, scope_key: str | None = None) -> Path:
        digest = hashlib.sha256((scope_key or self.scope_key(key)).encode("utf-8")).hexdigest()
        return self.settings.index_root / digest

    @staticmethod
    def _write_json(path: Path, payload: dict) -> None:
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _serialize_json(payload: dict) -> str:
        return json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )

    def load(self, key: str, scope_key: str | None = None) -> dict | None:
        key_root = self._key_root(key, scope_key)
        pointer_path = key_root / "current.json"
        pointer_generation: str | None = None
        try:
            pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
            if (
                isinstance(pointer, dict)
                and pointer.get("schema_version") == self._SCHEMA_VERSION
                and pointer.get("key") == key
            ):
                candidate = str(pointer.get("generation") or "")
                if self._GENERATION_RE.fullmatch(candidate):
                    pointer_generation = candidate
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            pointer_generation = None

        candidates: list[str] = []
        if pointer_generation:
            candidates.append(pointer_generation)
        try:
            retained = sorted(
                (
                    path
                    for path in key_root.iterdir()
                    if path.is_dir() and self._GENERATION_RE.fullmatch(path.name)
                ),
                key=lambda path: (path.name, path.stat().st_mtime_ns),
                reverse=True,
            )
        except OSError:
            retained = []
        candidates.extend(path.name for path in retained if path.name not in candidates)
        for generation in candidates:
            recovered = self._load_generation(key, key_root, generation)
            if recovered is not None:
                # The pointer is a fast path, not the sole source of truth.
                # Retained generations let a restart recover from a torn or
                # manually damaged pointer without trusting unvalidated data.
                return recovered
        return None

    def _load_generation(self, key: str, key_root: Path, generation: str) -> dict | None:
        if not self._GENERATION_RE.fullmatch(generation):
            return None
        try:
            generation_root = key_root / generation
            manifest = json.loads((generation_root / "manifest.json").read_text(encoding="utf-8"))
            if (
                not isinstance(manifest, dict)
                or manifest.get("schema_version") != self._SCHEMA_VERSION
                or manifest.get("key") != key
            ):
                return None
            index_path = generation_root / "index.json"
            serialized_bytes = index_path.stat().st_size
            manifest_bytes = manifest.get("serialized_bytes")
            if manifest_bytes is not None and (
                not isinstance(manifest_bytes, int)
                or isinstance(manifest_bytes, bool)
                or manifest_bytes != serialized_bytes
            ):
                return None
            if serialized_bytes > self.settings.max_serialized_index_bytes:
                return None
            serialized = index_path.read_bytes()
            checksum = manifest.get("index_sha256")
            if checksum is not None and (
                not isinstance(checksum, str)
                or not re.fullmatch(r"[0-9a-f]{64}", checksum)
                or hashlib.sha256(serialized).hexdigest() != checksum
            ):
                return None
            index = json.loads(serialized.decode("utf-8"))
            if not isinstance(index, dict) or index.get("version") != 2:
                return None
            vector_manifest = manifest.get("vectors")
            if vector_manifest is not None:
                vectors = self._load_vectors(generation_root, vector_manifest)
                if vectors is None:
                    return None
                index["embeddings"] = vectors
            if not self._valid_index(index, manifest):
                self._close_vectors(index.get("embeddings"))
                return None
            index.setdefault("embeddings", [])
            index.setdefault(
                "embedding",
                {"mode": "disabled", "status": "disabled", "profile": None, "dimension": 0},
            )
            index["cache_origin"] = "disk"
            index["generation"] = generation
            return index
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    @staticmethod
    def _close_vectors(vectors: object) -> None:
        mapped = getattr(vectors, "_mmap", None)
        if mapped is not None:
            mapped.close()

    def _valid_index(self, index: dict, manifest: dict) -> bool:
        if manifest.get("fingerprint") != index.get("fingerprint"):
            return False
        if manifest.get("embedding") != index.get("embedding"):
            return False

        documents = index.get("docs")
        graph = index.get("graph")
        graph_data = index.get("graph_data")
        if not isinstance(documents, list) or len(documents) > self.settings.max_index_files:
            return False
        if not isinstance(graph, dict) or not isinstance(graph_data, dict):
            return False

        chunks: list[dict] = []
        chunk_ids: set[str] = set()
        for document in documents:
            if not isinstance(document, dict):
                return False
            document_chunks = document.get("chunks")
            if not isinstance(document_chunks, list):
                return False
            for chunk in document_chunks:
                if not isinstance(chunk, dict):
                    return False
                chunk_id = chunk.get("id")
                if not isinstance(chunk_id, str) or not chunk_id or chunk_id in chunk_ids:
                    return False
                chunk_ids.add(chunk_id)
                chunks.append(chunk)
        if len(chunks) > self.settings.max_index_chunks:
            return False
        for chunk in chunks:
            text = chunk.get("text")
            if (
                not isinstance(text, str)
                or len(text) > self.settings.max_chunk_chars
                or len(text.split()) > self.settings.max_chunk_tokens
            ):
                return False

        graph_nodes = graph_data.get("nodes")
        graph_links = graph_data.get("links")
        if (
            not isinstance(graph_nodes, list)
            or not isinstance(graph_links, list)
            or len(graph_nodes) > self.settings.max_graph_nodes
            or len(graph_links) > self.settings.max_graph_links
        ):
            return False
        node_ids: set[str] = set()
        for node in graph_nodes:
            if not isinstance(node, dict):
                return False
            node_id = node.get("id")
            if not isinstance(node_id, str) or not node_id or node_id in node_ids:
                return False
            node_ids.add(node_id)
        if not chunk_ids.issubset(node_ids) or set(graph) != node_ids:
            return False
        if any(not isinstance(neighbors, dict) for neighbors in graph.values()):
            return False
        adjacency_links: set[tuple[str, str]] = set()
        for node_id, neighbors in graph.items():
            for neighbor_id, edge in neighbors.items():
                if (
                    not isinstance(neighbor_id, str)
                    or neighbor_id not in node_ids
                    or not isinstance(edge, dict)
                    or not isinstance(graph.get(neighbor_id, {}).get(node_id), dict)
                ):
                    return False
                adjacency_links.add(_edge_identity(node_id, neighbor_id))
        visible_links: set[tuple[str, str]] = set()
        for link in graph_links:
            if not isinstance(link, dict):
                return False
            source = link.get("source")
            target = link.get("target")
            if (
                not isinstance(source, str)
                or not isinstance(target, str)
                or source not in node_ids
                or target not in node_ids
            ):
                return False
            identity = _edge_identity(source, target)
            if identity in visible_links:
                return False
            visible_links.add(identity)
        if visible_links != adjacency_links:
            return False

        embeddings = index.get("embeddings", [])
        embedding = index.get("embedding")
        if not isinstance(embeddings, (list, np.ndarray)) or not isinstance(embedding, dict):
            return False
        if embedding.get("status") == "ready":
            dimension = embedding.get("dimension")
            if not isinstance(dimension, int) or dimension < 1 or len(embeddings) != len(chunks):
                return False
            for vector in embeddings:
                if (
                    not isinstance(vector, (list, tuple, np.ndarray))
                    or len(vector) != dimension
                    or any(
                        not isinstance(value, (int, float, np.number))
                        or not math.isfinite(float(value))
                        for value in vector
                    )
                ):
                    return False
        elif embeddings:
            return False
        return True

    def _load_vectors(self, generation_root: Path, metadata: object) -> np.ndarray | None:
        if not isinstance(metadata, dict) or metadata.get("file") != "vectors.bin":
            return None
        count = metadata.get("count")
        dimension = metadata.get("dimension")
        byte_count = metadata.get("bytes")
        checksum = metadata.get("sha256")
        if any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0
            for value in (count, dimension, byte_count)
        ) or not isinstance(checksum, str):
            return None
        if dimension < 1 or count > self.settings.max_index_chunks:
            return None
        expected_bytes = self._VECTOR_HEADER.size + count * dimension * 4
        if byte_count != expected_bytes or byte_count > self.settings.max_vector_artifact_bytes:
            return None
        path = generation_root / "vectors.bin"
        try:
            if path.stat().st_size != expected_bytes:
                return None
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                header = stream.read(self._VECTOR_HEADER.size)
                if len(header) != self._VECTOR_HEADER.size:
                    return None
                digest.update(header)
                remaining = expected_bytes - self._VECTOR_HEADER.size
                while remaining:
                    block = stream.read(min(1024 * 1024, remaining))
                    if not block:
                        return None
                    digest.update(block)
                    remaining -= len(block)
        except OSError:
            return None
        if not re.fullmatch(r"[0-9a-f]{64}", checksum) or digest.hexdigest() != checksum:
            return None
        vectors: np.ndarray | None = None
        try:
            stored_magic, stored_count, stored_dimension = self._VECTOR_HEADER.unpack(header)
            if (stored_magic, stored_count, stored_dimension) != (
                self._VECTOR_MAGIC,
                count,
                dimension,
            ):
                return None
            vectors = np.memmap(
                path,
                dtype="<f4",
                mode="r",
                offset=self._VECTOR_HEADER.size,
                shape=(count, dimension),
            )
            if not np.isfinite(vectors).all():
                self._close_vectors(vectors)
                return None
            return vectors
        except (OSError, TypeError, ValueError):
            self._close_vectors(vectors)
            return None

    def _vector_info(self, index: dict) -> tuple[object, int] | None:
        embedding = index.get("embedding")
        vectors = index.get("embeddings")
        if not isinstance(embedding, dict) or embedding.get("status") != "ready":
            return None
        if not isinstance(vectors, (list, np.ndarray)) or not len(vectors):
            return None
        dimension = embedding.get("dimension")
        if not isinstance(dimension, int) or isinstance(dimension, bool) or dimension < 1:
            raise ValueError("ready embedding dimension must be a positive integer")
        expected_bytes = self._VECTOR_HEADER.size + len(vectors) * dimension * 4
        if expected_bytes > self.settings.max_vector_artifact_bytes:
            raise IndexStoreLimitError(
                "vector artifact limit exceeded "
                f"({self.settings.max_vector_artifact_bytes} bytes)"
            )
        for vector in vectors:
            if (
                not isinstance(vector, (list, tuple, np.ndarray))
                or len(vector) != dimension
                or any(
                    not isinstance(value, (int, float, np.number))
                    or not math.isfinite(float(value))
                    for value in vector
                )
            ):
                raise ValueError("embedding vectors are invalid")
        return vectors, dimension

    def _write_vectors(self, path: Path, vectors: list[list[float]], dimension: int) -> dict[str, object]:
        digest = hashlib.sha256()
        byte_count = 0
        with path.open("wb") as target:
            header = self._VECTOR_HEADER.pack(self._VECTOR_MAGIC, len(vectors), dimension)
            target.write(header)
            digest.update(header)
            byte_count += len(header)
            format_string = f"<{dimension}f"
            for vector in vectors:
                encoded = struct.pack(format_string, *vector)
                target.write(encoded)
                digest.update(encoded)
                byte_count += len(encoded)
        return {
            "file": "vectors.bin",
            "count": len(vectors),
            "dimension": dimension,
            "bytes": byte_count,
            "sha256": digest.hexdigest(),
            "dtype": "float32-le",
            "storage": "mmap-compatible",
        }

    def save(self, key: str, index: dict, scope_key: str | None = None) -> str:
        vector_info = self._vector_info(index)
        storage_index = dict(index)
        if vector_info is not None:
            storage_index["embeddings"] = []
        serialized_index = self._serialize_json(storage_index)
        serialized_bytes = len(serialized_index.encode("utf-8"))
        if serialized_bytes > self.settings.max_serialized_index_bytes:
            raise IndexStoreLimitError(
                "serialized index limit exceeded "
                f"({self.settings.max_serialized_index_bytes} bytes)"
            )
        key_root = self._key_root(key, scope_key)
        key_root.mkdir(parents=True, exist_ok=True)
        with _ProcessFileLock(
            key_root / ".writer.lock",
            self.settings.index_lock_timeout_seconds,
        ):
            return self._save_locked(
                key,
                index,
                serialized_index,
                serialized_bytes,
                key_root,
                vector_info,
            )

    def _save_locked(
        self,
        key: str,
        index: dict,
        serialized_index: str,
        serialized_bytes: int,
        key_root: Path,
        vector_info: tuple[list[list[float]], int] | None,
    ) -> str:
        generation = f"{int(time.time() * 1000)}-{uuid.uuid4().hex}"
        staging = key_root / f".staging-{generation}"
        final = key_root / generation
        staging.mkdir(parents=True, exist_ok=False)
        promoted = False
        pointer_written = False
        try:
            (staging / "index.json").write_text(serialized_index, encoding="utf-8")
            vector_manifest = None
            if vector_info is not None:
                vector_manifest = self._write_vectors(
                    staging / "vectors.bin",
                    vector_info[0],
                    vector_info[1],
                )
            manifest_payload = {
                "schema_version": self._SCHEMA_VERSION,
                "key": key,
                "generation": generation,
                "fingerprint": index.get("fingerprint"),
                "embedding": index.get("embedding"),
                "serialized_bytes": serialized_bytes,
                "index_sha256": hashlib.sha256(
                    serialized_index.encode("utf-8")
                ).hexdigest(),
            }
            if vector_manifest is not None:
                manifest_payload["vectors"] = vector_manifest
            self._write_json(
                staging / "manifest.json",
                manifest_payload,
            )
            staging.replace(final)
            promoted = True
            self._write_json(
                key_root / "current.json",
                {"schema_version": self._SCHEMA_VERSION, "key": key, "generation": generation},
            )
            pointer_written = True
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            if promoted and not pointer_written:
                shutil.rmtree(final, ignore_errors=True)
            raise
        self._trim(key_root)
        self._remove_legacy_roots(key, key_root)
        return generation

    def _trim(self, key_root: Path) -> None:
        generations = [
            path
            for path in key_root.iterdir()
            if path.is_dir() and self._GENERATION_RE.fullmatch(path.name)
        ]
        keep = max(1, self.settings.max_index_generations)
        current_generation = None
        try:
            pointer = json.loads((key_root / "current.json").read_text(encoding="utf-8"))
            if isinstance(pointer, dict):
                current_generation = str(pointer.get("generation") or "")
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            _LOGGER.warning(
                "Ignoring malformed index pointer at %s: %s",
                key_root / "current.json",
                exc,
            )

        def generation_order(path: Path) -> tuple[int, int, str]:
            timestamp = int(path.name.split("-", 1)[0]) if "-" in path.name else 0
            try:
                modified = path.stat().st_mtime_ns
            except OSError:
                modified = 0
            return timestamp, modified, path.name

        ordered = sorted(generations, key=generation_order)
        keep_names = {path.name for path in ordered[-keep:]}
        if current_generation and current_generation not in keep_names:
            generation_names = {path.name for path in ordered}
            if current_generation not in generation_names:
                keep_names = {path.name for path in ordered[-keep:]}
            else:
                newest = [path.name for path in ordered if path.name != current_generation]
                keep_names = {current_generation}
                if keep > 1:
                    keep_names.update(newest[-(keep - 1):])
        for old in generations:
            if old.name not in keep_names:
                shutil.rmtree(old, ignore_errors=True)

    def _remove_legacy_roots(self, key: str, active_root: Path) -> None:
        """Remove old fingerprint-keyed roots for this scope after promotion."""

        scope = self.scope_key(key)
        try:
            candidates = list(self.settings.index_root.iterdir())
        except OSError:
            return
        for candidate in candidates:
            if candidate == active_root or not candidate.is_dir() or candidate.name.startswith("."):
                continue
            pointer_path = candidate / "current.json"
            try:
                pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
                candidate_key = pointer.get("key") if isinstance(pointer, dict) else None
                if isinstance(candidate_key, str) and self.scope_key(candidate_key) == scope:
                    shutil.rmtree(candidate, ignore_errors=True)
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                continue
