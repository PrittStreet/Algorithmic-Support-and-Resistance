#!/usr/bin/env python3
"""
Build script — compile React frontend into backend/static/
Usage: python build.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"


def main():
    print("Building frontend...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=FRONTEND,
        shell=(sys.platform == "win32"),
    )
    if result.returncode != 0:
        print("Build failed.")
        sys.exit(1)
    print("\nDone. Start the app with:")
    print("  cd backend && python -m uvicorn main:app --reload")
    print("Then open http://localhost:8000")


if __name__ == "__main__":
    main()
