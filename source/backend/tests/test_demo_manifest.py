from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "demo_manifest.py"
SPEC = importlib.util.spec_from_file_location("rag_method_demo_manifest", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load demo manifest generator: {SCRIPT}")
DEMO_MANIFEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEMO_MANIFEST)


class DemoManifestTests(unittest.TestCase):
    def test_tracked_manifest_matches_the_single_source_corpus(self) -> None:
        expected = DEMO_MANIFEST.build_manifest()
        tracked = json.loads(DEMO_MANIFEST.OUTPUT_PATH.read_text(encoding="utf-8"))

        self.assertEqual(tracked, expected)
        self.assertEqual(tracked["collection_id"], "rag-method-demo-v1")
        frontend_loader = (
            ROOT / "source" / "frontend" / "src" / "demo" / "loadDemo.ts"
        ).read_text(encoding="utf-8")
        self.assertIn(
            f'DEMO_COLLECTION_ID = "{tracked["collection_id"]}"',
            frontend_loader,
        )
        self.assertIn(
            f'DEMO_DISPLAY_NAME = "{tracked["display_name"]}"',
            frontend_loader,
        )
        self.assertEqual(len(tracked["files"]), 8)
        self.assertTrue(any(item["relative_path"].startswith("lore/") for item in tracked["files"]))
        self.assertEqual(len(tracked["source_digest"]), 64)

    def test_public_check_command_fails_closed_on_drift(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "--check"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("Demo manifest matches 8 source files.", completed.stdout)


if __name__ == "__main__":
    unittest.main()
