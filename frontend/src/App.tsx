import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TickerForm } from './components/TickerForm';
import { SRParamsPanel } from './components/SRParamsPanel';
import { ChartCard } from './components/ChartCard';
import { ListPanel } from './components/ListPanel';
import { SessionPanel } from './components/SessionPanel';
import { FavoritesPanel } from './components/FavoritesPanel';
import { TradeReferencePanel } from './components/TradeReferencePanel';
import { AnnotationModal } from './components/AnnotationModal';
import { fetchOhlcv } from './api';
import { analyzeOhlcv } from './sr';
import type { OHLCVBar, TickerResult, FetchParams } from './api';
import type { AnalysisParams } from './sr';
import type { TickerList, Session, Favorite, TradeReference, PatternAnnotation } from './lib/api-storage';
import {
  getFavorites, upsertFavorite, removeFavorite, favoriteKey,
  migrateFromLocalStorage, getTradeReferences, getPatternAnnotations,
  createTradeReference,
} from './lib/api-storage';
import { buildTemplates, DEFAULT_PATTERN_RULES } from './lib/patternLearning';
import type { PatternTemplate, DetectedPattern, PatternRulesConfig } from './lib/patternLearning';
import { PatternRulesPanel } from './components/PatternRulesPanel';
import type { PrefilledAnnotation } from './components/AnnotationModal';
import './App.css';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

type LevelFilter = 'all' | 'any' | 'support' | 'resistance';
type PatternFilter = 'w_forming' | 'w_confirmed' | 'coil' | 'score' | 'favorites' | 'matched' | 'proximity';

const PROXIMITY_THRESHOLD_PCT = 3; // % de tolérance prix↔dernier point du pattern

function patternProximityPct(r: TickerResult): number {
  if (r.matched_patterns.length === 0 || r.ohlcv.length === 0) return Infinity;
  const lastPrice = r.ohlcv[r.ohlcv.length - 1].close;
  if (lastPrice <= 0) return Infinity;
  // Prend le meilleur pattern (score le plus haut) et son dernier point comme "zone de déclenchement"
  const best = r.matched_patterns.reduce((a, b) => (a.score >= b.score ? a : b));
  const trigger = best.points[best.points.length - 1];
  if (!trigger) return Infinity;
  return Math.abs(lastPrice - trigger.price) / lastPrice * 100;
}
type SortMode = 'score' | 'ticker';

function CreateRefDialog({
  ticker, ohlcv, interval, onClose, onCreated,
}: {
  ticker: string;
  ohlcv: OHLCVBar[];
  interval: string;
  onClose: () => void;
  onCreated: (ref: TradeReference) => void;
}) {
  const fmt = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const [dateIn, setDateIn] = useState(ohlcv.length > 0 ? fmt(ohlcv[0].time) : '');
  const [dateOut, setDateOut] = useState(ohlcv.length > 0 ? fmt(ohlcv[ohlcv.length - 1].time) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const ref = await createTradeReference(ticker, dateIn, dateOut, interval, note || `Référence manuelle ${ticker}`);
      onCreated(ref);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Erreur');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Créer une référence</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Ticker</label>
            <div className="mt-1 px-3 py-2 bg-slate-800 rounded-lg text-white text-sm font-mono">{ticker}</div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-400">Date entrée</label>
              <input type="date" value={dateIn} onChange={e => setDateIn(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400">Date sortie</label>
              <input type="date" value={dateOut} onChange={e => setDateOut(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Note (optionnelle)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder={`Référence manuelle ${ticker}`}
              className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving || !dateIn || !dateOut}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 text-sm font-medium disabled:opacity-50 transition-colors">
              {saving ? 'Création…' : 'Créer & Annoter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarWidthRef = useRef(300);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    let pending: number | null = null;
    let nextW = startWidth;
    const onMove = (ev: MouseEvent) => {
      nextW = Math.max(220, Math.min(520, startWidth + ev.clientX - startX));
      if (pending !== null) return;
      pending = requestAnimationFrame(() => {
        setSidebarWidth(nextW);
        sidebarWidthRef.current = nextW;
        pending = null;
      });
    };
    const onUp = () => {
      if (pending !== null) cancelAnimationFrame(pending);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const [ohlcvByTicker, setOhlcvByTicker] = useState<Record<string, OHLCVBar[]>>({});
  const [analysisParams, setAnalysisParams] = useState<AnalysisParams>({ tolerance: 1.5 });
  const [results, setResults] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);
  const [fromCache, setFromCache] = useState<boolean | null>(null);

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('any');
  const [activePatternFilters, setActivePatternFilters] = useState<Set<PatternFilter>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const togglePatternFilter = (f: PatternFilter) =>
    setActivePatternFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });

  const [selectedList, setSelectedList] = useState<TickerList | null>(null);
  const [currentPeriod, setCurrentPeriod] = useState('3mo');
  const [currentInterval, setCurrentInterval] = useState('1d');
  const [activeTimeframe, setActiveTimeframe] = useState<{ period: string; interval: string } | null>(null);

  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [missingTickers, setMissingTickers] = useState<string[]>([]);

  // Trade Reference system
  const [tradeRefs, setTradeRefs] = useState<TradeReference[]>([]);
  const [annotations, setAnnotations] = useState<PatternAnnotation[]>([]);
  const [annotatingRef, setAnnotatingRef] = useState<TradeReference | null>(null);
  const [prefilledAnnotation, setPrefilledAnnotation] = useState<PrefilledAnnotation | null>(null);
  const [templates, setTemplates] = useState<PatternTemplate[]>([]);
  const [manualRefState, setManualRefState] = useState<{ ticker: string; ohlcv: OHLCVBar[] } | null>(null);

  const [patternRules, setPatternRules] = useState<PatternRulesConfig>(() => {
    try {
      const saved = localStorage.getItem('patternRules');
      if (!saved) return DEFAULT_PATTERN_RULES;
      const parsed = JSON.parse(saved) as Partial<PatternRulesConfig>;
      // Deep merge with defaults so new fields survive upgrades
      return {
        Range:              { ...DEFAULT_PATTERN_RULES.Range,              ...(parsed.Range              ?? {}) },
        W:                  { ...DEFAULT_PATTERN_RULES.W,                  ...(parsed.W                  ?? {}) },
        ETE:                { ...DEFAULT_PATTERN_RULES.ETE,                ...(parsed.ETE                ?? {}) },
        TriangleAscendant:  { ...DEFAULT_PATTERN_RULES.TriangleAscendant,  ...(parsed.TriangleAscendant  ?? {}) },
      };
    } catch { return DEFAULT_PATTERN_RULES; }
  });

  // Persist rules whenever they change
  useEffect(() => {
    localStorage.setItem('patternRules', JSON.stringify(patternRules));
  }, [patternRules]);

  const handlePromotePattern = async (mp: DetectedPattern, ticker: string, interval: string) => {
    if (mp.points.length < 2) return;
    const firstTime = mp.points[0].time;
    const lastTime = mp.points[mp.points.length - 1].time;
    const span = Math.max(lastTime - firstTime, 86400);
    const padding = Math.min(span * 0.25, 86400 * 30);
    const dateIn = new Date((firstTime - padding) * 1000).toISOString().slice(0, 10);
    const dateOut = new Date((lastTime + padding) * 1000).toISOString().slice(0, 10);
    try {
      const ref = await createTradeReference(
        ticker, dateIn, dateOut, interval,
        `Auto-promu: ${mp.pattern_type} (${mp.score}%)`,
      );
      setTradeRefs(prev => [ref, ...prev]);
      setPrefilledAnnotation({
        patternType: mp.pattern_type,
        points: mp.points.map(pt => ({ label: pt.label, price: pt.price, time: pt.time })),
      });
      setAnnotatingRef(ref);
    } catch (e) {
      console.error('[Promote] Failed:', e);
    }
  };

  const debouncedParams = useDebounce(analysisParams, 300);
  const fetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => fetchAbortRef.current?.abort(), []);

  // Initial data load
  useEffect(() => {
    migrateFromLocalStorage().then(() => {
      getFavorites().then(setFavorites);
      getTradeReferences().then(setTradeRefs);
      getPatternAnnotations().then(anns => {
        setAnnotations(anns);
        setTemplates(buildTemplates(anns));
      });
    });
  }, []);

  // Rebuild templates whenever annotations change
  useEffect(() => {
    setTemplates(buildTemplates(annotations));
  }, [annotations]);

  const favoriteSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of favorites) s.add(favoriteKey(f));
    return s;
  }, [favorites]);

  const isFavoriteNow = (ticker: string): boolean => {
    if (!activeTimeframe) return false;
    return favoriteSet.has(favoriteKey({ ticker, period: activeTimeframe.period, interval: activeTimeframe.interval }));
  };

  const handleLoadFavorite = (fav: Favorite) => {
    setCurrentPeriod(fav.period);
    setCurrentInterval(fav.interval);
    setSelectedList({ id: '_fav_', name: `★ ${fav.ticker}`, tickers: [fav.ticker], createdAt: 0 });
    handleFetch({ tickers: [fav.ticker], period: fav.period, interval: fav.interval });
  };

  const handleToggleFavorite = async (ticker: string) => {
    if (!activeTimeframe) return;
    const { period, interval } = activeTimeframe;
    const key = favoriteKey({ ticker, period, interval });
    if (favoriteSet.has(key)) {
      await removeFavorite(ticker, period, interval);
      setFavorites(prev => prev.filter(f => favoriteKey(f) !== key));
    } else {
      const fav = await upsertFavorite(ticker, period, interval);
      setFavorites(prev => [fav, ...prev.filter(f => favoriteKey(f) !== key)]);
    }
  };

  // Recompute analysis whenever data / params / templates change
  useEffect(() => {
    const entries = Object.entries(ohlcvByTicker);
    if (entries.length === 0) { setResults([]); return; }
    const computed: TickerResult[] = [];
    for (const [ticker, ohlcv] of entries) {
      const analysis = analyzeOhlcv(ohlcv, debouncedParams, templates, patternRules);
      computed.push({ ticker, ohlcv, ...analysis });
    }
    setResults(computed);
  }, [ohlcvByTicker, debouncedParams, templates]);

  const handleClearAll = () => {
    fetchAbortRef.current?.abort();
    setOhlcvByTicker({});
    setActiveTimeframe(null);
    setFromCache(null);
    setError(null);
    setNoData(false);
    setMissingTickers([]);
  };

  const handleFetch = async (params: FetchParams) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setCurrentPeriod(params.period);
    setCurrentInterval(params.interval);
    setLoading(true);
    setError(null);
    setNoData(false);
    setFromCache(null);
    setMissingTickers([]);

    const utChanged = activeTimeframe &&
      (activeTimeframe.period !== params.period || activeTimeframe.interval !== params.interval);
    if (utChanged) setOhlcvByTicker({});

    try {
      const data = await fetchOhlcv(params, controller.signal);
      if (controller.signal.aborted) return;
      let allCached = true;
      const newOhlcv: Record<string, OHLCVBar[]> = {};
      const returned = new Set<string>();
      for (const r of data.results) {
        newOhlcv[r.ticker] = r.ohlcv;
        returned.add(r.ticker);
        if (!r.from_cache) allCached = false;
      }
      const missing = params.tickers.filter(t => !returned.has(t.toUpperCase()));
      setOhlcvByTicker(prev => (utChanged ? newOhlcv : { ...prev, ...newOhlcv }));
      setActiveTimeframe({ period: params.period, interval: params.interval });
      setFromCache(data.results.length > 0 ? allCached : null);
      setMissingTickers(missing);
      if (data.results.length === 0) setNoData(true);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setError("Impossible de contacter le backend. Vérifiez qu'uvicorn tourne sur le port 8000.");
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      setLoading(false);
    }
  };

  const handleRestoreSession = (session: Session) => {
    setAnalysisParams(session.params);
    setCurrentPeriod(session.period);
    setCurrentInterval(session.interval);
    setActiveTimeframe(null);
    setFromCache(null);
    setError(null);
    setNoData(false);

    const hasOhlcv = session.snapshot.length > 0 && session.snapshot[0].ohlcv && session.snapshot[0].ohlcv.length > 0;
    if (hasOhlcv) {
      const byTicker: Record<string, OHLCVBar[]> = {};
      for (const r of session.snapshot) { if (r.ohlcv) byTicker[r.ticker] = r.ohlcv; }
      setOhlcvByTicker(byTicker);
      setActiveTimeframe({ period: session.period, interval: session.interval });
    } else {
      setOhlcvByTicker({});
      const tickers = session.tickers ?? session.snapshot.map(r => r.ticker);
      setSelectedList({ id: '_restore_', name: session.name, tickers, createdAt: 0 });
      handleFetch({ tickers, period: session.period, interval: session.interval });
    }
  };

  const loadedTickers = new Set(Object.keys(ohlcvByTicker));
  const hasData = loadedTickers.size > 0;

  // ── Filtering ──
  const afterLevelFilter = results.filter(r => {
    if (levelFilter === 'all') return true;
    if (levelFilter === 'any') return r.sr_levels.length > 0;
    if (levelFilter === 'support') return r.sr_levels.some(l => l.type === 'support');
    return r.sr_levels.some(l => l.type === 'resistance');
  });

  const filtered = afterLevelFilter.filter(r => {
    if (activePatternFilters.size === 0) return true;
    if (activePatternFilters.has('w_forming')   && !r.w_patterns.some(w => !w.confirmed)) return false;
    if (activePatternFilters.has('w_confirmed') && !r.w_patterns.some(w => w.confirmed)) return false;
    if (activePatternFilters.has('coil')        && !r.is_coiling) return false;
    if (activePatternFilters.has('score')       && r.score.total < 50) return false;
    if (activePatternFilters.has('favorites')   && !isFavoriteNow(r.ticker)) return false;
    if (activePatternFilters.has('matched')     && r.matched_patterns.length === 0) return false;
    if (activePatternFilters.has('proximity')   && patternProximityPct(r) > PROXIMITY_THRESHOLD_PCT) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    // Quand le filtre proximité est actif, trie par proximité croissante (plus proche en haut)
    if (activePatternFilters.has('proximity') && activePatternFilters.size === 1) {
      return patternProximityPct(a) - patternProximityPct(b);
    }
    if (sortMode === 'score') {
      return b.score.total - a.score.total;
    }
    return a.ticker.localeCompare(b.ticker);
  });

  // ── Counters ──
  const withLevels     = results.filter(r => r.sr_levels.length > 0).length;
  const withSupport    = results.filter(r => r.sr_levels.some(l => l.type === 'support')).length;
  const withResistance = results.filter(r => r.sr_levels.some(l => l.type === 'resistance')).length;
  const wForming       = results.filter(r => r.w_patterns.some(w => !w.confirmed)).length;
  const wConfirmed     = results.filter(r => r.w_patterns.some(w => w.confirmed)).length;
  const coiling        = results.filter(r => r.is_coiling).length;
  const highScore      = results.filter(r => r.score.total >= 50).length;
  const favCount       = results.filter(r => isFavoriteNow(r.ticker)).length;
  const matchedCount   = results.filter(r => r.matched_patterns.length > 0).length;
  const proximityCount = results.filter(r => patternProximityPct(r) <= PROXIMITY_THRESHOLD_PCT).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-3 mb-5">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-blue-400">S/R</span> Analyzer
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">Support &amp; Résistance · Apprentissage de patterns</p>
          </div>
          <div className="flex items-center gap-3">
            {templates.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-400 font-medium">{templates.length} template{templates.length > 1 ? 's' : ''} actif{templates.length > 1 ? 's' : ''}</span>
              </div>
            )}
            {hasData && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-mono text-blue-400">{activeTimeframe?.interval} · {activeTimeframe?.period}</span>
                <span className="text-slate-600">·</span>
                <span>{loadedTickers.size} ticker{loadedTickers.size > 1 ? 's' : ''}</span>
                {fromCache !== null && (
                  <span className={`px-2 py-0.5 rounded-full ${fromCache ? 'bg-slate-800 text-slate-500' : 'bg-blue-950 text-blue-400'}`}>
                    {fromCache ? 'cache' : 'fresh'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 pb-16">
        <div className="flex gap-0 items-start">

          {/* ── Sidebar ── */}
          <aside
            style={{ width: sidebarWidth }}
            className="shrink-0 sticky top-4 self-start max-h-[calc(100vh-5rem)] overflow-y-auto space-y-3 pb-4 scrollbar-thin"
          >
            <ListPanel
              selectedId={selectedList?.id ?? null}
              loadedTickers={loadedTickers}
              onSelect={list => setSelectedList(list)}
            />

            <TickerForm
              onFetch={handleFetch}
              loading={loading}
              loadedTickers={loadedTickers}
              selectedList={selectedList}
              activeTimeframe={activeTimeframe}
              onClearAll={handleClearAll}
              period={currentPeriod}
              interval={currentInterval}
              onPeriodChange={setCurrentPeriod}
              onIntervalChange={setCurrentInterval}
            />

            <TradeReferencePanel
              refs={tradeRefs}
              annotations={annotations}
              onRefsChange={(newRefs) => {
                setTradeRefs(newRefs);
                const activeIds = new Set(newRefs.map(r => r.id));
                setAnnotations(prev => prev.filter(a => activeIds.has(a.tradeRefId)));
              }}
              onAnnotate={ref => setAnnotatingRef(ref)}
            />

            <SRParamsPanel
              params={analysisParams}
              hasData={hasData}
              onParamsChange={setAnalysisParams}
            />

            <PatternRulesPanel
              rules={patternRules}
              onRulesChange={setPatternRules}
            />

            <SessionPanel
              hasData={hasData}
              period={currentPeriod}
              interval={currentInterval}
              params={analysisParams}
              results={results}
              onRestore={handleRestoreSession}
            />

            <FavoritesPanel
              favorites={favorites}
              onFavoritesChange={setFavorites}
              onLoad={handleLoadFavorite}
            />
          </aside>

          {/* ── Resize handle ── */}
          <div
            className="w-1 mx-2 self-stretch shrink-0 cursor-col-resize rounded-full bg-slate-800 hover:bg-blue-500 active:bg-blue-400 transition-colors"
            onMouseDown={startResize}
          />

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0 pl-2">
            {loading && (
              <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Téléchargement en cours…
              </div>
            )}
            {error && (
              <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-4 text-sm">{error}</div>
            )}
            {noData && !loading && (
              <div className="bg-amber-950 border border-amber-800 text-amber-300 rounded-xl px-4 py-3 mb-4 text-sm">
                Aucune donnée reçue — Yahoo Finance est peut-être temporairement limité. Réessayez dans quelques secondes.
              </div>
            )}
            {missingTickers.length > 0 && !loading && (
              <div className="bg-amber-950/50 border border-amber-900 text-amber-400 rounded-xl px-4 py-2.5 mb-4 text-xs">
                <span className="font-semibold">{missingTickers.length} ticker{missingTickers.length > 1 ? 's' : ''} non trouvé{missingTickers.length > 1 ? 's' : ''}</span>
                <span className="text-amber-500/70 ml-2 font-mono">{missingTickers.slice(0, 20).join(', ')}{missingTickers.length > 20 ? '…' : ''}</span>
              </div>
            )}

            {!hasData && !loading && !error && !noData && (
              <div className="flex flex-col items-center justify-center py-32 text-slate-600">
                <p className="text-lg font-medium mb-1">Aucune donnée chargée</p>
                <p className="text-sm">Sélectionne une liste ou saisis des tickers dans le panneau gauche, puis clique sur <span className="text-slate-400">Charger les données</span>.</p>
                {annotations.length === 0 && (
                  <p className="text-xs text-slate-700 mt-4 max-w-sm text-center">
                    Astuce : ajoute des trades de référence dans le panneau <span className="text-slate-500">TRADE REFERENCE</span> pour apprendre tes setups favoris.
                  </p>
                )}
              </div>
            )}

            {results.length > 0 && !loading && (
              <>
                {/* ── Filter / sort bar ── */}
                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 mb-4 space-y-2.5">

                  {/* Row 1: niveau + tri */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-500 uppercase tracking-widest">Niveaux</span>
                      <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                        {([
                          { key: 'all',        label: 'Tous', count: results.length },
                          { key: 'any',        label: 'S/R',  count: withLevels },
                          { key: 'support',    label: 'Supp', count: withSupport },
                          { key: 'resistance', label: 'Rés',  count: withResistance },
                        ] as const).map(({ key, label, count }) => (
                          <button
                            key={key}
                            onClick={() => setLevelFilter(key)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                              levelFilter === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {label}
                            <span className={`text-xs px-1 py-0.5 rounded-full ${levelFilter === key ? 'bg-blue-500 text-blue-100' : 'bg-slate-700 text-slate-500'}`}>
                              {count}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500 uppercase tracking-widest">Trier</span>
                      <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                        <button
                          onClick={() => setSortMode('score')}
                          className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'score' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >Score ↓</button>
                        <button
                          onClick={() => setSortMode('ticker')}
                          className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'ticker' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >A–Z</button>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: patterns (cumulatifs) */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500 uppercase tracking-widest">Patterns</span>
                    <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5 flex-wrap">
                      {/* Reset button */}
                      <button
                        onClick={() => setActivePatternFilters(new Set())}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                          activePatternFilters.size === 0
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Tous
                        <span className={`text-xs px-1 py-0.5 rounded-full ${activePatternFilters.size === 0 ? 'bg-blue-500 text-blue-100' : 'bg-slate-700 text-slate-500'}`}>
                          {afterLevelFilter.length}
                        </span>
                      </button>
                      {([
                        { key: 'favorites'   as PatternFilter, label: '★ Favoris',   count: favCount,       color: 'text-yellow-400' },
                        { key: 'matched'     as PatternFilter, label: '◆ Templates', count: matchedCount,   color: 'text-blue-400' },
                        { key: 'proximity'   as PatternFilter, label: `⊙ Près (≤${PROXIMITY_THRESHOLD_PCT}%)`, count: proximityCount, color: 'text-cyan-400' },
                        { key: 'w_forming'   as PatternFilter, label: 'W form.',     count: wForming,       color: 'text-yellow-400' },
                        { key: 'w_confirmed' as PatternFilter, label: 'W conf.',     count: wConfirmed,     color: 'text-green-400' },
                        { key: 'coil'        as PatternFilter, label: 'Coil',        count: coiling,        color: 'text-purple-400' },
                        { key: 'score'       as PatternFilter, label: 'Score ≥ 50',  count: highScore,      color: 'text-blue-400' },
                      ]).map(({ key, label, count, color }) => {
                        const isActive = activePatternFilters.has(key);
                        return (
                          <button
                            key={key}
                            onClick={() => togglePatternFilter(key)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                              isActive ? 'bg-blue-600 text-white' : `${color} hover:text-white`
                            }`}
                          >
                            {label}
                            <span className={`text-xs px-1 py-0.5 rounded-full ${isActive ? 'bg-blue-500 text-blue-100' : 'bg-slate-700 text-slate-500'}`}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-slate-500 text-xs ml-auto">
                      {sorted.length} affiché{sorted.length > 1 ? 's' : ''}
                      {activePatternFilters.size > 0 && (
                        <span className="ml-1 text-blue-400">· {activePatternFilters.size} filtre{activePatternFilters.size > 1 ? 's' : ''} actif{activePatternFilters.size > 1 ? 's' : ''}</span>
                      )}
                    </p>
                  </div>
                </div>

                {sorted.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <p className="text-lg mb-2">Aucun résultat pour ce filtre</p>
                    <p className="text-sm">Essayez d'assouplir la tolérance ou de changer de filtre.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {sorted.map(r => (
                      <ChartCard
                        key={r.ticker}
                        ticker={r.ticker}
                        ohlcv={r.ohlcv}
                        srLevels={r.sr_levels}
                        wPatterns={r.w_patterns}
                        score={r.score}
                        isCoiling={r.is_coiling}
                        matchedPatterns={r.matched_patterns}
                        isFavorite={isFavoriteNow(r.ticker)}
                        onToggleFavorite={() => handleToggleFavorite(r.ticker)}
                        onPromotePattern={(mp) => handlePromotePattern(mp, r.ticker, currentInterval)}
                        onCreateReference={() => setManualRefState({ ticker: r.ticker, ohlcv: r.ohlcv })}
                        templates={templates}
                        interval={currentInterval}
                        dif={analysisParams.dif ?? 1.5}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Annotation Modal ── */}
      {annotatingRef && (
        <AnnotationModal
          tradeRef={annotatingRef}
          prefilled={prefilledAnnotation}
          onClose={() => { setAnnotatingRef(null); setPrefilledAnnotation(null); }}
          onAnnotationsSaved={() => {
            getPatternAnnotations().then(all => setAnnotations(all));
          }}
        />
      )}

      {/* ── Create Manual Reference Dialog ── */}
      {manualRefState && (
        <CreateRefDialog
          ticker={manualRefState.ticker}
          ohlcv={manualRefState.ohlcv}
          interval={currentInterval}
          onClose={() => setManualRefState(null)}
          onCreated={ref => {
            setTradeRefs(prev => [ref, ...prev]);
            setManualRefState(null);
            setAnnotatingRef(ref);
          }}
        />
      )}
    </div>
  );
}
