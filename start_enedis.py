#!/usr/bin/env python3
"""
Lanceur dédié PC Enedis (VPN Always-On).
- Proxy EDF configuré pour les appels externes (Yahoo Finance)
- NO_PROXY pour que localhost/127.0.0.1 bypasse le proxy
- npm.cmd au lieu de npm (compatibilité Windows)
- Ouverture automatique du navigateur sur 127.0.0.1:8000

python start_enedis.py

"""
import os
import sys
import subprocess
import threading
import webbrowser
import time
from pathlib import Path

PROXY = "http://vip-users.proxy.edf.fr:3131"
os.environ.setdefault("HTTP_PROXY", PROXY)
os.environ.setdefault("HTTPS_PROXY", PROXY)
os.environ.setdefault("NO_PROXY", "localhost,127.0.0.1,127.*,::1")

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def build_frontend() -> None:
    print(">> Building frontend...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    result = subprocess.run([npm_cmd, "run", "build"], cwd=FRONTEND)
    if result.returncode != 0:
        print("!! Frontend build failed. Vérifiez que node_modules est présent dans frontend/.")
        sys.exit(1)
    print(">> Build OK — static files in backend/static/")


def open_browser(delay: int = 3) -> None:
    def _open():
        time.sleep(delay)
        webbrowser.open("http://127.0.0.1:8000")
    threading.Thread(target=_open, daemon=True).start()


def run_backend() -> None:
    print(">> Starting backend on http://127.0.0.1:8000 (Ctrl+C to stop)")
    open_browser()
    subprocess.run(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "127.0.0.1", "--port", "8000", "--reload"],
        cwd=BACKEND,
    )


def main() -> None:
    if "--no-build" not in sys.argv:
        build_frontend()
    run_backend()


if __name__ == "__main__":
    main()
