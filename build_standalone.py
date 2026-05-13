#!/usr/bin/env python3
"""
build_standalone.py — Build SR-Analyzer as a standalone Windows application.

This script:
  1. Verifies prerequisites (node/npm)
  2. Builds the React frontend  (npm run build → backend/static/)
  3. Creates a clean Python venv  (.build-venv/)
  4. Installs dependencies + PyInstaller into the venv
  5. Runs PyInstaller  (sr_analyzer.spec → dist/SR-Analyzer/)
  6. Copies sr_data.db next to the exe  (user data, outside the bundle)
  7. Copies distribution helper scripts into dist/SR-Analyzer/
  8. Optionally zips everything into dist/SR-Analyzer.zip

Usage:
  python build_standalone.py              # full build
  python build_standalone.py --no-npm-build  # skip React build (already done)
  python build_standalone.py --zip           # also create SR-Analyzer.zip

Output: dist/SR-Analyzer/
"""
import argparse
import os
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
DIST = ROOT / "dist" / "SR-Analyzer"
VENV_DIR = ROOT / ".build-venv"

DIST_HELPERS = [
    "create_shortcut.bat",
    "export_data.bat",
    "import_data.bat",
    "README.txt",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _force_remove(func, path, *_) -> None:
    """onerror handler for shutil.rmtree — unlocks read-only files on Windows."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def run(cmd: list, *, cwd=None, shell: bool = False) -> None:
    print(f"  >> {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, shell=shell)
    if result.returncode != 0:
        print(f"\nERREUR: la commande a echoue (code {result.returncode})")
        sys.exit(result.returncode)


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


# ── Steps ──────────────────────────────────────────────────────────────────────

def step_check(args) -> None:
    print("\n[1/7] Verification des prerequis...")
    # npm
    result = subprocess.run(["npm", "--version"], capture_output=True, shell=(sys.platform == "win32"))
    if result.returncode != 0:
        print("ERREUR: npm introuvable. Installez Node.js depuis https://nodejs.org")
        sys.exit(1)
    print(f"  npm: {result.stdout.decode().strip()}")
    print(f"  python: {sys.version.split()[0]}")


def step_build_frontend(args) -> None:
    if args.no_npm_build:
        print("\n[2/7] Build React ignore (--no-npm-build)")
        return
    print("\n[2/7] Build du frontend React...")
    run(["npm", "run", "build"], cwd=FRONTEND, shell=(sys.platform == "win32"))
    if not (BACKEND / "static" / "index.html").exists():
        print("ERREUR: backend/static/index.html introuvable apres le build")
        sys.exit(1)
    print(f"  Fichiers statiques generes dans: {BACKEND / 'static'}")


def step_create_venv(args) -> None:
    print("\n[3/7] Creation du venv de build propre...")
    if VENV_DIR.exists():
        shutil.rmtree(VENV_DIR, onerror=_force_remove)
    run([sys.executable, "-m", "venv", str(VENV_DIR)])
    print(f"  Venv: {VENV_DIR}")


def step_install_deps(args) -> None:
    print("\n[4/7] Installation des dependances dans le venv...")
    py = str(venv_python())
    run([py, "-m", "pip", "install", "--upgrade", "pip", "-q"])
    run([py, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt"), "-q"])
    # pyinstaller version epinglee pour reproductibilite
    run([py, "-m", "pip", "install", "pyinstaller==6.12.0", "-q"])
    print("  Dependances installees.")


def step_pyinstaller(args) -> None:
    print("\n[5/7] Lancement de PyInstaller...")
    spec = ROOT / "sr_analyzer.spec"
    if not spec.exists():
        print(f"ERREUR: {spec} introuvable")
        sys.exit(1)
    # Purge manuelle du dossier build/ — PyInstaller --clean échoue sur les
    # fichiers .pyc en lecture seule (localpycs) sous Windows (WinError 5).
    for stale in (ROOT / "build", ROOT / "dist"):
        if stale.exists():
            print(f"  Nettoyage {stale.name}/...")
            shutil.rmtree(stale, onerror=_force_remove)
    py = str(venv_python())
    run([py, "-m", "PyInstaller", str(spec), "--noconfirm"], cwd=ROOT)
    if not DIST.exists():
        print(f"ERREUR: {DIST} non genere")
        sys.exit(1)
    print(f"  Bundle cree: {DIST}")


def step_copy_data(args) -> None:
    print("\n[6/7] Copie des fichiers utilisateur...")
    src_db = BACKEND / "sr_data.db"
    dst_db = DIST / "sr_data.db"
    if src_db.exists():
        shutil.copy2(src_db, dst_db)
        size_mb = dst_db.stat().st_size // (1024 * 1024)
        print(f"  sr_data.db copie ({size_mb} MB)")
    else:
        print("  AVERTISSEMENT: sr_data.db absent — une base vide sera creee au 1er lancement")

    for helper in DIST_HELPERS:
        src = ROOT / helper
        if src.exists():
            shutil.copy2(src, DIST / helper)
            print(f"  {helper} copie")
        else:
            print(f"  AVERTISSEMENT: {helper} absent, ignoré")


def step_zip(args) -> None:
    if not args.zip:
        return
    print("\n[7/7] Creation du ZIP de distribution...")
    zip_path = ROOT / "dist" / "SR-Analyzer.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for fp in DIST.rglob("*"):
            if fp.is_file():
                zf.write(fp, Path("SR-Analyzer") / fp.relative_to(DIST))
    size_mb = zip_path.stat().st_size // (1024 * 1024)
    print(f"  ZIP cree: {zip_path} ({size_mb} MB)")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Build SR-Analyzer standalone Windows app")
    parser.add_argument("--no-npm-build", action="store_true",
                        help="Ne pas rebuilder le frontend React")
    parser.add_argument("--zip", action="store_true",
                        help="Creer SR-Analyzer.zip apres le build")
    args = parser.parse_args()

    print("=" * 58)
    print("  SR-Analyzer — Build Application Autonome")
    print("=" * 58)

    step_check(args)
    step_build_frontend(args)
    step_create_venv(args)
    step_install_deps(args)
    step_pyinstaller(args)
    step_copy_data(args)
    step_zip(args)

    print("\n" + "=" * 58)
    print("  BUILD TERMINE")
    print(f"  Dossier: {DIST}")
    if args.zip:
        print(f"  ZIP:     {ROOT / 'dist' / 'SR-Analyzer.zip'}")
    print()
    print("  Pour tester  : double-clic sur dist\\SR-Analyzer\\SR-Analyzer.exe")
    print("  Pour partager: zippez dist\\SR-Analyzer\\  ou utilisez --zip")
    print("=" * 58)


if __name__ == "__main__":
    main()
