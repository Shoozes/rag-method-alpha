"""Portable application verification runner for hosts with Python and Node."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from runtime_commands import npm_command


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"
FRONTEND = ROOT / "source" / "frontend"
BROWSER_RAG_TS = ROOT / "modules" / "browser-rag-ts"


def _run(command: list[str], cwd: Path) -> None:
    print(f"[portable] {' '.join(command)} (cwd={cwd})", flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def _backend_test() -> None:
    _run([sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-v"], BACKEND)


def _backend_compile() -> None:
    _run([sys.executable, "-B", "-m", "compileall", "-q", "mirrorlight_backend", "tests"], BACKEND)


def _rag_contract() -> None:
    _run([sys.executable, str(ROOT / "scripts" / "rag_contract_validate.py")], ROOT)


def _rag_indexing_contract() -> None:
    _run([sys.executable, str(ROOT / "scripts" / "rag_indexing_contract.py")], ROOT)


def _frontend_test() -> None:
    _run([*npm_command(), "run", "test"], FRONTEND)


def _browser_rag_npm(task: str) -> None:
    _run([*npm_command(), "--prefix", str(BROWSER_RAG_TS), "run", task], ROOT)


def _browser_rag_test() -> None:
    for task in ("contracts:check", "unicode:check", "core:check", "typecheck", "test", "build"):
        _browser_rag_npm(task)
    _browser_rag_adapter(prepared_module=True)


def _browser_rag_adapter(prepared_module: bool = False) -> None:
    arguments = ["--prepared-module"] if prepared_module else []
    _run(
        [
            sys.executable,
            str(ROOT / "scripts" / "browser_rag_adapter_conformance.py"),
            *arguments,
        ],
        ROOT,
    )


def _browser_rag_run(arguments: list[str]) -> int:
    from browser_rag_run import main as browser_rag_main

    return browser_rag_main(arguments)


def _browser_rag_smoke(arguments: list[str]) -> int:
    from browser_rag_smoke import main as browser_rag_smoke_main

    return browser_rag_smoke_main(arguments)


def _browser_smoke(arguments: list[str] | None = None) -> None:
    _run([sys.executable, str(ROOT / "scripts" / "browser_smoke.py"), *(arguments or [])], ROOT)


def _visual_run(arguments: list[str]) -> int:
    from visual_run import main as visual_main

    return visual_main(arguments)


def _benchmark() -> None:
    _run([sys.executable, str(BACKEND / "scripts" / "benchmark_rag.py"), "--output", str(ROOT / ".artifacts" / "proof" / "rag-benchmark-smoke.json")], ROOT)


def _portable_test() -> None:
    _backend_compile()
    _backend_test()
    _rag_contract()
    _rag_indexing_contract()
    _frontend_test()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-Task", "--task", default="test")
    args, task_arguments = parser.parse_known_args(argv)
    tasks = {
        "backend-compile": _backend_compile,
        "backend-test": _backend_test,
        "rag-contract": _rag_contract,
        "rag-indexing-contract": _rag_indexing_contract,
        "frontend-test": _frontend_test,
        "benchmark": _benchmark,
        "test": _portable_test,
        "active-test": _portable_test,
        "browser-rag-test": _browser_rag_test,
        "browser-rag-adapter": _browser_rag_adapter,
    }
    task = str(args.task).strip().lower()
    if task == "visual-run":
        try:
            return _visual_run(task_arguments)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            print(f"[portable] failed: {exc}", file=sys.stderr)
            return int(getattr(exc, "returncode", 1) or 1)
    if task == "browser-rag-run":
        try:
            return _browser_rag_run(task_arguments)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            print(f"[portable] failed: {exc}", file=sys.stderr)
            return int(getattr(exc, "returncode", 1) or 1)
    if task == "browser-rag-smoke":
        try:
            return _browser_rag_smoke(task_arguments)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            print(f"[portable] failed: {exc}", file=sys.stderr)
            return int(getattr(exc, "returncode", 1) or 1)
    if task == "browser-smoke":
        try:
            _browser_smoke(task_arguments)
            return 0
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            print(f"[portable] failed: {exc}", file=sys.stderr)
            return int(getattr(exc, "returncode", 1) or 1)
    if task_arguments:
        parser.error(f"task {task} does not accept additional arguments: {' '.join(task_arguments)}")
    if task not in tasks:
        parser.error(
            "portable application runner supports: " + ", ".join(sorted([*tasks, "browser-rag-run", "browser-rag-smoke", "browser-smoke", "visual-run"]))
        )
    try:
        tasks[task]()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"[portable] failed: {exc}", file=sys.stderr)
        return int(getattr(exc, "returncode", 1) or 1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
