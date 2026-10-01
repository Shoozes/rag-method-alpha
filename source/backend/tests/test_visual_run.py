from __future__ import annotations

import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "visual_run.py"
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("visual_run", SCRIPT_PATH)
assert SPEC and SPEC.loader
VISUAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VISUAL)


class FakeProcess:
    def __init__(self) -> None:
        self.returncode = None

    def poll(self) -> int | None:
        return self.returncode


class VisualRunTests(unittest.TestCase):
    def _managed(self, label: str):
        return SimpleNamespace(label=label, process=FakeProcess(), log_path=Path(f"{label}.log"))

    def test_ready_exit_uses_hash_label_and_stops_both_servers(self) -> None:
        spawned = []

        def spawn(label, command, cwd, environment, log_path):
            spawned.append((label, command, cwd, environment.copy(), log_path))
            return self._managed(label)

        output = io.StringIO()
        with patch.object(VISUAL, "port_available", return_value=True), patch.object(
            VISUAL, "npm_command", return_value=["npm"]
        ), patch.object(VISUAL, "spawn_process", side_effect=spawn), patch.object(
            VISUAL, "wait_http"
        ), patch.object(VISUAL, "stop_process", return_value=True) as stop, patch.object(
            VISUAL, "wait_port_release", return_value=True
        ), patch.object(VISUAL.webbrowser, "open") as browser_open, redirect_stdout(output):
            result = VISUAL.main(
                [
                    "--backend-port", "45100",
                    "--frontend-port", "45101",
                    "--embedding-mode", "hash",
                    "--no-open",
                    "--exit-after-ready",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual([entry[0] for entry in spawned], ["backend", "frontend"])
        self.assertEqual(spawned[0][3]["MIRRORLIGHT_EMBEDDING_MODE"], "hash")
        self.assertEqual(
            spawned[0][3]["MIRRORLIGHT_TRUSTED_ORIGINS"],
            "http://127.0.0.1:45101",
        )
        self.assertIn("prototype hash vectors", output.getvalue())
        self.assertEqual(stop.call_count, 2)
        browser_open.assert_not_called()

    def test_ctrl_c_path_is_clean_and_no_open_is_honored(self) -> None:
        managed = [self._managed("backend"), self._managed("frontend")]
        with patch.object(VISUAL, "port_available", return_value=True), patch.object(
            VISUAL, "npm_command", return_value=["npm"]
        ), patch.object(VISUAL, "spawn_process", side_effect=managed), patch.object(
            VISUAL, "wait_http"
        ), patch.object(VISUAL.time, "sleep", side_effect=KeyboardInterrupt), patch.object(
            VISUAL, "stop_process", return_value=True
        ), patch.object(VISUAL, "wait_port_release", return_value=True), patch.object(
            VISUAL.webbrowser, "open"
        ) as browser_open, redirect_stdout(io.StringIO()):
            result = VISUAL.main(
                ["--backend-port", "45102", "--frontend-port", "45103", "--no-open"]
            )

        self.assertEqual(result, 0)
        browser_open.assert_not_called()

    def test_backend_startup_failure_still_runs_cleanup(self) -> None:
        managed = [self._managed("backend"), self._managed("frontend")]
        with patch.object(VISUAL, "port_available", return_value=True), patch.object(
            VISUAL, "npm_command", return_value=["npm"]
        ), patch.object(VISUAL, "spawn_process", side_effect=managed), patch.object(
            VISUAL, "wait_http", side_effect=RuntimeError("backend startup failed")
        ), patch.object(VISUAL, "stop_process", return_value=True) as stop, patch.object(
            VISUAL, "wait_port_release", return_value=True
        ), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = VISUAL.main(
                ["--backend-port", "45104", "--frontend-port", "45105", "--no-open"]
            )

        self.assertEqual(result, 1)
        self.assertEqual(stop.call_count, 2)

    def test_frontend_startup_failure_still_runs_cleanup(self) -> None:
        managed = [self._managed("backend"), self._managed("frontend")]
        with patch.object(VISUAL, "port_available", return_value=True), patch.object(
            VISUAL, "npm_command", return_value=["npm"]
        ), patch.object(VISUAL, "spawn_process", side_effect=managed), patch.object(
            VISUAL, "wait_http", side_effect=[None, RuntimeError("frontend startup failed")]
        ), patch.object(VISUAL, "stop_process", return_value=True) as stop, patch.object(
            VISUAL, "wait_port_release", return_value=True
        ), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = VISUAL.main(
                ["--backend-port", "45108", "--frontend-port", "45109", "--no-open"]
            )

        self.assertEqual(result, 1)
        self.assertEqual(stop.call_count, 2)

    def test_occupied_port_fails_before_process_creation(self) -> None:
        with patch.object(VISUAL, "port_available", return_value=False), patch.object(
            VISUAL, "spawn_process"
        ) as spawn, patch.object(VISUAL, "stop_process", return_value=True), patch.object(
            VISUAL, "wait_port_release", return_value=True
        ), redirect_stderr(io.StringIO()):
            result = VISUAL.main(
                ["--backend-port", "45106", "--frontend-port", "45107", "--no-open"]
            )

        self.assertEqual(result, 1)
        spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
