#!/usr/bin/env python3
"""Run the Python v2 adapter and optionally retain its machine report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.rag_contract_validate import run_contract  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract-root",
        type=Path,
        default=ROOT / "contracts" / "rag-behavior-v2",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = run_contract(args.contract_root)
        rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output is not None:
            output = args.output.resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(rendered, encoding="utf-8")
        else:
            print(rendered, end="")
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Python RAG adapter failed: {exc}", file=sys.stderr)
        return 1
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
