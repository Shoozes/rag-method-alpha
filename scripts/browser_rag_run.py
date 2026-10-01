"""Launch the browser RAG application with fail-closed port ownership."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Sequence

from local_runtime import (
    ManagedProcess,
    free_port,
    log_tail,
    port_available,
    spawn_process,
    stop_process,
    wait_port_release,
)
from runtime_commands import node_command


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules" / "browser-rag-ts"
VITE_SCRIPT = MODULE / "scripts" / "vite.mjs"
PROOF_ROOT = ROOT / ".artifacts" / "proof" / "browser-rag-ts"
MODULE_VERSION = json.loads((MODULE / "module.json").read_text(encoding="utf-8"))["version"]
IDENTITY_MARKER = f'data-browser-rag-ts="{MODULE_VERSION}"'
STARTUP_TIMEOUT_SECONDS = 20.0


def _free_port() -> int:
    return free_port()


def _validate_port(port: int) -> int:
    if not 1024 <= port <= 65535:
        raise ValueError("--port must be between 1024 and 65535")
    if not port_available(port):
        raise RuntimeError(f"requested browser-rag-ts port is already occupied: {port}")
    return port


def _ready(port: int) -> bool:
    try:
        # The public root is a static landing page. Probe the executable explorer
        # route so readiness still proves that the application bundle is served.
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/browser/", timeout=1) as response:
            body = response.read(256 * 1024).decode("utf-8", errors="replace")
            return response.status == 200 and IDENTITY_MARKER in body
    except (OSError, urllib.error.URLError):
        return False


def _wait_ready(port: int, managed: ManagedProcess, timeout_seconds: float = STARTUP_TIMEOUT_SECONDS) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if managed.process.poll() is not None:
            raise RuntimeError(
                f"browser-rag-ts exited before readiness (code {managed.process.returncode}): {log_tail(managed)}"
            )
        if _ready(port):
            return
        time.sleep(0.1)
    raise TimeoutError(f"browser-rag-ts did not serve its identity marker within {timeout_seconds:g} seconds: {log_tail(managed)}")


def start_server(port: int, *, log_path: Path | None = None) -> ManagedProcess:
    if not VITE_SCRIPT.is_file():
        raise RuntimeError(f"browser-rag-ts module is missing: {MODULE}")
    _validate_port(port)
    resolved_log = (log_path or PROOF_ROOT / "browser-rag-vite.log").resolve()
    command = [*node_command(), str(VITE_SCRIPT), "--host", "127.0.0.1", "--port", str(port), "--strictPort"]
    return spawn_process("browser-rag-ts", command, MODULE, dict(os.environ), resolved_log)


def stop_server(managed: ManagedProcess | None, port: int) -> dict[str, bool]:
    if not stop_process(managed):
        raise RuntimeError("browser-rag-ts process tree did not terminate cleanly")
    if not wait_port_release(port):
        raise RuntimeError(f"browser-rag-ts port did not release after shutdown: {port}")
    return {"vite_process_tree_terminated": True, "port_released": True}


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int)
    parser.add_argument("--no-open", action="store_true", help="do not open the ready URL in the default browser")
    parser.add_argument("--exit-after-ready", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    managed: ManagedProcess | None = None
    port = args.port or _free_port()
    result = 1
    try:
        managed = start_server(port)
        _wait_ready(port, managed)
        url = f"http://127.0.0.1:{port}/"
        print(f"browser-rag-ts ready: {url}")
        if not args.no_open and not args.exit_after_ready:
            webbrowser.open(url, new=1)
        if args.exit_after_ready:
            result = 0
        else:
            result = int(managed.process.wait() or 0)
    except KeyboardInterrupt:
        result = 130
    except (OSError, RuntimeError, TimeoutError, ValueError) as exc:
        print(f"browser-rag-ts run failed: {exc}", file=sys.stderr)
        result = 1
    finally:
        if managed is not None:
            try:
                stop_server(managed, port)
            except RuntimeError as exc:
                print(f"browser-rag-ts cleanup failed: {exc}", file=sys.stderr)
                result = 1
    return result


if __name__ == "__main__":
    raise SystemExit(main())
