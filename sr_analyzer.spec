# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for SR-Analyzer standalone Windows bundle.
Build via: python build_standalone.py  (recommended)
Or directly: pyinstaller sr_analyzer.spec --clean --noconfirm
"""
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)
BACKEND = ROOT / "backend"
SITE_PKG = Path(sys.prefix) / "Lib" / "site-packages"

# Collect certifi certs (needed for HTTPS / yfinance)
_certifi_pem = SITE_PKG / "certifi" / "cacert.pem"
_datas = [
    (str(BACKEND / "static"), "static"),   # React build (read-only bundle)
    (str(BACKEND / "main.py"), "."),        # importable by launcher
]
if _certifi_pem.exists():
    _datas.append((str(_certifi_pem), "certifi"))

# tzdata for pandas timezone support (optional but avoids warnings)
_tzdata = SITE_PKG / "tzdata"
if _tzdata.exists():
    _datas.append((str(_tzdata), "tzdata"))

# NumPy 2.x and pandas 2.x: collect_all is required — manual hiddenimports
# miss the new numpy._core C-extensions (.pyd), causing ImportError at runtime.
_numpy_datas, _numpy_bins, _numpy_hiddens = collect_all('numpy')
_pandas_datas, _pandas_bins, _pandas_hiddens = collect_all('pandas')

block_cipher = None

a = Analysis(
    [str(ROOT / "sr_analyzer_launcher.py")],
    pathex=[str(BACKEND)],
    binaries=_numpy_bins + _pandas_bins,
    datas=_datas + _numpy_datas + _pandas_datas,
    hiddenimports=_numpy_hiddens + _pandas_hiddens + [
        # ── uvicorn (dynamic string-based module loading) ──────────────────
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.websockets_sansio_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # ── FastAPI / Starlette ────────────────────────────────────────────
        "fastapi.middleware.cors",
        "starlette.staticfiles",
        "starlette.routing",
        "starlette.responses",
        "starlette.middleware.cors",
        "starlette.middleware.exceptions",
        "starlette._exception_handler",
        # ── httpx (lazy imports inside route functions) ────────────────────
        "httpx",
        "httpx._transports.default",
        "httpx._transports.asgi",
        # ── anyio async backends ───────────────────────────────────────────
        "anyio",
        "anyio._backends._asyncio",
        "anyio._core._eventloop",
        "anyio._core._sockets",
        "anyio._core._streams",
        "anyio._core._tasks",
        "anyio._core._synchronization",
        "anyio.from_thread",
        "anyio.to_thread",
        # ── pydantic ──────────────────────────────────────────────────────
        "pydantic",
        "pydantic.v1",
        "pydantic_core",
        "pydantic_core.core_schema",
        # ── asyncio Windows ───────────────────────────────────────────────
        "asyncio",
        "asyncio.selector_events",
        "asyncio.windows_events",
        # ── h11 HTTP/1.1 parser ───────────────────────────────────────────
        "h11",
        "h11._readers",
        "h11._writers",
        # ── websockets ────────────────────────────────────────────────────
        "websockets",
        "websockets.connection",
        "websockets.extensions",
        "websockets.extensions.permessage_deflate",
        "websockets.frames",
        "websockets.http11",
        "websockets.legacy",
        "websockets.legacy.server",
        "websockets.legacy.client",
        # ── curl_cffi (yfinance HTTP backend) ─────────────────────────────
        "curl_cffi",
        "curl_cffi.requests",
        "curl_cffi.requests.session",
        "curl_cffi.aio",
        # ── cffi ──────────────────────────────────────────────────────────
        "cffi",
        "_cffi_backend",
        # ── yfinance ──────────────────────────────────────────────────────
        "yfinance",
        "yfinance.scrapers.history",
        "yfinance.scrapers.quote",
        "yfinance.multi",
        "yfinance.base",
        # ── google protobuf (yfinance pricing data) ────────────────────────
        "google.protobuf",
        "google._upb._message",
        # ── beautifulsoup4 ────────────────────────────────────────────────
        "bs4",
        "bs4.builder",
        "bs4.builder._htmlparser",
        # ── peewee (yfinance caching) ─────────────────────────────────────
        "peewee",
        "playhouse",
        # ── frozendict / multitasking (yfinance) ──────────────────────────
        "frozendict",
        "multitasking",
        # ── httptools (uvicorn HTTP parser) ───────────────────────────────
        "httptools",
        "httptools.parser",
        # ── aiofiles ──────────────────────────────────────────────────────
        "aiofiles",
        "aiofiles.os",
        "aiofiles.threadpool",
        # ── click (uvicorn CLI) ───────────────────────────────────────────
        "click",
        # ── colorama (Windows console colors) ─────────────────────────────
        "colorama",
        "colorama.initialise",
        # ── ssl / certs ───────────────────────────────────────────────────
        "ssl",
        "certifi",
        # ── watchfiles (pulled by uvicorn[standard], not used) ────────────
        "watchfiles",
        # ── email (internal parsing) ──────────────────────────────────────
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib",
        "PIL",
        "IPython",
        "jupyter_client",
        "jupyter_core",
        "ipykernel",
        "zmq",
        "tornado",
        "tkinter",
        "_tkinter",
        "unittest",
        "xmlrpc",
        "distutils",
        "setuptools",
        "pkg_resources",
        "MetaTrader5",
        "debugpy",
        "pywin32",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SR-Analyzer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,       # garder True pour v1 (logs visibles, erreurs lisibles)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="SR-Analyzer",  # → dist/SR-Analyzer/
)
