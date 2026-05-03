from __future__ import annotations

import subprocess
import sys
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parent
PROJECT_DIR = WORKSPACE_ROOT / "Frame Studio Deploy" / "FastFrame_Final"
VENV_PYTHON = WORKSPACE_ROOT / ".venv" / "Scripts" / "python.exe"
PROJECT_APP = PROJECT_DIR / "app.py"


def main() -> int:
    if not VENV_PYTHON.exists():
        print(f"Venv nao encontrada: {VENV_PYTHON}", file=sys.stderr)
        return 1

    if not PROJECT_APP.exists():
        print(f"App do projeto nao encontrado: {PROJECT_APP}", file=sys.stderr)
        return 1

    command = [str(VENV_PYTHON), str(PROJECT_APP), *sys.argv[1:]]
    completed = subprocess.run(command, cwd=str(PROJECT_DIR), check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())