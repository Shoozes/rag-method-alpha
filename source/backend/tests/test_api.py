from __future__ import annotations

import asyncio
import io
import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

import uvicorn

from mirrorlight_backend.app import _run_with_disconnect, create_app
from mirrorlight_backend.config import Settings


class ApiRouteTests(unittest.TestCase):
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
            max_graph_response_nodes=2,
            max_graph_response_links=1,
        )
        self.app = create_app(self.settings)
        self.server, self.thread, self.port = self._start_server(self.app)

    def tearDown(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)
        self.temp_dir.cleanup()

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def _start_server(
        self,
        app: Any,
    ) -> tuple[uvicorn.Server, threading.Thread, int]:
        port = self._free_port()
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=port,
                log_level="error",
                lifespan="off",
            )
        )
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.02)
        if not server.started:
            server.should_exit = True
            thread.join(timeout=5)
            self.fail("API server did not start")
        return server, thread, port

    def _request(
        self,
        path: str,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        body: bytes | None = None,
        content_type: str | None = None,
        headers: dict[str, str] | None = None,
        port: int | None = None,
        include_mutation_header: bool = True,
    ) -> tuple[int, dict[str, Any]]:
        data = body
        request_headers = dict(headers or {})
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and include_mutation_header:
            request_headers.setdefault("X-RAG-Method-Request", "1")
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if content_type:
            request_headers["Content-Type"] = content_type
        request = urllib.request.Request(
            f"http://127.0.0.1:{port or self.port}{path}",
            data=data,
            headers=request_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_non_loopback_server_requires_bearer_authentication(self) -> None:
        unauthenticated_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "remote-without-auth",
            host="0.0.0.0",
        )
        with self.assertRaisesRegex(ValueError, "MIRRORLIGHT_AUTH_TOKEN"):
            create_app(unauthenticated_settings)

        remote_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "remote-with-auth",
            host="0.0.0.0",
            auth_token="test-token",
        )
        remote_app = create_app(remote_settings)
        remote_server, remote_thread, remote_port = self._start_server(remote_app)
        try:
            status, health = self._request("/health", port=remote_port)
            self.assertEqual(status, 200)
            self.assertEqual(health["status"], "ok")

            status, payload = self._request("/api/companions", port=remote_port)
            self.assertEqual(status, 401)
            self.assertEqual(payload["error"], "authentication_required")

            status, payload = self._request(
                "/api/companions",
                headers={"Authorization": "Bearer test-token"},
                port=remote_port,
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload, {"companions": []})
        finally:
            remote_server.should_exit = True
            remote_thread.join(timeout=5)

    def test_request_boundary_rejects_untrusted_browser_mutations_before_writes(self) -> None:
        status, payload = self._request(
            "/health",
            headers={"Host": "attacker.example"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "untrusted_host")

        hostile_id = "hostile-browser"
        for origin in ("https://attacker.example", "null"):
            with self.subTest(origin=origin):
                status, payload = self._request(
                    "/api/companions",
                    "POST",
                    {"id": hostile_id},
                    headers={"Origin": origin},
                )
                self.assertEqual(status, 403)
                self.assertEqual(payload["error"], "untrusted_origin")
                self.assertFalse((self.settings.companions_root / hostile_id).exists())

        status, payload = self._request(
            "/api/companions",
            "POST",
            {"id": hostile_id},
            include_mutation_header=False,
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "mutation_header_required")
        self.assertFalse((self.settings.companions_root / hostile_id).exists())

        body, content_type = self._multipart_folder()
        status, payload = self._request(
            "/rag/import/folder-upload",
            "POST",
            body=body,
            content_type=content_type,
            headers={"Origin": "https://attacker.example"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "untrusted_origin")
        self.assertFalse((self.settings.companions_root / "folder-route").exists())
        self.assertEqual(list(self.settings.uploads_root.iterdir()), [])

        status, payload = self._request(
            "/api/companions",
            "POST",
            {"id": "trusted-browser"},
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["id"], "trusted-browser")

    def test_request_boundary_preserves_exact_origin_components(self) -> None:
        for origin in (
            "http://localhost:0",
            "http://localhost.:5173",
            "http://localhost:not-a-port",
            "http://localhost:65536",
            "http://user@localhost:5173",
            "http://localhost:5173/path",
        ):
            with self.subTest(origin=origin):
                companion_id = "rejected-origin-" + uuid.uuid4().hex
                status, payload = self._request(
                    "/api/companions",
                    "POST",
                    {"id": companion_id},
                    headers={"Origin": origin},
                )
                self.assertEqual(status, 403)
                self.assertEqual(payload["error"], "untrusted_origin")
                self.assertFalse((self.settings.companions_root / companion_id).exists())

        default_port_settings = Settings(
            project_root=self.settings.project_root,
            data_root=self.settings.data_root / "default-origin-port",
            trusted_origins=("http://localhost",),
        )
        default_port_app = create_app(default_port_settings)
        server, thread, port = self._start_server(default_port_app)
        try:
            status, payload = self._request(
                "/api/companions",
                "POST",
                {"id": "default-port-browser"},
                headers={"Origin": "http://localhost:80"},
                port=port,
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload["id"], "default-port-browser")
        finally:
            server.should_exit = True
            thread.join(timeout=5)

    def test_api_contract_models_validate_inputs_and_publish_openapi(self) -> None:
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/health")
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.headers.get("X-Mirrorlight-API-Version"), "v1")

        status, payload = self._request("/api/companions", "POST", {"id": 42})
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "validation_error")
        self.assertTrue(payload["detail"])

        status, payload = self._request("/api/memory", "POST", {"enabled": "false"})
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "validation_error")

        status, payload = self._request(
            "/api/memory",
            "POST",
            {"enabled": True, "enabeld": True},
        )
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "validation_error")

        status, payload = self._request(
            "/rag/assignments",
            "POST",
            {"companion_id": "astra", "vault_ids": "global:shared"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "validation_error")

        schemas = self.app.openapi()["components"]["schemas"]
        self.assertIn("CreateCompanionRequest", schemas)
        self.assertIn("GraphResponse", schemas)
        self.assertIn("provenance", schemas["GraphNode"]["properties"])
        self.assertIn("keywords", schemas["SearchResult"]["properties"])
        self.assertIn("_debug", schemas["SearchResult"]["properties"])
        for field in ("score_micro", "match_type", "cross_reference_from_id"):
            self.assertIn(field, schemas["SearchResult"]["properties"])
        for field in (
            "retrieval_method",
            "fallback_error",
            "semantic_state",
            "semantic_fallback_reason",
            "context_tokens",
            "truncated",
        ):
            self.assertIn(field, schemas["SearchResponse"]["properties"])
        self.assertEqual(self.app.state.api_contract_version, "v1")

    def test_binary_query_flags_reject_out_of_range_values(self) -> None:
        for path in ("/rag/graph?force=2", "/rag/search?query=context&debug=-1"):
            with self.subTest(path=path):
                status, payload = self._request(path)
                self.assertEqual(status, 422)
                self.assertEqual(payload["error"], "validation_error")

    @staticmethod
    def _multipart_zip() -> tuple[bytes, str]:
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("vault/MIND.md", "Name: Imported\nA route-test companion.")
            archive.writestr("vault/notes.md", "Graph search route context.")
        boundary = f"----Mirrorlight{uuid.uuid4().hex}"
        archive_bytes = archive_buffer.getvalue()
        chunks = [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="file"; filename="import.zip"\r\n',
            b"Content-Type: application/zip\r\n\r\n",
            archive_bytes,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    @staticmethod
    def _multipart_folder(oversized: bool = False) -> tuple[bytes, str]:
        boundary = f"----MirrorlightFolder{uuid.uuid4().hex}"
        files = (
            ("MIND.md", b"Name: Folder Route\nA folder upload companion."),
            ("notes/intro.md", b"x" * 2048 if oversized else b"Folder upload route context."),
        )
        chunks: list[bytes] = []
        for filename, content in files:
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode(),
                    b"Content-Type: text/markdown\r\n\r\n",
                    content,
                    b"\r\n",
                ]
            )
        chunks.append(f"--{boundary}--\r\n".encode())
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    def test_route_contract_import_graph_search_limits_and_state(self) -> None:
        status, payload = self._request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "ok")

        status, payload = self._request("/api/companions", "POST", {"id": "astra"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["id"], "astra")
        status, payload = self._request("/api/companions", "POST", {"id": "astra"})
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "conflict")

        note = self.settings.companions_root / "astra" / "vault" / "route.md"
        note.write_text("Graph search route context", encoding="utf-8")
        status, graph = self._request("/rag/graph?companion_id=astra&pockets=vault")
        self.assertEqual(status, 200)
        self.assertTrue(graph["nodes"])
        self.assertIn("generation", graph)

        query = urllib.parse.quote("route context")
        status, search = self._request(f"/rag/search?companion_id=astra&pockets=vault&query={query}")
        self.assertEqual(status, 200)
        self.assertTrue(search["results"])
        self.assertIn("score", search["results"][0])
        self.assertEqual(search["results"][0]["score_micro"], round(search["results"][0]["score"] * 1_000_000))
        self.assertIn(search["results"][0]["match_type"], {"exact", "semantic", "keyword", "cross_reference"})
        self.assertIn("cross_reference_from_id", search["results"][0])
        self.assertEqual(search["retrieval_mode"], "lexical-hybrid")

        status, debug_search = self._request(
            f"/rag/search?companion_id=astra&pockets=vault&query={query}&debug=1"
        )
        self.assertEqual(status, 200)
        self.assertIn("_debug", debug_search["results"][0])

        status, controlled_search = self._request(
            f"/rag/search?companion_id=astra&pockets=vault&query={query}"
            "&mode=exact_only&top_k=1&max_context_tokens=100&debug=1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(controlled_search["results"]), 1)
        self.assertEqual(controlled_search["results"][0]["_debug"]["mode"], "exact_only")
        self.assertLessEqual(controlled_search["context_tokens"], 100)

        status, bounded_search = self._request(
            f"/rag/search?companion_id=astra&pockets=vault&query={query}"
            "&mode=exact_only&max_context_tokens=1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(bounded_search["results"], [])
        self.assertTrue(bounded_search["truncated"])

        status, ordinary_search = self._request(
            f"/rag/search?companion_id=astra&pockets=vault&query={query}"
        )
        self.assertEqual(status, 200)
        self.assertNotIn("_debug", ordinary_search["results"][0])
        self.assertIn("score_micro", ordinary_search["results"][0])
        self.assertIn("match_type", ordinary_search["results"][0])

        status, memory = self._request("/api/memory", "POST", {"enabled": False})
        self.assertEqual(status, 200)
        self.assertEqual(memory, {"enabled": False, "persistence": "disk"})
        status, _ = self._request("/api/memory", "POST", {"enabled": "false"})
        self.assertEqual(status, 422)

        status, invalid_pocket = self._request(
            "/rag/search?companion_id=astra&pockets=unknown&query=route"
        )
        self.assertEqual(status, 400)
        self.assertEqual(invalid_pocket["error"], "invalid_request")
        status, _ = self._request("/rag/search?companion_id=astra&pockets=vault&query=route&top_k=21")
        self.assertEqual(status, 400)
        for invalid_control in (
            "mode=legacy",
            "max_context_tokens=0",
            "max_context_tokens=1801",
        ):
            status, _ = self._request(
                f"/rag/search?companion_id=astra&pockets=vault&query=route&{invalid_control}"
            )
            self.assertIn(status, {400, 422})
        status, _ = self._request(
            "/rag/search?companion_id=astra&pockets=vault&query=" + ("x" * 4001)
        )
        self.assertEqual(status, 400)

        (self.settings.companions_root / "astra" / "vault" / "oversized.md").write_text(
            "x" * 2048, encoding="utf-8"
        )
        status, _ = self._request("/rag/graph?companion_id=astra&pockets=vault")
        self.assertEqual(status, 413)
        status, _ = self._request(
            "/rag/search?companion_id=astra&pockets=vault&query=route"
        )
        self.assertEqual(status, 413)

        status, _ = self._request("/rag/vaults", "POST", {"id": "global:shared", "path": "shared"})
        self.assertEqual(status, 200)
        status, assignments = self._request(
            "/rag/assignments", "POST", {"companion_id": "astra", "vault_ids": ["global:Shared"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(assignments["vault_ids"], ["global:shared"])

    def test_cross_reference_only_result_survives_public_api_validation(self) -> None:
        status, payload = self._request("/api/companions", "POST", {"id": "cross-reference"})
        self.assertEqual(status, 200)
        vault = self.settings.companions_root / "cross-reference" / "vault"
        (vault / "origin.md").write_text(
            "# Origin\n\nLaunch beacon is documented here. [[target]]\n",
            encoding="utf-8",
        )
        (vault / "target.md").write_text(
            "# Target\n\nCross-reference-only evidence stays source-safe.\n",
            encoding="utf-8",
        )

        query = urllib.parse.quote("launch beacon")
        status, search = self._request(
            f"/rag/search?companion_id=cross-reference&pockets=vault"
            f"&query={query}&mode=exact_only&top_k=2&debug=1"
        )

        self.assertEqual(status, 200)
        target = next(
            (result for result in search["results"] if result.get("path") == "target.md"),
            None,
        )
        self.assertIsNotNone(target)
        assert target is not None
        self.assertEqual(target["match_type"], "cross_reference")
        self.assertEqual(target["cross_reference_from_id"], search["results"][0]["id"])
        self.assertEqual(target["_debug"]["cross_reference_micro"], 1_000_000)

    def test_vault_registration_rejects_unstable_paths_as_user_errors(self) -> None:
        file_path = self.settings.global_root / "not-a-vault"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text("not a directory", encoding="utf-8")

        status, payload = self._request(
            "/rag/vaults",
            "POST",
            {"id": "global:not-a-vault", "path": "not-a-vault"},
        )

        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid_request")
        self.assertIn("directory", payload["detail"])

        invalid_registrations = (
            ({"id": "global:root", "path": "."}, "direct child"),
            ({"id": "global:nested", "path": "outer/nested"}, "direct child"),
            ({"id": "global:alias", "path": "actual"}, "must match"),
        )
        for request, expected_detail in invalid_registrations:
            with self.subTest(request=request):
                status, payload = self._request("/rag/vaults", "POST", request)
                self.assertEqual(status, 400)
                self.assertEqual(payload["error"], "invalid_request")
                self.assertIn(expected_detail, payload["detail"])

        self.assertFalse((self.settings.global_root / "outer").exists())
        self.assertFalse((self.settings.global_root / "actual").exists())

    def test_zip_upload_is_imported_and_staging_is_cleaned(self) -> None:
        body, content_type = self._multipart_zip()
        status, payload = self._request(
            "/rag/import/vault-zip",
            "POST",
            body=body,
            content_type=content_type,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["id"], "imported")
        self.assertTrue((self.settings.companions_root / "imported" / "vault" / "notes.md").exists())
        self.assertEqual(list(self.settings.uploads_root.glob("upload_*.zip")), [])
        self.assertEqual(list(self.settings.uploads_root.glob("unz_*")), [])

    def test_direct_companion_persona_limit_is_visible_and_transactional(self) -> None:
        status, payload = self._request(
            "/api/companions",
            "POST",
            {"id": "oversized-persona", "persona": "x" * 2048},
        )

        self.assertEqual(status, 413)
        self.assertIn("persona metadata exceeds", payload["detail"])
        self.assertFalse((self.settings.companions_root / "oversized-persona").exists())

    def test_graph_route_reports_bounded_transport(self) -> None:
        status, payload = self._request("/api/companions", "POST", {"id": "graph-limit"})
        self.assertEqual(status, 200)
        vault = self.settings.companions_root / "graph-limit" / "vault"
        for index in range(3):
            (vault / f"graph-{index}.md").write_text(
                f"graph response retrieval context {index}", encoding="utf-8"
            )

        status, graph = self._request("/rag/graph?companion_id=graph-limit&pockets=vault")

        self.assertEqual(status, 200)
        self.assertTrue(graph["graph_meta"]["truncated"])
        self.assertEqual(len(graph["nodes"]), 2)
        self.assertLessEqual(len(graph["links"]), 1)
        visible_ids = {node["id"] for node in graph["nodes"]}
        self.assertTrue(
            all(link["source"] in visible_ids and link["target"] in visible_ids for link in graph["links"])
        )

    def test_folder_upload_is_imported_and_staging_is_cleaned(self) -> None:
        body, content_type = self._multipart_folder()
        status, payload = self._request(
            "/rag/import/folder-upload",
            "POST",
            body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["id"], "folder-route")
        self.assertTrue(
            (self.settings.companions_root / "folder-route" / "vault" / "notes" / "intro.md").exists()
        )
        self.assertEqual(list(self.settings.uploads_root.glob("stage_*")), [])

    def test_oversized_folder_import_is_rolled_back(self) -> None:
        body, content_type = self._multipart_folder(oversized=True)
        status, payload = self._request(
            "/rag/import/folder-upload",
            "POST",
            body=body,
            content_type=content_type,
        )

        self.assertEqual(status, 413)
        self.assertIn("index file limit exceeded", payload["detail"])
        self.assertFalse((self.settings.companions_root / "folder-route").exists())
        self.assertEqual(list(self.settings.uploads_root.glob("stage_*")), [])
        status, companions = self._request("/api/companions")
        self.assertEqual(status, 200)
        self.assertNotIn("folder-route", companions["companions"])


class AsyncOperationTests(unittest.IsolatedAsyncioTestCase):
    async def test_coroutine_cancellation_signals_the_worker_token(self) -> None:
        started = threading.Event()
        stopped = threading.Event()

        class ConnectedRequest:
            async def is_disconnected(self) -> bool:
                return False

        def wait_for_cancel(*, cancel_token: Any) -> None:
            started.set()
            while not cancel_token.cancelled:
                time.sleep(0.005)
            stopped.set()

        operation = asyncio.create_task(
            _run_with_disconnect(ConnectedRequest(), wait_for_cancel)
        )
        self.assertTrue(await asyncio.to_thread(started.wait, 1))
        operation.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await operation
        self.assertTrue(await asyncio.to_thread(stopped.wait, 1))
