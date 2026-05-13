#!/usr/bin/env python3
"""
SR-Analyzer standalone launcher — entry point for the PyInstaller bundle.
Double-click SR-Analyzer.exe to launch the app in your browser.
"""
import sys
import os
import threading
import time
import webbrowser
from pathlib import Path

# ── Fix SSL certificates for yfinance HTTPS on machines without Python ─────────
if getattr(sys, 'frozen', False):
    _cert = str(Path(sys._MEIPASS) / "certifi" / "cacert.pem")
    os.environ.setdefault("SSL_CERT_FILE", _cert)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _cert)
    # Make bundled main.py importable
    sys.path.insert(0, str(Path(sys._MEIPASS)))

# ── Import FastAPI app (triggers DB init on first run) ─────────────────────────
from main import app  # noqa: E402


def _open_browser(url: str = "http://127.0.0.1:8000", delay: float = 2.5) -> None:
    def _go() -> None:
        time.sleep(delay)
        webbrowser.open(url)
    threading.Thread(target=_go, daemon=True).start()


if __name__ == "__main__":
    import uvicorn

    print("=" * 58)
    print("  SR-Analyzer — Support & Resistance Tool")
    print("  Ouverture sur : http://127.0.0.1:8000")
    print("  Fermez cette fenetre pour arreter le serveur.")
    print("=" * 58)

    _open_browser()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=False,       # obligatoire en mode frozen
        log_level="warning",
    )
