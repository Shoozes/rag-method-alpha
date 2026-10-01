"""Dependency-neutral executable discovery shared by portable app tasks."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def can_run(command: list[str]) -> bool:
    try:
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
    return True


def npm_command() -> list[str]:
    candidates: list[list[str]] = []
    if os.name == "nt":
        candidates.extend(
            [[path] for path in (shutil.which("npm.cmd"), shutil.which("npm")) if path]
        )
    else:
        npm = shutil.which("npm")
        if npm:
            candidates.append([npm])

    node = shutil.which("node")
    if node:
        npm_cli = (
            Path(node).resolve().parent
            / "node_modules"
            / "npm"
            / "bin"
            / "npm-cli.js"
        )
        if npm_cli.is_file():
            candidates.append([node, str(npm_cli)])

    for candidate in candidates:
        if can_run([*candidate, "--version"]):
            return candidate
    raise RuntimeError(
        "npm was not found or did not execute; repair Node.js/npm or use the backend-only lane"
    )


def node_command() -> list[str]:
    for name in (("node.exe", "node") if os.name == "nt" else ("node",)):
        path = shutil.which(name)
        if path and can_run([path, "--version"]):
            return [path]
    raise RuntimeError("Node.js was not found or did not execute; repair Node.js before browser proof")
