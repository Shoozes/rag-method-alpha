from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np

from mirrorlight_backend.config import Settings, normalize_trusted_origin
from mirrorlight_backend.core import DEFAULT_POCKETS, RagService
from mirrorlight_backend.embeddings import EmbeddingError, validate_vectors
from mirrorlight_backend.importer import ImportErrorBase, VaultImporter
from mirrorlight_backend.indexer import (
    IndexLimitError,
    RAGIndexer,
    SourceEncodingError,
)
from mirrorlight_backend.index_store import (
    IndexStore,
    IndexStoreLimitError,
    _ProcessFileLock,
)
from mirrorlight_backend.operations import CancellationToken, OperationCancelled
from mirrorlight_backend.paths import (
    UnsafePathError,
    safe_upload_key,
    safe_upload_path,
    upload_keys_conflict,
)
from mirrorlight_backend.pockets import VaultIdentityCollisionError
from mirrorlight_backend.rag_core.indexing import (
    MAX_CHUNK_CHARS,
    MAX_CHUNK_TOKENS,
    MAX_SOURCE_UTF8_BYTES,
    index_document,
)


class RecordingEmbeddingProvider:
    profile = "test:2"
    dimension = 2

    def __init__(self) -> None:
        self.batch_sizes: list[int] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.batch_sizes.append(len(texts))
        return [[1.0, 0.0] for _ in texts]


class FailingEmbeddingProvider:
    profile = "test:failing"
    dimension = 2

    def __init__(self) -> None:
        self.calls = 0

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        raise EmbeddingError("provider unavailable")


class BackendCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.settings = Settings(
            project_root=root,
            data_root=root / "runtime-data" / "mirrorlight",
            max_upload_bytes=2 * 1024 * 1024,
            max_upload_files=20,
            max_top_k=20,
            max_index_file_bytes=1024,
            max_cached_indexes=1,
        )
        self.settings.ensure_runtime_dirs()
        self.service = RagService(self.settings)
        self.importer = VaultImporter(self.settings, self.service.pockets)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _tamper_current_index(self, key: str, mutate: Callable[[dict], None]) -> None:
        root = self.service.index_store._key_root(key)
        pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
        generation_root = root / pointer["generation"]
        index_path = generation_root / "index.json"
        manifest_path = generation_root / "manifest.json"
        stored_index = json.loads(index_path.read_text(encoding="utf-8"))
        mutate(stored_index)
        serialized = json.dumps(
            stored_index,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
        index_path.write_bytes(serialized)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["serialized_bytes"] = len(serialized)
        manifest["index_sha256"] = hashlib.sha256(serialized).hexdigest()
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    def test_invalid_environment_configuration_fails_visibly(self) -> None:
        for name, value in (
            ("MIRRORLIGHT_MAX_TOP_K", "many"),
            ("MIRRORLIGHT_MAX_TOP_K", "0"),
            ("MIRRORLIGHT_DEBUG_ERRORS", "sometimes"),
            ("MIRRORLIGHT_TRUSTED_HOSTS", "*"),
            ("MIRRORLIGHT_TRUSTED_ORIGINS", "null"),
        ):
            with self.subTest(name=name, value=value):
                with patch.dict(os.environ, {name: value}, clear=True):
                    with self.assertRaisesRegex(ValueError, name):
                        Settings.from_env(self.settings.project_root)

        with patch.dict(
            os.environ,
            {
                "MIRRORLIGHT_TRUSTED_HOSTS": "LOCALHOST, 127.0.0.1, localhost.",
                "MIRRORLIGHT_TRUSTED_ORIGINS": "HTTP://LOCALHOST:5173, http://127.0.0.1:5173/",
            },
            clear=True,
        ):
            normalized = Settings.from_env(self.settings.project_root)
        self.assertEqual(normalized.trusted_hosts, ("localhost", "127.0.0.1"))
        self.assertEqual(
            normalized.trusted_origins,
            ("http://localhost:5173", "http://127.0.0.1:5173"),
        )

        self.assertEqual(normalize_trusted_origin("HTTP://LOCALHOST"), "http://localhost:80")
        self.assertEqual(
            normalize_trusted_origin("https://[0:0:0:0:0:0:0:1]/"),
            "https://[::1]:443",
        )
        for origin in (
            "http://localhost:0",
            "http://localhost.:5173",
            "http://localhost:not-a-port",
            "http://localhost:65536",
            "http://user@localhost:5173",
            "http://localhost:5173/path",
        ):
            with self.subTest(origin=origin):
                with self.assertRaisesRegex(ValueError, "trusted origin"):
                    normalize_trusted_origin(origin)

        with self.assertRaisesRegex(ValueError, "between 1 and 65535"):
            Settings(
                project_root=self.settings.project_root,
                data_root=self.settings.data_root / "invalid-port",
                port=70_000,
            )
        with self.assertRaisesRegex(ValueError, "debug_errors"):
            Settings(
                project_root=self.settings.project_root,
                data_root=self.settings.data_root / "invalid-debug",
                debug_errors="yes",
            )
        for field, value in (
            ("max_top_k", 101),
            ("max_index_chunks", 50_001),
            ("max_query_chars", 4_001),
        ):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "rag-behavior-v2"):
                    Settings(
                        project_root=self.settings.project_root,
                        data_root=self.settings.data_root / f"invalid-{field}",
                        **{field: value},
                    )

    def test_search_rejects_invalid_unicode_before_index_build(self) -> None:
        with patch.object(
            self.service,
            "build_index",
            side_effect=AssertionError("invalid query reached index build"),
        ):
            with self.assertRaisesRegex(ValueError, "Unicode scalar"):
                self.service.search("\ud800", None, DEFAULT_POCKETS)

    def test_writer_lock_is_released_by_the_os_after_owner_process_exit(self) -> None:
        lock_path = self.settings.index_root / "subprocess" / ".writer.lock"
        backend_root = Path(__file__).resolve().parents[1]
        child_code = (
            "import sys, time\n"
            "from pathlib import Path\n"
            "sys.path.insert(0, sys.argv[3])\n"
            "from mirrorlight_backend.index_store import _ProcessFileLock\n"
            "with _ProcessFileLock(Path(sys.argv[1]), 5):\n"
            "    print('ready', flush=True)\n"
            "    time.sleep(20)\n"
        )
        process = subprocess.Popen(
            [sys.executable, "-c", child_code, str(lock_path), "20", str(backend_root)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertEqual(process.stdout.readline().strip(), "ready")
            with self.assertRaises(TimeoutError):
                with _ProcessFileLock(lock_path, 1):
                    pass

            process.kill()
            process.wait(timeout=5)
            self.assertTrue(lock_path.exists())
            with _ProcessFileLock(lock_path, 1):
                pass
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)

    def test_upload_paths_reject_posix_windows_and_nul_escapes(self) -> None:
        base = self.settings.uploads_root
        self.assertEqual(safe_upload_path(base, "nested/file.md"), base / "nested" / "file.md")
        for name in ("../escape.md", r"..\escape.md", r"C:\escape.md", "/escape.md", "bad\x00.md"):
            with self.subTest(name=name):
                with self.assertRaises(UnsafePathError):
                    safe_upload_path(base, name)

    def test_upload_paths_reject_windows_names_and_alias_collisions(self) -> None:
        base = self.settings.uploads_root
        for name in (
            "CON.txt",
            "folder/CON",
            "file.txt:secret",
            "name.",
            "name ",
            "foo<bar",
        ):
            with self.subTest(name=name):
                with self.assertRaises(UnsafePathError):
                    safe_upload_path(base, name)

        self.assertEqual(
            safe_upload_key("Docs/Readme.md"),
            safe_upload_key("docs/readme.md"),
        )
        self.assertEqual(safe_upload_key("Ｆoo.md"), safe_upload_key("Foo.md"))
        self.assertTrue(upload_keys_conflict("foo", {"foo/bar"}))
        self.assertTrue(upload_keys_conflict("foo/bar", {"foo"}))
        self.assertFalse(upload_keys_conflict("foo", {"foobar"}))

    def test_same_filename_in_vault_and_lore_keeps_distinct_document_ids(self) -> None:
        self.service.create_companion("astra")
        vault_note = self.settings.companions_root / "astra" / "vault" / "note.md"
        lore_note = self.settings.companions_root / "astra" / "lore" / "note.md"
        vault_note.write_text("Vault context about retrieval", encoding="utf-8")
        lore_note.write_text("Lore context about history", encoding="utf-8")

        graph = self.service.graph("astra", DEFAULT_POCKETS)
        title_nodes = [node for node in graph["nodes"] if node.get("type") == "title"]
        note_nodes = [node for node in title_nodes if node.get("label") == "note.md"]

        self.assertEqual(len(note_nodes), 2)
        self.assertEqual(len({node["id"] for node in note_nodes}), 2)

    def test_vault_selection_does_not_implicitly_include_lore(self) -> None:
        self.service.create_companion("astra")
        vault_note = self.settings.companions_root / "astra" / "vault" / "only-vault.md"
        lore_note = self.settings.companions_root / "astra" / "lore" / "only-lore.md"
        vault_note.write_text("shared selection retrieval context", encoding="utf-8")
        lore_note.write_text("shared selection retrieval context", encoding="utf-8")

        vault_results = self.service.search("selection", "astra", ["vault"])["results"]
        explicit_results = self.service.search(
            "selection", "astra", ["vault", "lore"]
        )["results"]

        self.assertEqual({result["pocket"] for result in vault_results}, {"vault"})
        self.assertEqual({result["pocket"] for result in explicit_results}, {"vault", "lore"})

    def test_canonical_vault_id_collision_is_rejected_without_overwrite(self) -> None:
        first = self.settings.global_root / "Alpha Beta"
        second = self.settings.global_root / "alpha_beta"
        self.service.pockets.register_vault("global:Alpha Beta", first)

        with self.assertRaises(VaultIdentityCollisionError):
            self.service.pockets.register_vault("global:alpha_beta", second)

        self.assertEqual(
            self.service.pockets.vault_registry["global:alpha_beta"],
            first.resolve(),
        )

    def test_vault_registration_requires_a_stable_direct_child_identity(self) -> None:
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                self.service.pockets.register_vault(
                    "global:linked",
                    self.settings.global_root / "linked",
                )
        with self.assertRaisesRegex(ValueError, "direct child"):
            self.service.pockets.register_vault(
                "global:root",
                self.settings.global_root,
            )
        with self.assertRaisesRegex(ValueError, "direct child"):
            self.service.pockets.register_vault(
                "global:nested",
                self.settings.global_root / "outer" / "nested",
            )
        with self.assertRaisesRegex(ValueError, "must match"):
            self.service.pockets.register_vault(
                "global:alias",
                self.settings.global_root / "actual",
            )

        self.assertFalse((self.settings.global_root / "outer").exists())
        self.assertFalse((self.settings.global_root / "actual").exists())

    def test_build_uses_one_source_snapshot_for_fingerprint_and_indexing(self) -> None:
        document = self.settings.global_root / "snapshot.md"
        document.write_text("read once retrieval context", encoding="utf-8")
        indexer = RAGIndexer(self.service.pockets)
        paths = self.service.resolve_paths(None, ["global"])
        inventory = indexer.inventory(paths)

        self.assertEqual(len(inventory), 1)
        self.assertIsNotNone(inventory[0].snapshot)
        self.assertEqual(inventory[0].snapshot.text, "read once retrieval context")

        with patch.object(Path, "read_bytes", side_effect=AssertionError("source reread")):
            index = self.service.build_index(None, ["global"])

        self.assertTrue(index["docs"])

    def test_indexed_results_expose_scope_and_source_authority_class(self) -> None:
        global_note = self.settings.global_root / "shared.md"
        global_note.write_text("Global retrieval context", encoding="utf-8")
        global_result = self.service.search("retrieval", None, ["global"])["results"][0]
        self.assertEqual(global_result["scope"], "global")
        self.assertEqual(global_result["authority"], "global_record")
        self.assertEqual(global_result["provenance"]["source_id"], global_result["source_id"])

        self.service.create_companion("astra")
        companion_note = self.settings.companions_root / "astra" / "vault" / "private.md"
        companion_note.write_text("Private companion retrieval context", encoding="utf-8")
        companion_result = self.service.search("private", "astra", ["vault"])["results"][0]
        self.assertEqual(companion_result["scope"], "persona:astra")
        self.assertEqual(companion_result["authority"], "persona_vault")
        self.assertEqual(companion_result["provenance"]["scope"], "persona:astra")

        graph = self.service.graph("astra", ["vault"])
        private_nodes = [node for node in graph["nodes"] if node.get("label") == "private.md"]
        self.assertTrue(private_nodes)
        self.assertEqual(private_nodes[0]["scope"], "persona:astra")
        self.assertEqual(private_nodes[0]["path"], "private.md")
        self.assertTrue(private_nodes[0]["source"].endswith("/vault"))

    def test_cancelled_index_operation_stops_before_work(self) -> None:
        token = CancellationToken()
        token.cancel()
        with self.assertRaises(OperationCancelled):
            self.service.graph(None, ["global"], cancel_token=token)

    def test_different_scopes_build_in_parallel_and_same_scope_builds_once(self) -> None:
        for companion_id in ("astra", "beatrice", "cora"):
            self.service.create_companion(companion_id)
            note = self.settings.companions_root / companion_id / "vault" / "note.md"
            note.write_text(f"retrieval context for {companion_id}", encoding="utf-8")

        original_build = RAGIndexer.build
        tracker_lock = threading.Lock()
        active = 0
        peak = 0
        calls = 0

        def tracked_build(indexer: RAGIndexer, *args: object, **kwargs: object) -> dict:
            nonlocal active, peak, calls
            with tracker_lock:
                active += 1
                peak = max(peak, active)
                calls += 1
            try:
                time.sleep(0.08)
                return original_build(indexer, *args, **kwargs)
            finally:
                with tracker_lock:
                    active -= 1

        with patch.object(RAGIndexer, "build", tracked_build):
            with ThreadPoolExecutor(max_workers=2) as executor:
                different = list(
                    executor.map(
                        lambda companion: self.service.graph(companion, ["vault"]),
                        ("astra", "beatrice"),
                    )
                )
            self.assertEqual(len(different), 2)
            self.assertGreaterEqual(peak, 2)

            calls = 0
            with ThreadPoolExecutor(max_workers=2) as executor:
                same = list(
                    executor.map(
                        lambda _unused: self.service.graph("cora", ["vault"]),
                        (0, 1),
                    )
                )
            self.assertEqual(len(same), 2)
            self.assertEqual(calls, 1)

    def test_content_change_invalidates_fingerprint_even_when_mtime_is_restored(self) -> None:
        document = self.settings.global_root / "stable.md"
        document.write_text("alpha retrieval text", encoding="utf-8")
        first = self.service.graph(None, ["global"])["fingerprint"]
        original_stat = document.stat()

        document.write_text("beta retrieval text", encoding="utf-8")
        os.utime(document, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        second = self.service.graph(None, ["global"])["fingerprint"]

        self.assertNotEqual(first, second)
        results = self.service.search("beta", None, ["global"], top_k=5)
        self.assertTrue(results["results"])

    def test_empty_and_short_token_searches_are_safe(self) -> None:
        empty = self.service.search("anything", None, ["global"], top_k=5)
        self.assertEqual(empty["results"], [])
        self.assertEqual(empty["retrieval_mode"], "lexical-hybrid")
        document = self.settings.global_root / "short.md"
        document.write_text("AI", encoding="utf-8")
        short_token = self.service.search("AI", None, ["global"], top_k=5)
        self.assertEqual([item["text"] for item in short_token["results"]], ["AI"])
        self.assertEqual(short_token["retrieval_method"], "rag-behavior-v2")
        self.assertEqual(self.service.search("anything", None, ["global"], top_k=0)["results"], [])

    def test_search_scores_are_present_and_unmatched_queries_return_no_results(self) -> None:
        document = self.settings.global_root / "search.md"
        document.write_text("Retrieval context for a useful debugger", encoding="utf-8")

        matched = self.service.search("retrieval", None, ["global"], top_k=5)
        self.assertTrue(matched["results"])
        self.assertGreater(matched["results"][0]["score"], 0)
        self.assertLessEqual(matched["results"][0]["score"], 1)

        unmatched = self.service.search("zzzz fabricated", None, ["global"], top_k=5)
        self.assertEqual(unmatched["results"], [])

    def test_production_search_exposes_v2_contract_metadata(self) -> None:
        document = self.settings.global_root / "contract-search.md"
        document.write_text("Contract retrieval beacon", encoding="utf-8")

        response = self.service.search(
            "contract retrieval",
            None,
            ["global"],
            top_k=5,
            debug=True,
        )

        self.assertEqual(response["retrieval_method"], "rag-behavior-v2")
        self.assertEqual(response["semantic_state"], "disabled_by_settings")
        self.assertIsInstance(response["context_tokens"], int)
        self.assertIn("exact_micro", response["results"][0]["_debug"])
        self.assertIn("score_micro", response["results"][0]["_debug"])
        self.assertEqual(response["results"][0]["score_micro"], response["results"][0]["_debug"]["score_micro"])
        self.assertIn(response["results"][0]["match_type"], {"exact", "semantic", "keyword", "cross_reference"})
        self.assertIn("cross_reference_from_id", response["results"][0])

    def test_explicit_lexical_modes_skip_query_embedding_work(self) -> None:
        document = self.settings.global_root / "controlled-search.md"
        document.write_text("Controlled retrieval context", encoding="utf-8")
        provider = RecordingEmbeddingProvider()
        self.service.embedding_provider = provider
        self.service.embedding_error = None
        self.service.build_index(None, ["global"])
        provider.batch_sizes.clear()

        for mode in ("exact_only", "keyword_only"):
            with self.subTest(mode=mode):
                response = self.service.search(
                    "controlled retrieval",
                    None,
                    ["global"],
                    mode=mode,
                    max_context_tokens=100,
                    debug=True,
                )
                self.assertTrue(response["results"])
                self.assertEqual(response["semantic_state"], "not_requested")
                self.assertEqual(response["results"][0]["_debug"]["mode"], mode)

        self.assertEqual(provider.batch_sizes, [])
        self.service.search("controlled retrieval", None, ["global"], mode="hybrid")
        self.assertEqual(provider.batch_sizes, [1])

    def test_production_vector_fallback_is_request_local_under_concurrency(self) -> None:
        class SelectiveProvider:
            profile = "test:2"
            dimension = 2

            def embed(self, texts: list[str]) -> list[list[float]]:
                if len(texts) == 1 and texts[0].startswith("fail"):
                    raise EmbeddingError("request provider failure")
                return [[1.0, 0.0] for _ in texts]

        document = self.settings.global_root / "concurrent-vector.md"
        document.write_text("good retrieval context", encoding="utf-8")
        self.service.embedding_provider = SelectiveProvider()
        self.service.embedding_error = None
        self.service.build_index(None, ["global"])

        with ThreadPoolExecutor(max_workers=2) as executor:
            failed, succeeded = executor.map(
                lambda query: self.service.search(query, None, ["global"]),
                ["fail retrieval", "good retrieval"],
            )

        self.assertEqual(failed["retrieval_mode"], "lexical-fallback")
        self.assertEqual(failed["fallback_error"], "request provider failure")
        self.assertEqual(succeeded["retrieval_mode"], "vector-hybrid")
        self.assertIsNone(succeeded["fallback_error"])

    def test_force_refresh_invalidates_the_application_engine(self) -> None:
        document = self.settings.global_root / "forced-engine.md"
        document.write_text("forced engine refresh context", encoding="utf-8")
        self.service.search("refresh", None, ["global"])
        first_engine = next(iter(self.service._engines.values()))

        self.service.search("refresh", None, ["global"], force=True)
        second_engine = next(iter(self.service._engines.values()))

        self.assertIsNot(first_engine, second_engine)

    def test_memory_state_persists_and_can_disable_memory_retrieval(self) -> None:
        self.service.create_companion("astra")
        memory = self.service.pockets.memory_file("astra")
        memory.write_text(
            json.dumps({"memories": [{"content": "private memory context"}]}),
            encoding="utf-8",
        )
        self.assertTrue(self.service.search("private", "astra", ["memories"])["results"])

        self.assertFalse(self.service.set_memory_enabled(False))
        self.assertEqual(self.service.search("private", "astra", ["memories"])["results"], [])

        restarted = RagService(self.settings)
        self.assertFalse(restarted.pockets.memory_enabled)
        self.assertEqual(restarted.search("private", "astra", ["memories"])["results"], [])

    def test_assignments_persist_and_unknown_assignments_are_pruned(self) -> None:
        self.service.create_companion("astra")
        vault = self.settings.global_root / "shared"
        self.service.pockets.register_vault("global:shared", vault)
        self.service.pockets.assign_vaults("astra", ["global:shared"])

        restarted = RagService(self.settings)
        self.assertEqual(restarted.pockets.assignments, {"astra": ["global:shared"]})

        state = json.loads(restarted.pockets.state_path.read_text(encoding="utf-8"))
        state["assignments"]["astra"].append("global:missing")
        restarted.pockets.state_path.write_text(json.dumps(state), encoding="utf-8")
        refreshed = RagService(self.settings)
        self.assertEqual(refreshed.pockets.assignments, {"astra": ["global:shared"]})

    def test_global_assignments_exclude_unassigned_vaults_and_duplicate_chunks(self) -> None:
        self.service.create_companion("astra")
        (self.settings.global_root / "root.md").write_text(
            "loose global context",
            encoding="utf-8",
        )
        shared = self.settings.global_root / "shared"
        private = self.settings.global_root / "private"
        shared.mkdir()
        private.mkdir()
        (shared / "shared.md").write_text("assigned vault context", encoding="utf-8")
        (private / "private.md").write_text("unassigned secret context", encoding="utf-8")
        self.service.refresh()
        self.service.pockets.assign_vaults("astra", ["global:shared"])

        assigned = self.service.build_index("astra", ["global"])
        assigned_paths = [document["path"] for document in assigned["docs"]]
        self.assertEqual(assigned_paths, ["root.md", "shared.md"])
        assigned_chunks = [
            chunk
            for document in assigned["docs"]
            for chunk in document["chunks"]
        ]
        self.assertEqual(len(assigned_chunks), 2)
        self.assertEqual(
            len({chunk["id"] for chunk in assigned_chunks}),
            len(assigned_chunks),
        )
        self.assertEqual(
            self.service.search("unassigned secret", "astra", ["global"])["results"],
            [],
        )

        unscoped = self.service.build_index(None, ["global"])
        self.assertEqual(
            {document["path"] for document in unscoped["docs"]},
            {"root.md", "shared/shared.md", "private/private.md"},
        )

    def test_malformed_runtime_state_fails_closed(self) -> None:
        state_path = self.settings.data_root / "state.json"
        state_path.write_text("{not-json", encoding="utf-8")

        service = RagService(self.settings)
        self.assertFalse(service.pockets.memory_enabled)
        self.assertEqual(service.pockets.assignments, {})

        state_path.write_text(
            json.dumps({"version": 1, "memory_enabled": "false", "assignments": {}}),
            encoding="utf-8",
        )
        typed_service = RagService(self.settings)
        self.assertFalse(typed_service.pockets.memory_enabled)
        self.assertEqual(typed_service.pockets.assignments, {})

    def test_aggregate_index_limit_is_enforced(self) -> None:
        limited_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "limited",
            max_index_file_bytes=1024,
            max_index_total_bytes=10,
            max_index_files=10,
        )
        limited_settings.ensure_runtime_dirs()
        (limited_settings.global_root / "one.md").write_text("123456", encoding="utf-8")
        (limited_settings.global_root / "two.md").write_text("123456", encoding="utf-8")
        service = RagService(limited_settings)

        with self.assertRaisesRegex(ValueError, "byte limit"):
            service.graph(None, ["global"])

    def test_oversized_source_is_rejected_instead_of_silently_skipped(self) -> None:
        oversized = self.settings.global_root / "oversized.md"
        oversized.write_text("x" * 2048, encoding="utf-8")

        with self.assertRaisesRegex(IndexLimitError, "file limit"):
            self.service.graph(None, ["global"])

    def test_embedding_calls_are_batched_for_large_indexes(self) -> None:
        vector_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "batched-vectors",
            max_embedding_batch=2,
        )
        vector_settings.ensure_runtime_dirs()
        for index in range(5):
            (vector_settings.global_root / f"doc-{index}.md").write_text(
                f"retrieval context {index}", encoding="utf-8"
            )

        service = RagService(vector_settings)
        indexer = RAGIndexer(service.pockets)
        paths = service.resolve_paths(None, ["global"])
        provider = RecordingEmbeddingProvider()
        index = indexer.build(paths, indexer.inventory(paths), provider)

        self.assertEqual(provider.batch_sizes, [2, 2, 1])
        self.assertEqual(len(index["embeddings"]), 5)

    def test_chunk_limit_stops_construction_before_the_rest_of_the_pocket(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "early-chunk-limit",
            max_index_chunks=1,
        )
        settings.ensure_runtime_dirs()
        (settings.global_root / "sections.md").write_text(
            "## One\nfirst context\n## Two\nsecond context\n## Three\nthird context",
            encoding="utf-8",
        )
        service = RagService(settings)
        indexer = RAGIndexer(service.pockets)
        paths = service.resolve_paths(None, ["global"])

        with self.assertRaisesRegex(IndexLimitError, "chunk limit"):
            indexer.build(paths, indexer.inventory(paths))

        built_chunks = [
            data
            for _node_id, data in indexer.graph.nodes(data=True)
            if data.get("type") != "title"
        ]
        self.assertEqual(len(built_chunks), 1)

    def test_ready_vectors_use_a_checked_sidecar_artifact(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "vector-sidecar",
            embedding_dimension=2,
        )
        settings.ensure_runtime_dirs()
        (settings.global_root / "vector.md").write_text(
            "durable vector retrieval context", encoding="utf-8"
        )
        service = RagService(settings)
        service.embedding_provider = RecordingEmbeddingProvider()
        service.embedding_error = None
        index = service.build_index(None, ["global"])
        key = service._cache_key(None, ["global"], index["fingerprint"], "test:2")
        root = service.index_store._key_root(key)
        pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
        generation_root = root / pointer["generation"]
        stored_index = json.loads((generation_root / "index.json").read_text(encoding="utf-8"))
        manifest = json.loads((generation_root / "manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(stored_index["embeddings"], [])
        self.assertEqual(manifest["vectors"]["file"], "vectors.bin")
        loaded = IndexStore(settings).load(key, service._scope_key(None, ["global"], "test:2"))
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["embeddings"].shape, (len(index["embeddings"]), 2))
        self.assertEqual(loaded["embeddings"].dtype, np.dtype("<f4"))
        self.assertTrue(np.allclose(loaded["embeddings"], index["embeddings"]))
        loaded["embeddings"]._mmap.close()

        vectors_path = generation_root / "vectors.bin"
        vectors_path.write_bytes(vectors_path.read_bytes() + b"x")
        self.assertIsNone(IndexStore(settings).load(key, service._scope_key(None, ["global"], "test:2")))

    def test_unheaded_documents_are_split_by_character_and_token_budgets(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "chunk-bounds",
            max_chunk_chars=80,
            max_chunk_tokens=12,
        )
        settings.ensure_runtime_dirs()
        document = settings.global_root / "long.md"
        document.write_text(" ".join(f"token-{index}" for index in range(60)), encoding="utf-8")

        index = RagService(settings).build_index(None, ["global"])
        chunks = [
            chunk
            for document in index["docs"]
            for chunk in document["chunks"]
        ]

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk["text"]) <= 80 for chunk in chunks))
        self.assertTrue(all(len(chunk["text"].split()) <= 12 for chunk in chunks))

    def test_production_markdown_indexing_uses_the_frozen_portable_records(self) -> None:
        content = (
            "\ufeff---\r\ntitle: ignored\r\n---\r\n"
            "# Alpha\r\nFirst [[Beta|label]].\r\n## Beta\r\nSecond."
        )
        source = self.settings.global_root / "guide.md"
        source.write_bytes(content.encode("utf-8"))

        index = self.service.build_index(None, ["global"])
        actual = [
            chunk
            for document in index["docs"]
            for chunk in document["chunks"]
        ]
        expected = index_document(
            content,
            format="markdown",
            path="guide.md",
            pocket="global",
            scopes=("global",),
            authority="global_record",
        ).records

        self.assertEqual([chunk["id"] for chunk in actual], [record.id for record in expected])
        self.assertEqual([chunk["text"] for chunk in actual], [record.text for record in expected])
        self.assertEqual(
            [chunk["source_id"] for chunk in actual],
            [record.source_id for record in expected],
        )
        self.assertEqual(
            [
                (
                    chunk["text_start"],
                    chunk["text_end"],
                    chunk["heading"],
                    chunk["heading_level"],
                    chunk["reference_targets"],
                )
                for chunk in actual
            ],
            [
                (
                    record.metadata["text_start"],
                    record.metadata["text_end"],
                    record.metadata["heading"],
                    record.metadata["heading_level"],
                    record.metadata["reference_targets"],
                )
                for record in expected
            ],
        )
        self.assertTrue(all(chunk["indexing_contract"] == "rag-indexing-v1" for chunk in actual))

    def test_invalid_utf8_source_fails_visibly(self) -> None:
        (self.settings.global_root / "invalid.md").write_bytes(b"valid\n\xffinvalid")

        with self.assertRaisesRegex(SourceEncodingError, "not valid UTF-8"):
            self.service.build_index(None, ["global"])

    def test_indexing_settings_cannot_exceed_the_portable_profile(self) -> None:
        invalid_settings = {
            "max_index_file_bytes": MAX_SOURCE_UTF8_BYTES + 1,
            "max_chunk_chars": MAX_CHUNK_CHARS + 1,
            "max_chunk_tokens": MAX_CHUNK_TOKENS + 1,
        }
        for name, value in invalid_settings.items():
            with self.subTest(name=name), self.assertRaisesRegex(
                ValueError, "rag-indexing-v1"
            ):
                Settings(
                    project_root=self.settings.project_root,
                    data_root=self.settings.data_root / f"oversized-{name}",
                    **{name: value},
                )

    def test_memory_entries_are_split_by_the_same_chunk_budgets(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "memory-chunk-bounds",
            max_chunk_chars=60,
            max_chunk_tokens=8,
        )
        settings.ensure_runtime_dirs()
        service = RagService(settings)
        service.create_companion("astra")
        service.pockets.memory_file("astra").write_text(
            json.dumps({"memories": [{"content": " ".join(f"memory-{index}" for index in range(30))}]}),
            encoding="utf-8",
        )

        index = service.build_index("astra", ["memories"])
        chunks = [chunk for document in index["docs"] for chunk in document["chunks"]]

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk["text"]) <= 60 for chunk in chunks))
        self.assertTrue(all(len(chunk["text"].split()) <= 8 for chunk in chunks))

    def test_durable_index_generation_is_reused_after_restart(self) -> None:
        document = self.settings.global_root / "durable.md"
        document.write_text("durable retrieval context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        restarted = RagService(self.settings)
        second = restarted.build_index(None, ["global"])

        self.assertEqual(first["generation"], second["generation"])
        self.assertEqual(second["cache_origin"], "disk")

    def test_durable_index_checksum_rejects_tampered_generation(self) -> None:
        document = self.settings.global_root / "checksum.md"
        document.write_text("checksum retrieval context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        root = self.service.index_store._key_root(key)
        pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
        generation_root = root / pointer["generation"]
        manifest = json.loads((generation_root / "manifest.json").read_text(encoding="utf-8"))
        self.assertRegex(manifest["index_sha256"], r"^[0-9a-f]{64}$")

        index_path = generation_root / "index.json"
        index_path.write_bytes(index_path.read_bytes() + b" ")

        self.assertIsNone(IndexStore(self.settings).load(key, self.service._scope_key(None, ["global"])))

    def test_deleted_source_gets_a_new_empty_generation(self) -> None:
        document = self.settings.global_root / "deleted.md"
        document.write_text("deletion reconciliation context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        document.unlink()

        second = RagService(self.settings).build_index(None, ["global"])
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])
        self.assertEqual(second["docs"], [])

    def test_durable_retention_is_bounded_across_fingerprint_changes(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "retention",
            max_index_generations=2,
        )
        settings.ensure_runtime_dirs()
        document = settings.global_root / "changing.md"
        service = RagService(settings)

        for value in ("one", "two", "three", "four", "five"):
            document.write_text(f"{value} durable retrieval context", encoding="utf-8")
            service.build_index(None, ["global"])

        roots = [
            path
            for path in settings.index_root.iterdir()
            if path.is_dir() and not path.name.startswith(".")
        ]
        self.assertEqual(len(roots), 1)
        generations = [
            path for path in roots[0].iterdir() if path.is_dir() and not path.name.startswith(".")
        ]
        self.assertLessEqual(len(generations), settings.max_index_generations)
        pointer = json.loads((roots[0] / "current.json").read_text(encoding="utf-8"))
        self.assertTrue((roots[0] / pointer["generation"]).is_dir())

    def test_pointer_failure_removes_promoted_orphan_generation(self) -> None:
        document = self.settings.global_root / "pointer-failure.md"
        document.write_text("pointer failure retrieval context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        original_write_json = IndexStore._write_json

        def fail_current(path: Path, payload: dict) -> None:
            if path.name == "current.json":
                raise OSError("pointer write failed")
            original_write_json(path, payload)

        with patch.object(IndexStore, "_write_json", side_effect=fail_current):
            with self.assertRaises(OSError):
                self.service.build_index(None, ["global"], force=True)

        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        root = self.service.index_store._key_root(key)
        generations = [
            path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")
        ]
        self.assertEqual([path.name for path in generations], [first["generation"]])
        self.assertEqual(list(root.glob(".staging-*")), [])

    def test_retention_protects_the_current_generation_when_timestamps_match(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "same-millisecond-retention",
            max_index_generations=2,
        )
        settings.ensure_runtime_dirs()
        document = settings.global_root / "changing.md"
        service = RagService(settings)

        with patch("mirrorlight_backend.index_store.time.time", return_value=1234.0):
            for value in ("one", "two", "three", "four", "five"):
                document.write_text(f"{value} durable retrieval context", encoding="utf-8")
                service.build_index(None, ["global"])

        key = service._cache_key(None, ["global"], service.build_index(None, ["global"])["fingerprint"], "disabled")
        root = service.index_store._key_root(key)
        generations = [
            path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")
        ]
        pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
        self.assertLessEqual(len(generations), settings.max_index_generations)
        self.assertTrue((root / pointer["generation"]).is_dir())

    def test_retention_does_not_become_unbounded_for_a_missing_current_pointer(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "missing-current-retention",
            max_index_generations=3,
        )
        settings.ensure_runtime_dirs()
        document = settings.global_root / "changing.md"
        service = RagService(settings)

        for value in ("one", "two", "three"):
            document.write_text(f"{value} durable retrieval context", encoding="utf-8")
            service.build_index(None, ["global"])

        latest = service.build_index(None, ["global"])
        key = service._cache_key(None, ["global"], latest["fingerprint"], "disabled")
        root = service.index_store._key_root(key)
        (root / "current.json").write_text(
            json.dumps({"schema_version": 1, "key": key, "generation": "9999999999-deadbeef"}),
            encoding="utf-8",
        )
        constrained = Settings(
            project_root=settings.project_root,
            data_root=settings.data_root,
            max_index_generations=1,
        )

        IndexStore(constrained)._trim(root)

        generations = [
            path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")
        ]
        self.assertLessEqual(len(generations), constrained.max_index_generations)

    def test_retention_preserves_unrecognized_directories(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "retention-unknown-directory",
            max_index_generations=1,
        )
        settings.ensure_runtime_dirs()
        document = settings.global_root / "changing.md"
        document.write_text("first generation", encoding="utf-8")
        service = RagService(settings)
        first = service.build_index(None, ["global"])
        key = service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        key_root = service.index_store._key_root(key)
        unknown = key_root / "operator-notes"
        unknown.mkdir()

        document.write_text("second generation", encoding="utf-8")
        service.build_index(None, ["global"])

        self.assertTrue(unknown.is_dir())
        generations = [
            path
            for path in key_root.iterdir()
            if path.is_dir() and service.index_store._GENERATION_RE.fullmatch(path.name)
        ]
        self.assertEqual(len(generations), 1)

    def test_persisted_index_above_current_chunk_limit_is_rejected(self) -> None:
        document = self.settings.global_root / "bounded-load.md"
        document.write_text("## One\nfirst context\n## Two\nsecond context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        constrained = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root,
            max_index_chunks=1,
        )
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        self.assertIsNone(IndexStore(constrained).load(key, self.service._scope_key(None, ["global"])))

    def test_persisted_index_above_current_serialized_limit_is_rejected(self) -> None:
        document = self.settings.global_root / "bounded-load-bytes.md"
        document.write_text("serialized retrieval context " * 20, encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        constrained = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root,
            max_serialized_index_bytes=1,
        )
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        self.assertIsNone(IndexStore(constrained).load(key, self.service._scope_key(None, ["global"])))

    def test_persisted_index_rejects_malformed_nested_document_shape(self) -> None:
        document = self.settings.global_root / "malformed-nested.md"
        document.write_text("nested validation context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")

        def corrupt_chunks(index: dict) -> None:
            index["docs"][0]["chunks"] = "not-an-array"

        self._tamper_current_index(key, corrupt_chunks)

        self.assertIsNone(
            IndexStore(self.settings).load(
                key,
                self.service._scope_key(None, ["global"]),
            )
        )

    def test_persisted_index_rejects_graph_view_disagreement(self) -> None:
        document = self.settings.global_root / "malformed-graph.md"
        document.write_text("graph validation context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")

        def remove_graph_links(index: dict) -> None:
            index["graph_data"]["links"] = []

        self._tamper_current_index(key, remove_graph_links)

        self.assertIsNone(
            IndexStore(self.settings).load(
                key,
                self.service._scope_key(None, ["global"]),
            )
        )

    def test_persisted_index_rejects_malformed_graph_adjacency(self) -> None:
        document = self.settings.global_root / "malformed-adjacency.md"
        document.write_text("adjacency validation context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")

        def break_adjacency(index: dict) -> None:
            first_node = next(iter(index["graph"]))
            index["graph"][first_node] = []

        self._tamper_current_index(key, break_adjacency)

        self.assertIsNone(
            IndexStore(self.settings).load(
                key,
                self.service._scope_key(None, ["global"]),
            )
        )

    def test_serialized_index_limit_is_enforced_before_promotion(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "serialized-limit",
            max_serialized_index_bytes=100,
        )
        settings.ensure_runtime_dirs()
        (settings.global_root / "large.md").write_text("serialized retrieval context " * 20, encoding="utf-8")

        with self.assertRaises(IndexStoreLimitError):
            RagService(settings).build_index(None, ["global"])

    def test_failing_embedding_provider_reuses_the_fallback_cache_identity(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "embedding-fallback-cache",
            embedding_mode="hash",
            embedding_dimension=2,
        )
        settings.ensure_runtime_dirs()
        (settings.global_root / "fallback.md").write_text(
            "lexical fallback cache context", encoding="utf-8"
        )
        service = RagService(settings)
        provider = FailingEmbeddingProvider()
        service.embedding_provider = provider
        service.embedding_error = None

        first = service.build_index(None, ["global"])
        second = service.build_index(None, ["global"])

        self.assertEqual(first["embedding"]["status"], "error")
        self.assertEqual(first["embedding"]["profile"], "error:hash:")
        self.assertEqual(first["generation"], second["generation"])
        self.assertEqual(provider.calls, 1)

    def test_corrupt_index_pointer_is_ignored_without_path_traversal(self) -> None:
        document = self.settings.global_root / "pointer.md"
        document.write_text("safe pointer context", encoding="utf-8")
        first = self.service.build_index(None, ["global"])
        key = self.service._cache_key(None, ["global"], first["fingerprint"], "disabled")
        pointer = self.service.index_store._key_root(key) / "current.json"
        pointer.write_text(
            json.dumps({"schema_version": 1, "key": key, "generation": ".."}),
            encoding="utf-8",
        )

        rebuilt = RagService(self.settings).build_index(None, ["global"])

        self.assertEqual(rebuilt["cache_origin"], "disk")
        self.assertEqual(rebuilt["generation"], first["generation"])

    def test_hash_embedding_mode_is_real_and_optional(self) -> None:
        vector_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "vectors",
            embedding_mode="hash",
            embedding_dimension=16,
        )
        vector_settings.ensure_runtime_dirs()
        (vector_settings.global_root / "vector.md").write_text(
            "semantic retrieval prototype context", encoding="utf-8"
        )
        service = RagService(vector_settings)

        result = service.search("semantic", None, ["global"])
        self.assertEqual(result["embedding"]["status"], "ready")
        self.assertEqual(result["retrieval_mode"], "vector-hybrid")
        self.assertTrue(result["results"])

        restarted = RagService(vector_settings).search("semantic", None, ["global"])
        self.assertEqual(restarted["semantic_state"], "ready")
        self.assertEqual(restarted["retrieval_mode"], "vector-hybrid")
        self.assertTrue(restarted["results"])

    def test_graph_response_is_bounded_and_describes_truncation(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "graph-response",
            max_graph_response_nodes=2,
            max_graph_response_links=1,
        )
        settings.ensure_runtime_dirs()
        for index in range(3):
            (settings.global_root / f"graph-{index}.md").write_text(
                f"graph response retrieval context {index}", encoding="utf-8"
            )

        graph = RagService(settings).graph(None, ["global"])
        metadata = graph["graph_meta"]
        visible_ids = {node["id"] for node in graph["nodes"]}
        self.assertTrue(metadata["truncated"])
        self.assertEqual(len(graph["nodes"]), 2)
        self.assertLessEqual(len(graph["links"]), 1)
        self.assertEqual(metadata["returned_nodes"], len(graph["nodes"]))
        self.assertTrue(
            all(link["source"] in visible_ids and link["target"] in visible_ids for link in graph["links"])
        )

    def test_search_honors_configured_top_k_and_source_diversity_cap(self) -> None:
        settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "large-top-k",
            max_top_k=100,
            max_index_file_bytes=10000,
            max_index_total_bytes=20000,
            max_index_chunks=200,
            max_graph_nodes=500,
            max_graph_links=500,
        )
        settings.ensure_runtime_dirs()
        sections = "\n".join(
            f"## Section {index}\nretrieval context {index}" for index in range(105)
        )
        (settings.global_root / "many-sections.md").write_text(sections, encoding="utf-8")

        result = RagService(settings).search("retrieval", None, ["global"], top_k=100)

        self.assertEqual(len(result["results"]), 2)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["retrieval_method"], "rag-behavior-v2")

    def test_invalid_embedding_configuration_is_visible_and_lexical(self) -> None:
        invalid_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "invalid-embedding",
            embedding_mode="unknown-provider",
        )
        invalid_settings.ensure_runtime_dirs()
        (invalid_settings.global_root / "fallback.md").write_text(
            "lexical fallback retrieval context", encoding="utf-8"
        )

        result = RagService(invalid_settings).search("fallback", None, ["global"])

        self.assertEqual(result["embedding"]["status"], "error")
        self.assertEqual(result["retrieval_mode"], "lexical-fallback")
        self.assertTrue(result["results"])

    def test_vector_validation_rejects_invalid_provider_output(self) -> None:
        with self.assertRaises(EmbeddingError):
            validate_vectors([[0.0, 0.0]], expected_dimension=2)
        with self.assertRaises(EmbeddingError):
            validate_vectors([[1.0, 0.0], [1.0, 0.0, 0.0]], expected_dimension=2)
        with self.assertRaises(EmbeddingError):
            validate_vectors([[float("nan"), 1.0]], expected_dimension=2)

    def test_companion_creation_rolls_back_on_metadata_failure(self) -> None:
        with patch("mirrorlight_backend.pockets._write_json_atomic", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.service.create_companion("rollback")

        self.assertFalse((self.settings.companions_root / "rollback").exists())
        self.assertEqual(list(self.settings.companions_root.glob(".staging-*")), [])

        with patch.object(self.service.pockets, "refresh", side_effect=OSError("refresh failed")):
            with self.assertRaises(OSError):
                self.service.create_companion("refresh-rollback")

        self.assertFalse((self.settings.companions_root / "refresh-rollback").exists())
        self.assertEqual(list(self.settings.companions_root.glob(".staging-*")), [])

    def test_companion_identity_collisions_are_consistent_across_filesystems(self) -> None:
        self.service.create_companion("Astra")

        with self.assertRaisesRegex(FileExistsError, "already exists"):
            self.service.create_companion("astra")

        self.assertEqual(self.importer._unique_id("astra"), "astra-2")
        self.assertEqual(self.service.list_companions(), ["Astra"])

    def test_import_rolls_back_when_memory_write_fails(self) -> None:
        archive_path = self.settings.uploads_root / "rollback.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("vault/notes.md", "import rollback context")

        original_write_text = Path.write_text

        def fail_memory_write(path: Path, data: str, *args, **kwargs):
            if path.name.endswith(".memory.json"):
                raise OSError("disk full")
            return original_write_text(path, data, *args, **kwargs)

        with patch.object(Path, "write_text", autospec=True, side_effect=fail_memory_write):
            with self.assertRaises(OSError):
                self.importer.import_zip(archive_path, preferred_id="rollback")

        self.assertFalse((self.settings.companions_root / "rollback").exists())
        self.assertEqual(list(self.settings.uploads_root.glob("unz_*")), [])

        refresh_archive = self.settings.uploads_root / "refresh-rollback.zip"
        with zipfile.ZipFile(refresh_archive, "w") as archive:
            archive.writestr("vault/notes.md", "refresh rollback context")
        with patch.object(self.importer.pockets, "refresh", side_effect=OSError("refresh failed")):
            with self.assertRaises(OSError):
                self.importer.import_zip(refresh_archive, preferred_id="refresh-rollback")

        self.assertFalse((self.settings.companions_root / "refresh-rollback").exists())
        self.assertEqual(list(self.settings.uploads_root.glob("unz_*")), [])

    def test_unknown_pockets_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown pocket"):
            self.service.graph(None, ["global", "private"])

    def test_non_object_memory_files_are_not_indexed_as_empty_chunks(self) -> None:
        self.service.create_companion("astra")
        memory = self.service.pockets.memory_file("astra")
        memory.write_text("[]", encoding="utf-8")

        memory_graph = self.service.graph("astra", ["memories"])

        self.assertEqual(memory_graph["nodes"], [])

    def test_blank_sections_and_memory_entries_are_skipped_and_bad_timestamps_are_safe(self) -> None:
        document = self.settings.global_root / "sections.md"
        document.write_text("## Empty\n\n## Filled\nUseful retrieval context.", encoding="utf-8")

        graph = self.service.graph(None, ["global"])
        chunks = [node for node in graph["nodes"] if node.get("type") == "chunk"]
        self.assertEqual(
            [chunk["text"] for chunk in chunks],
            ["## Filled\nUseful retrieval context."],
        )

        self.service.create_companion("astra")
        memory = self.service.pockets.memory_file("astra")
        memory.write_text(
            json.dumps(
                {
                    "memories": [
                        {"content": "Memory retrieval context", "timestamp": "invalid"},
                        {"content": "   ", "timestamp": "also invalid"},
                    ]
                }
            ),
            encoding="utf-8",
        )
        search = self.service.search("memory", "astra", ["memories"], top_k=5)
        self.assertTrue(search["results"])

    def test_cache_and_contract_engine_remain_bounded_when_fingerprints_change(self) -> None:
        document = self.settings.global_root / "changing.md"
        document.write_text("first retrieval text", encoding="utf-8")
        self.service.search("first", None, ["global"], top_k=5)
        document.write_text("second retrieval text", encoding="utf-8")
        self.service.search("second", None, ["global"], top_k=5)

        self.assertLessEqual(len(self.service._cache), 1)
        self.assertLessEqual(len(self.service._engines), 1)

    def test_refresh_tolerates_a_runtime_directory_removed_during_use(self) -> None:
        shutil.rmtree(self.settings.companions_root)
        shutil.rmtree(self.settings.global_root)

        self.assertEqual(self.service.list_companions(), [])

    def test_zip_import_is_indexed_and_warms_a_fingerprint(self) -> None:
        archive_path = self.settings.uploads_root / "astra.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("vault/MIND.md", "# Astra\n\nName: Astra\nA retrieval companion.")
            archive.writestr("vault/notes/intro.md", "## Retrieval\nUseful context for search.")

        result = self.importer.import_zip(archive_path, preferred_id="astra")
        self.assertEqual(result["id"], "astra")
        self.assertIn("Name: Astra", result["persona"])
        self.assertEqual(self.service.list_companions(), ["astra"])

        graph = self.service.graph("astra", DEFAULT_POCKETS)
        search = self.service.search("context", "astra", DEFAULT_POCKETS, top_k=5)
        self.assertTrue(graph["nodes"])
        self.assertTrue(search["results"])
        self.assertEqual(len(list(self.settings.uploads_root.glob("unz_*"))), 0)

    def test_zip_import_rejects_casefolded_and_ancestor_collisions(self) -> None:
        duplicate_archive = self.settings.uploads_root / "duplicate-paths.zip"
        with zipfile.ZipFile(duplicate_archive, "w") as archive:
            archive.writestr("vault/notes.md", "first")
            archive.writestr("VAULT/NOTES.MD", "second")

        with self.assertRaises(ImportErrorBase):
            self.importer.import_zip(duplicate_archive, preferred_id="duplicate")
        self.assertEqual(list(self.settings.uploads_root.glob("unz_*")), [])

        conflict_archive = self.settings.uploads_root / "ancestor-paths.zip"
        with zipfile.ZipFile(conflict_archive, "w") as archive:
            archive.writestr("vault", "file ancestor")
            archive.writestr("vault/child.md", "descendant")

        with self.assertRaises(ImportErrorBase):
            self.importer.import_zip(conflict_archive, preferred_id="conflict")
        self.assertEqual(list(self.settings.uploads_root.glob("unz_*")), [])

    def test_oversized_persona_metadata_is_not_read_unbounded(self) -> None:
        archive_path = self.settings.uploads_root / "large-persona.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("large-persona/MIND.md", "Name: Should Not Be Read\n" + "x" * 2048)
            archive.writestr("large-persona/notes.md", "bounded import context")

        result = self.importer.import_zip(archive_path)

        self.assertEqual(result["id"], "large-persona")
        self.assertEqual(result["persona"], "")
        self.assertTrue(
            (self.settings.companions_root / "large-persona" / "vault" / "notes.md").exists()
        )

    def test_malicious_zip_is_rejected_and_staging_is_removed(self) -> None:
        archive_path = self.settings.uploads_root / "bad.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("../escape.txt", "should not be extracted")

        with self.assertRaises(UnsafePathError):
            self.importer.import_zip(archive_path)

        self.assertFalse((self.settings.data_root / "escape.txt").exists())
        self.assertEqual(len(list(self.settings.uploads_root.glob("unz_*"))), 0)

    def test_invalid_zip_is_a_user_error_and_staging_is_removed(self) -> None:
        archive_path = self.settings.uploads_root / "invalid.zip"
        archive_path.write_bytes(b"not a zip archive")

        with self.assertRaises(ImportErrorBase):
            self.importer.import_zip(archive_path)

        self.assertEqual(len(list(self.settings.uploads_root.glob("unz_*"))), 0)

    def test_companion_ids_are_normalized_for_queries(self) -> None:
        self.service.create_companion("astra")
        note = self.settings.companions_root / "astra" / "vault" / "note.md"
        note.write_text("Normalized companion query context", encoding="utf-8")

        graph = self.service.graph("  astra  ", ["vault"])
        self.assertEqual(graph["companion_id"], "astra")
        self.assertTrue(graph["nodes"])

    def test_folder_import_is_contained_and_moves_the_staged_folder(self) -> None:
        stage = self.settings.uploads_root / "stage" / "folder"
        stage.mkdir(parents=True)
        (stage / "MIND.md").write_text("Name: Folder Agent", encoding="utf-8")
        (stage / "notes.md").write_text("Folder import context", encoding="utf-8")

        result = self.importer.import_folder(stage)
        self.assertEqual(result["id"], "folder-agent")
        self.assertFalse(stage.exists())
        self.assertTrue((self.settings.companions_root / "folder-agent" / "vault" / "notes.md").exists())

        with self.assertRaises(ImportErrorBase):
            self.importer.import_folder(self.settings.uploads_root)
        self.assertTrue(self.settings.uploads_root.exists())

    def test_folder_import_rejects_invalid_utf8_persona_and_cleans_stage(self) -> None:
        stage = self.settings.uploads_root / "invalid-persona"
        stage.mkdir(parents=True)
        (stage / "MIND.md").write_bytes(b"Name: Damaged\n\xff")

        with self.assertRaisesRegex(ImportErrorBase, "not valid UTF-8"):
            self.importer.import_folder(stage)

        self.assertFalse(stage.exists())
        self.assertFalse((self.settings.companions_root / "damaged").exists())
        self.assertEqual(list(self.settings.companions_root.glob(".staging-*")), [])

    def test_folder_import_reports_unreadable_persona_and_cleans_stage(self) -> None:
        stage = self.settings.uploads_root / "unreadable-persona"
        stage.mkdir(parents=True)
        (stage / "MIND.md").write_text("Name: Unreadable", encoding="utf-8")

        with patch.object(Path, "read_text", side_effect=OSError("access denied")):
            with self.assertRaisesRegex(ImportErrorBase, "could not be read"):
                self.importer.import_folder(stage)

        self.assertFalse(stage.exists())
        self.assertFalse((self.settings.companions_root / "unreadable").exists())
        self.assertEqual(list(self.settings.companions_root.glob(".staging-*")), [])


if __name__ == "__main__":
    unittest.main()
