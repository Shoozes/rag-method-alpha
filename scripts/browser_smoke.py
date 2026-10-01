"""Run the isolated local browser flow and retain a redacted proof report."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from local_runtime import (
    ManagedProcess,
    free_port as _free_port,
    remove_tree as _remove_tree,
    spawn_process as _spawn,
    stop_process as _stop_tree,
    terminate_process_tree as _terminate_process_tree,
    wait_http as _wait_http,
    wait_port_release as _wait_port_release,
)
from lab_report_validate import load_report
from runtime_commands import node_command, npm_command


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"
FRONTEND = ROOT / "source" / "frontend"
DRIVER = ROOT / "scripts" / "browser_smoke.mjs"
ARTIFACT_ROOT = (ROOT / ".artifacts").resolve()
PROOF_ROOT = ARTIFACT_ROOT / "proof"
SHOWCASE_BROWSER_EXECUTABLE = "playwright-bundled"
DEFAULT_DESKTOP_SCREENSHOT = PROOF_ROOT / "rag-method-lab-desktop.png"
DEFAULT_MOBILE_SCREENSHOT = PROOF_ROOT / "rag-method-lab-mobile.png"
DEFAULT_QUERY_REPORT = PROOF_ROOT / "rag-method-lab-query-report.json"
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_DRIVER_SCHEMA = "mirrorlight_browser_driver_report_v1"
_EXPECTED_DRIVER_CHECK_NAMES = (
    "launch and initial state",
    "built-in demo load and idempotent selection",
    "explicit controls and ranked evidence",
    "result and graph selection",
    "bounded comparison and report export",
    "explicit cancellation, supersession, and recovery",
    "folder import and collection refresh",
    "bounded graph fallback",
    "folder retrieval and refresh",
    "ZIP import",
    "mobile containment",
)
_ALLOWED_DRIVER_WARNING_PATTERN = re.compile(
    r"^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message "
    r"\(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels"
    r"(?: \(this message will no longer repeat\))?$",
    re.IGNORECASE,
)
_ALLOWED_DRIVER_WARNING_MAX = 4
_WARNING_KEYS = {"text", "url", "line", "column"}
_APPLICATION_URL_PREFIXES = ("http://127.0.0.1:", "http://localhost:")
_DRIVER_WARNING_URL_PREFIXES = (
    "chrome://",
    "devtools://",
    "http://127.0.0.1:",
    "http://localhost:",
)


def _artifact_path(raw: str, default: Path) -> Path:
    candidate = Path(raw).expanduser() if raw else default
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(ARTIFACT_ROOT)
    except ValueError as exc:
        raise ValueError("browser-smoke artifacts must stay under .artifacts") from exc
    return resolved


def _browser_artifact_target(
    raw: str,
    default: Path,
    browser_executable: str,
) -> Path:
    target = _artifact_path(raw, default)
    if browser_executable == SHOWCASE_BROWSER_EXECUTABLE:
        return target
    if raw and target != default.resolve():
        return target
    browser_label = re.sub(
        r"[^a-z0-9]+",
        "-",
        browser_executable.lower().replace(".exe", ""),
    ).strip("-") or "fallback"
    return target.with_name(f"{target.stem}-{browser_label}{target.suffix}")


def _staging_artifact_path(label: str) -> Path:
    return (PROOF_ROOT / f".browser-smoke-{os.getpid()}-{label}").resolve()


def _promote_artifacts(artifacts: list[tuple[Path, Path]]) -> None:
    prepared: list[tuple[Path, Path, bool]] = []
    promoted: list[Path] = []
    try:
        for index, (_, target) in enumerate(artifacts):
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = target.with_name(
                f".{target.name}.browser-smoke-{os.getpid()}-{index}.bak"
            )
            backup.unlink(missing_ok=True)
            existed = target.is_file()
            if existed:
                os.replace(target, backup)
            prepared.append((target, backup, existed))
        for staging, target in artifacts:
            os.replace(staging, target)
            promoted.append(target)
    except OSError as exc:
        rollback_errors: list[str] = []
        for target in reversed(promoted):
            try:
                target.unlink(missing_ok=True)
            except OSError as rollback_exc:
                rollback_errors.append(str(rollback_exc))
        for target, backup, existed in reversed(prepared):
            if not existed or not backup.is_file():
                continue
            try:
                os.replace(backup, target)
            except OSError as rollback_exc:
                rollback_errors.append(str(rollback_exc))
        detail = f"artifact promotion failed and was rolled back: {exc}"
        if rollback_errors:
            detail += "; rollback errors: " + "; ".join(rollback_errors)
        raise OSError(detail) from exc
    else:
        for _, backup, _ in prepared:
            backup.unlink(missing_ok=True)


def _version(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return (completed.stdout or completed.stderr).strip().splitlines()[0]


def _run_driver(
    command: list[str], timeout_seconds: int
) -> tuple[dict[str, Any], bool, int]:
    options: dict[str, Any] = {}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        **options,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        stopped = _terminate_process_tree(process)
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        raise TimeoutError(
            f"browser driver timed out; process cleanup {'passed' if stopped else 'failed'}"
        ) from exc
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"browser driver returned no report: {stderr.strip()}")
    try:
        report = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"browser driver returned malformed output: {lines[-1]}") from exc
    if not isinstance(report, dict):
        raise RuntimeError("browser driver report must be a JSON object")
    stopped = process.poll() is not None
    exit_code = process.returncode if process.returncode is not None else -1
    return report, stopped, exit_code


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _redact(value: str, temporary_root: Path | None) -> str:
    text = _ANSI_ESCAPE.sub("", value)
    replacements = {
        str(ROOT): "<repo>",
        str(Path.home()): "<home>",
    }
    if temporary_root is not None:
        replacements[str(temporary_root)] = "<temp>"
    for source, replacement in replacements.items():
        text = text.replace(source, replacement).replace(source.replace("\\", "/"), replacement)
    return text


def _validate_driver_report(report: dict[str, Any]) -> None:
    if report.get("schema") != _DRIVER_SCHEMA:
        raise RuntimeError("browser driver returned an unsupported report schema")
    if report.get("status") != "pass":
        raise RuntimeError(
            f"browser flow failed: {report.get('error') or 'unknown driver failure'}"
        )

    checks = report.get("checks")
    expected_count = len(_EXPECTED_DRIVER_CHECK_NAMES)
    if not isinstance(checks, list) or len(checks) != expected_count:
        count = len(checks) if isinstance(checks, list) else 0
        raise RuntimeError(
            f"browser driver returned {count} checks; expected {expected_count}"
        )
    names: list[str] = []
    for index, check in enumerate(checks):
        if not isinstance(check, dict):
            raise RuntimeError(f"browser driver check {index + 1} is not an object")
        name = check.get("name")
        elapsed = check.get("elapsed_ms")
        if not isinstance(name, str) or not name.strip() or check.get("status") != "pass":
            raise RuntimeError(f"browser driver check {index + 1} is not a named pass")
        if (
            isinstance(elapsed, bool)
            or not isinstance(elapsed, (int, float))
            or elapsed < 0
        ):
            raise RuntimeError(f"browser driver check {name} has invalid elapsed time")
        names.append(name)
    if names != list(_EXPECTED_DRIVER_CHECK_NAMES):
        raise RuntimeError("browser driver check names or order do not match the contract")

    console = report.get("console")
    if not isinstance(console, dict):
        raise RuntimeError("browser driver console evidence is missing")
    errors = console.get("errors")
    warnings = console.get("warnings")
    expected_http_errors = console.get("expected_http_errors")
    if not isinstance(errors, list) or errors:
        raise RuntimeError("browser driver reported unexpected console errors")
    if not isinstance(warnings, list):
        raise RuntimeError("browser driver warning evidence is malformed")
    classified_warnings: list[dict[str, Any]] = []
    allowed_driver_warning_count = 0
    for index, warning in enumerate(warnings):
        if not isinstance(warning, dict) or set(warning) != _WARNING_KEYS:
            raise RuntimeError(f"browser driver warning {index + 1} is malformed")
        text = warning.get("text")
        url = warning.get("url")
        line = warning.get("line")
        column = warning.get("column")
        if (
            not isinstance(text, str)
            or not text
            or not isinstance(url, str)
            or isinstance(line, bool)
            or not isinstance(line, int)
            or line < 0
            or isinstance(column, bool)
            or not isinstance(column, int)
            or column < 0
        ):
            raise RuntimeError(f"browser driver warning {index + 1} is malformed")
        known_driver_noise = _ALLOWED_DRIVER_WARNING_PATTERN.fullmatch(text) is not None
        driver_location = not url or url.startswith(_DRIVER_WARNING_URL_PREFIXES)
        application_location = url.startswith(_APPLICATION_URL_PREFIXES)
        if known_driver_noise and driver_location:
            allowed_driver_warning_count += 1
            category = "allowed_driver_noise"
        elif application_location:
            category = "unexpected_application_warning"
            raise RuntimeError(
                f"browser driver warning {index + 1} is an unexpected application warning"
            )
        else:
            category = "unexpected_browser_warning"
            raise RuntimeError(
                f"browser driver warning {index + 1} is an unexpected browser warning"
            )
        classified_warnings.append({**warning, "category": category})
    if allowed_driver_warning_count > _ALLOWED_DRIVER_WARNING_MAX:
        raise RuntimeError(
            "browser driver reported too many allowed GPU driver warnings"
        )
    console["warnings"] = classified_warnings
    if expected_http_errors != [{"status": 400, "path": "/rag/search"}]:
        raise RuntimeError("browser driver HTTP-error evidence is incomplete")

    versions = report.get("versions")
    if not isinstance(versions, dict) or not all(
        isinstance(versions.get(name), str) and versions[name]
        for name in ("playwright", "browser", "browser_executable")
    ):
        raise RuntimeError("browser driver version evidence is incomplete")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="")
    parser.add_argument("--screenshot", default="")
    parser.add_argument("--mobile-screenshot", default="")
    parser.add_argument("--query-report", default="")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=120)
    args = parser.parse_args(argv)
    if args.timeout_seconds < 20:
        parser.error("--timeout-seconds must be at least 20")

    proof_path = _artifact_path(
        args.output,
        PROOF_ROOT / "browser-smoke.json",
    )
    screenshot_path = _artifact_path(
        args.screenshot,
        DEFAULT_DESKTOP_SCREENSHOT,
    )
    mobile_screenshot_path = _artifact_path(
        args.mobile_screenshot,
        DEFAULT_MOBILE_SCREENSHOT,
    )
    query_report_path = _artifact_path(
        args.query_report,
        DEFAULT_QUERY_REPORT,
    )
    driver_screenshot_path = _staging_artifact_path("desktop.png")
    driver_mobile_screenshot_path = _staging_artifact_path("mobile.png")
    driver_query_report_path = _staging_artifact_path("query-report.json")
    artifact_paths = {
        proof_path,
        screenshot_path,
        mobile_screenshot_path,
        query_report_path,
        driver_screenshot_path,
        driver_mobile_screenshot_path,
        driver_query_report_path,
    }
    if len(artifact_paths) != 7:
        parser.error("browser proof, screenshots, and query report must identify different files")
    started = time.monotonic()
    backend_port = _free_port()
    frontend_port = _free_port()
    while frontend_port == backend_port:
        frontend_port = _free_port()

    temporary_root: Path | None = Path(tempfile.mkdtemp(prefix="mirrorlight-browser-smoke-"))
    backend: ManagedProcess | None = None
    frontend: ManagedProcess | None = None
    driver_stopped = False
    driver_exit_code: int | None = None
    driver_report: dict[str, Any] | None = None
    error: str | None = None
    temp_removed = False
    uploads_clean = False
    collections_created = False
    query_report_valid = False
    node: list[str] = []
    npm: list[str] = []
    node_version: str | None = None
    npm_version: str | None = None

    try:
        for artifact in (
            driver_screenshot_path,
            driver_mobile_screenshot_path,
            driver_query_report_path,
        ):
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.unlink(missing_ok=True)
        node = node_command()
        npm = npm_command()
        node_version = _version([*node, "--version"])
        npm_version = _version([*npm, "--version"])
        fixture_root = temporary_root / "fixtures"
        folder = fixture_root / "folder-smoke"
        folder.mkdir(parents=True)
        (folder / "MIND.md").write_text(
            "Name: Folder Smoke\nBrowser proof persona.\n",
            encoding="utf-8",
        )
        (folder / "notes.md").write_text(
            "Folder smoke beacon for retrieval and graph proof.\n",
            encoding="utf-8",
        )
        for index in range(28):
            (folder / f"graph-{index:02d}.md").write_text(
                f"Bounded graph filler document {index}.\n",
                encoding="utf-8",
            )
        (folder / "zz-cross-origin.md").write_text(
            "Cross-reference beacon is documented here. [[zz-cross-target]]\n",
            encoding="utf-8",
        )
        (folder / "zz-cross-target.md").write_text(
            "# Destination\n\nThis note contains only the linked material.\n",
            encoding="utf-8",
        )
        archive = fixture_root / "zip-smoke.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr("zip-smoke/MIND.md", "Name: Zip Smoke\nBrowser ZIP persona.\n")
            output.writestr("zip-smoke/notes.md", "ZIP smoke beacon for retrieval proof.\n")

        environment = os.environ.copy()
        environment.update(
            {
                "MIRRORLIGHT_PROJECT_ROOT": str(ROOT),
                "MIRRORLIGHT_DATA_ROOT": str(temporary_root / "runtime-data" / "mirrorlight"),
                "MIRRORLIGHT_HOST": "127.0.0.1",
                "MIRRORLIGHT_PORT": str(backend_port),
                "MIRRORLIGHT_TRUSTED_ORIGINS": f"http://127.0.0.1:{frontend_port}",
                "VITE_BACKEND_URL": f"http://127.0.0.1:{backend_port}",
                "PYTHONUNBUFFERED": "1",
            }
        )
        backend = _spawn(
            "backend",
            [sys.executable, "-B", "-m", "mirrorlight_backend"],
            BACKEND,
            environment,
            temporary_root / "backend.log",
        )
        frontend = _spawn(
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
            temporary_root / "frontend.log",
        )
        _wait_http(f"http://127.0.0.1:{backend_port}/health", backend)
        _wait_http(f"http://127.0.0.1:{frontend_port}/", frontend)

        driver_command = [
            *node,
            str(DRIVER),
            "--url",
            f"http://127.0.0.1:{frontend_port}/",
            "--folder",
            str(folder),
            "--zip",
            str(archive),
            "--screenshot",
            str(driver_screenshot_path),
            "--mobile-screenshot",
            str(driver_mobile_screenshot_path),
            "--report",
            str(driver_query_report_path),
        ]
        if args.headed:
            driver_command.append("--headed")
        driver_report, driver_stopped, driver_exit_code = _run_driver(
            driver_command, args.timeout_seconds
        )
        if driver_exit_code != 0:
            raise RuntimeError(
                f"browser driver exited with code {driver_exit_code}: "
                f"{driver_report.get('error') or 'no driver error was reported'}"
            )
        _validate_driver_report(driver_report)
        browser_executable = str(driver_report["versions"]["browser_executable"])
        screenshot_path = _browser_artifact_target(
            args.screenshot,
            DEFAULT_DESKTOP_SCREENSHOT,
            browser_executable,
        )
        mobile_screenshot_path = _browser_artifact_target(
            args.mobile_screenshot,
            DEFAULT_MOBILE_SCREENSHOT,
            browser_executable,
        )
        if len({proof_path, screenshot_path, mobile_screenshot_path, query_report_path}) != 4:
            raise RuntimeError(
                "browser proof, screenshots, and query report must identify different files"
            )

        data_root = temporary_root / "runtime-data" / "mirrorlight"
        uploads_root = data_root / "uploads"
        uploads_clean = uploads_root.is_dir() and not any(uploads_root.iterdir())
        companion_root = data_root / "companions"
        collections_created = all(
            (companion_root / name).is_dir()
            for name in ("rag-method-demo-v1", "folder-smoke", "zip-smoke")
        )
        if not uploads_clean:
            raise RuntimeError("browser flow left upload staging artifacts")
        if not collections_created:
            raise RuntimeError("browser flow did not create every fixture collection")
        if not driver_screenshot_path.is_file():
            raise RuntimeError("browser flow did not write its desktop proof screenshot")
        if not driver_mobile_screenshot_path.is_file():
            raise RuntimeError("browser flow did not write its mobile proof screenshot")
        validated_report = load_report(driver_query_report_path)
        query_report_valid = True
    except Exception as exc:
        error = _redact(str(exc), temporary_root)
    finally:
        frontend_stopped = _stop_tree(frontend)
        backend_stopped = _stop_tree(backend)
        if temporary_root is not None:
            uploads_root = temporary_root / "runtime-data" / "mirrorlight" / "uploads"
            uploads_clean = not uploads_root.exists() or not any(uploads_root.iterdir())

    backend_port_released = _wait_port_release(backend_port)
    frontend_port_released = _wait_port_release(frontend_port)
    if temporary_root is not None:
        temp_removed, cleanup_error = _remove_tree(temporary_root)
        if cleanup_error is not None:
            error = error or _redact(
                f"temporary cleanup failed: {cleanup_error}",
                temporary_root,
            )
    cleanup = {
        "backend_stopped": backend_stopped,
        "frontend_stopped": frontend_stopped,
        "driver_stopped": driver_stopped,
        "backend_port_released": backend_port_released,
        "frontend_port_released": frontend_port_released,
        "temporary_root_removed": temp_removed,
        "upload_staging_empty_before_cleanup": uploads_clean,
    }
    preliminary_pass = (
        error is None
        and driver_report is not None
        and driver_report.get("status") == "pass"
        and collections_created
        and query_report_valid
        and all(cleanup.values())
    )
    if preliminary_pass:
        try:
            _promote_artifacts(
                [
                    (driver_screenshot_path, screenshot_path),
                    (driver_mobile_screenshot_path, mobile_screenshot_path),
                    (driver_query_report_path, query_report_path),
                ]
            )
        except OSError as exc:
            error = _redact(f"browser artifact promotion failed: {exc}", temporary_root)
    for staging in (
        driver_screenshot_path,
        driver_mobile_screenshot_path,
        driver_query_report_path,
    ):
        staging.unlink(missing_ok=True)
    passed = (
        preliminary_pass
        and error is None
        and screenshot_path.is_file()
        and mobile_screenshot_path.is_file()
        and query_report_path.is_file()
    )
    report: dict[str, Any] = {
        "schema": "mirrorlight_browser_smoke_report_v1",
        "status": "pass" if passed else "fail",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "versions": {
            "python": platform.python_version(),
            "node": node_version,
            "npm": npm_version,
            "playwright": driver_report.get("versions", {}).get("playwright")
            if driver_report
            else None,
            "browser": driver_report.get("versions", {}).get("browser")
            if driver_report
            else None,
            "browser_executable": driver_report.get("versions", {}).get(
                "browser_executable"
            )
            if driver_report
            else None,
        },
        "ports": {"backend": backend_port, "frontend": frontend_port},
        "driver": {"exit_code": driver_exit_code},
        "checks": driver_report.get("checks", []) if driver_report else [],
        "console": driver_report.get("console", {}) if driver_report else {},
        "cleanup": cleanup,
        "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
        "report_validation": {
            "status": "pass" if query_report_valid else "fail",
            "current_results": len(validated_report["current"]["results"])
            if query_report_valid
            else 0,
            "comparison_modes": len(validated_report["comparison"])
            if query_report_valid
            else 0,
        },
        "artifacts": {
            "desktop_screenshot": screenshot_path.relative_to(ROOT).as_posix(),
            "mobile_screenshot": mobile_screenshot_path.relative_to(ROOT).as_posix(),
            "query_report": query_report_path.relative_to(ROOT).as_posix(),
        },
    }
    if error:
        report["error"] = error
    _write_json(proof_path, report)
    print(json.dumps(report, separators=(",", ":"), ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
