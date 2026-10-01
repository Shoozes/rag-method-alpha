from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = REPO_ROOT / "scripts" / "lab_report_validate.py"
FRONTEND_REPORT_PATH = (
    REPO_ROOT / "source" / "frontend" / "src" / "reports" / "currentQueryReport.ts"
)
SPEC = importlib.util.spec_from_file_location("lab_report_validate", VALIDATOR_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def _result(rank: int = 1) -> dict:
    return {
        "rank": rank,
        "id": f"chunk-{rank}",
        "chunk_id": f"chunk-{rank}",
        "source_id": "source-1",
        "path": "release-checklist.md",
        "heading": "Release readiness",
        "pocket": "vault",
        "scope": "persona:rag-method-demo-v1",
        "authority": "persona_vault",
        "tokens_est": 18,
        "score": 0.72,
        "score_micro": 720_000,
        "match_type": "exact",
        "cross_reference_from_id": None,
        "score_components_micro": {
            "exact": 1_000_000,
            "keyword": 500_000,
            "semantic": 0,
            "scope": 1_000_000,
            "provenance": 1_000_000,
            "authority": 600_000,
            "priority": 0,
            "aspect_coverage": 500_000,
            "cross_reference": 0,
        },
        "text": "Amber marks release readiness.",
    }


def _observation(mode: str, *, top_results: int = 1) -> dict:
    return {
        "requested_mode": mode,
        "duration_ms": 12.5,
        "retrieval_mode": "lexical-hybrid",
        "semantic_state": "not_requested" if mode in {"exact_only", "keyword_only"} else "disabled_by_settings",
        "semantic_fallback_reason": None if mode in {"exact_only", "keyword_only"} else "disabled_by_settings",
        "context_tokens": 18,
        "context_truncated": False,
        "results": [_result(index + 1) for index in range(top_results)],
    }


def valid_report() -> dict:
    current = _observation("scoped_hybrid")
    return {
        "schema": "rag_method_lab_query_report_v1",
        "generated_at_utc": "2026-08-10T23:00:00.000Z",
        "application": {"name": "RAG Method Lab", "version": "0.1.0"},
        "contracts": {"retrieval": "rag-behavior-v2", "indexing": "rag-indexing-v1", "api": "v1"},
        "collection": {"id": "rag-method-demo-v1", "fingerprint": "a" * 64, "generation": "generation-1"},
        "query": "What color marks release readiness?",
        "settings": {"pockets": ["vault", "lore"], "top_k": 5, "max_context_tokens": 1800, "detailed_score_evidence": True},
        "current": current,
        "comparison": [
            {"mode": "exact_only", "status": "pass", "duration_ms": 8.0, "error": None, "observation": _observation("exact_only")}
        ],
        "context_preview": [{"rank": 1, "id": "chunk-1", "tokens_est": 18, "text": "Amber marks release readiness."}],
    }


class LabReportTests(unittest.TestCase):
    def test_versioned_report_and_frontend_identity_agree(self) -> None:
        report = valid_report()
        self.assertIs(VALIDATOR.validate_report(report), report)
        source = FRONTEND_REPORT_PATH.read_text(encoding="utf-8")
        self.assertIn(f'LAB_REPORT_SCHEMA = "{VALIDATOR.REPORT_SCHEMA}"', source)
        self.assertIn('LAB_REPORT_FILENAME = "rag-method-lab-query-report.json"', source)

    def test_report_validator_fails_closed_on_shape_and_bound_drift(self) -> None:
        mutations = []
        extra = valid_report()
        extra["unknown"] = True
        mutations.append(extra)
        oversized_context = valid_report()
        oversized_context["current"]["context_tokens"] = 1801
        mutations.append(oversized_context)
        duplicate_mode = valid_report()
        duplicate_mode["comparison"].append(copy.deepcopy(duplicate_mode["comparison"][0]))
        mutations.append(duplicate_mode)
        mismatched_context = valid_report()
        mismatched_context["context_preview"][0]["id"] = "other"
        mutations.append(mismatched_context)
        bad_contract = valid_report()
        bad_contract["contracts"]["retrieval"] = "rag-behavior-v3"
        mutations.append(bad_contract)
        bad_version = valid_report()
        bad_version["application"]["version"] = "development"
        mutations.append(bad_version)
        bad_match = valid_report()
        bad_match["current"]["results"][0]["match_type"] = "guessed"
        mutations.append(bad_match)
        inconsistent_semantics = valid_report()
        inconsistent_semantics["current"]["semantic_fallback_reason"] = None
        mutations.append(inconsistent_semantics)
        mismatched_preview = valid_report()
        mismatched_preview["context_preview"][0]["text"] = "Different context."
        mutations.append(mismatched_preview)
        missing_requested_debug = valid_report()
        missing_requested_debug["current"]["results"][0]["score_components_micro"]["exact"] = None
        mutations.append(missing_requested_debug)
        unrequested_debug = valid_report()
        unrequested_debug["settings"]["detailed_score_evidence"] = False
        mutations.append(unrequested_debug)
        mismatched_score = valid_report()
        mismatched_score["current"]["results"][0]["score"] = 0.71
        mutations.append(mismatched_score)

        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with self.assertRaises(VALIDATOR.ReportValidationError):
                    VALIDATOR.validate_report(mutation)

    def test_cross_reference_result_is_public_and_unknown_match_types_fail(self) -> None:
        report = valid_report()
        report["current"]["results"][0]["match_type"] = "cross_reference"
        report["current"]["results"][0]["cross_reference_from_id"] = "chunk-origin"
        self.assertIs(VALIDATOR.validate_report(report), report)

        invalid = copy.deepcopy(report)
        invalid["current"]["results"][0]["match_type"] = "metadata"
        with self.assertRaises(VALIDATOR.ReportValidationError):
            VALIDATOR.validate_report(invalid)

    def test_query_validation_matches_frozen_unicode_and_utf8_limits(self) -> None:
        max_scalars, max_utf8_bytes = VALIDATOR._load_query_limits()
        profile = json.loads(
            (
                REPO_ROOT
                / "contracts"
                / "rag-behavior-v2"
                / "retrieval-profile.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(max_scalars, profile["limits"]["max_query_chars"])
        self.assertEqual(max_utf8_bytes, profile["limits"]["max_query_utf8_bytes"])

        combining = copy.deepcopy(valid_report())
        combining["query"] = "e\u0301"
        self.assertIs(VALIDATOR.validate_report(combining), combining)

        supplementary = copy.deepcopy(valid_report())
        supplementary["query"] = "😀"
        self.assertIs(VALIDATOR.validate_report(supplementary), supplementary)

        exact = copy.deepcopy(valid_report())
        exact["query"] = "😀" * max_scalars
        self.assertLessEqual(len(exact["query"].encode("utf-8")), max_utf8_bytes)
        self.assertIs(VALIDATOR.validate_report(exact), exact)

        oversized = copy.deepcopy(exact)
        oversized["query"] += "😀"
        with self.assertRaisesRegex(VALIDATOR.ReportValidationError, "scalar"):
            VALIDATOR.validate_report(oversized)

        for malformed in ("\ud800", "\udfff"):
            invalid = copy.deepcopy(valid_report())
            invalid["query"] = malformed
            with self.subTest(malformed=repr(malformed)):
                with self.assertRaisesRegex(VALIDATOR.ReportValidationError, "Unicode"):
                    VALIDATOR.validate_report(invalid)

    def test_public_validator_cli_returns_concise_status(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "report.json"
            path.write_text(json.dumps(valid_report()), encoding="utf-8")
            passed = subprocess.run(
                [sys.executable, str(VALIDATOR_PATH), str(path)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(passed.returncode, 0, passed.stderr)
            self.assertIn("report passed", passed.stdout)

            path.write_text("{}", encoding="utf-8")
            failed = subprocess.run(
                [sys.executable, str(VALIDATOR_PATH), str(path)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(failed.returncode, 2)
            self.assertIn("report failed", failed.stderr)
            self.assertNotIn("Traceback", failed.stderr)

            malformed = valid_report()
            malformed["query"] = "\ud800"
            path.write_text(json.dumps(malformed), encoding="utf-8")
            malformed_result = subprocess.run(
                [sys.executable, str(VALIDATOR_PATH), str(path)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(malformed_result.returncode, 2)
            self.assertIn("Unicode", malformed_result.stderr)
            self.assertNotIn("Traceback", malformed_result.stderr)


if __name__ == "__main__":
    unittest.main()
