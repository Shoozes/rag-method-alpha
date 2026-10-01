from __future__ import annotations

import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

from rag_indexing_contract import (  # noqa: E402
    actual_observations,
    load_contract,
    run_contract,
    validate_report,
    write_draft_expected,
)
from rag_indexing_import_external_report import validate_external_report  # noqa: E402
from rag_indexing_three_way_diff import compare_reports  # noqa: E402


class RagIndexingToolTests(unittest.TestCase):
    def test_documented_validator_cli_launches_directly(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "rag_indexing_contract.py")],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("12/12 cases passed", completed.stdout)

    def test_frozen_expected_matches_the_python_oracle(self) -> None:
        bundle = load_contract()

        self.assertEqual(bundle["manifest"]["status"], "frozen")
        self.assertEqual(actual_observations(), bundle["expected"])
        report = run_contract()
        validate_report(report)
        self.assertEqual(report["summary"], {"cases": 12, "passed": 12, "failed": 0})

    def test_frozen_expected_cannot_be_regenerated(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot be regenerated"):
            write_draft_expected()

    def test_external_import_requires_clean_exact_frozen_output(self) -> None:
        report = run_contract()
        report["runner"]["implementation"] = "edgesymbio"
        report["runner"]["language"] = "rust"
        report["repository"]["dirty"] = False
        validate_external_report(report, "edgesymbio")

        dirty = copy.deepcopy(report)
        dirty["repository"]["dirty"] = True
        with self.assertRaisesRegex(ValueError, "clean"):
            validate_external_report(dirty, "edgesymbio")

        drift = copy.deepcopy(report)
        drift["results"][0]["actual"]["document"]["records"][0]["text"] = "drift"
        drift["results"][0]["passed"] = False
        drift["summary"]["passed"] -= 1
        drift["summary"]["failed"] += 1
        with self.assertRaisesRegex(ValueError, "failed"):
            validate_external_report(drift, "edgesymbio")

    def test_external_import_cli_fails_cleanly_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            source = temporary_root / "invalid.json"
            output = temporary_root / "retained.json"
            source.write_text("{}\n", encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "rag_indexing_import_external_report.py"),
                    str(source),
                    "--implementation",
                    "edgesymbio",
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            output_exists = output.exists()

        self.assertEqual(completed.returncode, 1)
        self.assertIn("External indexing report import failed:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertFalse(output_exists)

    def test_three_way_diff_reports_nested_fields(self) -> None:
        python = run_contract()
        python["repository"]["dirty"] = False
        edge = copy.deepcopy(python)
        edge["runner"].update({"implementation": "edgesymbio", "language": "rust"})
        equal = compare_reports([python, edge])

        self.assertTrue(equal["equal"])
        self.assertTrue(equal["all_reports_passed"])
        self.assertTrue(equal["all_repositories_clean"])

        tulpa = copy.deepcopy(python)
        tulpa["runner"].update({"implementation": "tulpaweaver", "language": "javascript"})
        tulpa["results"][0]["actual"]["document"]["records"][0]["metadata"]["text_end"] += 1
        tulpa["results"][0]["passed"] = False
        tulpa["summary"]["passed"] -= 1
        tulpa["summary"]["failed"] += 1
        comparison = compare_reports([python, edge, tulpa])

        self.assertFalse(comparison["equal"])
        self.assertTrue(
            any(
                "records[0].metadata.text_end" in field
                for pair in comparison["pairs"]
                for difference in pair["differences"]
                for field in difference["fields"]
            )
        )

    def test_three_way_diff_cli_fails_cleanly_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            invalid = temporary_root / "invalid.json"
            output = temporary_root / "comparison.json"
            invalid.write_text("{}\n", encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "rag_indexing_three_way_diff.py"),
                    str(invalid),
                    str(invalid),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            output_exists = output.exists()

        self.assertEqual(completed.returncode, 1)
        self.assertIn("RAG indexing report comparison failed:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertFalse(output_exists)

    def test_report_shape_and_summary_fail_closed(self) -> None:
        report = run_contract()
        report["summary"]["passed"] -= 1
        with self.assertRaisesRegex(ValueError, "totals"):
            validate_report(report)

        extra = run_contract()
        extra["notes"] = []
        with self.assertRaisesRegex(ValueError, "top-level"):
            validate_report(extra)


if __name__ == "__main__":
    unittest.main()
