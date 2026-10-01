#!/usr/bin/env python3
"""Launch the prepared local RAG Method Lab backend and frontend together."""

from __future__ import annotations

import argparse
import os
import sys
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

from local_runtime import (
    ManagedProcess,
    free_port,
    log_tail,
    port_available,
    spawn_process,
    stop_process,
    wait_http,
    wait_port_release,
)
from runtime_commands import npm_command


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"
FRONTEND = ROOT / "source" / "frontend"


def _port(raw: int, label: str) -> int:
    if raw == 0:
        return free_port()
    if not 1 <= raw <= 65_535:
        raise ValueError(f"{label} must be 0 or between 1 and 65535")
    if not port_available(raw):
        raise ValueError(f"{label} {raw} is already occupied")
    return raw


def _process_failure(process: ManagedProcess) -> RuntimeError:
    return RuntimeError(
        f"{process.label} exited unexpectedly (code {process.process.returncode}): "
        f"{log_tail(process)}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-port", type=int, default=0)
    parser.add_argument("--frontend-port", type=int, default=0)
    parser.add_argument("--data-root", default=str(ROOT / "runtime-data" / "mirrorlight"))
    parser.add_argument("--embedding-mode", choices=("disabled", "hash"), default="disabled")
    parser.add_argument("--startup-timeout", type=float, default=30)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument(
        "--exit-after-ready",
        action="store_true",
        help="Verification mode: stop both servers immediately after readiness.",
    )
    args = parser.parse_args(argv)
    if not 5 <= args.startup_timeout <= 120:
        parser.error("--startup-timeout must be between 5 and 120 seconds")

    backend: ManagedProcess | None = None
    frontend: ManagedProcess | None = None
    backend_port = 0
    frontend_port = 0
    failure: Exception | None = None
    interrupted = False
    try:
        backend_port = _port(args.backend_port, "backend port")
        frontend_port = _port(args.frontend_port, "frontend port")
        while frontend_port == backend_port:
            if args.frontend_port:
                raise ValueError("backend and frontend ports must differ")
            frontend_port = free_port()

        npm = npm_command()
        data_root = Path(args.data_root).expanduser().resolve()
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
        log_root = ROOT / ".artifacts" / "visual-run" / run_id
        environment = os.environ.copy()
        environment.update(
            {
                "MIRRORLIGHT_PROJECT_ROOT": str(ROOT),
                "MIRRORLIGHT_DATA_ROOT": str(data_root),
                "MIRRORLIGHT_HOST": "127.0.0.1",
                "MIRRORLIGHT_PORT": str(backend_port),
                "MIRRORLIGHT_TRUSTED_ORIGINS": f"http://127.0.0.1:{frontend_port}",
                "MIRRORLIGHT_EMBEDDING_MODE": args.embedding_mode,
                "VITE_BACKEND_URL": f"http://127.0.0.1:{backend_port}",
                "PYTHONUNBUFFERED": "1",
            }
        )
        backend = spawn_process(
            "backend",
            [sys.executable, "-B", "-m", "mirrorlight_backend"],
            BACKEND,
            environment,
            log_root / "backend.log",
        )
        frontend = spawn_process(
            "frontend",
            [
                *npm,
                "run",
                "dev",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(frontend_port),
                "--strictPort",
            ],
            FRONTEND,
            environment,
            log_root / "frontend.log",
        )
        wait_http(
            f"http://127.0.0.1:{backend_port}/health",
            backend,
            args.startup_timeout,
        )
        url = f"http://127.0.0.1:{frontend_port}/"
        wait_http(url, frontend, args.startup_timeout)
        vector_label = (
            "prototype hash vectors (not model semantics)"
            if args.embedding_mode == "hash"
            else "lexical retrieval; semantic vectors disabled"
        )
        print(f"RAG Method Lab ready: {url}", flush=True)
        print(f"Mode: {vector_label}", flush=True)
        print(f"Logs: {log_root.relative_to(ROOT).as_posix()}", flush=True)

        if not args.no_open and not args.exit_after_ready:
            if not webbrowser.open(url, new=2):
                print("Browser did not open automatically; use the URL above.", flush=True)
        if args.exit_after_ready:
            print("Readiness verified; stopping both servers.", flush=True)
        else:
            print("Press Ctrl+C to stop RAG Method Lab.", flush=True)
            while True:
                if backend.process.poll() is not None:
                    raise _process_failure(backend)
                if frontend.process.poll() is not None:
                    raise _process_failure(frontend)
                time.sleep(0.2)
    except KeyboardInterrupt:
        interrupted = True
        print("\nStopping RAG Method Lab…", flush=True)
    except (OSError, RuntimeError, ValueError, TimeoutError) as exc:
        failure = exc
        print(f"RAG Method Lab failed: {exc}", file=sys.stderr, flush=True)
    finally:
        frontend_stopped = stop_process(frontend)
        backend_stopped = stop_process(backend)
        frontend_released = not frontend_port or wait_port_release(frontend_port)
        backend_released = not backend_port or wait_port_release(backend_port)

    cleanup_passed = frontend_stopped and backend_stopped and frontend_released and backend_released
    if not cleanup_passed:
        print(
            "RAG Method Lab cleanup failed: "
            f"backend_stopped={backend_stopped}, frontend_stopped={frontend_stopped}, "
            f"backend_port_released={backend_released}, frontend_port_released={frontend_released}",
            file=sys.stderr,
        )
        return 1
    if failure is not None:
        return 1
    print("RAG Method Lab stopped cleanly." if interrupted else "RAG Method Lab cleanup passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
