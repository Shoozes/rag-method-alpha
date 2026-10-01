from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = REPO_ROOT / "scripts" / "run.py"
SPEC = importlib.util.spec_from_file_location("mirrorlight_portable_runner", RUNNER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load portable runner: {RUNNER_PATH}")
sys.path.insert(0, str(RUNNER_PATH.parent))
import browser_smoke as BROWSER_SMOKE
import browser_rag_adapter_conformance as BROWSER_RAG_ADAPTER
import local_runtime as LOCAL_RUNTIME

RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class PortableRunnerTests(unittest.TestCase):
    @staticmethod
    def _valid_browser_driver_report() -> dict:
        return {
            "schema": "mirrorlight_browser_driver_report_v1",
            "status": "pass",
            "versions": {
                "playwright": "1.2.3",
                "browser": "Chromium 123",
                "browser_executable": "playwright-bundled",
            },
            "checks": [
                {"name": name, "status": "pass", "elapsed_ms": index}
                for index, name in enumerate(BROWSER_SMOKE._EXPECTED_DRIVER_CHECK_NAMES)
            ],
            "console": {
                "errors": [],
                "warnings": [],
                "expected_http_errors": [{"status": 400, "path": "/rag/search"}],
            },
        }

    def test_aggregate_lane_runs_both_frozen_contracts(self) -> None:
        calls: list[str] = []
        names = (
            "_backend_compile",
            "_backend_test",
            "_rag_contract",
            "_rag_indexing_contract",
            "_frontend_test",
        )
        patches = [
            patch.object(RUNNER, name, side_effect=lambda name=name: calls.append(name))
            for name in names
        ]
        for active_patch in patches:
            active_patch.start()
        try:
            RUNNER._portable_test()
        finally:
            for active_patch in reversed(patches):
                active_patch.stop()

        self.assertEqual(calls, list(names))

    def test_raw_indexing_contract_is_a_public_portable_task(self) -> None:
        with patch.object(RUNNER, "_rag_indexing_contract") as contract:
            self.assertEqual(RUNNER.main(["-Task", "rag-indexing-contract"]), 0)
        contract.assert_called_once_with()

    def test_browser_smoke_is_a_public_portable_task(self) -> None:
        with patch.object(RUNNER, "_browser_smoke") as browser_smoke:
            self.assertEqual(RUNNER.main(["-Task", "browser-smoke"]), 0)
        browser_smoke.assert_called_once_with([])

    def test_browser_smoke_forwards_bounded_driver_arguments(self) -> None:
        with patch.object(RUNNER, "_browser_smoke") as browser_smoke:
            self.assertEqual(RUNNER.main(["-Task", "browser-smoke", "--headed"]), 0)
        browser_smoke.assert_called_once_with(["--headed"])

    def test_browser_screenshots_are_isolated_by_browser_executable(self) -> None:
        default = BROWSER_SMOKE.DEFAULT_DESKTOP_SCREENSHOT
        self.assertEqual(
            BROWSER_SMOKE._browser_artifact_target(
                "", default, BROWSER_SMOKE.SHOWCASE_BROWSER_EXECUTABLE
            ),
            default,
        )
        self.assertEqual(
            BROWSER_SMOKE._browser_artifact_target("", default, "system:chrome.exe").name,
            "rag-method-lab-desktop-system-chrome.png",
        )
        explicit = ".artifacts/proof/operator-selected.png"
        self.assertEqual(
            BROWSER_SMOKE._browser_artifact_target(
                explicit, default, "system:chrome.exe"
            ),
            BROWSER_SMOKE._artifact_path(explicit, default),
        )
        self.assertEqual(
            BROWSER_SMOKE._browser_artifact_target(
                ".artifacts/proof/rag-method-lab-desktop.png",
                default,
                "system:chrome.exe",
            ).name,
            "rag-method-lab-desktop-system-chrome.png",
        )

    def test_browser_artifact_promotion_rolls_back_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staging = [root / f"staging-{index}" for index in range(3)]
            targets = [root / f"target-{index}" for index in range(3)]
            for index, path in enumerate(staging):
                path.write_text(f"new-{index}", encoding="utf-8")
            for index, path in enumerate(targets[1:], start=1):
                path.write_text(f"old-{index}", encoding="utf-8")

            real_replace = BROWSER_SMOKE.os.replace
            failed = False

            def fail_mid_promotion(source: str | Path, target: str | Path) -> None:
                nonlocal failed
                if Path(source) == staging[1] and not failed:
                    failed = True
                    raise OSError("synthetic promotion failure")
                real_replace(source, target)

            with patch.object(
                BROWSER_SMOKE.os, "replace", side_effect=fail_mid_promotion
            ):
                with self.assertRaises(OSError):
                    BROWSER_SMOKE._promote_artifacts(list(zip(staging, targets)))

            self.assertFalse(targets[0].exists())
            self.assertEqual(targets[1].read_text(encoding="utf-8"), "old-1")
            self.assertEqual(targets[2].read_text(encoding="utf-8"), "old-2")
            self.assertEqual(list(root.glob("*.bak")), [])

    def test_browser_rag_test_reuses_the_just_prepared_module(self) -> None:
        with (
            patch.object(RUNNER, "_browser_rag_npm") as browser_rag_npm,
            patch.object(RUNNER, "_browser_rag_adapter") as browser_rag_adapter,
        ):
            RUNNER._browser_rag_test()

        self.assertEqual(
            [call.args[0] for call in browser_rag_npm.call_args_list],
            [
                "contracts:check",
                "unicode:check",
                "core:check",
                "typecheck",
                "test",
                "build",
            ],
        )
        browser_rag_adapter.assert_called_once_with(prepared_module=True)

    def test_browser_rag_adapter_accepts_patch_runtime_drift_only(self) -> None:
        self.assertTrue(
            BROWSER_RAG_ADAPTER._same_python_minor_version("3.12.13", "3.12.14")
        )
        self.assertFalse(
            BROWSER_RAG_ADAPTER._same_python_minor_version("3.12.13", "3.13.0")
        )
        self.assertFalse(
            BROWSER_RAG_ADAPTER._same_python_minor_version("not-a-version", "3.12.14")
        )

    def test_browser_driver_report_validation_fails_closed(self) -> None:
        valid = self._valid_browser_driver_report()
        BROWSER_SMOKE._validate_driver_report(valid)

        known_warning = {
            "text": (
                "[.WebGL-0xabc123]GL Driver Message (OpenGL, Performance, "
                "GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels"
            ),
            "url": "",
            "line": 0,
            "column": 0,
        }
        known = self._valid_browser_driver_report()
        known["console"]["warnings"] = [
            known_warning,
            {**known_warning, "url": "http://127.0.0.1:5173/"},
        ]
        BROWSER_SMOKE._validate_driver_report(known)
        self.assertEqual(
            [warning["category"] for warning in known["console"]["warnings"]],
            ["allowed_driver_noise", "allowed_driver_noise"],
        )

        mutations = {
            "schema": lambda report: report.update(schema="other"),
            "status": lambda report: report.update(status="fail", error="driver failed"),
            "check count": lambda report: report["checks"].pop(),
            "unexpected check": lambda report: report["checks"][0].update(name="other"),
            "check order": lambda report: report["checks"].reverse(),
            "failed check": lambda report: report["checks"][0].update(status="fail"),
            "elapsed time": lambda report: report["checks"][0].update(elapsed_ms=-1),
            "console errors": lambda report: report["console"]["errors"].append("boom"),
            "malformed console warning": lambda report: report["console"].update(warnings=[{}]),
            "unknown browser warning": lambda report: report["console"].update(
                warnings=[{"text": "browser warning", "url": "", "line": 0, "column": 0}]
            ),
            "application warning": lambda report: report["console"].update(
                warnings=[
                    {
                        "text": "application warning",
                        "url": "http://127.0.0.1:5173/",
                        "line": 1,
                        "column": 1,
                    }
                ]
            ),
            "WebGL context exhaustion": lambda report: report["console"].update(
                warnings=[
                    {
                        "text": "WARNING: Too many active WebGL contexts. Oldest context will be lost.",
                        "url": "http://127.0.0.1:5173/src/components/KnowledgeGraph.tsx",
                        "line": 1,
                        "column": 1,
                    }
                ]
            ),
            "too many allowed warnings": lambda report: report["console"].update(
                warnings=[
                    {
                        "text": (
                            "[.WebGL-0xabc123]GL Driver Message (OpenGL, Performance, "
                            "GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels"
                        ),
                        "url": "",
                        "line": 0,
                        "column": 0,
                    }
                    for _ in range(BROWSER_SMOKE._ALLOWED_DRIVER_WARNING_MAX + 1)
                ]
            ),
            "HTTP evidence": lambda report: report["console"].update(expected_http_errors=[]),
            "versions": lambda report: report.update(versions={}),
            "browser executable": lambda report: report["versions"].update(
                browser_executable=""
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                report = deepcopy(valid)
                mutate(report)
                with self.assertRaises(RuntimeError):
                    BROWSER_SMOKE._validate_driver_report(report)

    def test_visual_run_is_a_public_portable_task_with_forwarded_arguments(self) -> None:
        with patch.object(RUNNER, "_visual_run", return_value=0) as visual_run:
            self.assertEqual(
                RUNNER.main(["-Task", "visual-run", "--no-open", "--embedding-mode", "hash"]),
                0,
            )
        visual_run.assert_called_once_with(["--no-open", "--embedding-mode", "hash"])

    def test_browser_proof_and_screenshot_cannot_alias(self) -> None:
        shared = BROWSER_SMOKE.ARTIFACT_ROOT / "proof" / "same-output"
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                BROWSER_SMOKE.main(
                    [
                        "--output",
                        str(shared),
                        "--screenshot",
                        str(shared),
                    ]
                )
        self.assertEqual(raised.exception.code, 2)

    def test_process_tree_cleanup_does_not_overclaim_a_failed_tree_signal(self) -> None:
        class FakeProcess:
            pid = 8123

            def __init__(self) -> None:
                self.stopped = False
                self.wait_calls = 0
                self.kill_calls = 0

            def poll(self) -> int | None:
                return 0 if self.stopped else None

            def wait(self, timeout: int) -> int:
                self.wait_calls += 1
                if self.wait_calls == 1:
                    raise subprocess.TimeoutExpired("fake-process", timeout)
                return 0

            def send_signal(self, requested_signal: int) -> None:
                raise OSError("group signal unavailable")

            def kill(self) -> None:
                self.kill_calls += 1
                self.stopped = True

        process = FakeProcess()
        if os.name == "nt":
            signals = patch.object(
                LOCAL_RUNTIME.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("taskkill", 15),
            )
            extra_patches = []
        else:
            signals = patch.object(LOCAL_RUNTIME.os, "killpg")
            extra_patches = [
                patch.object(LOCAL_RUNTIME.os, "getpgid", return_value=process.pid)
            ]

        with signals:
            for active_patch in extra_patches:
                active_patch.start()
            try:
                stopped = BROWSER_SMOKE._terminate_process_tree(process)
            finally:
                for active_patch in reversed(extra_patches):
                    active_patch.stop()
        self.assertEqual(stopped, os.name != "nt")
        self.assertEqual(process.kill_calls, 1)

    @unittest.skipUnless(os.name == "nt", "Windows process-group behavior")
    def test_windows_cleanup_prefers_graceful_process_group_signal(self) -> None:
        class FakeProcess:
            pid = 8124

            def __init__(self) -> None:
                self.stopped = False
                self.signals: list[int] = []

            def poll(self) -> int | None:
                return 0 if self.stopped else None

            def send_signal(self, requested_signal: int) -> None:
                self.signals.append(requested_signal)
                self.stopped = True

            def wait(self, timeout: int) -> int:
                return 0

            def kill(self) -> None:
                raise AssertionError("graceful group stop should not kill the parent")

        process = FakeProcess()
        with patch.object(LOCAL_RUNTIME.subprocess, "run") as force_signal:
            stopped = LOCAL_RUNTIME.terminate_process_tree(process)

        self.assertTrue(stopped)
        self.assertEqual(process.signals, [LOCAL_RUNTIME.signal.CTRL_BREAK_EVENT])
        force_signal.assert_not_called()

    def test_temporary_cleanup_retries_after_a_transient_handle_error(self) -> None:
        temporary_root = Path(tempfile.mkdtemp(prefix="mirrorlight-cleanup-test-"))
        (temporary_root / "frontend.log").write_text("held briefly", encoding="utf-8")
        real_rmtree = LOCAL_RUNTIME.shutil.rmtree
        attempts = 0

        def remove_with_one_transient_failure(path: Path) -> None:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise OSError("file handle is still closing")
            real_rmtree(path)

        try:
            with patch.object(
                LOCAL_RUNTIME.shutil,
                "rmtree",
                side_effect=remove_with_one_transient_failure,
            ), patch.object(LOCAL_RUNTIME.time, "sleep"):
                removed, error = BROWSER_SMOKE._remove_tree(temporary_root)
        finally:
            if temporary_root.exists():
                real_rmtree(temporary_root)

        self.assertTrue(removed)
        self.assertIsNone(error)
        self.assertEqual(attempts, 2)


if __name__ == "__main__":
    unittest.main()
