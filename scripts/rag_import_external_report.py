#!/usr/bin/env python3
"""Validate and canonically retain one external v2 adapter report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.rag_three_way_diff import load_report, validate_report  # noqa: E402
from scripts.rag_contract_validate import load_contract  # noqa: E402


def validate_external_report(report: dict[str, object], implementation: str) -> None:
    validate_report(report)
    implementation = implementation.strip()
    runner = report["runner"]
    if (
        not implementation
        or not isinstance(runner, dict)
        or runner.get("implementation") != implementation
    ):
        raise ValueError("report implementation does not match --implementation")
    repository = report["repository"]
    summary = report["summary"]
    if not isinstance(repository, dict) or repository.get("dirty") is not False:
        raise ValueError("external report must come from a clean repository")
    if not isinstance(summary, dict) or summary.get("failed") != 0:
        raise ValueError("external report contains failed cases")
    contract = load_contract()
    frozen = contract["expected"]
    frozen_modes = {case["id"]: case["mode"] for case in contract["cases"]}
    results = report["results"]
    report_cases = {result["id"]: result for result in results}
    if set(report_cases) != set(frozen) or any(
        report_cases[case_id]["expected"] != expected
        or report_cases[case_id]["mode"] != frozen_modes[case_id]
        for case_id, expected in frozen.items()
    ):
        raise ValueError(
            "report cases, modes, or expectations do not match the frozen local contract"
        )
    if any(
        report_cases[case_id]["actual"] != expected
        or report_cases[case_id]["passed"] is not True
        for case_id, expected in frozen.items()
    ):
        raise ValueError("external report actual observations failed the frozen contract")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--implementation", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = load_report(args.report.resolve())
        implementation = args.implementation.strip()
        validate_external_report(report, implementation)
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"External RAG report import failed: {exc}", file=sys.stderr)
        return 1
    print(f"Validated {implementation} report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
