#!/usr/bin/env python3
"""Compatibility entrypoint for exact two-report rag-behavior-v2 comparison."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.rag_three_way_diff import compare_reports, load_report  # noqa: E402


def compare(left: dict, right: dict) -> dict:
    return compare_reports([left, right])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    args = parser.parse_args()
    try:
        report = compare(load_report(args.left), load_report(args.right))
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"RAG report comparison failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return (
        0
        if report["equal"]
        and report["all_reports_passed"]
        and report["all_repositories_clean"]
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
