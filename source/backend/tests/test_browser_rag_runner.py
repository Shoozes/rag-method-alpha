from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import tempfile
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str):
    specification = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load {name}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


RUN = _load("browser_rag_run")
SMOKE = _load("browser_rag_smoke")


class BrowserRagRunnerTests(unittest.TestCase):
    def test_occupied_explicit_port_fails_before_server_creation(self) -> None:
        with patch.object(RUN, "port_available", return_value=False), patch.object(
            RUN, "spawn_process"
        ) as spawn:
            with self.assertRaisesRegex(RuntimeError, "already occupied"):
                RUN.start_server(45201)
        spawn.assert_not_called()

    def test_no_open_ready_exit_stops_and_proves_server_lifecycle(self) -> None:
        managed = SimpleNamespace(process=SimpleNamespace(wait=lambda: 0), log_path=Path("vite.log"))
        with patch.object(RUN, "start_server", return_value=managed), patch.object(
            RUN, "_wait_ready"
        ), patch.object(RUN, "stop_server", return_value={"vite_process_tree_terminated": True, "port_released": True}) as stop, patch.object(
            RUN.webbrowser, "open"
        ) as browser_open, redirect_stdout(io.StringIO()):
            result = RUN.main(["--port", "45202", "--no-open", "--exit-after-ready"])
        self.assertEqual(result, 0)
        stop.assert_called_once_with(managed, 45202)
        browser_open.assert_not_called()

    def test_cleanup_failure_changes_successful_ready_exit_to_failure(self) -> None:
        managed = SimpleNamespace(process=SimpleNamespace(wait=lambda: 0), log_path=Path("vite.log"))
        with patch.object(RUN, "start_server", return_value=managed), patch.object(
            RUN, "_wait_ready"
        ), patch.object(RUN, "stop_server", side_effect=RuntimeError("port held")), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = RUN.main(["--port", "45203", "--no-open", "--exit-after-ready"])
        self.assertEqual(result, 1)

    def test_browser_report_requires_exact_journey_deep_reports_and_lifecycle(self) -> None:
        SMOKE.PROOF_ROOT.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="browser-rag-runner-test-", dir=SMOKE.PROOF_ROOT))
        try:
            digest = "a" * 64

            def contract(contract_id: str, version: int) -> dict[str, object]:
                return {
                    "id": contract_id,
                    "version": version,
                    "runtime_snapshot_digest": digest,
                    "input_digests": {"fixture.json": digest},
                }

            identity = {
                "implementation": "rag-method-browser-ts-worker",
                "language": "typescript",
                "module_version": SMOKE.MODULE_VERSION,
            }
            observation = {
                "eligible_ids": [],
                "candidate_ids": [],
                "ordered_ids": [],
                "scores": [],
                "context_selected_ids": [],
                "context_tokens": 0,
                "truncated": False,
                "semantic_state": "not_requested",
                "semantic_fallback_reason": None,
                "errors": [],
            }
            artifact_values = {
                "indexing": {
                    "schema": "browser-rag-ts-worker-actual-report-v1",
                    "protocol_version": 1,
                    "kind": "indexing",
                    "identity": identity,
                    "contract": contract("rag-indexing-v1", 1),
                    "summary": {"cases": 1, "errors": 1},
                    "results": [{"id": "index", "actual": {"status": "error", "error": {"code": "fixture_error"}}}],
                },
                "retrieval": {
                    "schema": "browser-rag-ts-worker-actual-report-v1",
                    "protocol_version": 1,
                    "kind": "retrieval",
                    "identity": identity,
                    "contract": contract("rag-behavior-v2", 2),
                    "summary": {"cases": 1, "errors": 0},
                    "results": [{"id": "retrieve", "mode": "exact_only", "actual": observation}],
                },
                "query": {
                    "schema": "browser-rag-ts-worker-query-report-v1",
                    "protocol_version": 1,
                    "kind": "query",
                    "identity": identity,
                    "contract": contract("rag-behavior-v2", 2),
                    "query": "release",
                    "observation": observation,
                },
            }
            reports: dict[str, dict[str, object]] = {}
            for kind, value in artifact_values.items():
                artifact = temporary / f"{kind}.json"
                artifact.write_text(json.dumps(value), encoding="utf-8")
                metadata: dict[str, object] = {
                    "path": artifact.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                    "bytes": artifact.stat().st_size,
                }
                if kind == "query":
                    metadata["query"] = "release"
                else:
                    metadata["cases"] = 1
                reports[kind] = metadata
            output = temporary / "browser.json"
            payload = {
                "schema": "browser-rag-ts-smoke-v10",
                "status": "pass",
                "target": {"url": "http://127.0.0.1:45204/", "port": 45204},
                "runtime": {"node": "v-test", "playwright": "v-test", "browser": "v-test", "browser_executable": "v-test", "module_version": SMOKE.MODULE_VERSION},
                "timings": {"navigation_ms": 1, "total_ms": 2},
                "checks": [{"name": name, "status": "pass", "elapsed_ms": 1} for name in SMOKE.CHECK_NAMES],
                "mobile_journeys": {
                    backend: {
                        "requested_backend": backend,
                        "selected_backend": "webgl2",
                        "device_pixel_ratio": 1,
                        "viewport": {"width": 390, "height": 844},
                        "graph_revision": 2,
                        "topology_revision": 2,
                        "camera_revision": 2,
                        "picking_revision": 2,
                        "picking_mode": "raycast",
                        "selected_node_ids": ["left", "right"],
                    }
                    for backend in ("auto", "webgl2")
                },
                "reports": reports,
                "errors": {"console": [], "warnings": [], "page": [], "requests": [], "responses": [], "workers": [], "expected": ["WebGL Device Lost"]},
                "termination": {
                    "worker_disposal_acknowledged": True,
                    "page_closed": True,
                    "browser_context_closed": True,
                    "browser_closed": True,
                    "vite_process_tree_terminated": False,
                    "port_released": False,
                },
            }
            output.write_text(json.dumps(payload), encoding="utf-8")
            SMOKE._validate_driver_report(output, require_server_cleanup=False)
            SMOKE._record_server_cleanup(output, {"vite_process_tree_terminated": True, "port_released": True})
            recorded = json.loads(output.read_text(encoding="utf-8"))
            self.assertTrue(recorded["termination"]["vite_process_tree_terminated"])
            self.assertTrue(recorded["termination"]["port_released"])
            SMOKE._validate_driver_report(output)

            retrieval_artifact = temporary / "retrieval.json"
            malformed_retrieval = json.loads(retrieval_artifact.read_text(encoding="utf-8"))
            malformed_retrieval["results"][0]["actual"] = {"status": "ok"}
            retrieval_artifact.write_text(json.dumps(malformed_retrieval), encoding="utf-8")
            reports["retrieval"]["sha256"] = hashlib.sha256(retrieval_artifact.read_bytes()).hexdigest()
            reports["retrieval"]["bytes"] = retrieval_artifact.stat().st_size
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
            retrieval_artifact.write_text(json.dumps(artifact_values["retrieval"]), encoding="utf-8")
            reports["retrieval"]["sha256"] = hashlib.sha256(retrieval_artifact.read_bytes()).hexdigest()
            reports["retrieval"]["bytes"] = retrieval_artifact.stat().st_size

            payload["checks"][0]["name"] = "wrong"
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
            payload["checks"][0]["name"] = SMOKE.CHECK_NAMES[0]
            payload["checks"][0]["elapsed_ms"] = -1
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
            payload["checks"][0]["elapsed_ms"] = 1
            payload["mobile_journeys"]["auto"]["selected_node_ids"] = ["same", "same"]
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
            payload["mobile_journeys"]["auto"]["selected_node_ids"] = ["left", "right"]
            payload["mobile_journeys"]["webgl2"]["selected_backend"] = "webgpu"
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
            payload["mobile_journeys"]["webgl2"]["selected_backend"] = "webgl2"
            reports["query"]["sha256"] = "bad"
            output.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                SMOKE._validate_driver_report(output, require_server_cleanup=False)
        finally:
            for path in temporary.rglob("*"):
                if path.is_file():
                    path.unlink()
            temporary.rmdir()


if __name__ == "__main__":
    unittest.main()
