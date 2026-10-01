from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from proof_repository import OVERRIDE_ENV, repository_state


class ProofRepositoryTests(unittest.TestCase):
    def test_fresh_archive_override_is_exact_and_does_not_need_a_git_directory(self) -> None:
        payload = '{"commit":"0123456789abcdef0123456789abcdef01234567","dirty":false}'
        with patch.dict(os.environ, {OVERRIDE_ENV: payload}, clear=False):
            self.assertEqual(
                repository_state(ROOT / "missing-git-worktree"),
                {"commit": "0123456789abcdef0123456789abcdef01234567", "dirty": False},
            )

    def test_repository_override_rejects_extra_or_invalid_values(self) -> None:
        for payload in (
            '{"commit":"0123456789abcdef0123456789abcdef01234567","dirty":false,"extra":true}',
            '{"commit":"not-a-commit","dirty":false}',
            '{"commit":"0123456789abcdef0123456789abcdef01234567","dirty":"false"}',
        ):
            with self.subTest(payload=payload), patch.dict(os.environ, {OVERRIDE_ENV: payload}, clear=False):
                with self.assertRaises(ValueError):
                    repository_state(ROOT)


if __name__ == "__main__":
    unittest.main()
