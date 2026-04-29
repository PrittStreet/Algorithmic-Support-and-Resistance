#!/usr/bin/env python3
"""
All-in-one launcher — build frontend + start backend serving everything on http://localhost:8000

Usage:
  python start.py            # build + run
  python start.py --no-build # skip build (faster restart when only backend changed)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def build_frontend() -> None:
    print(">> Building frontend...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=FRONTEND,
        shell=(sys.platform == "win32"),
    )
    if result.returncode != 0:
        print("!! Frontend build failed.")
        sys.exit(1)


def run_backend() -> None:
    print(">> Starting backend on http://localhost:8000 (Ctrl+C to stop)")
    subprocess.run(
        [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"],
        cwd=BACKEND,
    )


def main() -> None:
    if "--no-build" not in sys.argv:
        build_frontend()
    run_backend()


if __name__ == "__main__":
    main()
