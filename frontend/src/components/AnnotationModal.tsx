import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from 'lightweight-charts';
import type { OHLCVBar } from '../api';
import type { TradeReference, PatternAnnotation, AnnotationPoint } from '../lib/api-storage';
import {
  fetchOhlcvRange,
  getPatternAnnotations,
  upsertPatternAnnotation,
  deletePatternAnnotation,
} from '../lib/api-storage';
import {
  PATTERN_DEFINITIONS,
  PATTERN_SHAPES,
  computeRangeQuality,
} from '../lib/patternLearning';

const PATTERN_COLORS: Record<string, string> = {
  'W':                  '#3b82f6',
  'Triple Bottom':      '#06b6d4',
  'ETE':                '#ec4899',
  'Range':              '#f59e0b',
  'Three Drive':        '#a855f7',
  'Triangle Ascendant': '#22c55e',
  'Custom':             '#94a3b8',
};

// Mini SVG diagrams showing the canonical shape of each pattern
const PATTERN_SVGS: Record<string, React.ReactNode> = {
  'W': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <polyline points="0,5 15,25 30,12 45,25 60,5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  'Range': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <line x1="2" y1="4" x2="58" y2="4" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="2" y1="26" x2="58" y2="26" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="2" y1="4" x2="2" y2="26" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="58" y1="4" x2="58" y2="26" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  'Triple Bottom': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <polyline points="0,5 10,25 20,13 30,25 40,13 50,25 60,5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  'ETE': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <polyline points="0,25 10,15 20,20 30,4 40,20 50,15 60,25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  'Three Drive': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <polyline points="0,26 10,18 20,22 30,12 40,16 50,4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  'Triangle Ascendant': (
    <svg viewBox="0 0 60 30" className="w-10 h-5 opacity-50">
      <line x1="0" y1="5" x2="60" y2="5" stroke="currentColor" strokeWidth="1.5"/>
      <polyline points="0,26 30,16 60,5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
};

function getColor(type: string) {
  return PATTERN_COLORS[type] ?? '#94a3b8';
}

// Returns the sequence of UP/DOWN moves between consecutive points (time-ordered)
function getShapeSequence(pts: AnnotationPoint[]): Array<'U' | 'D'> {
  const sorted = [...pts].sort((a, b) => a.time - b.time);
  const result: Array<'U' | 'D'> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    result.push(sorted[i + 1].price >= sorted[i].price ? 'U' : 'D');
  }
  return result;
}

export interface PrefilledAnnotation {
  patternType: string;
  points: Array<{ label: string; price: number; time: number }>;
}

interface Props {
  tradeRef: TradeReference;
  onClose: () => void;
  onAnnotationsSaved: (annotations: PatternAnnotation[]) => void;
  prefilled?: PrefilledAnnotation | null;
}

export function AnnotationModal({ tradeRef, onClose, onAnnotationsSaved, prefilled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const pointLinesRef = useRef<IPriceLine[]>([]);
  const guideLinesRef = useRef<IPriceLine[]>([]);
  const prefilledAppliedRef = useRef(false);

  const [ohlcv, setOhlcv] = useState<OHLCVBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [patternType, setPatternType] = useState<string>(prefilled?.patternType ?? 'W');
  const [points, setPoints] = useState<AnnotationPoint[]>(() =>
    prefilled
      ? prefilled.points.map((pt, i) => ({
          order: i,
          label: pt.label || `pt${i}`,
          price: pt.price,
          time: pt.time,
          x_rel: 0,
          y_rel: 0,
        }))
      : []
  );
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repositionIdx, setRepositionIdx] = useState<number | null>(null);
  const [showSaveWarning, setShowSaveWarning] = useState(false);

  const [existingAnnotations, setExistingAnnotations] = useState<PatternAnnotation[]>([]);
  const [activeAnnId, setActiveAnnId] = useState<string | null>(null);

  const expectedLabels = PATTERN_DEFINITIONS[patternType] ?? [];
  const nextLabel = expectedLabels[points.length] ?? `pt${points.length}`;
  const isFull = expectedLabels.length > 0 && points.length >= expectedLabels.length;

  // Range quality score (only for Range pattern with all 4 points placed)
  const rangeQuality = useMemo(() => {
    if (patternType !== 'Range' || points.length < 4) return null;
    return computeRangeQuality(points);
  }, [patternType, points]);

  // Geometric suggestions: ranked by shape similarity, not just point count
  const suggestions = useMemo(() => {
    if (points.length < 2) return [];
    const currentShape = getShapeSequence(points);
    return Object.entries(PATTERN_DEFINITIONS)
      .filter(([type, labels]) =>
        labels.length > 0 && type !== 'Custom' && type !== patternType && labels.length >= points.length
      )
      .map(([type, labels]) => {
        const expectedShape = PATTERN_SHAPES[type] ?? [];
        const prefixLen = Math.min(currentShape.length, expectedShape.length);
        let matches = 0;
        for (let i = 0; i < prefixLen; i++) {
          if (currentShape[i] === expectedShape[i]) matches++;
        }
        const shapeScore = prefixLen > 0 ? matches / prefixLen : 0.5;
        const exact = labels.length === points.length;
        const remaining = labels.length - points.length;
        return { type, exact, remaining, shapeScore };
      })
      .sort((a, b) => b.shapeScore - a.shapeScore || a.remaining - b.remaining)
      .slice(0, 4);
  }, [points, patternType]);

  // Fetch OHLCV for the reference period
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchOhlcvRange(tradeRef.ticker, tradeRef.dateIn, tradeRef.dateOut, tradeRef.interval)
      .then(data => { setOhlcv(data); setLoading(false); })
      .catch(() => { setError('Impossible de charger les données pour cette période.'); setLoading(false); });
  }, [tradeRef]);

  // Load existing annotations
  useEffect(() => {
    getPatternAnnotations(tradeRef.id).then(setExistingAnnotations);
  }, [tradeRef.id]);

  // Recompute x_rel/y_rel for prefilled points once OHLCV loads (one-shot)
  useEffect(() => {
    if (prefilledAppliedRef.current) return;
    if (ohlcv.length === 0 || !prefilled || prefilled.points.length === 0) return;
    prefilledAppliedRef.current = true;
    const priceMin = Math.min(...ohlcv.map(b => b.low));
    const priceMax = Math.max(...ohlcv.map(b => b.high));
    const timeMin = ohlcv[0].time;
    const timeMax = ohlcv[ohlcv.length - 1].time;
    setPoints(prev => prev.map(p => ({
      ...p,
      x_rel: Math.max(0, Math.min(1, (p.time - timeMin) / Math.max(1, timeMax - timeMin))),
      y_rel: Math.max(0, Math.min(1, (p.price - priceMin) / Math.max(1, priceMax - priceMin))),
    })));
  }, [ohlcv, prefilled]);

  // Build chart
  useEffect(() => {
    if (!containerRef.current || ohlcv.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    seriesRef.current = series;
    series.setData(ohlcv as never);

    const lineSer = chart.addSeries(LineSeries, {
      color: '#94a3b8',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lineSeriesRef.current = lineSer;

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lineSeriesRef.current = null;
      pointLinesRef.current = [];
      guideLinesRef.current = [];
    };
  }, [ohlcv]);

  // Redraw point price lines + connecting line whenever points or patternType changes
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const pl of pointLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* already removed */ }
    }
    pointLinesRef.current = [];

    const color = getColor(patternType);
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const isReposition = repositionIdx === i;
      const pl = series.createPriceLine({
        price: pt.price,
        color: isReposition ? '#60a5fa' : color,
        lineWidth: isReposition ? 2 : 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${i + 1}. ${pt.label}${isReposition ? ' ↕' : ''}`,
      });
      pointLinesRef.current.push(pl);
    }

    if (lineSeriesRef.current) {
      lineSeriesRef.current.applyOptions({ color });
      const sorted = [...points].sort((a, b) => a.time - b.time);
      lineSeriesRef.current.setData(
        sorted.length >= 2
          ? sorted.map(p => ({ time: p.time as Time, value: p.price }))
          : [],
      );
    }
  }, [points, patternType, repositionIdx]);

  // Guide lines for Range: show where the opposite top/bot should be placed
  useEffect(() => {
    const series = seriesRef.current;
    for (const pl of guideLinesRef.current) {
      try { series?.removePriceLine(pl); } catch {}
    }
    guideLinesRef.current = [];

    if (patternType !== 'Range' || !series) return;

    const byLabel: Record<string, number> = {};
    for (const p of points) byLabel[p.label] = p.price;

    const topG = byLabel['top_gauche'];
    const botG = byLabel['bot_gauche'];
    const hasTopD = byLabel['top_droit'] != null;
    const hasBotD = byLabel['bot_droit'] != null;

    if (topG != null && !hasTopD) {
      const pl = series.createPriceLine({
        price: topG,
        color: '#f59e0b55',
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: true,
        title: '↔ top_droit cible',
      });
      guideLinesRef.current.push(pl);
    }

    if (botG != null && !hasBotD) {
      const pl = series.createPriceLine({
        price: botG,
        color: '#f59e0b55',
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: true,
        title: '↔ bot_droit cible',
      });
      guideLinesRef.current.push(pl);
    }
  }, [points, patternType]);

  // Click handler: place new point or reposition existing one
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const isActive = adding || repositionIdx !== null;
    if (!chart || !series || !isActive) return;

    const handler = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.time || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = typeof param.time === 'number' ? param.time : Number(param.time);
      if (!t) return;

      const priceMin = Math.min(...ohlcv.map(b => b.low));
      const priceMax = Math.max(...ohlcv.map(b => b.high));
      const timeMin = ohlcv[0].time;
      const timeMax = ohlcv[ohlcv.length - 1].time;
      const x_rel = Math.max(0, Math.min(1, (t - timeMin) / Math.max(1, timeMax - timeMin)));
      const y_rel = Math.max(0, Math.min(1, (price - priceMin) / Math.max(1, priceMax - priceMin)));

      if (repositionIdx !== null) {
        setPoints(prev => {
          const next = [...prev];
          next[repositionIdx] = { ...next[repositionIdx], price, time: t, x_rel, y_rel };
          return next;
        });
        setRepositionIdx(null);
        setShowSaveWarning(false);
      } else {
        const newPt: AnnotationPoint = {
          order: points.length,
          label: nextLabel,
          price,
          time: t,
          x_rel,
          y_rel,
        };
        setPoints(prev => {
          const next = [...prev, newPt];
          if (expectedLabels.length > 0 && next.length >= expectedLabels.length) {
            setAdding(false);
          }
          return next;
        });
        setShowSaveWarning(false);
      }
    };

    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [adding, repositionIdx, points, ohlcv, nextLabel, expectedLabels]);

  const _doSave = async () => {
    setSaving(true);
    try {
      await upsertPatternAnnotation(tradeRef.id, patternType, points);
      const updated = await getPatternAnnotations(tradeRef.id);
      setExistingAnnotations(updated);
      const saved = updated.find(a => a.patternType === patternType);
      if (saved) setActiveAnnId(saved.id);
      onAnnotationsSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (points.length < 2) return;
    // Warn if Range quality is poor before saving (can be bypassed)
    if (patternType === 'Range' && rangeQuality && rangeQuality.score < 60 && !showSaveWarning) {
      setShowSaveWarning(true);
      return;
    }
    setShowSaveWarning(false);
    await _doSave();
  };

  const handleLoadExisting = (ann: PatternAnnotation) => {
    setPatternType(ann.patternType);
    setPoints(ann.points);
    setActiveAnnId(ann.id);
    setAdding(false);
    setRepositionIdx(null);
    setShowSaveWarning(false);
  };

  const handleDeleteAnn = async (ann: PatternAnnotation) => {
    await deletePatternAnnotation(ann.id);
    const updated = await getPatternAnnotations(tradeRef.id);
    setExistingAnnotations(updated);
    onAnnotationsSaved(updated);
    if (ann.id === activeAnnId) {
      setPoints([]);
      setActiveAnnId(null);
    }
  };

  const handleNewAnnotation = () => {
    setPoints([]);
    setActiveAnnId(null);
    setAdding(false);
    setRepositionIdx(null);
    setShowSaveWarning(false);
  };

  const patternTypes = Object.keys(PATTERN_DEFINITIONS);
  const isClickActive = adding || repositionIdx !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl flex flex-col max-h-[92vh] overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 shrink-0">
          <div>
            <h2 className="text-white font-bold text-base">
              Annotation — <span className="text-blue-400">{tradeRef.ticker}</span>
              <span className="text-slate-400 text-sm font-normal ml-2 font-mono">
                {tradeRef.dateIn} → {tradeRef.dateOut} · {tradeRef.interval}
              </span>
            </h2>
            {tradeRef.notes && <p className="text-slate-500 text-xs mt-0.5">{tradeRef.notes}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2 transition-colors">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left: chart */}
          <div className="flex-1 flex flex-col min-w-0 p-4 gap-3">

            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <span className="text-xs text-slate-400">Pattern :</span>
              <select
                value={patternType}
                onChange={e => {
                  setPatternType(e.target.value);
                  setPoints([]);
                  setAdding(false);
                  setRepositionIdx(null);
                  setShowSaveWarning(false);
                }}
                className="bg-slate-800 text-white text-xs px-2 py-1 rounded-lg border border-slate-600 focus:border-blue-500 outline-none"
              >
                {patternTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              {!adding && !isFull && repositionIdx === null && (
                <button
                  onClick={() => setAdding(true)}
                  className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded-lg transition-colors font-medium"
                >
                  + Placer point ({points.length}/{expectedLabels.length || '∞'})
                </button>
              )}

              {adding && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-400 font-medium animate-pulse">
                    Clic → <span className="font-bold">{nextLabel}</span> ({points.length + 1}/{expectedLabels.length || '?'})
                  </span>
                  <button onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:text-slate-300 px-2">Pause</button>
                </div>
              )}

              {repositionIdx !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-400 font-medium animate-pulse">
                    Clic sur le chart → repositionner <span className="font-bold">{points[repositionIdx]?.label}</span>
                  </span>
                  <button onClick={() => setRepositionIdx(null)} className="text-xs text-slate-500 hover:text-slate-300 px-2">Annuler</button>
                </div>
              )}

              {isFull && repositionIdx === null && (
                <span className="text-xs text-green-400 font-medium">Pattern complet ({points.length} pts) ✓</span>
              )}

              {points.length > 0 && repositionIdx === null && (
                <>
                  <button
                    onClick={() => { setPoints(prev => prev.slice(0, -1)); setShowSaveWarning(false); }}
                    className="text-xs text-slate-500 hover:text-amber-400 px-2"
                  >
                    ↩ Annuler dernier
                  </button>
                  <button
                    onClick={() => { setPoints([]); setAdding(false); setRepositionIdx(null); setShowSaveWarning(false); }}
                    className="text-xs text-slate-500 hover:text-red-400 px-2"
                  >
                    ✕ Effacer tout
                  </button>
                </>
              )}
            </div>

            {/* Range quality badge */}
            {rangeQuality && (
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg shrink-0 ${
                rangeQuality.score >= 80
                  ? 'bg-green-950/40 border border-green-800/40 text-green-400'
                  : rangeQuality.score >= 60
                  ? 'bg-amber-950/40 border border-amber-800/40 text-amber-400'
                  : 'bg-red-950/40 border border-red-800/40 text-red-400'
              }`}>
                <span className="font-medium">Qualité Range : {rangeQuality.score}%</span>
                <span className="opacity-60">
                  tops Δ{Math.round(rangeQuality.topSkew * 100)}% · bots Δ{Math.round(rangeQuality.botSkew * 100)}%
                </span>
                {rangeQuality.score < 60 && (
                  <span className="text-red-300 font-medium">— tops ou bots mal alignés</span>
                )}
              </div>
            )}

            {/* Geometric suggestions */}
            {suggestions.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <span className="text-xs text-slate-500">Ressemble à :</span>
                {suggestions.map(s => (
                  <span
                    key={s.type}
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      s.exact && s.shapeScore >= 0.9
                        ? 'border-green-700/60 text-green-400 bg-green-950/30'
                        : s.shapeScore >= 0.75
                        ? 'border-amber-700/60 text-amber-400 bg-amber-950/20'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {s.type}
                    {s.exact ? ' ✓' : ` (+${s.remaining} pts)`}
                    {s.shapeScore < 1 && s.shapeScore > 0 && (
                      <span className="opacity-40 ml-1">{Math.round(s.shapeScore * 100)}%</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Chart */}
            <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-800">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-slate-400 text-sm gap-3">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Chargement…
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-red-400 text-sm">{error}</div>
              )}
              <div
                ref={containerRef}
                className="w-full h-full"
                style={{ minHeight: 380, cursor: isClickActive ? 'crosshair' : 'default' }}
              />
            </div>
          </div>

          {/* Right: panel */}
          <div className="w-64 border-l border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">

            {/* Points placés */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Points placés</h3>
                <button onClick={handleNewAnnotation} className="text-xs text-slate-500 hover:text-white transition-colors" title="Réinitialiser">Nouveau</button>
              </div>

              {points.length === 0 ? (
                <p className="text-xs text-slate-600">Clique sur "+ Placer point" puis sur le graphique.</p>
              ) : (
                <div className="space-y-1">
                  {points.map((pt, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                        repositionIdx === i ? 'bg-blue-950/40 ring-1 ring-blue-600/50' : 'bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: repositionIdx === i ? '#2563eb' : getColor(patternType) }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <div className="text-xs text-slate-300 font-medium">{pt.label}</div>
                          <div className="text-xs text-slate-500 font-mono">{pt.price.toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {repositionIdx === i ? (
                          <span className="text-xs text-blue-400">↕ actif</span>
                        ) : (
                          <button
                            onClick={() => { setRepositionIdx(i); setAdding(false); }}
                            className="text-slate-600 hover:text-blue-400 text-xs px-1 transition-colors"
                            title="Repositionner ce point"
                          >
                            ↕
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setPoints(prev => prev.filter((_, j) => j !== i).map((p, j) => ({ ...p, order: j })));
                            if (repositionIdx === i) setRepositionIdx(null);
                            setShowSaveWarning(false);
                          }}
                          className="text-slate-600 hover:text-red-400 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Save warning for low-quality Range */}
              {showSaveWarning && rangeQuality && (
                <div className="mt-2 bg-red-950/40 border border-red-800/50 rounded-lg p-2.5">
                  <p className="text-xs text-red-300 mb-2 leading-relaxed">
                    Range de faible qualité ({rangeQuality.score}%) — les tops/bots ne sont pas horizontaux. Repositionne les points ou sauvegarde quand même.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={_doSave}
                      className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded transition-colors"
                    >
                      Sauvegarder
                    </button>
                    <button
                      onClick={() => setShowSaveWarning(false)}
                      className="text-xs text-slate-400 hover:text-white px-2 py-1 transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              {points.length >= 2 && !showSaveWarning && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full mt-3 bg-green-700 hover:bg-green-600 text-white text-xs py-1.5 rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {saving ? 'Sauvegarde…' : `Sauvegarder (${points.length} pts)`}
                </button>
              )}
            </div>

            {/* Annotations existantes */}
            {existingAnnotations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Sauvegardées</h3>
                <div className="space-y-1.5">
                  {existingAnnotations.map(ann => (
                    <div
                      key={ann.id}
                      className={`bg-slate-800 rounded-xl p-2 border transition-colors cursor-pointer ${ann.id === activeAnnId ? 'border-blue-600' : 'border-slate-700 hover:border-slate-500'}`}
                      onClick={() => handleLoadExisting(ann)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getColor(ann.patternType) }} />
                          <span className="text-xs text-white font-medium">{ann.patternType}</span>
                          <span className="text-xs text-slate-500">{ann.points.length} pts</span>
                        </div>
                        <button onClick={e => { e.stopPropagation(); handleDeleteAnn(ann); }} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Guide : pattern reference avec mini-diagrammes SVG */}
            <div className="mt-auto pt-3 border-t border-slate-800">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Référence</h3>
              {Object.entries(PATTERN_DEFINITIONS).filter(([k]) => k !== 'Custom').map(([type, labels]) => (
                <div key={type} className={`mb-2 rounded-lg px-2 py-1.5 transition-colors ${type === patternType ? 'bg-slate-800/80' : ''}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium" style={{ color: getColor(type) }}>{type}</span>
                    {PATTERN_SVGS[type] && (
                      <span style={{ color: getColor(type) }}>{PATTERN_SVGS[type]}</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-600 leading-relaxed">{labels.join(' → ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
