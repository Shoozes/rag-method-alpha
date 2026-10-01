#!/usr/bin/env python3
"""Compare two or three rag-behavior-v2 adapter reports exactly."""

from __future__ import annotations

import argparse
import json
import sys
from itertools import combinations
from pathlib import Path
from typing import Any


REPORT_CONTRACT = "rag-behavior-v2-report"
PROFILE_ID = "rag-behavior-v2-edge-derived"
OBSERVATION_FIELDS = (
    "eligible_ids",
    "candidate_ids",
    "ordered_ids",
    "scores",
    "context_selected_ids",
    "context_tokens",
    "truncated",
    "semantic_state",
    "semantic_fallback_reason",
    "errors",
)
COMPONENT_FIELDS = (
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
MODES = frozenset(
    {"exact_only", "semantic_only", "keyword_only", "hybrid", "scoped_hybrid"}
)
SEMANTIC_STATES = frozenset(
    {"not_requested", "ready", "disabled_by_settings", "lexical_fallback"}
)
FALLBACK_REASONS = frozenset(
    {"disabled_by_settings", "no_compatible_vectors", "embedding_failed"}
)
REPORT_FIELDS = frozenset(
    {"contract", "profile_id", "runner", "repository", "summary", "results"}
)
RUNNER_FIELDS = frozenset({"implementation", "language", "version"})
REPOSITORY_FIELDS = frozenset({"commit", "dirty"})
SUMMARY_FIELDS = frozenset({"cases", "passed", "failed"})


def load_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"report must contain an object: {path}")
    validate_report(payload, str(path))
    return payload


def validate_report(report: dict[str, Any], owner: str = "report") -> None:
    if set(report) != REPORT_FIELDS:
        raise ValueError(f"{owner} has an invalid top-level shape")
    if report.get("contract") != REPORT_CONTRACT or report.get("profile_id") != PROFILE_ID:
        raise ValueError(f"{owner} uses an unsupported contract or profile")
    runner = report.get("runner")
    repository = report.get("repository")
    summary = report.get("summary")
    results = report.get("results")
    if not isinstance(runner, dict) or not isinstance(repository, dict) or not isinstance(
        summary, dict
    ) or not isinstance(results, list):
        raise ValueError(f"{owner} is missing runner, repository, summary, or results")
    if set(runner) != RUNNER_FIELDS:
        raise ValueError(f"{owner} runner has an invalid shape")
    if set(repository) != REPOSITORY_FIELDS:
        raise ValueError(f"{owner} repository has an invalid shape")
    if set(summary) != SUMMARY_FIELDS:
        raise ValueError(f"{owner} summary has an invalid shape")
    for field in ("implementation", "language"):
        if not isinstance(runner.get(field), str) or not runner[field].strip():
            raise ValueError(f"{owner} runner.{field} must be a non-empty string")
    if runner.get("version") != 1 or isinstance(runner["version"], bool):
        raise ValueError(f"{owner} runner.version must be 1")
    commit = repository.get("commit")
    if (
        not isinstance(commit, str)
        or len(commit) != 40
        or any(character not in "0123456789abcdef" for character in commit)
        or not isinstance(repository.get("dirty"), bool)
    ):
        raise ValueError(f"{owner} repository state is invalid")
    counts: list[int] = []
    for field in ("cases", "passed", "failed"):
        value = summary.get(field)
        minimum = 1 if field == "cases" else 0
        if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
            raise ValueError(
                f"{owner} summary.{field} must be an integer of at least {minimum}"
            )
        counts.append(value)
    if counts[0] != len(results) or counts[1] + counts[2] != counts[0]:
        raise ValueError(f"{owner} summary totals do not match results")
    seen: set[str] = set()
    actual_passed = 0
    for result in results:
        if not isinstance(result, dict) or set(result) != {
            "id",
            "mode",
            "passed",
            "expected",
            "actual",
        }:
            raise ValueError(f"{owner} results must contain objects")
        case_id = result.get("id")
        if not isinstance(case_id, str) or not case_id.strip() or case_id in seen:
            raise ValueError(f"{owner} contains an invalid or duplicate case ID")
        seen.add(case_id)
        if result.get("mode") not in MODES:
            raise ValueError(f"{owner} case {case_id} has an invalid mode")
        if not isinstance(result.get("passed"), bool):
            raise ValueError(f"{owner} case {case_id} passed must be a boolean")
        expected = result.get("expected")
        actual = result.get("actual")
        for label, observation in (("expected", expected), ("actual", actual)):
            _validate_observation(observation, f"{owner} case {case_id} {label}")
        if result["passed"] != (expected == actual):
            raise ValueError(f"{owner} case {case_id} pass flag is inconsistent")
        actual_passed += int(result["passed"])
    if actual_passed != summary["passed"]:
        raise ValueError(f"{owner} passed count is inconsistent")


def _validate_id_list(value: object, owner: str) -> list[str]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() or item != item.strip()
        for item in value
    ):
        raise ValueError(f"{owner} must be an array of trimmed non-empty strings")
    if len(set(value)) != len(value):
        raise ValueError(f"{owner} must not contain duplicates")
    return value


def _validate_observation(observation: object, owner: str) -> None:
    if not isinstance(observation, dict) or set(observation) != set(OBSERVATION_FIELDS):
        raise ValueError(f"{owner} has an invalid observation shape")
    eligible_ids = _validate_id_list(observation["eligible_ids"], f"{owner}.eligible_ids")
    candidate_ids = _validate_id_list(observation["candidate_ids"], f"{owner}.candidate_ids")
    ordered_ids = _validate_id_list(observation["ordered_ids"], f"{owner}.ordered_ids")
    selected_ids = _validate_id_list(
        observation["context_selected_ids"],
        f"{owner}.context_selected_ids",
    )
    if selected_ids != ordered_ids:
        raise ValueError(f"{owner} context_selected_ids must equal ordered_ids")
    if not set(candidate_ids).issubset(eligible_ids):
        raise ValueError(f"{owner} candidate IDs must be eligible")
    if not set(ordered_ids).issubset(candidate_ids):
        raise ValueError(f"{owner} ordered IDs must be candidates")
    scores = observation["scores"]
    if not isinstance(scores, list) or len(scores) != len(ordered_ids):
        raise ValueError(f"{owner}.scores must align with ordered_ids")
    for expected_id, score in zip(ordered_ids, scores):
        if not isinstance(score, dict) or set(score) != {
            "id",
            "score_micro",
            "components",
            "cross_reference_from_id",
        }:
            raise ValueError(f"{owner} score entries have an invalid shape")
        if score["id"] != expected_id:
            raise ValueError(f"{owner} score IDs must align with ordered_ids")
        if (
            not isinstance(score["score_micro"], int)
            or isinstance(score["score_micro"], bool)
            or not 0 <= score["score_micro"] <= 1_000_000
        ):
            raise ValueError(f"{owner} score_micro must use bounded fixed-point units")
        components = score["components"]
        if not isinstance(components, dict) or set(components) != set(COMPONENT_FIELDS):
            raise ValueError(f"{owner} score components are incomplete")
        for name, value in components.items():
            minimum = -1_000_000 if name == "priority_micro" else 0
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or not minimum <= value <= 1_000_000
            ):
                raise ValueError(f"{owner} component {name} is out of range")
        reference = score["cross_reference_from_id"]
        if reference is not None and (
            not isinstance(reference, str)
            or not reference.strip()
            or reference != reference.strip()
            or reference not in candidate_ids
        ):
            raise ValueError(f"{owner} cross-reference origin is invalid")
    context_tokens = observation["context_tokens"]
    if (
        not isinstance(context_tokens, int)
        or isinstance(context_tokens, bool)
        or context_tokens < 0
    ):
        raise ValueError(f"{owner}.context_tokens must be a non-negative integer")
    if not isinstance(observation["truncated"], bool):
        raise ValueError(f"{owner}.truncated must be a boolean")
    state = observation["semantic_state"]
    reason = observation["semantic_fallback_reason"]
    if state not in SEMANTIC_STATES or reason not in FALLBACK_REASONS | {None}:
        raise ValueError(f"{owner} semantic state or fallback reason is invalid")
    expected_reasons = {
        "not_requested": {None},
        "ready": {None},
        "disabled_by_settings": {"disabled_by_settings"},
        "lexical_fallback": {"no_compatible_vectors", "embedding_failed"},
    }
    if reason not in expected_reasons[state]:
        raise ValueError(f"{owner} semantic state and fallback reason disagree")
    errors = observation["errors"]
    if not isinstance(errors, list) or any(
        not isinstance(error, str) or not error.strip() or error != error.strip()
        for error in errors
    ):
        raise ValueError(f"{owner}.errors must be an array of strings")


def _case_map(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {result["id"]: result for result in report["results"]}


def compare_pair(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    validate_report(left, "left report")
    validate_report(right, "right report")
    left_cases = _case_map(left)
    right_cases = _case_map(right)
    differences: list[dict[str, Any]] = []
    for case_id in sorted(set(left_cases) | set(right_cases)):
        if case_id not in left_cases or case_id not in right_cases:
            differences.append(
                {
                    "id": case_id,
                    "left_present": case_id in left_cases,
                    "right_present": case_id in right_cases,
                    "fields": ["case_presence"],
                }
            )
            continue
        left_actual = left_cases[case_id]["actual"]
        right_actual = right_cases[case_id]["actual"]
        fields: list[str] = []
        if left_cases[case_id]["mode"] != right_cases[case_id]["mode"]:
            fields.append("mode")
        if left_cases[case_id]["expected"] != right_cases[case_id]["expected"]:
            fields.append("expected")
        fields.extend(
            field
            for field in OBSERVATION_FIELDS
            if left_actual[field] != right_actual[field]
        )
        if fields:
            differences.append(
                {
                    "id": case_id,
                    "left_present": True,
                    "right_present": True,
                    "fields": fields,
                }
            )
    return {
        "left": left["runner"]["implementation"],
        "right": right["runner"]["implementation"],
        "equal": not differences,
        "differences": differences,
    }


def compare_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    if len(reports) not in {2, 3}:
        raise ValueError("two or three reports are required")
    for index, report in enumerate(reports):
        validate_report(report, f"report {index + 1}")
    implementations = [report["runner"]["implementation"] for report in reports]
    if len(set(implementations)) != len(implementations):
        raise ValueError("report implementation names must be unique")
    pairs = [compare_pair(left, right) for left, right in combinations(reports, 2)]
    return {
        "contract": "rag-behavior-v2-three-way-diff",
        "profile_id": PROFILE_ID,
        "implementations": implementations,
        "all_reports_passed": all(report["summary"]["failed"] == 0 for report in reports),
        "all_repositories_clean": all(
            not report["repository"]["dirty"] for report in reports
        ),
        "equal": all(pair["equal"] for pair in pairs),
        "pairs": pairs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = compare_reports([load_report(path) for path in args.reports])
        rendered = json.dumps(report, indent=2, sort_keys=True)
        if args.output is not None:
            output = args.output.resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(rendered + "\n", encoding="utf-8")
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"RAG report comparison failed: {exc}", file=sys.stderr)
        return 1
    print(rendered)
    return (
        0
        if report["equal"]
        and report["all_reports_passed"]
        and report["all_repositories_clean"]
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
