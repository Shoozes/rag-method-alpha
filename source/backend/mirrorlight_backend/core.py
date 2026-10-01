from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, RLock
from typing import Iterable, List

from .config import Settings
from .embeddings import EmbeddingError, create_embedding_provider
from .index_store import IndexStore
from .indexer import CorpusFile, RAGIndexer
from .operations import CancellationToken
from .paths import resolve_under, validate_companion_id
from .pockets import PocketManager
from .rag_core.application import (
    ApplicationRagIndex,
    application_result,
    build_application_index,
    result_scopes,
)
from .rag_core.types import MAX_QUERY_UTF8_BYTES, validate_query


DEFAULT_POCKETS = ["global", "vault", "lore", "memories"]
RETRIEVAL_METHOD = "rag-behavior-v2"


def normalize_pockets(raw: str | Iterable[str] | None) -> List[str]:
    if raw is None:
        values = DEFAULT_POCKETS
    elif isinstance(raw, str):
        values = raw.split(",")
    else:
        values = raw
    allowed = set(DEFAULT_POCKETS)
    result: List[str] = []
    unknown: List[str] = []
    for value in values:
        name = str(value).strip().lower()
        if not name:
            continue
        if name not in allowed:
            unknown.append(name)
            continue
        if name not in result:
            result.append(name)
    if unknown:
        raise ValueError(f"unknown pocket(s): {', '.join(dict.fromkeys(unknown))}")
    return result or ["global"]


@dataclass(frozen=True)
class _IndexContext:
    normalized_companion: str | None
    names: List[str]
    paths: List[tuple[Path, str, str | None]]
    inventory: List[CorpusFile]
    key: str
    scope_key: str
    fingerprint: str
    embedding_profile: str


class RagService:
    """Application service for active runtime data, indexing, graph, and search."""

    def __init__(self, settings: Settings, pocket_manager: PocketManager | None = None):
        self.settings = settings
        self.settings.ensure_runtime_dirs()
        self.pockets = pocket_manager or PocketManager(settings)
        self._cache: OrderedDict[str, dict] = OrderedDict()
        self._engines: OrderedDict[str, ApplicationRagIndex] = OrderedDict()
        self.index_store = IndexStore(settings)
        self.embedding_error: str | None = None
        try:
            self.embedding_provider = create_embedding_provider(
                settings.embedding_mode,
                settings.embedding_dimension,
                settings.embedding_model,
            )
        except EmbeddingError as exc:
            self.embedding_provider = None
            self.embedding_error = str(exc)
        self._lock = RLock()
        self._build_locks: dict[str, Lock] = {}

    @property
    def operation_lock(self):
        """Serialize imports and small state transitions shared by the app."""

        return self._lock

    def refresh(self) -> None:
        with self._lock:
            self.pockets.refresh()

    def clear_cache(self) -> None:
        with self._lock:
            self._cache.clear()
            self._engines.clear()

    def list_companions(self) -> List[str]:
        with self._lock:
            self.refresh()
            return self.pockets.companion_ids()

    def resolve_paths(self, companion_id: str | None, pocket_names: Iterable[str]) -> List[tuple[Path, str, str | None]]:
        normalized_companion = validate_companion_id(companion_id) if companion_id else None
        paths: List[tuple[Path, str, str | None]] = []
        for pocket in normalize_pockets(pocket_names):
            if pocket == "global":
                paths.append((self.pockets.global_pocket, pocket, normalized_companion))
                for vault_id in self.pockets.assignments.get(normalized_companion or "", []):
                    path = self.pockets.vault_registry.get(vault_id)
                    if path:
                        paths.append((path, "global", normalized_companion))
                continue
            if pocket == "memories" and not self.pockets.memory_enabled:
                continue
            path = self.pockets.resolve_named_pocket(normalized_companion, pocket)
            if path:
                paths.append((path, pocket, normalized_companion))

        result: List[tuple[Path, str, str | None]] = []
        seen: set[Path] = set()
        for path, pocket, owner in paths:
            safe_path = resolve_under(self.settings.data_root, path)
            if safe_path.exists() and safe_path not in seen:
                result.append((safe_path, pocket, owner))
                seen.add(safe_path)
        return result

    def fingerprint(
        self,
        files: Iterable[CorpusFile],
        cancel_token: CancellationToken | None = None,
    ) -> str:
        digest = hashlib.sha256()
        for item in files:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            try:
                relative = item.path.relative_to(self.settings.data_root).as_posix()
                snapshot = item.snapshot
                if snapshot is None:
                    # Compatibility for callers that construct CorpusFile
                    # values directly; normal service builds always carry a
                    # read-consistent snapshot from inventory().
                    data = item.path.read_bytes()
                    content_digest = hashlib.sha256(data).digest()
                    size = len(data)
                else:
                    content_digest = bytes.fromhex(snapshot.digest)
                    size = snapshot.size
            except (OSError, ValueError):
                continue
            digest.update(item.pocket.encode("utf-8"))
            digest.update(b"\0")
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(size).encode("ascii"))
            digest.update(b"\0")
            digest.update(content_digest)
        return digest.hexdigest()

    def build_index(
        self,
        companion_id: str | None,
        pocket_names: Iterable[str] | None,
        force: bool = False,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        token = cancel_token or CancellationToken()
        requested_pockets = (
            pocket_names
            if pocket_names is None or isinstance(pocket_names, str)
            else list(pocket_names)
        )
        normalized_companion, names, scope_key = self._request_scope(
            companion_id,
            requested_pockets,
        )
        build_lock = self._build_lock_for(scope_key)
        while not build_lock.acquire(timeout=0.05):
            token.raise_if_cancelled()
        try:
            token.raise_if_cancelled()
            # Inventory and fingerprinting are deliberately inside the scope
            # lease. A waiting request observes the promoted generation instead
            # of repeating a full corpus scan while another writer is working.
            context = self._prepare_index_context(
                normalized_companion,
                names,
                token,
            )
            cached = self._load_cached_index(context.key, context.scope_key, force=force)
            if cached is not None:
                return cached

            with self._lock:
                provider = self.embedding_provider
            embedding_profile = context.embedding_profile
            indexer = RAGIndexer(self.pockets)
            try:
                index = indexer.build(context.paths, context.inventory, provider, token)
            except EmbeddingError as exc:
                with self._lock:
                    self.embedding_error = str(exc)
                    self.embedding_provider = None
                    # The provider identity is part of both cache keys. Recompute
                    # it after fallback so the lexical result can be reused.
                    embedding_profile = self._embedding_profile()
                context = _IndexContext(
                    normalized_companion=context.normalized_companion,
                    names=context.names,
                    paths=context.paths,
                    inventory=context.inventory,
                    key=self._cache_key(
                        context.normalized_companion,
                        context.names,
                        context.fingerprint,
                        embedding_profile,
                    ),
                    scope_key=self._scope_key(
                        context.normalized_companion,
                        context.names,
                        embedding_profile,
                    ),
                    fingerprint=context.fingerprint,
                    embedding_profile=embedding_profile,
                )
                index = indexer.build(context.paths, context.inventory, None, token)
                index["embedding"] = {
                    "mode": "fallback",
                    "status": "error",
                    "profile": embedding_profile,
                    "dimension": 0,
                    "error": str(exc),
                }
            if (
                provider is None
                and self.embedding_error
                and index["embedding"].get("status") == "disabled"
            ):
                index["embedding"] = {
                    "mode": "fallback",
                    "status": "error",
                    "profile": embedding_profile,
                    "dimension": 0,
                    "error": self.embedding_error,
                }
            token.raise_if_cancelled()
            index.update(
                {
                    "companion_id": context.normalized_companion,
                    "pockets": context.names,
                    "retrieval_method": RETRIEVAL_METHOD,
                    "paths": [
                        path.relative_to(self.settings.data_root).as_posix()
                        for path, _, _ in context.paths
                    ],
                    "fingerprint": context.fingerprint,
                    "cache_origin": "built",
                }
            )
            index["generation"] = self.index_store.save(
                context.key,
                index,
                context.scope_key,
            )
            with self._lock:
                self._cache[context.key] = index
                self._engines.pop(context.key, None)
                self._cache.move_to_end(context.key)
                self._trim_cache()
            return index
        finally:
            build_lock.release()

    def _request_scope(
        self,
        companion_id: str | None,
        pocket_names: Iterable[str] | None,
    ) -> tuple[str | None, List[str], str]:
        """Resolve the cheap lock identity before touching corpus contents."""

        with self._lock:
            self.refresh()
            normalized_companion = validate_companion_id(companion_id) if companion_id else None
            names = normalize_pockets(pocket_names)
        return normalized_companion, names, self._scope_key(normalized_companion, names)

    def _prepare_index_context(
        self,
        companion_id: str | None,
        pocket_names: Iterable[str] | None,
        cancel_token: CancellationToken,
    ) -> _IndexContext:
        cancel_token.raise_if_cancelled()
        with self._lock:
            self.refresh()
            normalized_companion = validate_companion_id(companion_id) if companion_id else None
            names = normalize_pockets(pocket_names)
            paths = self.resolve_paths(normalized_companion, names)
        indexer = RAGIndexer(self.pockets)
        inventory = indexer.inventory(paths, cancel_token)
        fingerprint = self.fingerprint(inventory, cancel_token) if inventory else "empty"
        cancel_token.raise_if_cancelled()
        with self._lock:
            embedding_profile = self._embedding_profile()
        key = self._cache_key(normalized_companion, names, fingerprint, embedding_profile)
        scope_key = self._scope_key(normalized_companion, names, embedding_profile)
        return _IndexContext(
            normalized_companion=normalized_companion,
            names=names,
            paths=paths,
            inventory=inventory,
            key=key,
            scope_key=scope_key,
            fingerprint=fingerprint,
            embedding_profile=embedding_profile,
        )

    def _build_lock_for(self, scope_key: str) -> Lock:
        with self._lock:
            return self._build_locks.setdefault(scope_key, Lock())

    def _load_cached_index(self, key: str, scope_key: str, force: bool = False) -> dict | None:
        if force:
            return None
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                return cached
        persisted = self.index_store.load(key, scope_key)
        if persisted is None:
            return None
        with self._lock:
            existing = self._cache.get(key)
            if existing is not None:
                self._cache.move_to_end(key)
                return existing
            self._cache[key] = persisted
            self._engines.pop(key, None)
            self._cache.move_to_end(key)
            self._trim_cache()
            return persisted

    def _trim_cache(self) -> None:
        while len(self._cache) > self.settings.max_cached_indexes:
            evicted_key, _ = self._cache.popitem(last=False)
            self._engines.pop(evicted_key, None)

    def _embedding_profile(self) -> str:
        if self.embedding_provider is not None:
            return self.embedding_provider.profile
        if self.embedding_error:
            return f"error:{self.settings.embedding_mode}:{self.settings.embedding_model}"
        return "disabled"

    @staticmethod
    def _cache_key(
        companion_id: str | None,
        pocket_names: Iterable[str],
        fingerprint: str,
        embedding_profile: str = "disabled",
    ) -> str:
        return f"{companion_id or 'global'}::{','.join(pocket_names)}::{fingerprint}::{embedding_profile}"

    @staticmethod
    def _scope_key(
        companion_id: str | None,
        pocket_names: Iterable[str],
        embedding_profile: str | None = None,
    ) -> str:
        # The writer lease protects the corpus scope, not one provider profile.
        # A provider failure must be able to reuse the same durable root without
        # allowing two profiles to publish generations concurrently.
        return f"{companion_id or 'global'}::{','.join(pocket_names)}"

    def graph(
        self,
        companion_id: str | None,
        pocket_names: Iterable[str],
        force: bool = False,
        max_nodes: int | None = None,
        max_links: int | None = None,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        token = cancel_token or CancellationToken()
        index = self.build_index(companion_id, pocket_names, force=force, cancel_token=token)
        token.raise_if_cancelled()
        graph_data = index["graph_data"]
        all_nodes = list(graph_data["nodes"])
        all_links = list(graph_data["links"])
        node_limit = max(
            1,
            int(
                max_nodes
                if max_nodes is not None
                else getattr(self.settings, "max_graph_response_nodes", len(all_nodes) or 1)
            ),
        )
        link_limit = max(
            1,
            int(
                max_links
                if max_links is not None
                else getattr(self.settings, "max_graph_response_links", len(all_links) or 1)
            ),
        )
        nodes = all_nodes[:node_limit]
        visible_ids = {node.get("id") for node in nodes}
        links = [
            link
            for link in all_links
            if link.get("source") in visible_ids and link.get("target") in visible_ids
        ][:link_limit]
        return {
            "nodes": nodes,
            "links": links,
            "graph_meta": {
                "total_nodes": len(all_nodes),
                "total_links": len(all_links),
                "returned_nodes": len(nodes),
                "returned_links": len(links),
                "node_limit": node_limit,
                "link_limit": link_limit,
                "truncated": len(nodes) < len(all_nodes) or len(links) < len(all_links),
            },
            "companion_id": index["companion_id"],
            "pockets": index["pockets"],
            "paths": index["paths"],
            "fingerprint": index["fingerprint"],
            "embedding": index["embedding"],
            "generation": index.get("generation"),
        }

    def search(
        self,
        query: str,
        companion_id: str | None,
        pocket_names: Iterable[str],
        top_k: int = 5,
        debug: bool = False,
        force: bool = False,
        mode: str = "scoped_hybrid",
        max_context_tokens: int | None = None,
        cancel_token: CancellationToken | None = None,
    ) -> dict:
        validate_query(
            query,
            max_chars=self.settings.max_query_chars,
            max_utf8_bytes=MAX_QUERY_UTF8_BYTES,
        )
        token = cancel_token or CancellationToken()
        index = self.build_index(companion_id, pocket_names, force=force, cancel_token=token)
        token.raise_if_cancelled()
        with self._lock:
            key = self._cache_key(
                index["companion_id"],
                index["pockets"],
                index["fingerprint"],
                self._embedding_profile(),
            )
            application_index = self._engines.get(key)
            if application_index is None:
                application_index = build_application_index(
                    index,
                    max_query_chars=self.settings.max_query_chars,
                    max_records=self.settings.max_index_chunks,
                    max_top_k=self.settings.max_top_k,
                )
                self._engines[key] = application_index
            self._engines.move_to_end(key)
        if top_k <= 0:
            results = []
            semantic_state = "not_requested"
            semantic_fallback_reason = None
            context_tokens = 0
            truncated = False
            retrieval_mode = "lexical-hybrid"
            fallback_error = None
        else:
            embedding_status = str(index["embedding"].get("status") or "disabled")
            normalized_mode = str(mode).strip().lower()
            semantic_requested = normalized_mode in {
                "semantic_only",
                "hybrid",
                "scoped_hybrid",
            }
            query_vector = None
            fallback_error = None
            semantic_enabled = semantic_requested and embedding_status != "disabled"
            semantic_fallback_reason = (
                "disabled_by_settings"
                if semantic_requested and not semantic_enabled
                else None
            )
            if (
                semantic_requested
                and embedding_status == "ready"
                and self.embedding_provider is not None
            ):
                token.raise_if_cancelled()
                try:
                    query_vector = self.embedding_provider.embed([query])[0]
                except (EmbeddingError, IndexError, TypeError, ValueError) as exc:
                    fallback_error = str(exc)
                    semantic_fallback_reason = "embedding_failed"
                token.raise_if_cancelled()
            elif semantic_requested and embedding_status == "error":
                fallback_error = str(index["embedding"].get("error") or "embedding failed")
                semantic_fallback_reason = "embedding_failed"
            response = application_index.engine.search(
                query,
                mode=normalized_mode,
                top_k=top_k,
                include_scopes=result_scopes(application_index.engine.records),
                vectors=application_index.vectors,
                query_vector=query_vector,
                query_embedding_profile_id=application_index.embedding_profile_id,
                semantic_enabled=semantic_enabled,
                semantic_fallback_reason=semantic_fallback_reason,
                max_context_tokens=max_context_tokens,
                checkpoint=lambda _phase: token.raise_if_cancelled(),
            )
            results = [
                application_result(
                    result,
                    rank,
                    response,
                    debug=debug,
                    fallback_error=fallback_error,
                )
                for rank, result in enumerate(response.results)
            ]
            semantic_state = response.semantic_state
            semantic_fallback_reason = response.semantic_fallback_reason
            context_tokens = response.context_tokens
            truncated = response.truncated
            retrieval_mode = (
                "vector-hybrid"
                if response.semantic_state == "ready"
                else "lexical-fallback"
                if fallback_error
                else "lexical-hybrid"
            )
        return {
            "results": results,
            "companion_id": index["companion_id"],
            "pockets": index["pockets"],
            "paths": index["paths"],
            "fingerprint": index["fingerprint"],
            "embedding": index["embedding"],
            "retrieval_mode": retrieval_mode,
            "fallback_error": fallback_error,
            "retrieval_method": RETRIEVAL_METHOD,
            "semantic_state": semantic_state,
            "semantic_fallback_reason": semantic_fallback_reason,
            "context_tokens": context_tokens,
            "truncated": truncated,
            "generation": index.get("generation"),
        }

    def create_companion(self, companion_id: str, persona: str = "") -> dict:
        with self._lock:
            normalized_id = validate_companion_id(companion_id)
            self.pockets.refresh()
            self.pockets.create_companion(normalized_id, persona)
            self.clear_cache()
            return {"status": "ok", "id": normalized_id}

    def remove_companion(self, companion_id: str) -> bool:
        """Remove a newly imported companion when index warm-up fails."""

        with self._lock:
            removed = self.pockets.remove_companion(companion_id)
            self.clear_cache()
            return removed

    def set_memory_enabled(self, enabled: bool) -> bool:
        with self._lock:
            value = self.pockets.set_memory_enabled(enabled)
            self.clear_cache()
            return value
