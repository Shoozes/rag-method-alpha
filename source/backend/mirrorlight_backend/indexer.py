from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from stat import S_ISREG
from typing import Dict, Iterable, List

import networkx as nx

from .config import Settings
from .embeddings import EmbeddingError, EmbeddingProvider, validate_vectors
from .operations import CancellationToken
from .paths import resolve_under
from .pockets import PocketManager
from .provenance import build_provenance
from .rag_core.indexing import IndexingLimits, index_document, split_text_ranges


TEXT_EXTENSIONS = frozenset({".md", ".mdx", ".markdown", ".txt"})
_LINK_PATTERN = re.compile(r"\[\[(.*?)\]\]|#([\w-]+)")


class IndexLimitError(ValueError):
    """Raised when a corpus exceeds an explicit indexing budget."""


class SourceEncodingError(ValueError):
    """Raised when a text source is not strict UTF-8."""


@dataclass(frozen=True)
class SourceSnapshot:
    """One read-consistent source payload used by fingerprinting and indexing."""

    root: Path
    path: Path
    pocket: str
    companion_id: str | None
    size: int
    mtime_ns: int
    file_identity: tuple[int, int, int, int]
    digest: str
    text: str


@dataclass(frozen=True)
class CorpusFile:
    root: Path
    path: Path
    pocket: str
    companion_id: str | None
    snapshot: SourceSnapshot | None = None


class SourceChangedError(RuntimeError):
    """Raised when a source is replaced while a snapshot is being read."""


def normalize_text(value: str) -> str:
    return (value or "").casefold().strip()


class RAGIndexer:
    """Build a deterministic document/chunk graph from active pocket paths."""

    def __init__(self, pocket_manager: PocketManager):
        self.pocket_manager = pocket_manager
        self.settings: Settings = pocket_manager.settings
        self.graph = nx.Graph()
        self._heading_to_id: Dict[tuple[str, str], str] = {}
        self._chunk_count = 0

    def _reserve_chunk(self) -> None:
        if self._chunk_count >= self.settings.max_index_chunks:
            raise IndexLimitError(
                f"index chunk limit exceeded ({self.settings.max_index_chunks})"
            )
        self._chunk_count += 1

    def _enforce_graph_limits(self) -> None:
        if self.graph.number_of_nodes() > self.settings.max_graph_nodes:
            raise IndexLimitError(
                f"graph node limit exceeded ({self.settings.max_graph_nodes})"
            )
        if self.graph.number_of_edges() > self.settings.max_graph_links:
            raise IndexLimitError(
                f"graph link limit exceeded ({self.settings.max_graph_links})"
            )

    @staticmethod
    def _file_identity(stat_result: os.stat_result) -> tuple[int, int, int, int]:
        return (
            int(stat_result.st_dev),
            int(stat_result.st_ino),
            int(stat_result.st_size),
            int(stat_result.st_mtime_ns),
        )

    def _snapshot_file(
        self,
        root: Path,
        file_path: Path,
        pocket: str,
        companion_id: str | None,
    ) -> SourceSnapshot:
        safe_path = resolve_under(self.settings.data_root, file_path)
        try:
            before = os.stat(safe_path, follow_symlinks=False)
            if not S_ISREG(before.st_mode) or safe_path.is_symlink():
                raise SourceChangedError(f"source is not a regular file: {safe_path}")
            if before.st_size > self.settings.max_index_file_bytes:
                raise IndexLimitError(
                    f"index file limit exceeded for {safe_path.name} "
                    f"({self.settings.max_index_file_bytes} bytes)"
                )
            with safe_path.open("rb") as stream:
                opened = os.fstat(stream.fileno())
                if self._file_identity(opened) != self._file_identity(before):
                    raise SourceChangedError(f"source changed before reading: {safe_path}")
                data = stream.read(self.settings.max_index_file_bytes + 1)
                after = os.stat(safe_path, follow_symlinks=False)
                if self._file_identity(opened) != self._file_identity(after):
                    raise SourceChangedError(f"source changed while reading: {safe_path}")
        except FileNotFoundError as exc:
            raise SourceChangedError(f"source disappeared while reading: {safe_path}") from exc
        except OSError as exc:
            raise SourceChangedError(f"source could not be read: {safe_path}") from exc
        if len(data) > self.settings.max_index_file_bytes:
            raise IndexLimitError(
                f"index file limit exceeded for {safe_path.name} "
                f"({self.settings.max_index_file_bytes} bytes)"
            )
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SourceEncodingError(
                f"index source is not valid UTF-8: {safe_path.name}"
            ) from exc
        return SourceSnapshot(
            root=root,
            path=safe_path,
            pocket=pocket,
            companion_id=companion_id,
            size=len(data),
            mtime_ns=before.st_mtime_ns,
            file_identity=self._file_identity(before),
            digest=hashlib.sha256(data).hexdigest(),
            text=text,
        )

    @staticmethod
    def _keywords(text: str) -> List[str]:
        seen: set[str] = set()
        keywords: List[str] = []
        for token in re.findall(r"(?u)\b\w{3,}\b", (text or "").casefold()):
            if token not in seen:
                seen.add(token)
                keywords.append(token)
        return keywords

    def _split_text(self, text: str, cancel_token: CancellationToken | None = None) -> List[str]:
        """Split one section into deterministic, bounded retrieval chunks."""

        checkpoint = cancel_token.raise_if_cancelled if cancel_token is not None else None
        return [
            piece
            for piece, _text_start, _text_end in split_text_ranges(
                text,
                limits=IndexingLimits(
                    max_chars=self.settings.max_chunk_chars,
                    max_tokens=self.settings.max_chunk_tokens,
                ),
                checkpoint=checkpoint,
            )
        ]

    @staticmethod
    def _should_index_file(file_path: Path) -> bool:
        return (
            file_path.is_file()
            and not file_path.is_symlink()
            and not file_path.name.startswith(".")
            and not file_path.name.lower().startswith("__macosx")
            and file_path.suffix.lower() in TEXT_EXTENSIONS
        )

    def _iter_text_files(
        self,
        root: Path,
        cancel_token: CancellationToken | None = None,
        *,
        recursive: bool = True,
    ) -> Iterable[Path]:
        if not root.is_dir():
            return []
        if not recursive:
            try:
                entries = sorted(root.iterdir())
            except OSError as exc:
                raise SourceChangedError(
                    f"source directory could not be read: {root}"
                ) from exc
            return [path for path in entries if self._should_index_file(path)]

        def fail_walk(error: OSError) -> None:
            location = error.filename or str(root)
            raise SourceChangedError(
                f"source directory could not be read: {location}"
            ) from error

        files: List[Path] = []
        for current, directories, names in os.walk(
            root,
            followlinks=False,
            onerror=fail_walk,
        ):
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            directories[:] = sorted(
                directory
                for directory in directories
                if not directory.startswith(".") and directory.lower() != "__macosx"
            )
            for name in sorted(names):
                if cancel_token is not None:
                    cancel_token.raise_if_cancelled()
                path = Path(current) / name
                if self._should_index_file(path):
                    files.append(path)
        return files

    def inventory(
        self,
        pockets: Iterable[tuple[Path, str, str | None]],
        cancel_token: CancellationToken | None = None,
    ) -> list[CorpusFile]:
        """Collect one bounded source inventory for hashing and indexing."""

        files: list[CorpusFile] = []
        total_bytes = 0
        for root, pocket, companion_id in pockets:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            safe_root = resolve_under(self.settings.data_root, root)
            if safe_root.is_file():
                candidates = [safe_root] if safe_root.suffix.lower() == ".json" and companion_id else []
            else:
                # A companion sees loose global documents plus only the global
                # vault directories assigned to it. Assigned vaults are added
                # as separate roots by RagService.resolve_paths(); recursively
                # walking global_root here would bypass that boundary and index
                # an assigned vault twice.
                recursive = not (
                    companion_id is not None
                    and safe_root == self.settings.global_root
                )
                candidates = list(
                    self._iter_text_files(
                        safe_root,
                        cancel_token,
                        recursive=recursive,
                    )
                )
            for file_path in candidates:
                if cancel_token is not None:
                    cancel_token.raise_if_cancelled()
                snapshot = self._snapshot_file(safe_root, file_path, pocket, companion_id)
                files.append(
                    CorpusFile(safe_root, file_path, pocket, companion_id, snapshot)
                )
                total_bytes += snapshot.size
                if len(files) > self.settings.max_index_files:
                    raise IndexLimitError(
                        f"index file limit exceeded ({self.settings.max_index_files})"
                    )
                if total_bytes > self.settings.max_index_total_bytes:
                    raise IndexLimitError(
                        f"index byte limit exceeded ({self.settings.max_index_total_bytes})"
                    )
        return files

    def _doc_id(self, pocket: str, source: str, relative_path: str) -> str:
        return f"doc::{pocket}::{source}::{relative_path}"

    def _chunk_document(
        self,
        source_file: CorpusFile,
        relative_path: str,
        pocket: str,
        source: str,
        companion_id: str | None = None,
        cancel_token: CancellationToken | None = None,
    ) -> List[dict]:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        snapshot = source_file.snapshot or self._snapshot_file(
            source_file.root,
            source_file.path,
            source_file.pocket,
            source_file.companion_id,
        )
        content = snapshot.text
        provenance = build_provenance(pocket, companion_id, source, relative_path)
        indexed = index_document(
            content,
            format="text" if Path(relative_path).suffix.lower() == ".txt" else "markdown",
            path=relative_path,
            pocket=pocket,
            scopes=(provenance.scope,),
            authority=provenance.authority,
            limits=IndexingLimits(
                max_chars=self.settings.max_chunk_chars,
                max_tokens=self.settings.max_chunk_tokens,
            ),
            checkpoint=cancel_token.raise_if_cancelled if cancel_token is not None else None,
        )
        if not indexed.records:
            return []
        doc_id = self._doc_id(pocket, source, relative_path)
        title = Path(relative_path).name
        shared_provenance = {
            "scope": indexed.scopes[0],
            "authority": indexed.authority,
            "source_id": indexed.source_id,
            "provenance": {
                "scope": indexed.scopes[0],
                "authority": indexed.authority,
                "source_id": indexed.source_id,
            },
        }
        self.graph.add_node(
            doc_id,
            id=doc_id,
            label=title,
            type="title",
            pocket=pocket,
            path=relative_path,
            source=source,
            **shared_provenance,
        )

        chunks: List[dict] = []
        previous_id: str | None = None
        seen_sections: set[int] = set()
        for record in indexed.records:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            self._reserve_chunk()
            metadata = dict(record.metadata)
            section_index = int(metadata["section_index"])
            chunk = {
                "id": record.id,
                "heading": metadata["heading"],
                "heading_level": metadata["heading_level"],
                "text": record.text,
                "snippet": record.text[:280],
                "keywords": self._keywords(record.text),
                "tokens_est": metadata["token_estimate"],
                "timestamp": snapshot.mtime_ns,
                "pocket": record.pocket,
                "path": record.path,
                "source": source,
                "scope": record.scope,
                "scopes": list(record.scopes),
                "authority": record.authority,
                "source_id": record.source_id,
                "priority": record.priority,
                "references": list(record.references),
                "indexing_contract": metadata["indexing_contract"],
                "indexing_profile": metadata["indexing_profile"],
                "content_id": metadata["content_id"],
                "chunk_index": metadata["chunk_index"],
                "text_start": metadata["text_start"],
                "text_end": metadata["text_end"],
                "section_index": section_index,
                "reference_targets": metadata["reference_targets"],
                "provenance": {
                    "scope": record.scope,
                    "authority": record.authority,
                    "source_id": record.source_id,
                },
            }
            chunks.append(chunk)
            self.graph.add_node(record.id, **chunk)
            self.graph.add_edge(doc_id, record.id)
            if previous_id:
                self.graph.add_edge(previous_id, record.id)
            self._enforce_graph_limits()
            previous_id = record.id
            if section_index not in seen_sections:
                self._heading_to_id[
                    (doc_id, normalize_text(str(metadata["heading"])))
                ] = record.id
                seen_sections.add(section_index)

        for match in _LINK_PATTERN.finditer(content):
            target = normalize_text(match.group(1) or match.group(2) or "")
            target_id = self._heading_to_id.get((doc_id, target))
            if target_id:
                self.graph.add_edge(doc_id, target_id)

        return chunks

    def _index_memory_file(
        self,
        source_file: CorpusFile,
        companion_id: str,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        snapshot = source_file.snapshot or self._snapshot_file(
            source_file.root,
            source_file.path,
            source_file.pocket,
            source_file.companion_id,
        )
        memory_path = snapshot.path
        doc_id = f"memory::{companion_id}"
        provenance = build_provenance(
            "memories",
            companion_id,
            memory_path.parent.relative_to(self.settings.data_root).as_posix(),
            memory_path.name,
        )
        self.graph.add_node(
            doc_id,
            id=doc_id,
            label=f"{companion_id} memories",
            type="title",
            pocket="memories",
            path=memory_path.name,
            **provenance.as_fields(),
        )
        try:
            payload = json.loads(snapshot.text)
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        chunks: List[dict] = []
        previous_id: str | None = None
        for index, memory in enumerate(payload.get("memories", [])):
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            if not isinstance(memory, dict):
                continue
            text = str(memory.get("content") or "").strip()
            parts = self._split_text(text, cancel_token) if text else []
            if not parts:
                continue
            for part_index, part in enumerate(parts):
                if cancel_token is not None:
                    cancel_token.raise_if_cancelled()
                self._reserve_chunk()
                chunk_id = f"{doc_id}::memory::{index}"
                if len(parts) > 1:
                    chunk_id += f"::part::{part_index}"
                chunk = {
                    "id": chunk_id,
                    "heading": "Memory",
                    "text": part,
                    "snippet": part[:280],
                    "keywords": self._keywords(part),
                    "tokens_est": len(part.split()),
                    "timestamp": memory.get("timestamp", 0) or 0,
                    "pocket": "memories",
                    "path": memory_path.name,
                    **provenance.as_fields(),
                }
                chunks.append(chunk)
                self.graph.add_node(chunk_id, **chunk)
                self.graph.add_edge(doc_id, chunk_id)
                if previous_id:
                    self.graph.add_edge(previous_id, chunk_id)
                self._enforce_graph_limits()
                previous_id = chunk_id
        if not chunks:
            self.graph.remove_node(doc_id)
        return {
            "path": memory_path.name,
            "title": doc_id,
            "chunks": chunks,
            **provenance.as_fields(),
        }

    def index_pocket(self, pocket_path: Path, pocket: str, companion_id: str | None = None) -> List[dict]:
        return self._index_pocket(pocket_path, pocket, companion_id)

    def _index_pocket(
        self,
        pocket_path: Path,
        pocket: str,
        companion_id: str | None = None,
        file_paths: Iterable[CorpusFile | Path] | None = None,
        cancel_token: CancellationToken | None = None,
    ) -> List[dict]:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        safe_path = resolve_under(self.settings.data_root, pocket_path)
        if safe_path.is_file() and safe_path.suffix.lower() == ".json" and companion_id:
            source_file = next(
                (
                    item
                    for item in (file_paths or [])
                    if isinstance(item, CorpusFile) and item.path == safe_path
                ),
                CorpusFile(safe_path.parent, safe_path, pocket, companion_id),
            )
            document = self._index_memory_file(source_file, companion_id, cancel_token)
            return [document] if document["chunks"] else []
        if not safe_path.is_dir():
            return []
        documents = []
        source = safe_path.relative_to(self.settings.data_root).as_posix()
        entries = file_paths if file_paths is not None else self._iter_text_files(safe_path, cancel_token)
        for entry in entries:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            source_file = entry if isinstance(entry, CorpusFile) else CorpusFile(
                safe_path,
                entry,
                pocket,
                companion_id,
            )
            file_path = source_file.path
            relative = file_path.relative_to(safe_path).as_posix()
            chunks = self._chunk_document(
                source_file,
                relative,
                pocket,
                source,
                companion_id,
                cancel_token,
            )
            if not chunks:
                continue
            documents.append(
                {
                    "path": relative,
                    "source": source,
                    "title": self._doc_id(pocket, source, relative),
                    "chunks": chunks,
                    "scope": chunks[0]["scope"],
                    "authority": chunks[0]["authority"],
                    "source_id": chunks[0]["source_id"],
                    "provenance": dict(chunks[0]["provenance"]),
                }
            )
        return documents

    def build(
        self,
        pockets: Iterable[tuple[Path, str, str | None]],
        inventory: Iterable[CorpusFile] | None = None,
        embedding_provider: EmbeddingProvider | None = None,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        self.graph = nx.Graph()
        self._heading_to_id = {}
        self._chunk_count = 0
        documents: List[dict] = []
        pocket_list = list(pockets)
        inventory_list = (
            list(inventory)
            if inventory is not None
            else self.inventory(pocket_list, cancel_token)
        )
        grouped: dict[tuple[Path, str, str | None], list[CorpusFile]] = {}
        for item in inventory_list:
            grouped.setdefault((item.root, item.pocket, item.companion_id), []).append(item)
        for path, pocket, companion_id in pocket_list:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            safe_path = resolve_under(self.settings.data_root, path)
            new_documents = self._index_pocket(
                safe_path,
                pocket,
                companion_id,
                grouped.get((safe_path, pocket, companion_id)),
                cancel_token,
            )
            documents.extend(new_documents)
            self._enforce_graph_limits()
        graph_data = self.get_graph_data(cancel_token)
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        result = {
            "version": 2,
            "docs": documents,
            "graph": nx.to_dict_of_dicts(self.graph),
            "graph_data": graph_data,
            "embeddings": [],
            "embedding": {"mode": "disabled", "status": "disabled", "profile": None, "dimension": 0},
        }
        if embedding_provider is not None:
            texts = [
                chunk["text"]
                for document in documents
                for chunk in document.get("chunks", [])
            ]
            vectors: list[list[float]] = []
            batch_size = max(1, int(self.settings.max_embedding_batch))
            for start in range(0, len(texts), batch_size):
                if cancel_token is not None:
                    cancel_token.raise_if_cancelled()
                batch_texts = texts[start : start + batch_size]
                batch_vectors = validate_vectors(
                    embedding_provider.embed(batch_texts),
                    embedding_provider.dimension or None,
                )
                if len(batch_vectors) != len(batch_texts):
                    raise EmbeddingError("embedding provider returned the wrong number of vectors")
                vectors.extend(batch_vectors)
            result["embeddings"] = vectors
            result["embedding"] = {
                "mode": "enabled",
                "status": "ready",
                "profile": embedding_provider.profile,
                "dimension": len(vectors[0]) if vectors else embedding_provider.dimension,
            }
        return result

    def get_graph_data(
        self,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        nodes = []
        for node_id, data in sorted(self.graph.nodes(data=True), key=lambda item: str(item[0])):
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            nodes.append(
                {
                    "id": str(node_id),
                    "label": data.get("label", data.get("heading", node_id)),
                    "color": "#a78bfa" if data.get("type") == "title" else "#71717a",
                    "text": data.get("text", ""),
                    "pocket": data.get("pocket", ""),
                    "type": data.get("type", "chunk"),
                    "path": data.get("path", ""),
                    "source": data.get("source", ""),
                    "scope": data.get("scope", ""),
                    "authority": data.get("authority", ""),
                    "source_id": data.get("source_id", ""),
                    "provenance": data.get("provenance", {}),
                }
            )
        links = []
        for source, target in sorted(
            self.graph.edges(),
            key=lambda edge: (str(edge[0]), str(edge[1])),
        ):
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            links.append({"source": str(source), "target": str(target)})
        return {"nodes": nodes, "links": links}
