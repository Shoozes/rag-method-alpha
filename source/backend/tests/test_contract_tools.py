from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.rag_contract_validate import (  # noqa: E402
    _load_cases,
    _profile_from_mapping,
    actual_observations,
    load_contract,
    run_contract,
)
from scripts.rag_import_external_report import validate_external_report  # noqa: E402
from scripts.rag_three_way_diff import (  # noqa: E402
    compare_reports,
    validate_report,
)


class RagContractToolTests(unittest.TestCase):
    def test_documented_validator_cli_launches_directly(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "rag_contract_validate.py")],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("15/15 cases passed", completed.stdout)

    def test_validator_uses_the_frozen_v2_profile_and_all_expectations(self) -> None:
        contract_root = ROOT / "contracts" / "rag-behavior-v2"
        bundle = load_contract(contract_root)
        profile = bundle["profile"]

        self.assertEqual(profile.exact_weight, 250_000)
        self.assertEqual(profile.semantic_weight, 250_000)
        self.assertEqual(profile.keyword_weight, 150_000)
        self.assertEqual(bundle["limits"].max_reference_expansion, 4)
        self.assertEqual(set(bundle["expected"]), {case["id"] for case in bundle["cases"]})

        report = run_contract(contract_root)
        self.assertEqual(report["summary"]["passed"], report["summary"]["cases"])
        self.assertEqual(report["summary"]["failed"], 0)
        validate_report(report)

    def test_actual_observations_equal_the_mode_owned_expectations(self) -> None:
        contract_root = ROOT / "contracts" / "rag-behavior-v2"
        bundle = load_contract(contract_root)
        self.assertEqual(actual_observations(contract_root), bundle["expected"])

    def test_profile_drift_fails_closed(self) -> None:
        profile_payload = json.loads(
            (ROOT / "contracts" / "rag-behavior-v2" / "retrieval-profile.json").read_text(
                encoding="utf-8"
            )
        )
        changed_policy = copy.deepcopy(profile_payload)
        changed_policy["scope"]["deny_first"] = False
        with self.assertRaisesRegex(ValueError, "scope policy"):
            _profile_from_mapping(changed_policy)

        changed_weights = copy.deepcopy(profile_payload)
        changed_weights["scoring"]["exact_weight_micro"] += 1
        with self.assertRaisesRegex(ValueError, "weight budget"):
            _profile_from_mapping(changed_weights)

        changed_identity = copy.deepcopy(profile_payload)
        changed_identity["identity"]["normalization"]["pocket"] = "lowercase"
        with self.assertRaisesRegex(ValueError, "identity"):
            _profile_from_mapping(changed_identity)

        changed_estimator = copy.deepcopy(profile_payload)
        changed_estimator["context"]["token_estimator"] = "words"
        with self.assertRaisesRegex(ValueError, "context"):
            _profile_from_mapping(changed_estimator)

    def test_case_loader_rejects_unknown_or_coerced_fields(self) -> None:
        payload = {
            "contract": "rag-behavior-v2-cases",
            "version": 2,
            "cases": [
                {
                    "id": "bad-case",
                    "query": "query",
                    "mode": "hybrid",
                    "top_k": 1,
                    "expand": "false",
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "expand"):
            _load_cases(payload, set())

        payload["cases"][0].pop("expand")
        payload["cases"][0]["topk"] = 1
        with self.assertRaisesRegex(ValueError, "unknown fields"):
            _load_cases(payload, set())

    def test_three_way_diff_checks_every_observation_field(self) -> None:
        left = run_contract()
        left["repository"]["dirty"] = False
        right = copy.deepcopy(left)
        right["runner"]["implementation"] = "edgesymbio"
        equal = compare_reports([left, right])
        self.assertTrue(equal["equal"])
        self.assertTrue(equal["all_reports_passed"])
        self.assertTrue(equal["all_repositories_clean"])

        drift = copy.deepcopy(right)
        drift["runner"]["implementation"] = "tulpaweaver"
        drift_case = drift["results"][0]
        drift_case["actual"]["ordered_ids"] = []
        drift_case["actual"]["context_selected_ids"] = []
        drift_case["actual"]["scores"] = []
        drift_case["actual"]["context_tokens"] = 0
        drift_case["passed"] = False
        drift["summary"]["passed"] -= 1
        drift["summary"]["failed"] += 1
        comparison = compare_reports([left, right, drift])
        self.assertFalse(comparison["equal"])
        self.assertFalse(comparison["all_reports_passed"])
        self.assertTrue(
            any(
                "ordered_ids" in difference["fields"]
                for pair in comparison["pairs"]
                for difference in pair["differences"]
            )
        )

        wrong_mode = copy.deepcopy(right)
        wrong_mode["results"][0]["mode"] = "keyword_only"
        mode_comparison = compare_reports([left, wrong_mode])
        self.assertFalse(mode_comparison["equal"])
        self.assertIn("mode", mode_comparison["pairs"][0]["differences"][0]["fields"])

    def test_three_way_diff_cli_can_retain_exact_result(self) -> None:
        python = run_contract()
        python["repository"]["dirty"] = False
        edge = copy.deepcopy(python)
        edge["runner"]["implementation"] = "edgesymbio"
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            python_path = temporary_root / "python.json"
            edge_path = temporary_root / "edge.json"
            output = temporary_root / "comparison.json"
            python_path.write_text(json.dumps(python), encoding="utf-8")
            edge_path.write_text(json.dumps(edge), encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "rag_three_way_diff.py"),
                    str(python_path),
                    str(edge_path),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            retained = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(retained["equal"])
        self.assertTrue(retained["all_reports_passed"])
        self.assertTrue(retained["all_repositories_clean"])

    def test_external_import_rejects_mode_or_expectation_drift(self) -> None:
        report = run_contract()
        report["repository"]["dirty"] = False
        validate_external_report(report, "rag-method-py")

        wrong_mode = copy.deepcopy(report)
        wrong_mode["results"][0]["mode"] = "keyword_only"
        with self.assertRaisesRegex(ValueError, "modes"):
            validate_external_report(wrong_mode, "rag-method-py")

        wrong_version = copy.deepcopy(report)
        wrong_version["runner"]["version"] = 2
        with self.assertRaisesRegex(ValueError, "version"):
            validate_report(wrong_version)

    def test_external_import_requires_clean_passing_actual_output(self) -> None:
        report = run_contract()
        report["runner"]["implementation"] = "edgesymbio"
        report["repository"]["dirty"] = False
        validate_external_report(report, "edgesymbio")

        dirty = copy.deepcopy(report)
        dirty["repository"]["dirty"] = True
        with self.assertRaisesRegex(ValueError, "clean"):
            validate_external_report(dirty, "edgesymbio")

        drift = copy.deepcopy(report)
        drift["results"][0]["actual"]["ordered_ids"] = []
        drift["results"][0]["actual"]["context_selected_ids"] = []
        drift["results"][0]["actual"]["scores"] = []
        drift["results"][0]["actual"]["context_tokens"] = 0
        drift["results"][0]["passed"] = False
        drift["summary"]["passed"] -= 1
        drift["summary"]["failed"] += 1
        with self.assertRaisesRegex(ValueError, "failed cases"):
            validate_external_report(drift, "edgesymbio")

        dishonest = copy.deepcopy(report)
        dishonest["results"][0]["actual"]["ordered_ids"] = []
        dishonest["results"][0]["actual"]["context_selected_ids"] = []
        dishonest["results"][0]["actual"]["scores"] = []
        dishonest["results"][0]["actual"]["context_tokens"] = 0
        with self.assertRaisesRegex(ValueError, "pass flag|actual observations"):
            validate_external_report(dishonest, "edgesymbio")

    def test_report_validation_rejects_inconsistent_or_duplicate_data(self) -> None:
        report = run_contract()
        inconsistent = copy.deepcopy(report)
        inconsistent["summary"]["passed"] -= 1
        with self.assertRaisesRegex(ValueError, "totals|passed count"):
            validate_report(inconsistent)

        duplicate = copy.deepcopy(report)
        duplicate["results"][1]["id"] = duplicate["results"][0]["id"]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_report(duplicate)

        extra_field = copy.deepcopy(report)
        extra_field["notes"] = []
        with self.assertRaisesRegex(ValueError, "top-level shape"):
            validate_report(extra_field)

        inconsistent_semantic_state = copy.deepcopy(report)
        inconsistent_semantic_state["results"][0]["actual"]["semantic_fallback_reason"] = (
            "embedding_failed"
        )
        inconsistent_semantic_state["results"][0]["passed"] = False
        inconsistent_semantic_state["summary"]["passed"] -= 1
        inconsistent_semantic_state["summary"]["failed"] += 1
        with self.assertRaisesRegex(ValueError, "state and fallback reason"):
            validate_report(inconsistent_semantic_state)


if __name__ == "__main__":
    unittest.main()
