import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TickerForm } from './components/TickerForm';
import { SRParamsPanel } from './components/SRParamsPanel';
import { ChartCard } from './components/ChartCard';
import { ListPanel } from './components/ListPanel';
import { SessionPanel } from './components/SessionPanel';
import { FavoritesPanel } from './components/FavoritesPanel';
import { FundamentalPanel } from './components/FundamentalPanel';
import { TradeJournalPanel, TradeJournalMainView } from './components/TradeJournalPanel';
import { StatsBar } from './components/StatsBar';
import { fetchOhlcv, testConnection, analyzeFundamentalsStream } from './api';
import type { FundamentalResult, TradeJournalEntry } from './api';
import { analyzeOhlcv, computeSupportScore } from './sr';
import type { OHLCVBar, TickerResult, FetchParams } from './api';
import type { AnalysisParams } from './sr';
import type { TickerList, Session, Favorite } from './lib/api-storage';
import {
  getFavorites, upsertFavorite, removeFavorite, favoriteKey,
  migrateFromLocalStorage, saveSession, getTradeJournal,
} from './lib/api-storage';
import './App.css';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

type LevelFilter = 'all' | 'any';
type ActiveFilter = 'score' | 'favorites';
type SortMode = 'score' | 'ticker';

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const sidebarWidthRef = useRef(240);
  const [sidebarTab, setSidebarTab] = useState<'data' | 'sr' | 'favorites' | 'journal'>('data');
  const [journalTrades, setJournalTrades] = useState<TradeJournalEntry[]>([]);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') ?? '');
  const [geminiModel, setGeminiModel]   = useState(() => localStorage.getItem('gemini_model') ?? 'gemini-3-flash-preview');
  const [isFavAnalyzing, setIsFavAnalyzing] = useState(false);
  const [favAnalyzeProgress, setFavAnalyzeProgress] = useState({ done: 0, total: 0 });

  const [fundamentalResults, setFundamentalResults] = useState<Record<string, FundamentalResult>>({});

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    let pending: number | null = null;
    let nextW = startWidth;
    const onMove = (ev: MouseEvent) => {
      nextW = Math.max(180, Math.min(400, startWidth + ev.clientX - startX));
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
  const [sessionVersion, setSessionVersion] = useState(0);
  const [results, setResults] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);
  const [fromCache, setFromCache] = useState<boolean | null>(null);
  const [apiStatus, setApiStatus] = useState<null | 'checking' | 'ok' | 'error'>(null);

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('any');
  const [activeFilters, setActiveFilters] = useState<Set<ActiveFilter>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [srTypeFilter, setSrTypeFilter] = useState<'all' | 'support' | 'resistance'>('all');
  const [zoneOpacity, setZoneOpacity] = useState(0.4);
  const [gridCols, setGridCols] = useState<1 | 2 | 3>(() => (Number(localStorage.getItem('gridCols') ?? '2') as 1 | 2 | 3));

  useEffect(() => { localStorage.setItem('gridCols', String(gridCols)); }, [gridCols]);

  const toggleFilter = (f: ActiveFilter) =>
    setActiveFilters(prev => {
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

  const debouncedParams = useDebounce(analysisParams, 300);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const autoSavePending = useRef(false);
  useEffect(() => () => fetchAbortRef.current?.abort(), []);

  useEffect(() => {
    migrateFromLocalStorage().then(() => {
      getFavorites().then(setFavorites);
    });
    getTradeJournal().then(setJournalTrades);
  }, []);

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

  // Recompute analysis whenever data or params change
  useEffect(() => {
    const entries = Object.entries(ohlcvByTicker);
    if (entries.length === 0) { setResults([]); return; }
    const computed: TickerResult[] = entries.map(([ticker, ohlcv]) => ({
      ticker,
      ohlcv,
      ...analyzeOhlcv(ohlcv, debouncedParams),
    }));
    setResults(computed);

    if (autoSavePending.current) {
      autoSavePending.current = false;
      const tickers = computed.map(r => r.ticker);
      const now = new Date();
      const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const label = tickers.length <= 3 ? tickers.join(', ') : `${tickers.length} tickers`;
      const name = `Auto • ${label} ${currentPeriod}/${currentInterval} – ${dateStr} ${timeStr}`;
      saveSession(name, currentPeriod, currentInterval, debouncedParams, tickers, computed, true)
        .then(() => setSessionVersion(v => v + 1))
        .catch(() => {});
    }
  }, [ohlcvByTicker, debouncedParams]);

  const handleGeminiKeyChange = (key: string) => {
    setGeminiApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const handleGeminiModelChange = (model: string) => {
    setGeminiModel(model);
    localStorage.setItem('gemini_model', model);
  };

  const handleAnalyzeFavorites = async () => {
    if (!geminiApiKey.trim()) return;
    const tickers = [...new Set(favorites.map(f => f.ticker))];
    if (tickers.length === 0) return;
    setIsFavAnalyzing(true);
    setFavAnalyzeProgress({ done: 0, total: tickers.length });
    try {
      for await (const result of analyzeFundamentalsStream(tickers, geminiApiKey.trim(), geminiModel)) {
        setFundamentalResults(prev => ({ ...prev, [result.ticker]: result }));
        setFavAnalyzeProgress(p => ({ ...p, done: p.done + 1 }));
      }
    } finally {
      setIsFavAnalyzing(false);
    }
  };

  const handleTestConnection = async () => {
    setApiStatus('checking');
    try {
      await testConnection();
      setApiStatus('ok');
    } catch {
      setApiStatus('error');
    }
  };

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
      if (!allCached && data.results.length > 0) autoSavePending.current = true;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const msg = (e as Error)?.message ?? '';
      if (msg.startsWith('Erreur 5')) {
        setError(`Erreur interne du serveur — ${msg}. Consultez les logs uvicorn pour le détail.`);
      } else if (msg.startsWith('Erreur 4')) {
        setError(`Requête rejetée par le serveur — ${msg}.`);
      } else {
        setError("Backend inaccessible — vérifiez qu'uvicorn tourne sur le port 8000.");
      }
      setApiStatus(null);
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
      autoSavePending.current = false;
      handleFetch({ tickers, period: session.period, interval: session.interval });
    }
  };

  const loadedTickers = new Set(Object.keys(ohlcvByTicker));
  const hasData = loadedTickers.size > 0;

  // ── Display results with dynamic score based on srTypeFilter ──
  const displayResults = useMemo(() =>
    srTypeFilter === 'support'
      ? results.map(r => ({ ...r, score: computeSupportScore(r.ohlcv, r.sr_levels) }))
      : results,
    [results, srTypeFilter]
  );

  // ── Filtering ──
  const afterTypeFilter = displayResults.filter(r => {
    if (srTypeFilter === 'support')    return r.sr_levels.some(l => l.type === 'support'    && !l.obsolete);
    if (srTypeFilter === 'resistance') return r.sr_levels.some(l => l.type === 'resistance' && !l.obsolete);
    return true;
  });

  const afterLevelFilter = afterTypeFilter.filter(r => {
    if (levelFilter === 'all') return true;
    return r.sr_levels.length > 0;
  });

  const filtered = afterLevelFilter.filter(r => {
    if (activeFilters.size === 0) return true;
    if (activeFilters.has('score')     && r.score.total < 50) return false;
    if (activeFilters.has('favorites') && !isFavoriteNow(r.ticker)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'score') return b.score.total - a.score.total;
    return a.ticker.localeCompare(b.ticker);
  });

  // ── Counters ──
  const withLevels       = results.filter(r => r.sr_levels.length > 0).length;
  const countSupports    = results.filter(r => r.sr_levels.some(l => l.type === 'support'    && !l.obsolete)).length;
  const countResistances = results.filter(r => r.sr_levels.some(l => l.type === 'resistance' && !l.obsolete)).length;
  const highScore        = displayResults.filter(r => r.score.total >= 50).length;
  const favCount         = results.filter(r => isFavoriteNow(r.ticker)).length;

  const topTickers = useMemo(() =>
    [...results]
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 20)
      .map(r => r.ticker),
    [results]
  );

  return (
    <div className="min-h-screen bg-[#1e2939] text-white">
      <header className="sticky top-0 z-20 border-b border-slate-700/60 px-4 py-3 bg-[#1e2939]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-blue-400">S/R</span> Analyzer
              </h1>
              <p className="text-slate-500 text-xs mt-0.5">Support &amp; Résistance algorithmique</p>
            </div>
            {loading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
          </div>
          {hasData && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-1 bg-slate-800 rounded-lg font-mono text-blue-400">
                {activeTimeframe?.interval} · {activeTimeframe?.period}
              </span>
              <span className="px-2 py-1 bg-slate-800 rounded-lg text-slate-300">
                {loadedTickers.size} ticker{loadedTickers.size > 1 ? 's' : ''}
              </span>
              {fromCache !== null && (
                <span className={`px-2 py-1 rounded-lg ${fromCache ? 'bg-slate-800 text-slate-500' : 'bg-blue-950 text-blue-400'}`}>
                  {fromCache ? 'cache' : 'fresh'}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="px-4 pt-5 pb-16">
        <div className="flex gap-0 items-start">

          {/* ── Sidebar ── */}
          <aside
            style={{ width: sidebarWidth }}
            className="shrink-0 sticky top-[76px] self-start max-h-[calc(100vh-5rem)] overflow-y-auto pb-4 scrollbar-thin"
          >
            {/* ── Tab bar ── */}
            <div className="flex border-b border-slate-800 bg-slate-900 rounded-t-xl sticky top-0 z-10">
              {([
                { key: 'data',      icon: '📊', label: 'Data'    },
                { key: 'sr',        icon: '⚙️',  label: 'Analyse' },
                { key: 'favorites', icon: '⭐',  label: 'Favoris' },
                { key: 'journal',   icon: '📒', label: 'Journal' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setSidebarTab(tab.key)}
                  className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors border-b-2 ${
                    sidebarTab === tab.key
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="text-sm leading-none">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* ── Tab content ── */}
            <div className="space-y-3 pt-3">
              {sidebarTab === 'data' && (
                <>
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
                  <SessionPanel
                    hasData={hasData}
                    period={currentPeriod}
                    interval={currentInterval}
                    params={analysisParams}
                    results={results}
                    onRestore={handleRestoreSession}
                    refreshTrigger={sessionVersion}
                    onSessionSaved={() => setSessionVersion(v => v + 1)}
                  />
                  <div className="border-t border-slate-800 pt-3">
                    <FundamentalPanel
                      topTickers={topTickers}
                      onResults={setFundamentalResults}
                      apiKey={geminiApiKey}
                      onApiKeyChange={handleGeminiKeyChange}
                      model={geminiModel}
                      onModelChange={handleGeminiModelChange}
                    />
                  </div>
                </>
              )}
              {sidebarTab === 'sr' && (
                <SRParamsPanel
                  params={analysisParams}
                  hasData={hasData}
                  onParamsChange={setAnalysisParams}
                  zoneOpacity={zoneOpacity}
                  onZoneOpacityChange={setZoneOpacity}
                />
              )}
              {sidebarTab === 'favorites' && (
                <FavoritesPanel
                  favorites={favorites}
                  onFavoritesChange={setFavorites}
                  onLoad={handleLoadFavorite}
                  onAnalyzeFavorites={handleAnalyzeFavorites}
                  isFavAnalyzing={isFavAnalyzing}
                  favAnalyzeProgress={favAnalyzeProgress}
                />
              )}
              {sidebarTab === 'journal' && (
                <TradeJournalPanel
                  trades={journalTrades}
                  onTradesChange={setJournalTrades}
                  apiKey={geminiApiKey}
                  onApiKeyChange={handleGeminiKeyChange}
                  model={geminiModel}
                  onModelChange={handleGeminiModelChange}
                />
              )}
            </div>

            {/* ── Stats footer ── */}
            <div className="mt-3 pt-3 border-t border-slate-800">
              <StatsBar />
            </div>
          </aside>

          {/* ── Resize handle ── */}
          <div
            className="w-1 mx-2 self-stretch shrink-0 cursor-col-resize rounded-full bg-slate-800 hover:bg-blue-500 active:bg-blue-400 transition-colors"
            onMouseDown={startResize}
          />

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0 pl-2">
            {sidebarTab === 'journal' && (
              <TradeJournalMainView
                trades={journalTrades}
                onTradesChange={setJournalTrades}
                apiKey={geminiApiKey}
                model={geminiModel}
              />
            )}
            {sidebarTab !== 'journal' && (
            <>
            {loading && (
              <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Téléchargement en cours…
              </div>
            )}
            {error && (
              <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span>{error}</span>
                  <button
                    onClick={handleTestConnection}
                    disabled={apiStatus === 'checking'}
                    className="shrink-0 px-2.5 py-1 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded-lg text-xs font-medium transition-colors"
                  >
                    {apiStatus === 'checking' ? '…' : 'Tester la connexion'}
                  </button>
                </div>
                {apiStatus === 'ok' && (
                  <p className="mt-2 text-xs text-green-400">✓ Backend accessible — le problème vient des données ou d'une exception serveur.</p>
                )}
                {apiStatus === 'error' && (
                  <p className="mt-2 text-xs text-red-400">✗ Backend inaccessible — uvicorn ne répond pas sur le port 8000.</p>
                )}
              </div>
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
                <p className="text-sm mb-4">Sélectionne une liste ou saisis des tickers dans le panneau gauche, puis clique sur <span className="text-slate-400">Charger les données</span>.</p>
                <button
                  onClick={handleTestConnection}
                  disabled={apiStatus === 'checking'}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                >
                  {apiStatus === 'checking' ? 'Test en cours…' : 'Tester la connexion API'}
                </button>
                {apiStatus === 'ok' && (
                  <p className="mt-2 text-xs text-green-500">✓ Backend accessible (port 8000)</p>
                )}
                {apiStatus === 'error' && (
                  <p className="mt-2 text-xs text-red-500">✗ Backend inaccessible — démarrez uvicorn sur le port 8000</p>
                )}
              </div>
            )}

            {results.length > 0 && !loading && (
              <>
                {/* ── Filter / sort bar ── */}
                <div className="bg-slate-900 border border-slate-700 rounded-2xl px-3 py-2 mb-4 flex items-center gap-2 flex-wrap">

                  {/* Type S/R */}
                  <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                    {([
                      { key: 'all',        label: 'S+R',    count: results.length },
                      { key: 'support',    label: 'Supp',   count: countSupports },
                      { key: 'resistance', label: 'Rés',    count: countResistances },
                    ] as const).map(({ key, label, count }) => (
                      <button
                        key={key}
                        onClick={() => setSrTypeFilter(key)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                          srTypeFilter === key
                            ? key === 'support'    ? 'bg-green-700 text-white'
                            : key === 'resistance' ? 'bg-red-700 text-white'
                            :                        'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {label}
                        <span className={`text-xs px-1 py-0.5 rounded-full ${srTypeFilter === key ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-500'}`}>
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-4 bg-slate-700 shrink-0" />

                  {/* Niveaux */}
                  <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                    {([
                      { key: 'all', label: 'Tous', count: afterTypeFilter.length },
                      { key: 'any', label: 'S/R',  count: withLevels },
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

                  <div className="w-px h-4 bg-slate-700 shrink-0" />

                  {/* Filtres actifs */}
                  <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                    <button
                      onClick={() => setActiveFilters(new Set())}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                        activeFilters.size === 0 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Tous
                      <span className={`text-xs px-1 py-0.5 rounded-full ${activeFilters.size === 0 ? 'bg-blue-500 text-blue-100' : 'bg-slate-700 text-slate-500'}`}>
                        {afterLevelFilter.length}
                      </span>
                    </button>
                    {([
                      { key: 'favorites' as ActiveFilter, label: '★',        count: favCount,  color: 'text-yellow-400' },
                      { key: 'score'     as ActiveFilter, label: '≥50',       count: highScore, color: 'text-blue-400' },
                    ]).map(({ key, label, count, color }) => {
                      const isActive = activeFilters.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleFilter(key)}
                          title={key === 'favorites' ? 'Favoris seulement' : 'Score ≥ 50'}
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

                  {/* Tri */}
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

                  {/* Séparateur + grid toggle + compteur à droite */}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                      {([1, 2, 3] as const).map(n => (
                        <button
                          key={n}
                          onClick={() => setGridCols(n)}
                          title={`${n} colonne${n > 1 ? 's' : ''}`}
                          className={`w-6 h-6 flex items-center justify-center rounded-md text-xs font-bold transition-colors ${
                            gridCols === n ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >{n}</button>
                      ))}
                    </div>
                    <p className="text-slate-500 text-xs whitespace-nowrap">
                      {sorted.length} affiché{sorted.length > 1 ? 's' : ''}
                      {activeFilters.size > 0 && (
                        <span className="ml-1 text-blue-400">· {activeFilters.size} filtre{activeFilters.size > 1 ? 's' : ''}</span>
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
                  <div className={`grid gap-4 ${gridCols === 1 ? 'grid-cols-1' : gridCols === 3 ? 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3' : 'grid-cols-1 xl:grid-cols-2'}`}>
                    {sorted.map(r => (
                      <ChartCard
                        key={r.ticker}
                        ticker={r.ticker}
                        ohlcv={r.ohlcv}
                        srLevels={r.sr_levels}
                        score={r.score}
                        isFavorite={isFavoriteNow(r.ticker)}
                        onToggleFavorite={() => handleToggleFavorite(r.ticker)}
                        interval={currentInterval}
                        dif={analysisParams.dif ?? 1.5}
                        srTypeFilter={srTypeFilter}
                        zoneOpacity={zoneOpacity}
                        fundamentalResult={fundamentalResults[r.ticker]}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
