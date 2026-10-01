"""Resolve report repository identity without allowing ambiguous proof input."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


OVERRIDE_ENV = "RAG_METHOD_PROOF_REPOSITORY_STATE"
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


def repository_state(root: Path) -> dict[str, Any]:
    """Return Git state, or a strict archive-provenance override for fresh proof."""
    raw = os.environ.get(OVERRIDE_ENV)
    if raw is not None:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{OVERRIDE_ENV} must be valid JSON") from exc
        if not isinstance(value, dict) or set(value) != {"commit", "dirty"}:
            raise ValueError(f"{OVERRIDE_ENV} must contain only commit and dirty")
        commit = value["commit"]
        dirty = value["dirty"]
        if not isinstance(commit, str) or not _COMMIT_RE.fullmatch(commit) or not isinstance(dirty, bool):
            raise ValueError(f"{OVERRIDE_ENV} is invalid")
        return {"commit": commit, "dirty": dirty}
    ancestry_path = root / "public-source.json"
    if ancestry_path.is_file():
        ancestry = json.loads(ancestry_path.read_text(encoding="utf-8"))
        if (
            not isinstance(ancestry, dict)
            or ancestry.get("schema") != "public-source-ancestry/v1"
            or ancestry.get("project") != "rag-method"
            or ancestry.get("prepared_from_modified_worktree") is not True
            or ancestry.get("identity_manifest") != "PUBLIC_MANIFEST.json"
            or not isinstance(ancestry.get("base_commit"), str)
            or not _COMMIT_RE.fullmatch(ancestry["base_commit"])
        ):
            raise ValueError("public source ancestry is invalid")
        # The frozen report envelope requires a Git-shaped ancestry field.
        # This is deliberately dirty; PUBLIC_MANIFEST.json binds fresh bytes.
        return {"commit": ancestry["base_commit"], "dirty": True}
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not _COMMIT_RE.fullmatch(commit):
        raise ValueError("git returned an invalid HEAD commit")
    dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain=v1"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    )
    return {"commit": commit, "dirty": dirty}
