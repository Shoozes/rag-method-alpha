#!/usr/bin/env python3
"""Validate and execute the frozen rag-indexing-v1 contract."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

from scripts.proof_repository import repository_state  # noqa: E402

from mirrorlight_backend.rag_core.indexing import (  # noqa: E402
    INDEXING_CONTRACT_ID,
    INDEXING_PROFILE_ID,
    MAX_CHUNK_CHARS,
    MAX_CHUNK_TOKENS,
    MAX_PATH_CHARS,
    MAX_SCOPES,
    MAX_SOURCE_UTF8_BYTES,
    IndexingContractError,
    IndexingLimits,
    index_document,
)


REPORT_CONTRACT = "rag-indexing-v1-report"
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_EXPECTED_MANIFEST_FIELDS = {
    "$schema",
    "contract",
    "version",
    "status",
    "owner",
    "baseline_commits",
    "fixture_counts",
    "files",
    "change_policy",
}
_CASE_FIELDS = {
    "id",
    "expected_status",
    "expected_error_code",
    "format",
    "path",
    "pocket",
    "scopes",
    "authority",
    "priority",
    "limits",
    "content",
}


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"contract file must contain an object: {path}")
    return value


def _child_path(root: Path, value: object, field_name: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty relative path")
    path = (root / value).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{field_name} must remain under the contract root") from exc
    if not path.is_file():
        raise ValueError(f"contract file is missing: {path}")
    return path


def _validate_manifest(manifest: dict[str, Any], root: Path) -> dict[str, Path]:
    if set(manifest) != _EXPECTED_MANIFEST_FIELDS:
        raise ValueError("indexing manifest fields drifted")
    if (
        manifest.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
        or manifest.get("contract") != INDEXING_CONTRACT_ID
        or manifest.get("version") != 1
        or manifest.get("status") not in {"draft", "frozen"}
        or manifest.get("owner") != "RAG-Method-PY"
        or manifest.get("change_policy")
        != "Freeze expected observations once; any later behavioral change requires a new indexing contract version."
    ):
        raise ValueError("unsupported indexing manifest")
    commits = manifest.get("baseline_commits")
    if (
        not isinstance(commits, dict)
        or set(commits) != {"rag_method_py", "edgesymbio", "tulpaweaver"}
        or any(not isinstance(value, str) or not _COMMIT_RE.fullmatch(value) for value in commits.values())
    ):
        raise ValueError("baseline commits must be exact full SHAs")
    counts = manifest.get("fixture_counts")
    if (
        not isinstance(counts, dict)
        or set(counts) != {"cases", "success", "errors"}
        or any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts.values())
        or counts["cases"] != counts["success"] + counts["errors"]
    ):
        raise ValueError("fixture counts are invalid")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != {
        "profile",
        "document_schema",
        "observation_schema",
        "report_schema",
        "fixtures",
        "expected",
        "adapters",
    }:
        raise ValueError("manifest files are invalid")
    adapters = files["adapters"]
    if not isinstance(adapters, dict) or set(adapters) != {"python", "rust", "javascript"}:
        raise ValueError("manifest adapters are invalid")
    paths = {
        key: _child_path(root, files[key], f"files.{key}")
        for key in (
            "profile",
            "document_schema",
            "observation_schema",
            "report_schema",
            "fixtures",
            "expected",
        )
    }
    for key, value in adapters.items():
        paths[f"adapter_{key}"] = _child_path(root, value, f"files.adapters.{key}")
    return paths


def _validate_profile(profile: dict[str, Any]) -> None:
    if (
        profile.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
        or profile.get("contract") != INDEXING_CONTRACT_ID
        or profile.get("version") != 1
        or profile.get("profile_id") != INDEXING_PROFILE_ID
    ):
        raise ValueError("unsupported indexing profile")
    inputs = profile.get("input")
    chunking = profile.get("chunking")
    if not isinstance(inputs, dict) or not isinstance(chunking, dict):
        raise ValueError("indexing profile input and chunking policies are required")
    expected_inputs = {
        "formats": ["markdown", "text"],
        "strict_utf8": True,
        "unicode_unit": "scalar",
        "max_source_utf8_bytes": MAX_SOURCE_UTF8_BYTES,
        "max_path_scalars": MAX_PATH_CHARS,
        "max_scopes": MAX_SCOPES,
        "nul_policy": "reject",
    }
    if inputs != expected_inputs:
        raise ValueError("indexing input policy drifted")
    if (
        chunking.get("default_max_chars") != MAX_CHUNK_CHARS
        or chunking.get("default_max_tokens") != MAX_CHUNK_TOKENS
        or chunking.get("offset_unit") != "canonical-unicode-scalars"
        or chunking.get("overlap_chars") != 0
    ):
        raise ValueError("indexing chunk policy drifted")
    whitespace = profile.get("whitespace_code_points")
    if not isinstance(whitespace, list) or len(whitespace) != 25 or len(set(whitespace)) != 25:
        raise ValueError("explicit whitespace table drifted")


def _load_cases(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if (
        set(payload) != {"contract", "version", "cases"}
        or payload.get("contract") != "rag-indexing-v1-fixtures"
        or payload.get("version") != 1
        or not isinstance(payload.get("cases"), list)
    ):
        raise ValueError("fixture document envelope is invalid")
    cases: list[dict[str, Any]] = []
    ids: set[str] = set()
    for raw_case in payload["cases"]:
        if not isinstance(raw_case, dict) or set(raw_case) - _CASE_FIELDS:
            raise ValueError("fixture case contains unknown fields")
        required = {
            "id",
            "expected_status",
            "format",
            "path",
            "pocket",
            "scopes",
            "authority",
            "priority",
            "content",
        }
        if not required <= set(raw_case):
            raise ValueError("fixture case is missing required fields")
        case_id = raw_case["id"]
        if not isinstance(case_id, str) or not case_id or case_id in ids:
            raise ValueError("fixture case IDs must be unique non-empty strings")
        ids.add(case_id)
        status = raw_case["expected_status"]
        if status not in {"ok", "error"}:
            raise ValueError(f"fixture {case_id} has invalid expected_status")
        error_code = raw_case.get("expected_error_code")
        if (status == "error") != (isinstance(error_code, str) and bool(error_code)):
            raise ValueError(f"fixture {case_id} has inconsistent expected error data")
        limits = raw_case.get("limits")
        if limits is not None and (
            not isinstance(limits, dict)
            or set(limits) != {"max_chars", "max_tokens"}
        ):
            raise ValueError(f"fixture {case_id} limits are invalid")
        cases.append(dict(raw_case))
    return cases


def execute_case(case: dict[str, Any]) -> dict[str, Any]:
    limits_payload = case.get("limits")
    try:
        limits = (
            IndexingLimits(
                max_chars=limits_payload["max_chars"],
                max_tokens=limits_payload["max_tokens"],
            )
            if isinstance(limits_payload, dict)
            else None
        )
        document = index_document(
            case["content"],
            format=case["format"],
            path=case["path"],
            pocket=case["pocket"],
            scopes=case["scopes"],
            authority=case["authority"],
            priority=case["priority"],
            limits=limits,
        )
    except IndexingContractError as exc:
        return {"status": "error", "error": {"code": exc.code}}
    return {"status": "ok", "document": document.to_observation()}


def actual_observations(contract_root: Path | None = None) -> dict[str, dict[str, Any]]:
    bundle = load_contract(contract_root, require_expected=False)
    return {case["id"]: execute_case(case) for case in bundle["cases"]}


def _load_expected(payload: dict[str, Any], cases: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if (
        set(payload) != {"contract", "version", "observations"}
        or payload.get("contract") != "rag-indexing-v1-expected"
        or payload.get("version") != 1
        or not isinstance(payload.get("observations"), dict)
    ):
        raise ValueError("expected observation envelope is invalid")
    observations = payload["observations"]
    case_ids = {case["id"] for case in cases}
    if set(observations) != case_ids:
        raise ValueError("expected observations do not match fixture case IDs")
    if any(not isinstance(value, dict) for value in observations.values()):
        raise ValueError("expected observations must be objects")
    return observations


def load_contract(
    contract_root: Path | None = None,
    *,
    require_expected: bool = True,
) -> dict[str, Any]:
    root = (contract_root or ROOT / "contracts" / INDEXING_CONTRACT_ID).resolve()
    manifest = _read(root / "manifest.json")
    paths = _validate_manifest(manifest, root)
    _validate_profile(_read(paths["profile"]))
    for key, schema_id in {
        "document_schema": "rag-indexing-v1/document.schema.json",
        "observation_schema": "rag-indexing-v1/observation.schema.json",
        "report_schema": "rag-indexing-v1/report.schema.json",
    }.items():
        schema = _read(paths[key])
        if (
            schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
            or schema.get("$id") != schema_id
        ):
            raise ValueError(f"schema identity drifted: {paths[key]}")
    cases = _load_cases(_read(paths["fixtures"]))
    counts = manifest["fixture_counts"]
    success = sum(case["expected_status"] == "ok" for case in cases)
    if len(cases) != counts["cases"] or success != counts["success"]:
        raise ValueError("loaded fixtures do not match manifest counts")
    expected = _load_expected(_read(paths["expected"]), cases) if require_expected else {}
    return {
        "root": root,
        "manifest": manifest,
        "paths": paths,
        "cases": cases,
        "expected": expected,
    }


def write_draft_expected(contract_root: Path | None = None) -> Path:
    bundle = load_contract(contract_root, require_expected=False)
    if bundle["manifest"]["status"] != "draft":
        raise ValueError("frozen indexing expectations cannot be regenerated")
    observations = {case["id"]: execute_case(case) for case in bundle["cases"]}
    for case in bundle["cases"]:
        actual = observations[case["id"]]
        if actual.get("status") != case["expected_status"]:
            raise ValueError(f"fixture {case['id']} did not produce its intended status")
        if case["expected_status"] == "error" and actual["error"]["code"] != case["expected_error_code"]:
            raise ValueError(f"fixture {case['id']} produced the wrong error code")
    payload = {
        "contract": "rag-indexing-v1-expected",
        "version": 1,
        "observations": observations,
    }
    path = bundle["paths"]["expected"]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _git_identity(root: Path = ROOT) -> dict[str, object]:
    return repository_state(root)


def run_contract(
    contract_root: Path | None = None,
    *,
    implementation: str = "rag-method-py",
    language: str = "python",
) -> dict[str, Any]:
    bundle = load_contract(contract_root)
    results = []
    for case in bundle["cases"]:
        expected = bundle["expected"][case["id"]]
        actual = execute_case(case)
        results.append(
            {
                "id": case["id"],
                "passed": actual == expected,
                "expected": expected,
                "actual": actual,
            }
        )
    passed = sum(result["passed"] for result in results)
    return {
        "contract": REPORT_CONTRACT,
        "profile_id": INDEXING_PROFILE_ID,
        "runner": {
            "implementation": implementation,
            "language": language,
            "version": 1,
        },
        "repository": _git_identity(),
        "summary": {
            "cases": len(results),
            "passed": passed,
            "failed": len(results) - passed,
        },
        "results": results,
    }


def validate_report(report: dict[str, Any], contract_root: Path | None = None) -> None:
    if set(report) != {"contract", "profile_id", "runner", "repository", "summary", "results"}:
        raise ValueError("report top-level shape is invalid")
    if report.get("contract") != REPORT_CONTRACT or report.get("profile_id") != INDEXING_PROFILE_ID:
        raise ValueError("report contract identity is invalid")
    runner = report.get("runner")
    repository = report.get("repository")
    summary = report.get("summary")
    results = report.get("results")
    if (
        not isinstance(runner, dict)
        or set(runner) != {"implementation", "language", "version"}
        or not isinstance(runner.get("implementation"), str)
        or not runner["implementation"]
        or not isinstance(runner.get("language"), str)
        or not runner["language"]
        or runner.get("version") != 1
    ):
        raise ValueError("report runner is invalid")
    if (
        not isinstance(repository, dict)
        or set(repository) != {"commit", "dirty"}
        or not isinstance(repository.get("commit"), str)
        or not _COMMIT_RE.fullmatch(repository["commit"])
        or not isinstance(repository.get("dirty"), bool)
    ):
        raise ValueError("report repository identity is invalid")
    if not isinstance(summary, dict) or set(summary) != {"cases", "passed", "failed"}:
        raise ValueError("report summary is invalid")
    if not isinstance(results, list) or not results:
        raise ValueError("report results must be a non-empty array")
    ids: set[str] = set()
    passed = 0
    for result in results:
        if not isinstance(result, dict) or set(result) != {"id", "passed", "expected", "actual"}:
            raise ValueError("report result shape is invalid")
        case_id = result["id"]
        if not isinstance(case_id, str) or not case_id or case_id in ids:
            raise ValueError("report case IDs must be unique")
        ids.add(case_id)
        if not isinstance(result["passed"], bool) or result["passed"] != (result["actual"] == result["expected"]):
            raise ValueError("report pass flag is inconsistent")
        if not isinstance(result["expected"], dict) or not isinstance(result["actual"], dict):
            raise ValueError("report observations must be objects")
        passed += int(result["passed"])
    expected_ids = {case["id"] for case in load_contract(contract_root)["cases"]}
    if ids != expected_ids:
        raise ValueError("report cases do not match the frozen contract")
    if (
        summary.get("cases") != len(results)
        or summary.get("passed") != passed
        or summary.get("failed") != len(results) - passed
    ):
        raise ValueError("report summary totals are inconsistent")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-root", type=Path)
    parser.add_argument("--implementation", default="rag-method-py")
    parser.add_argument("--language", default="python")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--write-expected", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.write_expected:
        path = write_draft_expected(args.contract_root)
        print(f"Wrote draft expectations: {path}")
        return 0
    report = run_contract(
        args.contract_root,
        implementation=args.implementation,
        language=args.language,
    )
    validate_report(report, args.contract_root)
    if args.output is not None:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.json:
        # Keep direct CLI output safe under the legacy Windows console codepage.
        # Retained report files remain UTF-8 with readable Unicode.
        print(json.dumps(report, ensure_ascii=True, indent=2))
    else:
        summary = report["summary"]
        print(f"rag-indexing-v1: {summary['passed']}/{summary['cases']} cases passed")
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
