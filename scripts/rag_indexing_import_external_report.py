#!/usr/bin/env python3
"""Strictly import one clean native rag-indexing-v1 report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from rag_indexing_contract import load_contract, validate_report


def validate_external_report(
    report: dict[str, Any],
    implementation: str,
    contract_root: Path | None = None,
) -> None:
    validate_report(report, contract_root)
    if report["runner"]["implementation"] != implementation:
        raise ValueError("report implementation does not match the requested spoke")
    if report["repository"]["dirty"]:
        raise ValueError("external report must come from a clean repository")
    if report["summary"]["failed"] != 0:
        raise ValueError("external report contains failed cases")
    expected = load_contract(contract_root)["expected"]
    for result in report["results"]:
        frozen = expected[result["id"]]
        if result["expected"] != frozen:
            raise ValueError(f"external expected observation drifted: {result['id']}")
        if result["actual"] != frozen or not result["passed"]:
            raise ValueError(f"external actual observation failed: {result['id']}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--implementation", required=True)
    parser.add_argument("--contract-root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        if not isinstance(report, dict):
            raise ValueError("external report must contain a JSON object")
        validate_external_report(report, args.implementation, args.contract_root)
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"External indexing report import failed: {exc}", file=sys.stderr)
        return 1
    print(f"Imported clean {args.implementation} rag-indexing-v1 report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
