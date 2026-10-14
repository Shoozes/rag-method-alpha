"""Run a bounded browser-rag-ts proof and validate Worker evidence exactly."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from browser_rag_run import PROOF_ROOT, _free_port, _wait_ready, start_server, stop_server
from local_runtime import log_tail
from runtime_commands import node_command, npm_command


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules" / "browser-rag-ts"
SMOKE = ROOT / "scripts" / "browser_rag_smoke.mjs"
MAX_REPORT_BYTES = 8 * 1024 * 1024
DRIVER_TIMEOUT_SECONDS = 180
MODULE_VERSION = json.loads((MODULE / "module.json").read_text(encoding="utf-8"))["version"]
CHECK_NAMES = (
    "page_ready",
    "identity_marker",
    "heading_visible",
    "worker_initialized",
    "graph_projection",
    "renderer_tsl_active",
    "renderer_webgl2_device_loss_fallback",
    "renderer_svg_opt_out",
    "default_presentation",
    "initial_worker_reports",
    "worker_actual_reports_downloaded",
    "exact_query",
    "keyword_query",
    "fixture_semantic_query",
    "scoped_query",
    "cross_reference_query",
    "result_to_graph_selection",
    "renderer_selection_diagnostics",
    "managed_canvas_selection",
    "graph_to_result_selection",
    "graph_view_switch",
    "graph_rapid_view_cancellation",
    "foreground_graph_coordination",
    "selection_reset",
    "component_scores_visible",
    "context_visible",
    "readable_evidence",
    "managed_mobile_auto_viewport",
    "managed_mobile_webgl2_viewport",
    "managed_resize_rotation",
    "svg_mobile_view_switch",
    "svg_text_zoom_rotation",
    "reduced_motion",
    "responsive_captures",
    "query_report_downloaded",
    "query_report_copy",
    "query_report_failure_isolation",
    "local_document_query",
    "selected_outside_graph_window",
    "long_heading_graph_isolation",
    "real_worker_cancellation",
    "diagnostic_preserves_collection",
    "worker_disposal",
    "session_cleanup",
)
SCORE_COMPONENTS = (
    "exact_micro",
    "semantic_micro",
    "keyword_micro",
    "scope_micro",
    "provenance_micro",
    "authority_micro",
    "priority_micro",
    "aspect_coverage_micro",
    "cross_reference_micro",
)
TERMINATION_KEYS = (
    "worker_disposal_acknowledged",
    "page_closed",
    "browser_context_closed",
    "browser_closed",
    "vite_process_tree_terminated",
    "port_released",
)


def _inside_proof_root(path: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(PROOF_ROOT.resolve())
    except ValueError as exc:
        raise ValueError(f"browser proof output must remain under {PROOF_ROOT}: {resolved}") from exc
    return resolved


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"browser proof artifact is missing: {path}")
    if path.stat().st_size > MAX_REPORT_BYTES:
        raise RuntimeError(f"browser proof artifact exceeds {MAX_REPORT_BYTES} bytes: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"browser proof artifact must be an object: {path}")
    return value


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must be an object")
    return value


def _exact(value: Any, fields: Sequence[str], label: str) -> dict[str, Any]:
    payload = _object(value, label)
    if set(payload) != set(fields):
        raise RuntimeError(f"{label} has invalid fields")
    return payload


def _text(value: Any, label: str, maximum: int = 16_384) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise RuntimeError(f"{label} must be a bounded non-empty string")
    return value


def _integer(value: Any, label: str, minimum: int = 0, maximum: int = 2**53 - 1) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise RuntimeError(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def _elapsed(value: Any, label: str) -> float:
    if type(value) not in (int, float) or isinstance(value, bool) or value < 0:
        raise RuntimeError(f"{label} must be a non-negative numeric elapsed time")
    return float(value)


def _digest(value: Any, label: str) -> str:
    text = _text(value, label, 64)
    if len(text) != 64 or any(character not in "0123456789abcdef" for character in text):
        raise RuntimeError(f"{label} must be a SHA-256 digest")
    return text


def _string_list(value: Any, label: str, maximum: int = 50_000) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum:
        raise RuntimeError(f"{label} must be a bounded string list")
    return [_text(item, f"{label}[{index}]") for index, item in enumerate(value)]


def _contract_identity(value: Any, expected_id: str, label: str) -> None:
    payload = _exact(value, ("id", "version", "runtime_snapshot_digest", "input_digests"), label)
    if payload["id"] != expected_id:
        raise RuntimeError(f"{label} has the wrong contract ID")
    _integer(payload["version"], f"{label} version", 1, 1_000)
    _digest(payload["runtime_snapshot_digest"], f"{label} runtime snapshot digest")
    inputs = _object(payload["input_digests"], f"{label} input digests")
    if not inputs:
        raise RuntimeError(f"{label} has no input digests")
    for path, value in inputs.items():
        _text(path, f"{label} input path", 512)
        _digest(value, f"{label} input digest")


def _observation(value: Any, label: str) -> None:
    payload = _exact(value, ("eligible_ids", "candidate_ids", "ordered_ids", "scores", "context_selected_ids", "context_tokens", "truncated", "semantic_state", "semantic_fallback_reason", "errors"), label)
    ordered = _string_list(payload["ordered_ids"], f"{label} ordered_ids", 100)
    scores = payload["scores"]
    if not isinstance(scores, list) or len(scores) > 100:
        raise RuntimeError(f"{label} scores are invalid")
    score_ids: list[str] = []
    for index, value in enumerate(scores):
        score = _exact(value, ("id", "score_micro", "components", "cross_reference_from_id"), f"{label} score {index}")
        score_ids.append(_text(score["id"], f"{label} score {index} ID", 128))
        _integer(score["score_micro"], f"{label} score {index}", 0, 1_000_000)
        components = _exact(score["components"], SCORE_COMPONENTS, f"{label} score {index} components")
        for component in SCORE_COMPONENTS:
            _integer(components[component], f"{label} score {index} {component}", -1_000_000, 1_000_000)
        if score["cross_reference_from_id"] is not None:
            _text(score["cross_reference_from_id"], f"{label} score {index} cross reference", 128)
    if ordered != score_ids:
        raise RuntimeError(f"{label} ordered IDs do not match scores")
    _string_list(payload["eligible_ids"], f"{label} eligible_ids")
    _string_list(payload["candidate_ids"], f"{label} candidate_ids")
    _string_list(payload["context_selected_ids"], f"{label} context_selected_ids", 100)
    _integer(payload["context_tokens"], f"{label} context_tokens", 0, 1_800)
    if type(payload["truncated"]) is not bool:
        raise RuntimeError(f"{label} truncated is invalid")
    if payload["semantic_state"] not in ("not_requested", "ready", "disabled_by_settings", "lexical_fallback"):
        raise RuntimeError(f"{label} semantic_state is invalid")
    if payload["semantic_fallback_reason"] not in (None, "disabled_by_settings", "no_compatible_vectors", "embedding_failed"):
        raise RuntimeError(f"{label} semantic_fallback_reason is invalid")
    _string_list(payload["errors"], f"{label} errors", 1_000)


def _indexing_actual(value: Any, label: str) -> None:
    envelope = _object(value, label)
    if envelope.get("status") == "error":
        failed = _exact(envelope, ("status", "error"), label)
        details = _exact(failed["error"], ("code",), f"{label} error")
        _text(details["code"], f"{label} error code", 128)
        return
    success = _exact(envelope, ("status", "document"), label)
    if success["status"] != "ok":
        raise RuntimeError(f"{label} status is invalid")
    document = _exact(success["document"], ("format", "path", "pocket", "scopes", "authority", "priority", "source_id", "source_content_id", "source_utf8_bytes", "canonical_content_id", "canonical_scalar_count", "normalization", "limits", "records"), f"{label} document")
    if document["format"] not in ("markdown", "text"):
        raise RuntimeError(f"{label} format is invalid")
    for field in ("path", "pocket", "authority"):
        _text(document[field], f"{label} {field}", 256)
    _string_list(document["scopes"], f"{label} scopes", 16)
    _integer(document["priority"], f"{label} priority", -100, 100)
    for field in ("source_id", "source_content_id", "canonical_content_id"):
        _digest(document[field], f"{label} {field}")
    _integer(document["source_utf8_bytes"], f"{label} source bytes", 0, 10 * 1024 * 1024)
    _integer(document["canonical_scalar_count"], f"{label} scalar count", 0, 10 * 1024 * 1024)
    normalization = _exact(document["normalization"], ("bom_removed", "line_endings_changed", "frontmatter_removed"), f"{label} normalization")
    if any(type(item) is not bool for item in normalization.values()):
        raise RuntimeError(f"{label} normalization is invalid")
    limits = _exact(document["limits"], ("max_chars", "max_tokens"), f"{label} limits")
    _integer(limits["max_chars"], f"{label} max chars", 1, 1_000_000)
    _integer(limits["max_tokens"], f"{label} max tokens", 1, 1_000_000)
    records = document["records"]
    if not isinstance(records, list) or len(records) > 50_000:
        raise RuntimeError(f"{label} records are invalid")
    for index, value in enumerate(records):
        record = _exact(value, ("id", "text", "source_id", "source_name", "path", "pocket", "scope", "scopes", "authority", "priority", "provenance", "references", "embedding_profile_id", "metadata"), f"{label} record {index}")
        for field in ("id", "text", "source_id", "source_name", "path", "pocket", "scope", "authority"):
            _text(record[field], f"{label} record {index} {field}")
        _string_list(record["scopes"], f"{label} record {index} scopes", 16)
        _integer(record["priority"], f"{label} record {index} priority", -100, 100)
        provenance = _exact(record["provenance"], ("file_source", "chunk_source"), f"{label} record {index} provenance")
        if type(provenance["file_source"]) is not bool or type(provenance["chunk_source"]) is not bool:
            raise RuntimeError(f"{label} record {index} provenance is invalid")
        _string_list(record["references"], f"{label} record {index} references", 1_024)
        if record["embedding_profile_id"] is not None:
            _text(record["embedding_profile_id"], f"{label} record {index} embedding profile", 128)
        _object(record["metadata"], f"{label} record {index} metadata")


def _actual_report(value: Any, kind: str) -> dict[str, Any]:
    report = _exact(value, ("schema", "protocol_version", "kind", "identity", "contract", "summary", "results"), f"{kind} report")
    if report["schema"] != "browser-rag-ts-worker-actual-report-v1" or report["protocol_version"] != 1 or report["kind"] != kind:
        raise RuntimeError(f"{kind} report identity is invalid")
    identity = _exact(report["identity"], ("implementation", "language", "module_version"), f"{kind} report identity")
    if identity != {"implementation": "rag-method-browser-ts-worker", "language": "typescript", "module_version": MODULE_VERSION}:
        raise RuntimeError(f"{kind} report implementation identity is invalid")
    _contract_identity(report["contract"], "rag-indexing-v1" if kind == "indexing" else "rag-behavior-v2", f"{kind} report contract")
    summary = _exact(report["summary"], ("cases", "errors"), f"{kind} report summary")
    results = report["results"]
    if not isinstance(results, list) or len(results) != _integer(summary["cases"], f"{kind} report cases", 0, 50_000):
        raise RuntimeError(f"{kind} report case count is invalid")
    errors = 0
    for index, value in enumerate(results):
        fields = ("id", "actual") if kind == "indexing" else ("id", "mode", "actual")
        item = _exact(value, fields, f"{kind} report case {index}")
        _text(item["id"], f"{kind} report case {index} ID", 256)
        if kind == "retrieval":
            _text(item["mode"], f"{kind} report case {index} mode", 128)
        actual = _object(item["actual"], f"{kind} report case {index} actual")
        if "expected" in actual or "passed" in actual:
            raise RuntimeError(f"{kind} report leaks proof-only data")
        if kind == "retrieval":
            _observation(actual, f"{kind} report case {index} observation")
        else:
            _indexing_actual(actual, f"{kind} report case {index} observation")
        errors += actual.get("status") == "error"
    if _integer(summary["errors"], f"{kind} report errors", 0, len(results)) != errors:
        raise RuntimeError(f"{kind} report error count is inconsistent")
    return report


def _query_report(value: Any) -> dict[str, Any]:
    report = _exact(value, ("schema", "protocol_version", "kind", "identity", "contract", "query", "observation"), "query report")
    if report["schema"] != "browser-rag-ts-worker-query-report-v1" or report["protocol_version"] != 1 or report["kind"] != "query":
        raise RuntimeError("query report identity is invalid")
    identity = _exact(report["identity"], ("implementation", "language", "module_version"), "query report identity")
    if identity != {"implementation": "rag-method-browser-ts-worker", "language": "typescript", "module_version": MODULE_VERSION}:
        raise RuntimeError("query report implementation identity is invalid")
    _contract_identity(report["contract"], "rag-behavior-v2", "query report contract")
    _text(report["query"], "query report query")
    _observation(report["observation"], "query report observation")
    return report


def _run(command: list[str], *, timeout: int | None = None) -> None:
    print(f"[browser-rag-smoke] {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True, timeout=timeout)


def _validate_driver_report(path: Path, *, require_server_cleanup: bool = True) -> dict[str, Any]:
    report = _read_object(path)
    expected = {"schema", "status", "target", "runtime", "timings", "checks", "mobile_journeys", "reports", "errors", "termination"}
    if set(report) != expected or report["schema"] != "browser-rag-ts-smoke-v10" or report["status"] != "pass":
        raise RuntimeError("browser smoke report does not declare a passing v10 proof")
    target = _exact(report["target"], ("url", "port"), "browser smoke target")
    _text(target["url"], "browser smoke target URL", 2_048)
    _integer(target["port"], "browser smoke target port", 1_024, 65_535)
    runtime = _exact(report["runtime"], ("node", "playwright", "browser", "browser_executable", "module_version"), "browser smoke runtime")
    for field in ("node", "playwright", "browser", "browser_executable"):
        _text(runtime[field], f"browser smoke runtime {field}", 4_096)
    if runtime["module_version"] != MODULE_VERSION:
        raise RuntimeError("browser smoke report module version is stale")
    timings = _exact(report["timings"], ("navigation_ms", "total_ms"), "browser smoke timings")
    _elapsed(timings["navigation_ms"], "browser smoke navigation elapsed time")
    _elapsed(timings["total_ms"], "browser smoke total elapsed time")
    checks = report["checks"]
    if not isinstance(checks, list) or len(checks) != len(CHECK_NAMES):
        raise RuntimeError("browser smoke report has the wrong check count")
    for expected_name, check in zip(CHECK_NAMES, checks):
        payload = _exact(check, ("name", "status", "elapsed_ms"), f"browser smoke check {expected_name}")
        if payload["name"] != expected_name or payload["status"] != "pass":
            raise RuntimeError(f"browser smoke check {expected_name} is not an exact passing check")
        _elapsed(payload["elapsed_ms"], f"browser smoke check {expected_name} elapsed time")
    mobile_journeys = _exact(report["mobile_journeys"], ("auto", "webgl2"), "browser smoke mobile journeys")
    for requested_backend in ("auto", "webgl2"):
        evidence = _exact(
            mobile_journeys[requested_backend],
            ("requested_backend", "selected_backend", "device_pixel_ratio", "viewport", "graph_revision", "topology_revision", "camera_revision", "picking_revision", "picking_mode", "selected_node_ids"),
            f"browser smoke {requested_backend} mobile evidence",
        )
        if evidence["requested_backend"] != requested_backend or evidence["selected_backend"] not in {"webgpu", "webgl2"}:
            raise RuntimeError(f"browser smoke {requested_backend} backend evidence is invalid")
        if requested_backend == "webgl2" and evidence["selected_backend"] != "webgl2":
            raise RuntimeError("forced WebGL2 mobile evidence selected another backend")
        if _elapsed(evidence["device_pixel_ratio"], f"browser smoke {requested_backend} device scale") <= 0:
            raise RuntimeError(f"browser smoke {requested_backend} device scale must be positive")
        viewport = _exact(evidence["viewport"], ("width", "height"), f"browser smoke {requested_backend} viewport")
        _integer(viewport["width"], f"browser smoke {requested_backend} viewport width", 1)
        _integer(viewport["height"], f"browser smoke {requested_backend} viewport height", 1)
        for revision in ("graph_revision", "topology_revision", "camera_revision", "picking_revision"):
            _integer(evidence[revision], f"browser smoke {requested_backend} {revision}", 1)
        if evidence["picking_mode"] not in {"raycast", "spatial", "gpu-id"}:
            raise RuntimeError(f"browser smoke {requested_backend} picking mode is invalid")
        selected = _string_list(evidence["selected_node_ids"], f"browser smoke {requested_backend} selected node IDs", 2)
        if len(selected) != 2 or selected[0] == selected[1]:
            raise RuntimeError(f"browser smoke {requested_backend} did not select two distinct edge nodes")
    errors = _exact(report["errors"], ("console", "warnings", "page", "requests", "responses", "workers", "expected"), "browser smoke errors")
    if any(errors[name] for name in errors if name != "expected"):
        raise RuntimeError("browser smoke report contains browser, page, Worker, request, response, or warning diagnostics")
    expected_diagnostics = _string_list(errors["expected"], "browser smoke expected diagnostics", 16)
    if not any("WebGL Device Lost" in message for message in expected_diagnostics):
        raise RuntimeError("browser smoke report did not record the expected device-loss diagnostic")
    required = {"indexing", "retrieval", "query"}
    reports = _object(report["reports"], "browser smoke report artifacts")
    if set(reports) != required:
        raise RuntimeError("browser smoke report does not declare exactly the required Worker report artifacts")
    for kind, metadata in reports.items():
        fields = ("path", "sha256", "bytes", "cases") if kind in {"indexing", "retrieval"} else ("path", "sha256", "bytes", "query")
        payload = _exact(metadata, fields, f"browser smoke {kind} metadata")
        relative_path = _text(payload["path"], f"browser smoke {kind} path", 4_096)
        if Path(relative_path).is_absolute():
            raise RuntimeError(f"browser smoke {kind} path must be relative")
        artifact = _inside_proof_root(ROOT / relative_path)
        if _sha256(artifact) != _digest(payload["sha256"], f"browser smoke {kind} SHA-256"):
            raise RuntimeError(f"browser smoke report hash differs for {kind}")
        if artifact.stat().st_size != _integer(payload["bytes"], f"browser smoke {kind} bytes", 1, MAX_REPORT_BYTES):
            raise RuntimeError(f"browser smoke report byte count differs for {kind}")
        report_value = _read_object(artifact)
        if kind in {"indexing", "retrieval"}:
            parsed = _actual_report(report_value, kind)
            if parsed["summary"]["cases"] != _integer(payload["cases"], f"browser smoke {kind} cases", 1, 50_000):
                raise RuntimeError(f"browser smoke report case count differs for {kind}")
        else:
            parsed = _query_report(report_value)
            if parsed["query"] != _text(payload["query"], "browser smoke query metadata"):
                raise RuntimeError("browser smoke query metadata differs from its artifact")
    termination = _exact(report["termination"], TERMINATION_KEYS, "browser smoke termination")
    for key in TERMINATION_KEYS:
        if type(termination[key]) is not bool:
            raise RuntimeError(f"browser smoke termination {key} is invalid")
    required_termination = TERMINATION_KEYS if require_server_cleanup else TERMINATION_KEYS[:4]
    if not all(termination[key] for key in required_termination):
        raise RuntimeError("browser smoke report does not prove complete runtime termination")
    return report


def _record_server_cleanup(path: Path, lifecycle: dict[str, bool]) -> None:
    if lifecycle != {"vite_process_tree_terminated": True, "port_released": True}:
        raise RuntimeError("browser-rag-ts server lifecycle proof is incomplete")
    report = _read_object(path)
    if report.get("schema") != "browser-rag-ts-smoke-v10" or report.get("status") not in ("pass", "fail"):
        raise RuntimeError("browser smoke cleanup received an invalid report envelope")
    termination = _exact(report.get("termination"), TERMINATION_KEYS, "browser smoke termination")
    if any(type(value) is not bool for value in termination.values()):
        raise RuntimeError("browser smoke termination values must be boolean")
    if report["status"] == "pass":
        _validate_driver_report(path, require_server_cleanup=False)
    # A functional failure must retain truthful cleanup without becoming a pass.
    termination.update(lifecycle)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _ensure_node_and_python_reports() -> None:
    tasks = (
        ("rag_indexing_contract.py", "--output", str(PROOF_ROOT / "indexing-python.json")),
        ("rag_contract_validate.py", "--json"),
    )
    for task in tasks:
        if task[0] == "rag_contract_validate.py":
            completed = subprocess.run([sys.executable, str(ROOT / "scripts" / task[0]), task[1]], cwd=ROOT, check=True, capture_output=True, text=True)
            value = json.loads(completed.stdout)
            if not isinstance(value, dict):
                raise RuntimeError("retrieval Python report is not an object")
            (PROOF_ROOT / "retrieval-python.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            _run([sys.executable, str(ROOT / "scripts" / task[0]), *task[1:]])
    _run([*npm_command(), "--prefix", str(MODULE), "run", "report:indexing"])
    _run([*npm_command(), "--prefix", str(MODULE), "run", "report:retrieval"])


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PROOF_ROOT / "browser.json")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    output = _inside_proof_root(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    port = _free_port()
    server = None
    started = time.monotonic()
    result = 1
    try:
        server = start_server(port, log_path=PROOF_ROOT / "browser-rag-vite.log")
        _wait_ready(port, server)
        _ensure_node_and_python_reports()
        _run([*node_command(), str(SMOKE), "--port", str(port), "--output", str(output), "--report-dir", str(PROOF_ROOT)], timeout=DRIVER_TIMEOUT_SECONDS)
        _validate_driver_report(output, require_server_cleanup=False)
        _run([*npm_command(), "--prefix", str(MODULE), "run", "report:worker:prepare", "--", "--indexing", str(PROOF_ROOT / "indexing-worker-actual.json"), "--retrieval", str(PROOF_ROOT / "retrieval-worker-actual.json"), "--output-dir", str(PROOF_ROOT)])
        for comparator, reports, output_path in (
            ("rag_indexing_three_way_diff.py", ("indexing-python.json", "indexing-node.json", "indexing-browser.json"), "indexing-three-way-diff.json"),
            ("rag_three_way_diff.py", ("retrieval-python.json", "retrieval-node.json", "retrieval-browser.json"), "retrieval-three-way-diff.json"),
        ):
            command = [sys.executable, str(ROOT / "scripts" / comparator), *(str(PROOF_ROOT / report) for report in reports), "--output", str(PROOF_ROOT / output_path)]
            print(f"[browser-rag-smoke] {' '.join(command)}", flush=True)
            completed = subprocess.run(command, cwd=ROOT, check=False, capture_output=True, text=True)
            comparison = _read_object(PROOF_ROOT / output_path)
            if comparison.get("equal") is not True or comparison.get("all_reports_passed") is not True:
                raise RuntimeError(f"{comparator} found an actual-observation mismatch: {completed.stdout or completed.stderr}")
            if completed.returncode not in (0, 1):
                raise RuntimeError(f"{comparator} failed unexpectedly: {completed.stdout or completed.stderr}")
        print(f"browser-rag-ts smoke: pass ({time.monotonic() - started:.2f}s)")
        result = 0
    except (OSError, RuntimeError, TimeoutError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        tail = log_tail(server) if server is not None else ""
        print(f"browser-rag-ts smoke failed: {exc}{f'; Vite tail: {tail}' if tail else ''}", file=sys.stderr)
        result = int(getattr(exc, "returncode", 1) or 1)
    finally:
        if server is not None:
            try:
                lifecycle = stop_server(server, port)
                if output.is_file():
                    _record_server_cleanup(output, lifecycle)
                    if result == 0:
                        _validate_driver_report(output)
            except RuntimeError as exc:
                print(f"browser-rag-ts smoke cleanup failed: {exc}", file=sys.stderr)
                result = 1
    return result


if __name__ == "__main__":
    raise SystemExit(main())
