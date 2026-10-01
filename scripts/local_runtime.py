"""Shared fail-closed process and port lifecycle for local visual tasks."""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ManagedProcess:
    label: str
    process: subprocess.Popen[str]
    log_path: Path
    log_stream: Any


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def port_available(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def spawn_process(
    label: str,
    command: list[str],
    cwd: Path,
    environment: dict[str, str],
    log_path: Path,
) -> ManagedProcess:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_stream = log_path.open("w", encoding="utf-8", errors="replace")
    options: dict[str, Any] = {}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=log_stream,
            stderr=subprocess.STDOUT,
            text=True,
            **options,
        )
    except Exception:
        log_stream.close()
        raise
    return ManagedProcess(label, process, log_path, log_stream)


def signal_process_tree(process: subprocess.Popen[str], *, force: bool) -> bool:
    if process.poll() is not None:
        return True
    if os.name == "nt":
        if not force:
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
            except (AttributeError, OSError, ValueError):
                return False
            return True
        try:
            completed = subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        return completed.returncode == 0
    try:
        process_group = os.getpgid(process.pid)
        os.killpg(process_group, signal.SIGKILL if force else signal.SIGTERM)
    except OSError:
        return False
    return True


def terminate_process_tree(process: subprocess.Popen[str]) -> bool:
    if process.poll() is not None:
        return True
    tree_signalled = signal_process_tree(process, force=False)
    try:
        process.wait(timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        tree_signalled = signal_process_tree(process, force=True) or tree_signalled
        try:
            process.kill()
        except OSError:
            pass
        try:
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
    return process.poll() is not None and tree_signalled


def stop_process(managed: ManagedProcess | None) -> bool:
    if managed is None:
        return True
    try:
        return terminate_process_tree(managed.process)
    finally:
        managed.log_stream.close()


def log_tail(managed: ManagedProcess, lines: int = 20) -> str:
    managed.log_stream.flush()
    try:
        values = managed.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(values[-lines:])


def wait_http(url: str, managed: ManagedProcess, timeout_seconds: float = 25) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = "not ready"
    while time.monotonic() < deadline:
        if managed.process.poll() is not None:
            raise RuntimeError(
                f"{managed.label} exited before readiness (code {managed.process.returncode}): "
                f"{log_tail(managed)}"
            )
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 500:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(0.1)
    raise TimeoutError(f"{managed.label} did not become ready: {last_error}; {log_tail(managed)}")


def wait_port_release(port: int, timeout_seconds: float = 5) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if port_available(port):
            return True
        time.sleep(0.1)
    return False


def remove_tree(path: Path, timeout_seconds: float = 5) -> tuple[bool, OSError | None]:
    deadline = time.monotonic() + timeout_seconds
    last_error: OSError | None = None
    while True:
        try:
            shutil.rmtree(path)
        except FileNotFoundError:
            return True, None
        except OSError as exc:
            last_error = exc
        if not path.exists():
            return True, None
        if time.monotonic() >= deadline:
            return False, last_error
        time.sleep(0.1)
