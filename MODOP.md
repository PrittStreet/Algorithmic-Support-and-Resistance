# MODOP — SR-Analyzer

Guide opérationnel personnel : dev quotidien, build distribution, pièges.

---

## 1. Démarrage rapide (dev quotidien)

### Mode le plus simple — build + serve

```bash
python start.py
```

Ouvre `http://localhost:8000` dans le navigateur.

Ce que ça fait :
1. `npm run build` dans `/frontend` → génère `backend/static/`
2. Lance `uvicorn main:app --reload --port 8000` dans `/backend`

Le `--reload` recharge automatiquement le backend si tu modifies `main.py`.

**Si seul le backend a changé (plus rapide) :**

```bash
python start.py --no-build
```

### Mode dev frontend (hot reload Vite)

Pour itérer vite sur le React sans rebuilder à chaque fois :

```bash
# Terminal 1 — backend
python start.py --no-build

# Terminal 2 — frontend Vite dev server
cd frontend
npm run dev          # → http://localhost:5173
```

Le CORS est configuré pour `localhost:5173`, les deux modes fonctionnent.

---

## 2. Architecture en un coup d'œil

| Élément | Valeur |
|---------|--------|
| Backend | FastAPI + uvicorn + SQLite, **Python 3.11** |
| Frontend | React 19 + Vite + TypeScript, compilé dans `backend/static/` |
| Packaging | PyInstaller 6.12.0 `--onedir` |
| Point d'entrée dev | `python start.py` |
| Point d'entrée bundle | `sr_analyzer_launcher.py` → `SR-Analyzer.exe` |
| Base de données | `backend/sr_data.db` (SQLite, ~57 MB) |
| URL | `http://127.0.0.1:8000` |

---

## 3. Fichiers clés

| Fichier | Rôle |
|---------|------|
| `backend/main.py` | Toute la logique API FastAPI (~44 KB) |
| `frontend/src/sr.ts` | Algorithme zig-zag + calcul des niveaux S/R |
| `frontend/src/App.tsx` | Orchestration globale, state management |
| `frontend/src/api.ts` | Client API (appels vers le backend) |
| `backend/sr_data.db` | Base SQLite utilisateur — **ne jamais supprimer** |

---

## 4. Base de données — 8 tables

| Table | Contenu |
|-------|---------|
| `ticker_lists` | Listes de tickers personnalisées |
| `presets` | Configurations d'analyse S/R sauvegardées |
| `sessions` | Sessions d'analyse complètes |
| `feedback` | Votes/tags utilisateur (like/dislike) + annotations |
| `ohlcv_cache` | Cache données OHLCV Yahoo Finance |
| `favorites` | Tickers favoris |
| `trade_references` | Références de trades |
| `pattern_annotations` | Annotations de patterns détectés |

---

## 5. Build pour distribution (PyInstaller)

### Commande tout-en-un

```bash
python build_standalone.py --zip
```

Génère :
- `dist/SR-Analyzer/` — dossier complet prêt à distribuer
- `dist/SR-Analyzer.zip` — archive à envoyer

**Flags :**

```bash
--no-npm-build   # saute l'étape npm build (React déjà compilé)
--zip            # génère le .zip après le build
```

### Ce que fait `build_standalone.py` (7 étapes)

| Étape | Action |
|-------|--------|
| 1 | Vérifie que `npm` est disponible |
| 2 | `npm run build` dans `/frontend` → `backend/static/` |
| 3 | Crée `.build-venv/` (venv Python propre) |
| 4 | Installe `requirements.txt` + `pyinstaller==6.12.0` dans le venv |
| 5 | Lance `pyinstaller sr_analyzer.spec --clean --noconfirm` |
| 6 | Copie `sr_data.db` à côté de `SR-Analyzer.exe` |
| 7 | Copie les scripts helpers (`create_shortcut.bat`, etc.) dans `dist/SR-Analyzer/` |

### Rebuilds partiels

```bash
# Seulement le backend Python a changé :
python build_standalone.py --no-npm-build --zip

# Seulement le React a changé (ou les deux) :
python build_standalone.py --zip

# Rebuild complet depuis zéro (supprime et recrée .build-venv/) :
python build_standalone.py --zip
```

---

## 6. Architecture chemins — frozen vs dev (CRITIQUE)

En mode PyInstaller `--onedir`, deux répertoires sont utilisés selon le contexte :

| Ressource | Mode dev | Mode frozen (exe) |
|-----------|----------|-------------------|
| `sr_data.db` (données mutables) | `Path(__file__).parent` | `Path(sys.executable).parent` |
| `backend/static/` (assets read-only) | `Path(__file__).parent` | `Path(sys._MEIPASS)` |

En `--onedir`, `sys._MEIPASS == Path(sys.executable).parent`, donc les deux pointent vers `dist/SR-Analyzer/`. La distinction importe surtout pour `--onefile` où `_MEIPASS` serait un temp dir.

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

## 7. Pièges PyInstaller connus et solutions

### Piège 1 — uvicorn hidden imports

uvicorn charge ses protocoles HTTP/WS par string dynamique. PyInstaller ne les détecte pas. **Tous** ces modules doivent être dans `hiddenimports` du `.spec` :

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
# FAUX (plante en mode frozen) :
uvicorn.run("main:app", ...)

# CORRECT :
from main import app
uvicorn.run(app, ...)
```

### Piège 3 — reload=True plante l'exe

Le watcher ne peut pas observer des fichiers .pyc compilés dans un bundle. Toujours `reload=False` dans le launcher.

### Piège 4 — MS Store Python (stub launcher)

PyInstaller 6.x résout le stub automatiquement. Utiliser un venv évite les conflits — le `python.exe` du venv est un vrai exécutable.

### Piège 5 — Certificats SSL (yfinance HTTPS)

Sans ce fix dans le launcher, yfinance échoue avec `SSL: CERTIFICATE_VERIFY_FAILED` sur les machines sans Python installé :

```python
if getattr(sys, 'frozen', False):
    _cert = str(Path(sys._MEIPASS) / "certifi" / "cacert.pem")
    os.environ.setdefault("SSL_CERT_FILE", _cert)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _cert)
```

Et `certifi/cacert.pem` doit être dans `datas` du `.spec`.

### Piège 6 — curl_cffi et _cffi_backend

`curl_cffi` est le backend HTTP de yfinance. Il nécessite `"cffi"` et `"_cffi_backend"` dans `hiddenimports`. La lib curl est statiquement liée dans `_wrapper.pyd` — pas de `curl.dll` à bundler.

### Piège 7 — Build en venv propre (OBLIGATOIRE)

La machine de dev a des dizaines de packages non nécessaires. Lancer PyInstaller hors venv gonfle le bundle à 1+ GB et provoque des conflits de DLLs. Toujours builder depuis `.build-venv/`.

### Piège 8 — google.protobuf extension C

```
"google.protobuf", "google._upb._message"
```

Les deux sont requis dans `hiddenimports`.

### Piège 9 — NumPy 2.x C-extensions manquantes (**CONFIRMÉ EN PROD**)

**Symptôme :** `ImportError: No module named 'numpy._core._exceptions'`

**Cause :** NumPy 2.x a migré de `numpy.core` vers `numpy._core`. PyInstaller ne détecte pas automatiquement les C-extensions (`.pyd`) du nouveau sous-package.

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

`collect_all()` est la seule approche fiable pour NumPy 2.x et pandas 2.x. Ne jamais lister ces modules manuellement dans `hiddenimports`.

---

## 8. Tailles attendues du bundle

| Mesure | Valeur |
|--------|--------|
| `dist/SR-Analyzer/` décompressé | ~250–320 MB |
| `dist/SR-Analyzer.zip` | ~130–170 MB |
| dont `sr_data.db` | ~57 MB (compresse peu) |

---

## 9. Versions épinglées

| Package | Version | Raison |
|---------|---------|--------|
| PyInstaller | **6.12.0** | Breaking changes fréquents entre versions — ne pas upgrader sans test |
| Python | **3.11.x** | Compatibilité testée. 3.12+ peut nécessiter des ajustements sur curl_cffi |
| Node.js | **18+** | Requis pour builder le frontend React |

---

## 10. Procédure de test du bundle

1. Lancer `dist\SR-Analyzer\SR-Analyzer.exe`
2. La console apparaît, le navigateur s'ouvre sur `http://127.0.0.1:8000`
3. Tester une analyse de ticker (requiert internet → yfinance)
4. Sauvegarder une session, la recharger
5. Tester l'analyse Gemini (si clé API configurée)
6. **Test de portabilité** : copier `dist\SR-Analyzer\` sur un PC sans Python/Node → répéter
7. Sur ce PC : lancer `create_shortcut.bat` → vérifier le raccourci bureau
8. Tester `export_data.bat` puis `import_data.bat`

---

## 11. Partage de données entre utilisateurs

```
Utilisateur A                          Utilisateur B
─────────────────────────────          ─────────────────────────────
double-clic export_data.bat            double-clic import_data.bat
→ sr_data_20260513_1430.db  ──────→   → choisir le .db reçu
(dans Documents)                       → relancer SR-Analyzer
```

Pour un partage partiel (seulement les presets par exemple) : utiliser SQLite Browser pour exporter/importer des tables individuelles, ou ajouter des endpoints API JSON.

---

## 12. Structure du projet (référence)

```
Algorithmic-Support-and-Resistance/
├── backend/
│   ├── main.py              ← FastAPI app (modifié pour frozen)
│   ├── sr_data.db           ← Base SQLite utilisateur
│   ├── requirements.txt
│   └── static/              ← Build React (généré par npm run build)
├── frontend/
│   ├── src/
│   └── package.json
├── dist/                    ← Généré par build_standalone.py
│   ├── SR-Analyzer/         ← Application prête à distribuer
│   └── SR-Analyzer.zip      ← Archive à envoyer
├── .build-venv/             ← Venv de build (gitignored)
├── sr_analyzer_launcher.py  ← Entry point PyInstaller (SSL fix + browser + uvicorn)
├── sr_analyzer.spec         ← Config PyInstaller (hiddenimports, datas, excludes)
├── build_standalone.py      ← Script de build complet (7 étapes)
├── start.py                 ← Launcher dev
├── create_shortcut.bat      ← Helper distribué dans le ZIP
├── export_data.bat          ← Helper distribué
├── import_data.bat          ← Helper distribué
└── README.txt               ← Guide utilisateur final distribué
```
