import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from 'lightweight-charts';
import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from '../api';
import type { TopFeature } from '../lib/preferences';
import { LIKE_TAGS, DISLIKE_TAGS } from '../lib/preferences';
import type { RoiAnnotation } from '../lib/api-storage';

interface ChartCardProps {
  ticker: string;
  ohlcv: OHLCVBar[];
  srLevels: SRLevel[];
  wPatterns: WPattern[];
  score: BreakoutScore;
  isCoiling: boolean;
  currentVote: 'like' | 'dislike' | null;
  preferenceScore: number | null;
  preferenceTopFeatures: TopFeature[] | null;
  isFavorite: boolean;
  annotation: RoiAnnotation | null;
  onFeedback: (vote: 'like' | 'dislike', tags: string[], annotation?: RoiAnnotation | null) => void;
  onRemoveFeedback: () => void;
  onToggleFavorite: () => void;
}

function ScoreBadge({ score }: { score: BreakoutScore }) {
  if (score.total === 0) return null;
  const color =
    score.label === 'fort'    ? 'bg-green-900 text-green-300 border-green-700' :
    score.label === 'modéré'  ? 'bg-yellow-900 text-yellow-300 border-yellow-700' :
    score.label === 'faible'  ? 'bg-slate-800 text-slate-400 border-slate-600' :
                                'bg-slate-800 text-slate-500 border-slate-700';
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-semibold ${color}`} title={`Tightness: ${score.tightness}/40 · Proximity: ${score.proximity}/40 · Accumulation: ${score.accumulation}/20`}>
      <span className="text-xs opacity-70">⬆</span>
      {score.total}
    </div>
  );
}

function PatternTags({ wPatterns, isCoiling }: { wPatterns: WPattern[]; isCoiling: boolean }) {
  const confirmed = wPatterns.filter(w => w.confirmed);
  const forming = wPatterns.filter(w => !w.confirmed);

  return (
    <div className="flex flex-wrap gap-1">
      {confirmed.length > 0 && (
        <span className="text-xs bg-green-900/60 text-green-300 border border-green-700/50 px-2 py-0.5 rounded-full font-medium">
          W confirmé
        </span>
      )}
      {forming.length > 0 && (
        <span className="text-xs bg-yellow-900/60 text-yellow-300 border border-yellow-700/50 px-2 py-0.5 rounded-full font-medium">
          W formation
        </span>
      )}
      {isCoiling && (
        <span className="text-xs bg-purple-900/60 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full font-medium">
          Coil ↗
        </span>
      )}
    </div>
  );
}

export function ChartCard({
  ticker, ohlcv, srLevels, wPatterns, score, isCoiling,
  currentVote, preferenceScore, preferenceTopFeatures, isFavorite, annotation,
  onFeedback, onRemoveFeedback, onToggleFavorite,
}: ChartCardProps) {
  const prefPct = preferenceScore !== null && preferenceScore !== undefined
    ? Math.round((preferenceScore - 0.5) * 200)
    : null;
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const roiLinesRef = useRef<IPriceLine[]>([]);
  const [tagPickerVote, setTagPickerVote] = useState<'like' | 'dislike' | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<RoiAnnotation | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [firstClick, setFirstClick] = useState<{ t: number; p: number } | null>(null);

  const activeAnnotation = draftAnnotation ?? annotation ?? null;

  // Lazy-render: only instantiate lightweight-charts when scrolled into view
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
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
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candlesRef.current = candles;

    candles.setData(ohlcv as never);

    // Volume histogram
    const hasVolume = ohlcv.some(b => b.volume != null && b.volume! > 0);
    if (hasVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      const volData = ohlcv
        .filter(b => b.volume != null && b.volume! > 0)
        .map(b => ({
          time: b.time,
          value: b.volume!,
          color: b.close >= b.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        }));
      volSeries.setData(volData as never);
    }

    // S/R levels
    srLevels
      .filter(l => isFinite(l.price) && l.price > 0)
      .forEach(l => {
        candles.createPriceLine({
          price: l.price,
          color: l.type === 'support' ? '#22c55e' : '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${l.type === 'support' ? 'S' : 'R'} ×${l.touches}`,
        });
      });

    // W pattern necklines
    wPatterns
      .filter(w => isFinite(w.neckline_price) && w.neckline_price > 0)
      .forEach(w => {
        candles.createPriceLine({
          price: w.neckline_price,
          color: w.confirmed ? '#86efac' : '#fde68a',
          lineWidth: 2,
          lineStyle: w.confirmed ? LineStyle.Solid : LineStyle.Dotted,
          axisLabelVisible: true,
          title: w.confirmed ? 'W ✓' : 'W neck',
        });
      });

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      roiLinesRef.current = [];
    };
  }, [visible, ohlcv, srLevels, wPatterns]);

  // Draw/remove ROI price lines whenever the active annotation changes
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles) return;
    for (const l of roiLinesRef.current) candles.removePriceLine(l);
    roiLinesRef.current = [];
    if (!activeAnnotation) return;
    const pTop = Math.max(activeAnnotation.p1, activeAnnotation.p2);
    const pBot = Math.min(activeAnnotation.p1, activeAnnotation.p2);
    const color = currentVote === 'like' ? '#facc15' : '#fb923c';
    roiLinesRef.current.push(candles.createPriceLine({
      price: pTop, color, lineWidth: 2, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: 'ROI haut',
    }));
    roiLinesRef.current.push(candles.createPriceLine({
      price: pBot, color, lineWidth: 2, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: 'ROI bas',
    }));
  }, [activeAnnotation, currentVote, visible]);

  // Capture clicks while in drawing mode → 2 clicks = annotation
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || !candles || !drawing) return;
    const handler = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.point || !param.time) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = typeof param.time === 'number' ? param.time : 0;
      if (!t) return;
      if (!firstClick) {
        setFirstClick({ t, p: price });
      } else {
        setDraftAnnotation({ type: 'roi', t1: firstClick.t, t2: t, p1: firstClick.p, p2: price });
        setFirstClick(null);
        setDrawing(false);
      }
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [drawing, firstClick]);

  const supports = srLevels.filter(l => l.type === 'support');
  const resistances = srLevels.filter(l => l.type === 'resistance');
  const hasPatterns = wPatterns.length > 0 || isCoiling;

  const handleVote = (vote: 'like' | 'dislike') => {
    if (currentVote === vote) {
      // Toggle off
      onRemoveFeedback();
      setTagPickerVote(null);
      setSelectedTags([]);
      setDraftAnnotation(null);
      setDrawing(false);
      setFirstClick(null);
    } else {
      setTagPickerVote(vote);
      setSelectedTags([]);
      setDraftAnnotation(null);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleConfirmVote = () => {
    if (!tagPickerVote) return;
    onFeedback(tagPickerVote, selectedTags, draftAnnotation ?? annotation ?? null);
    setTagPickerVote(null);
    setSelectedTags([]);
    setDraftAnnotation(null);
    setDrawing(false);
    setFirstClick(null);
  };

  const handleCancelDraw = () => {
    setDrawing(false);
    setFirstClick(null);
    setDraftAnnotation(null);
  };

  const activeTags = tagPickerVote === 'like' ? LIKE_TAGS : DISLIKE_TAGS;

  const borderClass =
    isFavorite                ? 'border-yellow-500/80 shadow-[0_0_0_1px_rgba(234,179,8,0.25)]' :
    currentVote === 'like'    ? 'border-green-600/70' :
    currentVote === 'dislike' ? 'border-red-600/70' :
    wPatterns.some(w => w.confirmed) ? 'border-green-700/50' :
    wPatterns.length > 0             ? 'border-yellow-700/50' :
    isCoiling                        ? 'border-purple-700/50' :
                                       'border-slate-700';

  return (
    <div ref={cardRef} className={`bg-slate-900 border rounded-2xl p-4 hover:border-slate-500 transition-colors ${borderClass}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-base tracking-wide">{ticker}</h3>
          <div className="flex gap-3 text-xs font-medium mt-0.5">
            <span className="text-green-400">{supports.length} supp{supports.length !== 1 ? 's' : ''}</span>
            <span className="text-red-400">{resistances.length} rés{resistances.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Preference score badge */}
          {prefPct !== null && prefPct !== 0 && (
            <div className="relative group">
              <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-semibold cursor-help ${
                prefPct > 0
                  ? 'bg-green-900/50 text-green-400 border border-green-800'
                  : 'bg-red-900/50 text-red-400 border border-red-800'
              }`}>
                {prefPct > 0 ? '+' : ''}{prefPct}%
              </span>
              {preferenceTopFeatures && preferenceTopFeatures.length > 0 && (
                <div className="absolute right-0 top-full mt-1.5 z-20 hidden group-hover:block bg-slate-800 border border-slate-600 rounded-xl p-3 min-w-[210px] shadow-xl pointer-events-none">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-semibold">Top features</p>
                  {preferenceTopFeatures.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-xs mb-1.5">
                      <span className="text-slate-400 truncate">{f.label}</span>
                      <span className={`font-mono shrink-0 font-semibold ${f.contribution > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {f.contribution > 0 ? '+' : ''}{Math.round(f.contribution * 100)}
                      </span>
                    </div>
                  ))}
                  <p className="text-slate-600 text-xs mt-2 border-t border-slate-700 pt-2">
                    {prefPct > 0 ? 'Setup favorisé par tes préférences' : 'Setup défavorisé par tes préférences'}
                  </p>
                </div>
              )}
            </div>
          )}
          <ScoreBadge score={score} />
          {/* Favorite toggle */}
          <button
            onClick={onToggleFavorite}
            className={`text-sm px-1.5 py-1 rounded-lg transition-colors ${
              isFavorite
                ? 'text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50'
                : 'text-slate-500 hover:text-yellow-400 hover:bg-slate-800'
            }`}
            title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >{isFavorite ? '★' : '☆'}</button>
          {/* Like / Dislike buttons */}
          <button
            onClick={() => handleVote('like')}
            className={`text-sm px-1.5 py-1 rounded-lg transition-colors ${
              currentVote === 'like'
                ? 'bg-green-700 text-white'
                : 'text-slate-500 hover:text-green-400 hover:bg-slate-800'
            }`}
            title="J'aime ce setup"
          >👍</button>
          <button
            onClick={() => handleVote('dislike')}
            className={`text-sm px-1.5 py-1 rounded-lg transition-colors ${
              currentVote === 'dislike'
                ? 'bg-red-800 text-white'
                : 'text-slate-500 hover:text-red-400 hover:bg-slate-800'
            }`}
            title="Je n'aime pas ce setup"
          >👎</button>
        </div>
      </div>

      {/* Tag picker (après un vote) */}
      {tagPickerVote && (
        <div className="mb-3 p-2 bg-slate-800 rounded-xl border border-slate-700">
          <p className="text-xs text-slate-400 mb-2">
            {tagPickerVote === 'like' ? '👍 Pourquoi tu aimes ?' : '👎 Pourquoi tu n\'aimes pas ?'}
            <span className="text-slate-600 ml-1">(optionnel)</span>
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {activeTags.map(tag => (
              <button
                key={tag}
                onClick={() => handleTagToggle(tag)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  selectedTags.includes(tag)
                    ? tagPickerVote === 'like'
                      ? 'bg-green-700 text-white border-green-600'
                      : 'bg-red-700 text-white border-red-600'
                    : 'bg-slate-700 text-slate-400 border-slate-600 hover:border-slate-400'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          {/* Annotation ROI */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {!drawing && !draftAnnotation && (
              <button
                type="button"
                onClick={() => { setDrawing(true); setFirstClick(null); }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded-lg transition-colors"
                title="Dessiner une zone d'intérêt sur le chart (2 clics)"
              >
                ✏ Dessiner zone
              </button>
            )}
            {drawing && (
              <>
                <span className="text-xs text-yellow-400 font-medium">
                  {firstClick ? '2e clic : coin opposé' : '1er clic : coin de la zone'}
                </span>
                <button
                  type="button"
                  onClick={handleCancelDraw}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 transition-colors"
                >Annuler</button>
              </>
            )}
            {!drawing && draftAnnotation && (
              <>
                <span className="text-xs text-yellow-400">Zone dessinée ✓</span>
                <button
                  type="button"
                  onClick={() => setDraftAnnotation(null)}
                  className="text-xs text-slate-500 hover:text-red-400 px-2 transition-colors"
                >Effacer</button>
                <button
                  type="button"
                  onClick={() => { setDraftAnnotation(null); setDrawing(true); setFirstClick(null); }}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 transition-colors"
                >Redessiner</button>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirmVote}
              className={`text-xs px-3 py-1 rounded-lg text-white transition-colors ${
                tagPickerVote === 'like' ? 'bg-green-700 hover:bg-green-600' : 'bg-red-700 hover:bg-red-600'
              }`}
            >
              Valider
            </button>
            <button
              onClick={() => { setTagPickerVote(null); setSelectedTags([]); setDraftAnnotation(null); setDrawing(false); setFirstClick(null); }}
              className="text-xs text-slate-500 hover:text-slate-300 px-2 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Pattern tags */}
      {hasPatterns && (
        <div className="mb-2">
          <PatternTags wPatterns={wPatterns} isCoiling={isCoiling} />
        </div>
      )}

      {/* Score detail bar */}
      {score.label && (
        <div className="flex gap-2 mb-2">
          {[
            { label: 'Range', val: score.tightness, max: 40, color: 'bg-blue-500' },
            { label: 'Prox',  val: score.proximity,    max: 40, color: 'bg-orange-500' },
            { label: 'Accum', val: score.accumulation, max: 20, color: 'bg-purple-500' },
          ].map(({ label, val, max, color }) => (
            <div key={label} className="flex-1" title={`${label}: ${val}/${max}`}>
              <div className="text-slate-600 text-xs mb-0.5">{label}</div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${(val / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        style={{ minHeight: 320, cursor: drawing ? 'crosshair' : undefined }}
      >
        {!visible && (
          <div className="h-[320px] flex items-center justify-center text-slate-700 text-xs">
            ◌
          </div>
        )}
      </div>
    </div>
  );
}
