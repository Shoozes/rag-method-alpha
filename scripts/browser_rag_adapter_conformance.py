"""Compare browser-rag-ts Unicode and deterministic adapter evidence locally."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any, Sequence

from runtime_commands import node_command, npm_command


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules" / "browser-rag-ts"
FIXTURE = MODULE / "tests" / "fixtures" / "unicode-conformance-v1.json"
DEFAULT_OUTPUT = ROOT / ".artifacts" / "proof" / "browser-rag-ts" / "adapter-conformance.json"


def _same_python_minor_version(recorded: object, current: str) -> bool:
    """Allow patch updates when the recorded Unicode data version is unchanged."""

    if not isinstance(recorded, str):
        return False
    try:
        recorded_parts = tuple(int(part) for part in recorded.split(".")[:2])
        current_parts = tuple(int(part) for part in current.split(".")[:2])
    except ValueError:
        return False
    return len(recorded_parts) == 2 and recorded_parts == current_parts


def _collapse(value: str) -> str:
    return " ".join(value.split())


def _lower(value: str) -> str:
    return _collapse(unicodedata.normalize("NFKC", value).lower())


def _casefold(value: str) -> str:
    return _collapse(unicodedata.normalize("NFKC", value).casefold())


def _stable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _stable(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(_stable(value), ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _mapping_evidence(transform: Any) -> dict[str, Any]:
    digest = hashlib.sha256()
    mappings = 0
    for codepoint in range(sys.maxunicode + 1):
        if 0xD800 <= codepoint <= 0xDFFF:
            continue
        value = chr(codepoint)
        output = transform(value)
        if output == value:
            continue
        encoded = ",".join(f"{ord(scalar):X}" for scalar in output)
        digest.update(f"{codepoint:X}:{encoded}\n".encode("utf-8"))
        mappings += 1
    return {"mappings": mappings, "sha256": digest.hexdigest()}


def _set_evidence(predicate: Any) -> dict[str, Any]:
    digest = hashlib.sha256()
    scalars = 0
    for codepoint in range(sys.maxunicode + 1):
        if 0xD800 <= codepoint <= 0xDFFF or not predicate(chr(codepoint)):
            continue
        digest.update(f"{codepoint:X}\n".encode("utf-8"))
        scalars += 1
    return {"scalars": scalars, "sha256": digest.hexdigest()}


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"expected a JSON object: {path}")
    return value


def _run(command: list[str]) -> None:
    print(f"[browser-rag-adapter] {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--prepared-module",
        action="store_true",
        help="reuse module test output produced immediately before this check",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    output = args.output.resolve()
    node_output = output.with_name("adapter-conformance-node.json")
    try:
        if args.prepared_module:
            _run(
                [
                    *node_command(),
                    str(MODULE / "scripts" / "adapter-conformance.mjs"),
                    "--output",
                    str(node_output),
                ]
            )
        else:
            _run(
                [
                    *npm_command(),
                    "--prefix",
                    str(MODULE),
                    "run",
                    "adapter:conformance",
                    "--",
                    "--output",
                    str(node_output),
                ]
            )
        fixture = _read_object(FIXTURE)
        node = _read_object(node_output)
        if node.get("schema") != "browser-rag-ts-adapter-conformance-node-v4" or node.get("status") != "pass":
            raise RuntimeError("Node adapter conformance did not report pass")
        metadata = fixture.get("metadata")
        if not isinstance(metadata, dict) or node.get("unicode_metadata") != metadata:
            raise RuntimeError("Node generated casefold metadata differs from the fixture")
        if node.get("fixture_sha256") != hashlib.sha256(FIXTURE.read_bytes()).hexdigest():
            raise RuntimeError("Node fixture digest differs")
        python_unicode_metadata = node.get("python_unicode_metadata")
        if not isinstance(python_unicode_metadata, dict):
            raise RuntimeError("Node Python-Unicode metadata is missing")
        if python_unicode_metadata.get("generator") != "scripts/browser_rag_nfkc_conformance.py":
            raise RuntimeError("Node Python-Unicode generator identity differs")
        if not _same_python_minor_version(
            python_unicode_metadata.get("python_version"), sys.version.split()[0]
        ):
            raise RuntimeError(
                "Node Python-Unicode generator major/minor runtime differs from the owning Python runtime"
            )
        if python_unicode_metadata.get("unicode_version") != unicodedata.unidata_version:
            raise RuntimeError("Node Python-Unicode data version differs from the owning Python runtime")
        expected_exhaustive = {
            "nfkc": _mapping_evidence(lambda value: unicodedata.normalize("NFKC", value)),
            "raw_lowercase": _mapping_evidence(str.lower),
            "lowercase": _mapping_evidence(_lower),
            "casefold": _mapping_evidence(_casefold),
            "alphanumeric": _set_evidence(str.isalnum),
            "whitespace": _set_evidence(str.isspace),
        }
        if node.get("unicode_exhaustive") != expected_exhaustive:
            raise RuntimeError("Node/Python exhaustive Unicode normalization differs")
        node_cases = {entry.get("id"): entry for entry in node.get("unicode_cases", []) if isinstance(entry, dict)}
        fixture_cases = fixture.get("cases")
        if not isinstance(fixture_cases, list) or len(node_cases) != len(fixture_cases):
            raise RuntimeError("Node Unicode case set is incomplete")
        for entry in fixture_cases:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not isinstance(entry.get("input"), str):
                raise RuntimeError("Unicode fixture case is malformed")
            node_case = node_cases.get(entry["id"])
            expected_lower = _lower(entry["input"])
            expected_casefold = _casefold(entry["input"])
            if entry.get("retrieval_lowercase") != expected_lower or entry.get("identity_casefold") != expected_casefold:
                raise RuntimeError(f"Python Unicode fixture drift: {entry['id']}")
            if not isinstance(node_case, dict) or node_case.get("retrieval_lowercase") != expected_lower or node_case.get("identity_casefold") != expected_casefold:
                raise RuntimeError(f"Node/Python Unicode mismatch: {entry['id']}")
        distinctions = fixture.get("distinctions")
        if not isinstance(distinctions, dict) or len(set(distinctions.get("street_retrieval_values_must_differ", []))) != 2:
            raise RuntimeError("retrieval lowercase no longer distinguishes Straße and STRASSE")
        if distinctions.get("street_identity_values_must_match") != "strasse":
            raise RuntimeError("identity full casefold no longer converges Street values")
        seeded = node.get("seeded_corpus")
        worker = node.get("worker")
        if not isinstance(seeded, dict) or seeded.get("records") != 4 or seeded.get("result_sha256") != _digest(seeded.get("result")):
            raise RuntimeError("seeded Node corpus evidence is malformed")
        if not isinstance(worker, dict) or worker.get("disposed") != {"disposed": True} or worker.get("search_sha256") != _digest(worker.get("search")):
            raise RuntimeError("representative Worker evidence is malformed")
        output.parent.mkdir(parents=True, exist_ok=True)
        receipt = {
            "schema": "browser-rag-ts-adapter-conformance-v4",
            "status": "pass",
            "seed": node.get("seed"),
            "python": {"version": sys.version.split()[0], "unicode_version": unicodedata.unidata_version},
            "node": {
                "version": node.get("node_version"),
                "unicode_metadata": metadata,
                "python_unicode_metadata": python_unicode_metadata,
            },
            "inputs": {"fixture": FIXTURE.relative_to(ROOT).as_posix(), "fixture_sha256": node.get("fixture_sha256"), "unicode_cases": len(fixture_cases)},
            "results": {
                "unicode_cases_sha256": _digest(node.get("unicode_cases")),
                "unicode_exhaustive": expected_exhaustive,
                "seeded_records": seeded["records"],
                "seeded_result_sha256": seeded["result_sha256"],
                "worker_search_sha256": worker["search_sha256"],
                "worker_disposed": True,
            },
        }
        output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"browser-rag-ts adapter conformance: pass ({output.relative_to(ROOT).as_posix()})")
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        print(f"browser-rag-ts adapter conformance failed: {exc}", file=sys.stderr)
        return int(getattr(exc, "returncode", 1) or 1)


if __name__ == "__main__":
    raise SystemExit(main())
