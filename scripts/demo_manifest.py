"""Generate or verify the tracked RAG Method Lab demonstration manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "examples" / "visual-rag-demo"
OUTPUT_PATH = ROOT / "source" / "frontend" / "public" / "demo" / "manifest.json"
SCHEMA_ID = "rag_method_demo_manifest_v1"
FIXTURE_VERSION = "rag-method-demo-v1"
COLLECTION_ID = "rag-method-demo-v1"
DISPLAY_NAME = "RAG Method Demo"
SUGGESTED_QUERIES = [
    "What color marks release readiness?",
    "Which storage decision is recorded, and what cloud dependency is prohibited?",
    "Which note links to the release checklist?",
]


def build_manifest() -> dict[str, Any]:
    files = [
        {
            "relative_path": path.relative_to(SOURCE_ROOT).as_posix(),
            "content": path.read_text(encoding="utf-8"),
        }
        for path in sorted(SOURCE_ROOT.rglob("*.md"))
        if path.is_file() and not path.is_symlink()
    ]
    if not files:
        raise ValueError(f"demo source contains no Markdown files: {SOURCE_ROOT}")
    canonical = json.dumps(
        {"fixture_version": FIXTURE_VERSION, "files": files},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    digest = hashlib.sha256(b"rag-method-demo-manifest-v1\0" + canonical).hexdigest()
    return {
        "schema": SCHEMA_ID,
        "fixture_version": FIXTURE_VERSION,
        "collection_id": COLLECTION_ID,
        "display_name": DISPLAY_NAME,
        "source_digest": digest,
        "suggested_queries": SUGGESTED_QUERIES,
        "files": files,
    }


def render_manifest() -> str:
    return json.dumps(build_manifest(), ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--write", action="store_true", help="write the canonical manifest")
    action.add_argument("--check", action="store_true", help="verify the tracked manifest")
    args = parser.parse_args(argv)

    try:
        rendered = render_manifest()
        if args.write:
            OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT_PATH.write_text(rendered, encoding="utf-8")
            print(f"Wrote demo manifest: {OUTPUT_PATH}")
            return 0
        if not OUTPUT_PATH.is_file():
            raise ValueError(f"demo manifest is missing: {OUTPUT_PATH}")
        if OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise ValueError("demo manifest does not match examples/visual-rag-demo; run with --write")
    except (OSError, TypeError, ValueError, UnicodeError) as exc:
        print(f"Demo manifest check failed: {exc}", file=sys.stderr)
        return 1
    print(f"Demo manifest matches {len(build_manifest()['files'])} source files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
