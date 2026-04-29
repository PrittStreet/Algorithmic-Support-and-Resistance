# S/R Analyzer - Codebase Structure

Analyseur technique d'algorithmes de support/résistance avec interface web interactive.

## Overview

Application full-stack : **FastAPI (backend) + React/TypeScript (frontend)** pour visualiser et analyser les niveaux de support/résistance sur les graphiques boursiers.

---

## Architecture

### Backend (`/backend`)

**Framework:** FastAPI + SQLite

Fonctionnalités principales:
- **API REST**: endpoints pour OHLCV, analyses S/R, sessions, favoris
- **Data fetching**: intégration Yahoo Finance (yfinance)
- **Persistence**: SQLite avec 5 tables principales

**Fichier principal:** `backend/main.py`
- Routes FastAPI
- Validation des requêtes (tickers, periods, intervals)
- Logique d'analyse S/R
- Gestion des patterns détectés
- CORS middleware pour localhost:5173

**Base de données (sr_data.db):**
- `ticker_lists`: listes personnalisées de tickers
- `presets`: configurations d'analyse sauvegardées
- `sessions`: sessions d'analyse complètes
- `feedback`: votes/tags utilisateur (like/dislike) + annotations
- `ohlcv_cache`: cache des données OHLCV (ticker, period, interval)

---

### Frontend (`/frontend`)

**Tech Stack:** React 18 + TypeScript + Vite

#### Composants principaux

| Fichier | Rôle |
|---------|------|
| `src/App.tsx` | Root component, orchestration globale |
| `src/api.ts` | Client API (appels backend) |
| `src/sr.ts` | **Logique d'analyse S/R** (zig-zag, calcul levels) |
| `src/sr.test.ts` | Tests unitaires de l'analyse |
| `src/components/TickerForm.tsx` | Formulaire entrée tickers |
| `src/components/SRParamsPanel.tsx` | Panneaux contrôle paramètres (dif, time, number, min) |
| `src/components/ChartCard.tsx` | **Affichage graphique** (candlesticks + S/R lines) |
| `src/components/ListPanel.tsx` | Listing des tickers analysés |
| `src/components/SessionPanel.tsx` | Gestion sessions sauvegardées |
| `src/components/FavoritesPanel.tsx` | Favoris utilisateur |
| `src/components/AnnotationModal.tsx` | Modal annotations patterns |
| `src/components/PatternRulesPanel.tsx` | Configuration détection patterns |
| `src/components/TradeReferencePanel.tsx` | Références commerciales |

#### Libraries métier

| Fichier | Rôle |
|---------|------|
| `src/lib/patternLearning.ts` | **Détection patterns** (W, Coil, formations) |
| `src/lib/api-storage.ts` | **Storage backend** (favoris, sessions, annotations) |
| `src/lib/preferences.ts` | Préférences utilisateur |

---

## Flux de données principal

```
TickerForm (input)
    ↓
App.tsx (state management)
    ↓
fetchOhlcv() → backend API
    ↓
analyzeOhlcv() → sr.ts (zig-zag, S/R levels)
    ↓
ChartCard (render) + patternLearning (detect patterns)
    ↓
Storage: sessions, feedback, annotations
```

---

## Points clés

### Paramètres d'analyse S/R

Configurables via `SRParamsPanel`:
- `dif`: tolérance groupage points reversement (%)
- `time`: fenêtre temps max entre points (en barres)
- `number`: minimum points dans zone pour tracer ligne S/R
- `min`: barres min depuis le début pour afficher ligne S/R

### Détection de patterns

- Templates: W, Coil, formations pré-définies
- Matching: score basé sur proximité + configuration règles
- Stockage: annotations backend via `PatternAnnotation`

### Persistance

- **IndexedDB**: sessions locales, cache, préférences
- **Backend SQLite**: feedback global, annotations, favoris
- **Synchronisation bidirectionnelle** App.tsx ↔ API

---

## Configuration & Stack

- **Vite** (build tool)
- **TypeScript** config: `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- **ESLint** config: `eslint.config.js`
- **CORS**: auth pour localhost:5173 seulement

## Scripts

- `start.py`: lance backend + frontend
- `build.py`: build frontend
