# MODOP — SR-Analyzer Application Autonome Windows

Ce document permet à un futur développeur (ou assistant IA) de **reconstruire l'application autonome depuis zéro**, sans contexte préalable.

---

## 1. Vue d'ensemble

| Élément | Valeur |
|---------|--------|
| Backend | FastAPI + uvicorn + SQLite, Python 3.11 |
| Frontend | React 19 + Vite + TypeScript, compilé dans `backend/static/` |
| Packaging | PyInstaller 6.12.0 `--onedir` |
| Point d'entrée dev | `python start.py` |
| Point d'entrée bundle | `sr_analyzer_launcher.py` → `SR-Analyzer.exe` |
| Base de données | `backend/sr_data.db` (SQLite, ~57 MB) |

L'application tourne sur **http://127.0.0.1:8000**. Le backend sert directement les fichiers React buildés (`backend/static/`).

---

## 2. Prérequis de build

Ces outils doivent être installés sur la machine de build :

- **Python 3.11** (MS Store Python OK — PyInstaller 6.x est compatible)
- **Node.js 18+** avec `npm` (pour builder le frontend React)
- Connexion internet (pour installer les packages dans le venv de build)

Aucune installation n'est nécessaire sur la machine de l'utilisateur final.

---

## 3. Commande de build (tout-en-un)

```bash
python build_standalone.py --zip
```

Cela génère :
- `dist/SR-Analyzer/` — dossier complet prêt à distribuer
- `dist/SR-Analyzer.zip` — archive à envoyer à un ami

---

## 4. Ce que fait `build_standalone.py` (7 étapes)

| Étape | Action |
|-------|--------|
| 1 | Vérifie que `npm` est disponible |
| 2 | `npm run build` dans `/frontend` → `backend/static/` |
| 3 | Crée `.build-venv/` (venv Python propre) |
| 4 | Installe `requirements.txt` + `pyinstaller==6.12.0` dans le venv |
| 5 | Lance `pyinstaller sr_analyzer.spec --clean --noconfirm` |
| 6 | Copie `sr_data.db` à côté de `SR-Analyzer.exe` |
| 7 | Copie les scripts helpers (`create_shortcut.bat`, etc.) dans `dist/SR-Analyzer/` |

**Flags disponibles :**
```bash
--no-npm-build   # saute l'étape 2 (React déjà buildé)
--zip            # génère dist/SR-Analyzer.zip après le build
```

---

## 5. Architecture de résolution des chemins (CRITIQUE)

Deux répertoires différents sont utilisés selon le mode :

| Ressource | Mode dev | Mode frozen (PyInstaller) |
|-----------|----------|--------------------------|
| `sr_data.db` | `Path(__file__).parent` | `Path(sys.executable).parent` |
| `backend/static/` | `Path(__file__).parent` | `Path(sys._MEIPASS)` |

En mode `--onedir`, `sys._MEIPASS == Path(sys.executable).parent`, donc les deux pointent vers le même dossier (`dist/SR-Analyzer/`). La distinction importe surtout pour `--onefile` où `_MEIPASS` est un temp dir.

**Fonctions dans `backend/main.py` :**
```python
def _get_base_dir() -> Path:   # données mutables (DB)
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent

def _get_bundle_dir() -> Path:  # assets read-only (static/)
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent
```

---

## 6. Fichiers modifiés vs créés

### Modifiés

| Fichier | Lignes | Modification |
|---------|--------|-------------|
| `backend/main.py` | ~44-58 | Ajout `_get_base_dir()` / `_get_bundle_dir()` + `DB_PATH` |
| `backend/main.py` | ~18-23 | CORS : ajout `localhost:8000` et `127.0.0.1:8000` |
| `backend/main.py` | ~996-998 | `_STATIC` utilise `_get_bundle_dir()` + `str()` |

### Créés (racine du projet)

| Fichier | Rôle |
|---------|------|
| `sr_analyzer_launcher.py` | Entry point PyInstaller — SSL fix + browser open + uvicorn.run() |
| `sr_analyzer.spec` | Config PyInstaller (hiddenimports, datas, excludes) |
| `build_standalone.py` | Script de build complet (7 étapes) |
| `create_shortcut.bat` | Crée le raccourci Bureau (distribué dans le ZIP) |
| `export_data.bat` | Exporte sr_data.db avec horodatage (distribué) |
| `import_data.bat` | Importe un sr_data.db reçu (distribué) |
| `README.txt` | Guide utilisateur final (distribué) |
| `MODOP.md` | Ce fichier |

---

## 7. Pièges PyInstaller connus et solutions

### Piège 1 — uvicorn hidden imports
uvicorn charge ses protocoles HTTP/WS par string dynamique. PyInstaller ne les détecte pas automatiquement. **Tous** les modules suivants doivent être dans `hiddenimports` du `.spec` :
```
uvicorn.protocols.http.h11_impl
uvicorn.protocols.http.httptools_impl
uvicorn.protocols.websockets.websockets_impl
uvicorn.protocols.websockets.websockets_sansio_impl
uvicorn.loops.asyncio
uvicorn.lifespan.on
uvicorn.lifespan.off
```

### Piège 2 — uvicorn.run() avec string vs objet
```python
# FAUX (plante en mode frozen, sys.path ne contient pas le bon chemin) :
uvicorn.run("main:app", ...)

# CORRECT (import direct de l'objet app) :
from main import app
uvicorn.run(app, ...)
```

### Piège 3 — reload=True plante l'exe
Le watcher de rechargement ne peut pas observer des fichiers .pyc compilés dans un bundle. Toujours `reload=False` dans le launcher.

### Piège 4 — MS Store Python (stub launcher)
Le Python de MS Store a un stub exe dans `WindowsApps/`. PyInstaller 6.x le résout automatiquement. Utiliser un venv évite les conflits — le `python.exe` du venv est un vrai exécutable.

### Piège 5 — Certificats SSL (yfinance HTTPS)
Sans ce fix dans le launcher, yfinance échoue avec `SSL: CERTIFICATE_VERIFY_FAILED` sur les machines sans Python installé :
```python
if getattr(sys, 'frozen', False):
    _cert = str(Path(sys._MEIPASS) / "certifi" / "cacert.pem")
    os.environ.setdefault("SSL_CERT_FILE", _cert)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _cert)
```
Et dans le `.spec`, `certifi/cacert.pem` doit être dans `datas`.

### Piège 6 — curl_cffi et _cffi_backend
`curl_cffi` est le backend HTTP de yfinance. Il nécessite `"cffi"` et `"_cffi_backend"` dans `hiddenimports`. La librairie curl est statiquement liée dans `_wrapper.pyd` — pas de `curl.dll` à bundler.

### Piège 7 — Build en venv propre (OBLIGATOIRE)
La machine de développement a des dizaines de packages non nécessaires (MetaTrader5, matplotlib, jupyter...). Lancer PyInstaller hors venv gonfle le bundle à 1+ GB et provoque des conflits de DLLs. Toujours builder depuis `.build-venv/`.

### Piège 8 — google.protobuf extension C
```
"google.protobuf", "google._upb._message"
```
Les deux sont requis dans `hiddenimports`.

### Piège 9 — NumPy 2.x C-extensions manquantes (**CONFIRMÉ EN PROD**)
**Symptôme :** `ImportError: No module named 'numpy._core._exceptions'`

**Cause :** NumPy 2.x a migré de `numpy.core` vers `numpy._core`. PyInstaller ne détecte pas automatiquement les C-extensions (`.pyd`) du nouveau sous-package, même avec des `hiddenimports` manuels.

**Fix obligatoire dans `sr_analyzer.spec` :**
```python
from PyInstaller.utils.hooks import collect_all

_numpy_datas, _numpy_bins, _numpy_hiddens = collect_all('numpy')
_pandas_datas, _pandas_bins, _pandas_hiddens = collect_all('pandas')

a = Analysis(
    ...
    binaries  = _numpy_bins + _pandas_bins,
    datas     = _datas + _numpy_datas + _pandas_datas,
    hiddenimports = _numpy_hiddens + _pandas_hiddens + [...autres...],
)
```

`collect_all()` utilise les hooks officiels PyInstaller — c'est la seule approche fiable pour NumPy 2.x et pandas 2.x. Ne jamais lister les modules numpy/pandas manuellement dans `hiddenimports`.

---

## 8. Taille attendue du bundle

| Mesure | Valeur |
|--------|--------|
| `dist/SR-Analyzer/` décompressé | ~250–320 MB |
| `dist/SR-Analyzer.zip` | ~130–170 MB |
| dont `sr_data.db` | ~57 MB (compresse peu) |

---

## 9. Partage de données entre utilisateurs

```
Utilisateur A                          Utilisateur B
─────────────────────────────          ─────────────────────────────
double-clic export_data.bat            double-clic import_data.bat
→ sr_data_20260513_1430.db  ──────→   → choisir le .db reçu
(dans Documents)                       → relancer SR-Analyzer
```

La base SQLite contient 8 tables :
- `ticker_lists` — listes de tickers personnalisées
- `presets` — paramètres S/R sauvegardés
- `sessions` — sessions d'analyse complètes
- `feedback` — votes/tags utilisateur
- `ohlcv_cache` — cache données Yahoo Finance
- `favorites` — tickers favoris
- `trade_references` — références de trades
- `pattern_annotations` — annotations de patterns

Pour un partage partiel (seulement les presets, par exemple), utiliser SQLite Browser pour exporter/importer des tables individuelles, ou ajouter des endpoints API JSON.

---

## 10. Rebuilds partiels

```bash
# Seulement le code Python a changé (pas de nouveaux packages) :
python build_standalone.py --no-npm-build --zip

# Seulement le React a changé :
python build_standalone.py --zip
# (le build npm est inclus par défaut)

# Rebuild complet depuis zéro :
python build_standalone.py --zip
# (supprime et recrée .build-venv/)
```

---

## 11. Versions épinglées

| Package | Version | Raison |
|---------|---------|--------|
| PyInstaller | 6.12.0 | Breaking changes fréquents entre versions — ne pas upgrader sans test |
| Python | 3.11.x | Compatibilité testée. 3.12+ peut nécessiter des ajustements sur curl_cffi |

---

## 12. Procédure de test du bundle

1. Lancer `dist\SR-Analyzer\SR-Analyzer.exe`
2. La fenêtre console apparaît, le navigateur s'ouvre sur `http://127.0.0.1:8000`
3. Tester une analyse de ticker (requiert internet → yfinance)
4. Sauvegarder une session, la recharger
5. Tester l'analyse Gemini (si clé API configurée)
6. **Test de portabilité** : copier le dossier `dist\SR-Analyzer\` sur un PC sans Python/Node → répéter les tests
7. Sur ce PC, lancer `create_shortcut.bat` → vérifier le raccourci bureau
8. Tester `export_data.bat` puis `import_data.bat`

---

## 13. Structure du projet (référence)

```
Algorithmic-Support-and-Resistance/
├── backend/
│   ├── main.py          ← FastAPI app (modifié pour frozen)
│   ├── sr_data.db       ← Base SQLite utilisateur
│   ├── requirements.txt
│   └── static/          ← Build React (généré par npm run build)
├── frontend/
│   ├── src/
│   └── package.json
├── dist/                ← Généré par build_standalone.py
│   ├── SR-Analyzer/     ← Application prête à distribuer
│   └── SR-Analyzer.zip  ← Archive à envoyer
├── .build-venv/         ← Venv de build (gitignore recommandé)
├── sr_analyzer_launcher.py  ← Entry point PyInstaller
├── sr_analyzer.spec         ← Config PyInstaller
├── build_standalone.py      ← Script de build
├── create_shortcut.bat      ← Helper distribué
├── export_data.bat          ← Helper distribué
├── import_data.bat          ← Helper distribué
├── README.txt               ← Guide utilisateur distribué
├── start.py                 ← Launcher dev (inchangé)
└── MODOP.md                 ← Ce fichier
```
