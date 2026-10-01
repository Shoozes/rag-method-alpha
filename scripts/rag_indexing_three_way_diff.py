#!/usr/bin/env python3
"""Compare two or three clean rag-indexing-v1 reports exactly."""

from __future__ import annotations

import argparse
import json
import sys
from itertools import combinations
from pathlib import Path
from typing import Any

from rag_indexing_contract import INDEXING_PROFILE_ID, validate_report


def _difference_paths(left: object, right: object, prefix: str = "") -> list[str]:
    if type(left) is not type(right):
        return [prefix or "$type"]
    if isinstance(left, dict):
        paths: list[str] = []
        for key in sorted(set(left) | set(right)):
            path = f"{prefix}.{key}" if prefix else str(key)
            if key not in left or key not in right:
                paths.append(path)
            else:
                paths.extend(_difference_paths(left[key], right[key], path))
        return paths
    if isinstance(left, list):
        if len(left) != len(right):
            return [f"{prefix}.length"]
        paths = []
        for index, (left_value, right_value) in enumerate(zip(left, right)):
            paths.extend(_difference_paths(left_value, right_value, f"{prefix}[{index}]"))
        return paths
    return [] if left == right else [prefix or "$value"]


def compare_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    if not 2 <= len(reports) <= 3:
        raise ValueError("exact comparison requires two or three reports")
    for report in reports:
        validate_report(report)
    implementations = [report["runner"]["implementation"] for report in reports]
    if len(set(implementations)) != len(implementations):
        raise ValueError("report implementations must be unique")
    pairs = []
    for left_index, right_index in combinations(range(len(reports)), 2):
        left = reports[left_index]
        right = reports[right_index]
        right_results = {result["id"]: result for result in right["results"]}
        differences = []
        for left_result in left["results"]:
            right_result = right_results[left_result["id"]]
            fields = _difference_paths(left_result["actual"], right_result["actual"])
            if fields:
                differences.append({"id": left_result["id"], "fields": fields})
        pairs.append(
            {
                "left": left["runner"]["implementation"],
                "right": right["runner"]["implementation"],
                "equal": not differences,
                "differences": differences,
            }
        )
    return {
        "contract": "rag-indexing-v1-three-way-diff",
        "profile_id": INDEXING_PROFILE_ID,
        "implementations": implementations,
        "equal": all(pair["equal"] for pair in pairs),
        "all_reports_passed": all(report["summary"]["failed"] == 0 for report in reports),
        "all_repositories_clean": all(not report["repository"]["dirty"] for report in reports),
        "pairs": pairs,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        reports = []
        for path in args.reports:
            report = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(report, dict):
                raise ValueError(f"report must be a JSON object: {path}")
            reports.append(report)
        comparison = compare_reports(reports)
        if args.output is not None:
            output = args.output.resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(
                json.dumps(comparison, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"RAG indexing report comparison failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(comparison, ensure_ascii=True, indent=2))
    return 0 if (
        comparison["equal"]
        and comparison["all_reports_passed"]
        and comparison["all_repositories_clean"]
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
