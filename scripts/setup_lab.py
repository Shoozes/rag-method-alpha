"""Explicitly prepare the locked Python/React Lab dependencies."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from runtime_commands import npm_command

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "source" / "backend"


def main() -> int:
    if sys.version_info[:2] != (3, 12):
        print("Locked Lab setup is tested with Python 3.12. Select Python 3.12 through PROJECT_PYTHON or PATH before setup.", file=sys.stderr)
        return 1
    target = BACKEND / ".venv"
    interpreter = target / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    try:
        if target.exists() and not interpreter.is_file():
            raise RuntimeError("source/backend/.venv exists without a Python interpreter; repair it deliberately before setup")
        if not target.exists():
            subprocess.run([sys.executable, "-m", "venv", str(target)], check=True)
        version = subprocess.run([str(interpreter), "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], check=True, capture_output=True, text=True).stdout.strip()
        if version != "3.12":
            raise RuntimeError("the existing Lab environment is not Python 3.12; choose a separate environment instead of overwriting it")
        subprocess.run([str(interpreter), "-m", "pip", "install", "-r", "requirements.lock"], cwd=BACKEND, check=True)
        subprocess.run([*npm_command(), "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=ROOT / "source" / "frontend", check=True)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Lab setup failed: {exc}", file=sys.stderr)
        return int(getattr(exc, "returncode", 1) or 1)
    print("Lab dependencies prepared. Activate source/backend/.venv or set PROJECT_PYTHON to its interpreter, then run node run.mjs run-lab.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
