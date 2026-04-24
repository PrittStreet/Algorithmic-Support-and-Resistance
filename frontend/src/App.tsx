import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TickerForm } from './components/TickerForm';
import { SRParamsPanel } from './components/SRParamsPanel';
import { ChartCard } from './components/ChartCard';
import { ListPanel } from './components/ListPanel';
import { SessionPanel } from './components/SessionPanel';
import { PreferencePanel } from './components/PreferencePanel';
import { fetchOhlcv } from './api';
import { analyzeOhlcv } from './sr';
import type { ChartFingerprint } from './sr';
import type { OHLCVBar, TickerResult, FetchParams } from './api';
import type { AnalysisParams } from './sr';
import type { TickerList, Session, FeedbackEntry } from './lib/api-storage';
import { getFeedback, upsertFeedback, removeFeedback, migrateFromLocalStorage } from './lib/api-storage';
import { buildPreferenceModel, computePreferenceBonus, computePreferenceScore, getTopInfluencingFeatures } from './lib/preferences';
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
type PatternFilter = 'all' | 'w_forming' | 'w_confirmed' | 'coil' | 'score';
type SortMode = 'score' | 'ticker';

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarWidthRef = useRef(300);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(220, Math.min(520, startWidth + ev.clientX - startX));
      setSidebarWidth(w);
      sidebarWidthRef.current = w;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const [ohlcvByTicker, setOhlcvByTicker] = useState<Record<string, OHLCVBar[]>>({});
  const [analysisParams, setAnalysisParams] = useState<AnalysisParams>({
    dif: 1.5,
    pivot_order: 5,
    min_touches: 2,
  });
  const [results, setResults] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);
  const [fromCache, setFromCache] = useState<boolean | null>(null);

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('any');
  const [patternFilter, setPatternFilter] = useState<PatternFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const [selectedList, setSelectedList] = useState<TickerList | null>(null);
  const [currentPeriod, setCurrentPeriod] = useState('3mo');
  const [currentInterval, setCurrentInterval] = useState('1d');
  const [activeTimeframe, setActiveTimeframe] = useState<{ period: string; interval: string } | null>(null);

  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [fingerprintByTicker, setFingerprintByTicker] = useState<Record<string, ChartFingerprint>>({});
  const [scoreMode, setScoreMode] = useState<'raw' | 'adjusted'>('raw');

  const debouncedParams = useDebounce(analysisParams, 300);

  useEffect(() => {
    migrateFromLocalStorage().then(() => getFeedback().then(setFeedback));
  }, []);

  useEffect(() => {
    const entries = Object.entries(ohlcvByTicker);
    if (entries.length === 0) { setResults([]); setFingerprintByTicker({}); return; }
    const computed: TickerResult[] = [];
    const fps: Record<string, ChartFingerprint> = {};
    for (const [ticker, ohlcv] of entries) {
      const analysis = analyzeOhlcv(ohlcv, debouncedParams);
      computed.push({ ticker, ohlcv, ...analysis });
      fps[ticker] = analysis.fingerprint;
    }
    setResults(computed);
    setFingerprintByTicker(fps);
  }, [ohlcvByTicker, debouncedParams]);

  const preferenceModel = useMemo(() => buildPreferenceModel(feedback), [feedback]);

  const getAdjustedScore = (r: TickerResult) => {
    if (!preferenceModel || scoreMode === 'raw') return r.score.total;
    const fp = fingerprintByTicker[r.ticker];
    if (!fp) return r.score.total;
    return r.score.total + computePreferenceBonus(fp, preferenceModel);
  };

  const handleFeedbackVote = async (ticker: string, vote: 'like' | 'dislike', tags: string[]) => {
    const fp = fingerprintByTicker[ticker];
    if (!fp) return;
    const entry = await upsertFeedback(ticker, vote, tags, fp);
    setFeedback(prev => [entry, ...prev.filter(f => f.ticker !== ticker)]);
  };

  const handleRemoveFeedback = async (ticker: string) => {
    await removeFeedback(ticker);
    setFeedback(prev => prev.filter(f => f.ticker !== ticker));
  };

  const handleClearAll = () => {
    setOhlcvByTicker({});
    setActiveTimeframe(null);
    setFromCache(null);
    setError(null);
    setNoData(false);
  };

  const handleFetch = async (params: FetchParams) => {
    setCurrentPeriod(params.period);
    setCurrentInterval(params.interval);
    setLoading(true);
    setError(null);
    setNoData(false);
    setFromCache(null);

    const utChanged = activeTimeframe &&
      (activeTimeframe.period !== params.period || activeTimeframe.interval !== params.interval);
    if (utChanged) setOhlcvByTicker({});

    try {
      const data = await fetchOhlcv(params);
      let allCached = true;
      const newOhlcv: Record<string, OHLCVBar[]> = {};
      for (const r of data.results) {
        newOhlcv[r.ticker] = r.ohlcv;
        if (!r.from_cache) allCached = false;
      }
      setOhlcvByTicker(prev => (utChanged ? newOhlcv : { ...prev, ...newOhlcv }));
      setActiveTimeframe({ period: params.period, interval: params.interval });
      setFromCache(data.results.length > 0 ? allCached : null);
      if (data.results.length === 0) setNoData(true);
    } catch {
      setError("Impossible de contacter le backend. Vérifiez qu'uvicorn tourne sur le port 8000.");
    } finally {
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

    // Legacy sessions stored OHLCV — restore charts directly
    const hasOhlcv = session.snapshot.length > 0 && session.snapshot[0].ohlcv && session.snapshot[0].ohlcv.length > 0;
    if (hasOhlcv) {
      const byTicker: Record<string, OHLCVBar[]> = {};
      for (const r of session.snapshot) { if (r.ohlcv) byTicker[r.ticker] = r.ohlcv; }
      setOhlcvByTicker(byTicker);
      setActiveTimeframe({ period: session.period, interval: session.interval });
    } else {
      // New-style session: auto-fetch data (OHLCV stripped at save time)
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
    if (patternFilter === 'all') return true;
    if (patternFilter === 'w_forming') return r.w_patterns.some(w => !w.confirmed);
    if (patternFilter === 'w_confirmed') return r.w_patterns.some(w => w.confirmed);
    if (patternFilter === 'coil') return r.is_coiling;
    if (patternFilter === 'score') return r.score.total >= 50;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'score') return getAdjustedScore(b) - getAdjustedScore(a);
    return a.ticker.localeCompare(b.ticker);
  });

  // ── Counters ──
  const withLevels = results.filter(r => r.sr_levels.length > 0).length;
  const withSupport = results.filter(r => r.sr_levels.some(l => l.type === 'support')).length;
  const withResistance = results.filter(r => r.sr_levels.some(l => l.type === 'resistance')).length;
  const wForming = results.filter(r => r.w_patterns.some(w => !w.confirmed)).length;
  const wConfirmed = results.filter(r => r.w_patterns.some(w => w.confirmed)).length;
  const coiling = results.filter(r => r.is_coiling).length;
  const highScore = results.filter(r => r.score.total >= 50).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-3 mb-5">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-blue-400">S/R</span> Analyzer
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">Support &amp; Résistance algorithmiques — Yahoo Finance</p>
          </div>
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

            <SRParamsPanel
              params={analysisParams}
              hasData={hasData}
              onParamsChange={setAnalysisParams}
              onParamsSet={setAnalysisParams}
            />

            <SessionPanel
              hasData={hasData}
              period={currentPeriod}
              interval={currentInterval}
              params={analysisParams}
              results={results}
              onRestore={handleRestoreSession}
            />

            <PreferencePanel
              feedback={feedback}
              onFeedbackChange={setFeedback}
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

            {!hasData && !loading && !error && !noData && (
              <div className="flex flex-col items-center justify-center py-32 text-slate-600">
                <p className="text-lg font-medium mb-1">Aucune donnée chargée</p>
                <p className="text-sm">Sélectionne une liste ou saisis des tickers dans le panneau gauche, puis clique sur <span className="text-slate-400">Charger les données</span>.</p>
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
                          { key: 'all',        label: 'Tous',  count: results.length },
                          { key: 'any',        label: 'S/R',   count: withLevels },
                          { key: 'support',    label: 'Supp',  count: withSupport },
                          { key: 'resistance', label: 'Rés',   count: withResistance },
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

                    <div className="flex items-center gap-2">
                      {preferenceModel && (
                        <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                          <button
                            onClick={() => setScoreMode('raw')}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${scoreMode === 'raw' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="Classement basé uniquement sur le score algorithmique brut"
                          >
                            Brut
                          </button>
                          <button
                            onClick={() => setScoreMode('adjusted')}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${scoreMode === 'adjusted' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="Classement tenant compte de tes préférences personnelles"
                          >
                            Ajusté ✦
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-500 uppercase tracking-widest">Trier</span>
                        <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5">
                          <button
                            onClick={() => setSortMode('score')}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'score' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                          >
                            Score ↓
                          </button>
                          <button
                            onClick={() => setSortMode('ticker')}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'ticker' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                          >
                            A–Z
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: patterns */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500 uppercase tracking-widest">Patterns</span>
                    <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5 flex-wrap">
                      {([
                        { key: 'all',         label: 'Tous',        count: afterLevelFilter.length, color: '' },
                        { key: 'w_forming',   label: 'W form.',     count: wForming,    color: 'text-yellow-400' },
                        { key: 'w_confirmed', label: 'W conf.',     count: wConfirmed,  color: 'text-green-400' },
                        { key: 'coil',        label: 'Coil',        count: coiling,     color: 'text-purple-400' },
                        { key: 'score',       label: 'Score ≥ 50',  count: highScore,   color: 'text-blue-400' },
                      ] as const).map(({ key, label, count, color }) => (
                        <button
                          key={key}
                          onClick={() => setPatternFilter(key)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                            patternFilter === key
                              ? 'bg-blue-600 text-white'
                              : `${color || 'text-slate-400'} hover:text-white`
                          }`}
                        >
                          {label}
                          <span className={`text-xs px-1 py-0.5 rounded-full ${patternFilter === key ? 'bg-blue-500 text-blue-100' : 'bg-slate-700 text-slate-500'}`}>
                            {count}
                          </span>
                        </button>
                      ))}
                    </div>

                    <p className="text-slate-500 text-xs ml-auto">
                      {sorted.length} affiché{sorted.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {sorted.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <p className="text-lg mb-2">Aucun résultat pour ce filtre</p>
                    <p className="text-sm">Essayez d'assouplir les paramètres S/R ou de changer de filtre.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {sorted.map(r => {
                      const fp = fingerprintByTicker[r.ticker];
                      const vote = feedback.find(f => f.ticker === r.ticker)?.vote ?? null;
                      if (!fp) return null;
                      const prefScore   = (preferenceModel && fp) ? computePreferenceScore(fp, preferenceModel) : null;
                      const prefTopFeat = (preferenceModel && fp) ? getTopInfluencingFeatures(fp, preferenceModel) : null;
                      return (
                        <ChartCard
                          key={r.ticker}
                          ticker={r.ticker}
                          ohlcv={r.ohlcv}
                          srLevels={r.sr_levels}
                          wPatterns={r.w_patterns}
                          score={r.score}
                          isCoiling={r.is_coiling}
                          fingerprint={fp}
                          currentVote={vote}
                          preferenceScore={prefScore}
                          preferenceTopFeatures={prefTopFeat}
                          onFeedback={(v, tags) => handleFeedbackVote(r.ticker, v, tags)}
                          onRemoveFeedback={() => handleRemoveFeedback(r.ticker)}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
