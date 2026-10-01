#!/usr/bin/env python3
"""Validate one bounded RAG Method Lab current-query report."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


REPORT_SCHEMA = "rag_method_lab_query_report_v1"
APPLICATION_NAME = "RAG Method Lab"
APPLICATION_VERSION = json.loads(
    (Path(__file__).resolve().parents[1] / "version.json").read_text(encoding="utf-8")
)["version"]
RETRIEVAL_PROFILE_PATH = (
    Path(__file__).resolve().parents[1]
    / "contracts"
    / "rag-behavior-v2"
    / "retrieval-profile.json"
)
MAX_REPORT_BYTES = 5 * 1024 * 1024
MODES = {"exact_only", "keyword_only", "semantic_only", "hybrid", "scoped_hybrid"}
COMPARISON_MODES = {"exact_only", "keyword_only", "semantic_only", "scoped_hybrid"}
POCKETS = {"global", "vault", "lore", "memories"}
RETRIEVAL_MODES = {"lexical-hybrid", "vector-hybrid", "lexical-fallback"}
SEMANTIC_STATES = {"not_requested", "ready", "disabled_by_settings", "lexical_fallback"}
FALLBACK_REASONS = {None, "disabled_by_settings", "no_compatible_vectors", "embedding_failed"}
HEX_64 = re.compile(r"^[0-9a-f]{64}$")


class ReportValidationError(ValueError):
    """Raised when a report does not match the versioned bounded shape."""


def _load_query_limits() -> tuple[int, int]:
    """Load and validate the query boundary from the frozen retrieval profile."""
    try:
        profile = json.loads(RETRIEVAL_PROFILE_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReportValidationError(
            f"could not read frozen retrieval profile: {exc}"
        ) from exc
    limits = profile.get("limits") if isinstance(profile, dict) else None
    if not isinstance(limits, dict):
        raise ReportValidationError("frozen retrieval profile limits are missing")
    max_scalars = limits.get("max_query_chars")
    max_utf8_bytes = limits.get("max_query_utf8_bytes")
    if (
        isinstance(max_scalars, bool)
        or not isinstance(max_scalars, int)
        or max_scalars <= 0
        or isinstance(max_utf8_bytes, bool)
        or not isinstance(max_utf8_bytes, int)
        or max_utf8_bytes <= 0
    ):
        raise ReportValidationError("frozen retrieval profile query limits are invalid")
    if limits.get("query_character_unit") != "unicode_scalar_values":
        raise ReportValidationError(
            "frozen retrieval profile must count Unicode scalar values"
        )
    if limits.get("query_byte_encoding") != "utf8_strict":
        raise ReportValidationError(
            "frozen retrieval profile must require strict UTF-8"
        )
    return max_scalars, max_utf8_bytes


def _validate_query(value: Any, path: str) -> str:
    query = _string(value, path)
    max_scalars, max_utf8_bytes = _load_query_limits()
    try:
        encoded = query.encode("utf-8", "strict")
    except UnicodeEncodeError as exc:
        raise ReportValidationError(
            f"{path} must contain valid Unicode scalar values"
        ) from exc
    if len(query) > max_scalars:
        raise ReportValidationError(
            f"{path} exceeds {max_scalars:,} Unicode scalar values"
        )
    if len(encoded) > max_utf8_bytes:
        raise ReportValidationError(
            f"{path} exceeds {max_utf8_bytes:,} strict UTF-8 bytes"
        )
    return query


def _object(value: Any, path: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReportValidationError(f"{path} must be an object")
    actual = set(value)
    if actual != keys:
        missing = sorted(keys - actual)
        unknown = sorted(actual - keys)
        raise ReportValidationError(f"{path} keys differ; missing={missing}, unknown={unknown}")
    return value


def _string(value: Any, path: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value):
        raise ReportValidationError(f"{path} must be a{' non-empty' if not allow_empty else ''} string")
    return value


def _integer(value: Any, path: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ReportValidationError(f"{path} must be an integer between {minimum} and {maximum}")
    return value


def _number(value: Any, path: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReportValidationError(f"{path} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ReportValidationError(f"{path} must be finite and between {minimum} and {maximum}")
    return result


def _nullable_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return _string(value, path)


def _nullable_integer(value: Any, path: str, minimum: int, maximum: int) -> int | None:
    if value is None:
        return None
    return _integer(value, path, minimum, maximum)


def _result(value: Any, path: str, expected_rank: int) -> dict[str, Any]:
    result = _object(
        value,
        path,
        {
            "rank", "id", "chunk_id", "source_id", "path", "heading", "pocket",
            "scope", "authority", "tokens_est", "score", "score_micro",
            "match_type", "cross_reference_from_id", "score_components_micro", "text",
        },
    )
    if _integer(result["rank"], f"{path}.rank", 1, 100) != expected_rank:
        raise ReportValidationError(f"{path}.rank must preserve result order")
    for name in ("id", "chunk_id", "source_id", "path", "heading", "pocket", "scope", "authority"):
        _nullable_string(result[name], f"{path}.{name}")
    if result["id"] is None:
        raise ReportValidationError(f"{path}.id must identify the ranked chunk")
    _nullable_integer(result["tokens_est"], f"{path}.tokens_est", 0, 10_000_000)
    if result["score"] is not None:
        score = _number(result["score"], f"{path}.score", 0, 1)
    else:
        score = None
    score_micro = _integer(result["score_micro"], f"{path}.score_micro", 0, 1_000_000)
    if score is not None and score_micro is not None and not math.isclose(
        score, score_micro / 1_000_000, abs_tol=1e-9
    ):
        raise ReportValidationError(f"{path}.score must agree with score_micro")
    if result["match_type"] not in {"exact", "semantic", "keyword", "cross_reference"}:
        raise ReportValidationError(f"{path}.match_type is invalid")
    _nullable_string(result["cross_reference_from_id"], f"{path}.cross_reference_from_id")
    components = _object(
        result["score_components_micro"],
        f"{path}.score_components_micro",
        {"exact", "keyword", "semantic", "scope", "provenance", "authority", "priority", "aspect_coverage", "cross_reference"},
    )
    for name, component in components.items():
        _nullable_integer(component, f"{path}.score_components_micro.{name}", -1_000_000 if name == "priority" else 0, 1_000_000)
    _string(result["text"], f"{path}.text", allow_empty=True)
    return result


def _observation(
    value: Any,
    path: str,
    *,
    top_k: int,
    context_limit: int,
    expected_mode: str | None = None,
    detailed_score_evidence: bool | None = None,
) -> dict[str, Any]:
    observation = _object(
        value,
        path,
        {"requested_mode", "duration_ms", "retrieval_mode", "semantic_state", "semantic_fallback_reason", "context_tokens", "context_truncated", "results"},
    )
    mode = _string(observation["requested_mode"], f"{path}.requested_mode")
    if mode not in MODES or (expected_mode is not None and mode != expected_mode):
        raise ReportValidationError(f"{path}.requested_mode is invalid")
    _number(observation["duration_ms"], f"{path}.duration_ms", 0, 86_400_000)
    if observation["retrieval_mode"] not in RETRIEVAL_MODES:
        raise ReportValidationError(f"{path}.retrieval_mode is invalid")
    semantic_state = observation["semantic_state"]
    fallback_reason = observation["semantic_fallback_reason"]
    if semantic_state not in SEMANTIC_STATES:
        raise ReportValidationError(f"{path}.semantic_state is invalid")
    if fallback_reason not in FALLBACK_REASONS:
        raise ReportValidationError(f"{path}.semantic_fallback_reason is invalid")
    expected_reasons = {
        "not_requested": {None},
        "ready": {None},
        "disabled_by_settings": {"disabled_by_settings"},
        "lexical_fallback": {"no_compatible_vectors", "embedding_failed"},
    }
    if fallback_reason not in expected_reasons[semantic_state]:
        raise ReportValidationError(f"{path} semantic state and fallback reason disagree")
    _integer(observation["context_tokens"], f"{path}.context_tokens", 0, context_limit)
    if not isinstance(observation["context_truncated"], bool):
        raise ReportValidationError(f"{path}.context_truncated must be a boolean")
    results = observation["results"]
    if not isinstance(results, list) or len(results) > top_k:
        raise ReportValidationError(f"{path}.results must contain at most {top_k} items")
    ids: set[str] = set()
    for index, raw_result in enumerate(results):
        result = _result(raw_result, f"{path}.results[{index}]", index + 1)
        if result["id"] in ids:
            raise ReportValidationError(f"{path}.results contains a duplicate ID")
        ids.add(result["id"])
        debug_values = list(result["score_components_micro"].values())
        if detailed_score_evidence is True and any(value is None for value in debug_values):
            raise ReportValidationError(f"{path}.results[{index}] lacks requested score evidence")
        if detailed_score_evidence is False and any(value is not None for value in debug_values):
            raise ReportValidationError(f"{path}.results[{index}] contains unrequested score evidence")
    return observation


def validate_report(value: Any) -> dict[str, Any]:
    report = _object(
        value,
        "report",
        {"schema", "generated_at_utc", "application", "contracts", "collection", "query", "settings", "current", "comparison", "context_preview"},
    )
    if report["schema"] != REPORT_SCHEMA:
        raise ReportValidationError(f"report.schema must equal {REPORT_SCHEMA}")
    generated = _string(report["generated_at_utc"], "report.generated_at_utc")
    try:
        parsed_time = datetime.fromisoformat(generated.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReportValidationError("report.generated_at_utc must be ISO-8601") from exc
    if parsed_time.tzinfo is None:
        raise ReportValidationError("report.generated_at_utc must include a timezone")

    application = _object(report["application"], "report.application", {"name", "version"})
    if application["name"] != APPLICATION_NAME:
        raise ReportValidationError(f"report.application.name must equal {APPLICATION_NAME}")
    version = _string(application["version"], "report.application.version")
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", version):
        raise ReportValidationError("report.application.version must be a major.minor.patch version")
    if version != APPLICATION_VERSION:
        raise ReportValidationError(
            f"report.application.version must equal the project version {APPLICATION_VERSION}"
        )

    contracts = _object(report["contracts"], "report.contracts", {"retrieval", "indexing", "api"})
    if contracts != {"retrieval": "rag-behavior-v2", "indexing": "rag-indexing-v1", "api": "v1"}:
        raise ReportValidationError("report.contracts do not match the frozen application boundaries")

    collection = _object(report["collection"], "report.collection", {"id", "fingerprint", "generation"})
    _string(collection["id"], "report.collection.id")
    fingerprint = _string(collection["fingerprint"], "report.collection.fingerprint")
    if not HEX_64.fullmatch(fingerprint):
        raise ReportValidationError("report.collection.fingerprint must be a lowercase SHA-256")
    _nullable_string(collection["generation"], "report.collection.generation")
    _validate_query(report["query"], "report.query")

    settings = _object(report["settings"], "report.settings", {"pockets", "top_k", "max_context_tokens", "detailed_score_evidence"})
    pockets = settings["pockets"]
    if not isinstance(pockets, list) or not pockets or len(pockets) != len(set(pockets)) or any(pocket not in POCKETS for pocket in pockets):
        raise ReportValidationError("report.settings.pockets must be unique supported pockets")
    top_k = _integer(settings["top_k"], "report.settings.top_k", 1, 20)
    context_limit = _integer(settings["max_context_tokens"], "report.settings.max_context_tokens", 1, 1_800)
    if not isinstance(settings["detailed_score_evidence"], bool):
        raise ReportValidationError("report.settings.detailed_score_evidence must be a boolean")

    current = _observation(
        report["current"],
        "report.current",
        top_k=top_k,
        context_limit=context_limit,
        detailed_score_evidence=settings["detailed_score_evidence"],
    )
    comparison = report["comparison"]
    if not isinstance(comparison, list) or len(comparison) > 4:
        raise ReportValidationError("report.comparison must contain at most four modes")
    comparison_modes: set[str] = set()
    for index, raw_entry in enumerate(comparison):
        entry_path = f"report.comparison[{index}]"
        entry = _object(raw_entry, entry_path, {"mode", "status", "duration_ms", "error", "observation"})
        mode = _string(entry["mode"], f"{entry_path}.mode")
        if mode not in COMPARISON_MODES or mode in comparison_modes:
            raise ReportValidationError(f"{entry_path}.mode must be a unique comparison mode")
        comparison_modes.add(mode)
        _number(entry["duration_ms"], f"{entry_path}.duration_ms", 0, 86_400_000)
        if entry["status"] == "pass":
            if entry["error"] is not None or entry["observation"] is None:
                raise ReportValidationError(f"{entry_path} passing state is inconsistent")
            _observation(
                entry["observation"],
                f"{entry_path}.observation",
                top_k=min(3, top_k),
                context_limit=context_limit,
                expected_mode=mode,
                detailed_score_evidence=True,
            )
        elif entry["status"] == "error":
            _string(entry["error"], f"{entry_path}.error")
            if entry["observation"] is not None:
                raise ReportValidationError(f"{entry_path} error state must not contain an observation")
        else:
            raise ReportValidationError(f"{entry_path}.status must be pass or error")

    preview = report["context_preview"]
    current_results = current["results"]
    if not isinstance(preview, list) or len(preview) != len(current_results):
        raise ReportValidationError("report.context_preview must align with current results")
    for index, raw_item in enumerate(preview):
        path = f"report.context_preview[{index}]"
        item = _object(raw_item, path, {"rank", "id", "tokens_est", "text"})
        if _integer(item["rank"], f"{path}.rank", 1, 100) != index + 1:
            raise ReportValidationError(f"{path}.rank must preserve context order")
        if item["id"] != current_results[index]["id"]:
            raise ReportValidationError(f"{path}.id must match the ranked result")
        _nullable_integer(item["tokens_est"], f"{path}.tokens_est", 0, 10_000_000)
        _string(item["text"], f"{path}.text", allow_empty=True)
        if item["tokens_est"] != current_results[index]["tokens_est"]:
            raise ReportValidationError(f"{path}.tokens_est must match the ranked result")
        if item["text"] != current_results[index]["text"]:
            raise ReportValidationError(f"{path}.text must match the ranked result")
    return report


def load_report(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ReportValidationError(f"report file does not exist: {path}")
    if path.stat().st_size > MAX_REPORT_BYTES:
        raise ReportValidationError(f"report exceeds {MAX_REPORT_BYTES} bytes")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReportValidationError(f"report is not strict UTF-8 JSON: {exc}") from exc
    return validate_report(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Downloaded RAG Method Lab report JSON")
    args = parser.parse_args(argv)
    try:
        report = load_report(args.report)
    except ReportValidationError as exc:
        print(f"RAG Method Lab report failed: {exc}", file=sys.stderr)
        return 2
    print(
        f"RAG Method Lab report passed: {len(report['current']['results'])} current results, "
        f"{len(report['comparison'])} comparison modes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
