import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from '../api';
import type { DetectedPattern } from '../sr';
import type { PatternTemplate } from '../lib/patternLearning';
import { tradingViewUrl } from '../lib/tradingview';

const PATTERN_BADGE_COLORS: Record<string, string> = {
  'W':                  'bg-blue-900/60 text-blue-300 border-blue-700/50',
  'Triple Bottom':      'bg-cyan-900/60 text-cyan-300 border-cyan-700/50',
  'ETE':                'bg-pink-900/60 text-pink-300 border-pink-700/50',
  'Range':              'bg-amber-900/60 text-amber-300 border-amber-700/50',
  'Three Drive':        'bg-purple-900/60 text-purple-300 border-purple-700/50',
  'Triangle Ascendant': 'bg-green-900/60 text-green-300 border-green-700/50',
  'Custom':             'bg-slate-800 text-slate-300 border-slate-600',
};

const PATTERN_LINE_COLORS: Record<string, string> = {
  'W':                  '#3b82f6',
  'Triple Bottom':      '#06b6d4',
  'ETE':                '#ec4899',
  'Range':              '#f59e0b',
  'Three Drive':        '#a855f7',
  'Triangle Ascendant': '#22c55e',
  'Custom':             '#94a3b8',
};

function badgeColor(type: string) {
  return PATTERN_BADGE_COLORS[type] ?? 'bg-slate-800 text-slate-300 border-slate-600';
}
function lineColor(type: string) {
  return PATTERN_LINE_COLORS[type] ?? '#94a3b8';
}

interface ChartCardProps {
  ticker: string;
  ohlcv: OHLCVBar[];
  srLevels: SRLevel[];
  wPatterns: WPattern[];
  score: BreakoutScore;
  isCoiling: boolean;
  matchedPatterns: DetectedPattern[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onPromotePattern?: (mp: DetectedPattern) => void;
  onCreateReference?: () => void;
  templates?: PatternTemplate[];
  interval?: string;
  dif?: number;
}

function ScoreBadge({ score }: { score: BreakoutScore }) {
  if (score.total === 0) return null;
  const color =
    score.label === 'fort'   ? 'bg-green-900 text-green-300 border-green-700' :
    score.label === 'modéré' ? 'bg-yellow-900 text-yellow-300 border-yellow-700' :
    score.label === 'faible' ? 'bg-slate-800 text-slate-400 border-slate-600' :
                               'bg-slate-800 text-slate-500 border-slate-700';
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-semibold ${color}`}
      title={`Tightness: ${score.tightness}/40 · Proximity: ${score.proximity}/40 · Accumulation: ${score.accumulation}/20`}>
      <span className="text-xs opacity-70">⬆</span>
      {score.total}
    </div>
  );
}

export function ChartCard({
  ticker, ohlcv, srLevels, wPatterns, score, isCoiling,
  matchedPatterns, isFavorite, onToggleFavorite, onPromotePattern, onCreateReference,
  templates, interval, dif = 1.5,
}: ChartCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [visible, setVisible] = useState(false);
  const [overlayIndices, setOverlayIndices] = useState<Set<number>>(new Set());
  const [showSRBands, setShowSRBands] = useState(false);

  const toggleOverlay = (i: number) => setOverlayIndices(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  // Lazy-render: only build chart when scrolled into view
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => { for (const e of entries) setVisible(e.isIntersecting); },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
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

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
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
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volSeries.setData(ohlcv
        .filter(b => b.volume != null && b.volume! > 0)
        .map(b => ({
          time: b.time,
          value: b.volume!,
          color: b.close >= b.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        })) as never
      );
    }

    // S/R levels — axis label uniquement sur les 2 plus forts par type (touches), exclude obsolete
    const validLevels = srLevels.filter(l => isFinite(l.price) && l.price > 0);
    const topSupports    = [...validLevels].filter(l => l.type === 'support' && !l.obsolete).sort((a, b) => b.touches - a.touches).slice(0, 2);
    const topResistances = [...validLevels].filter(l => l.type === 'resistance' && !l.obsolete).sort((a, b) => b.touches - a.touches).slice(0, 2);
    const labeledLevels = new Set<typeof srLevels[number]>([...topSupports, ...topResistances]);
    validLevels.forEach(l => {
      const isLabeled = labeledLevels.has(l);
      const isObsolete = l.obsolete === true;
      candles.createPriceLine({
        price: l.price,
        color: isObsolete ? '#64748b' : l.type === 'support' ? '#22c55e' : '#ef4444',
        lineWidth: 1,
        lineStyle: isObsolete ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: isLabeled && !isObsolete,
        title: isLabeled && !isObsolete ? `${l.type === 'support' ? 'S' : 'R'} ×${l.touches}` : '',
      });
    });

    // W necklines — axis label uniquement pour les confirmés
    wPatterns
      .filter(w => isFinite(w.neckline_price) && w.neckline_price > 0)
      .forEach(w => {
        candles.createPriceLine({
          price: w.neckline_price,
          color: w.confirmed ? '#86efac' : '#fde68a',
          lineWidth: w.confirmed ? 2 : 1,
          lineStyle: w.confirmed ? LineStyle.Solid : LineStyle.Dotted,
          axisLabelVisible: w.confirmed,
          title: w.confirmed ? 'W ✓' : '',
        });
      });

    // Matched patterns — dessiner la STRUCTURE (ligne reliant les points) au lieu de niveaux horizontaux
    for (const mp of matchedPatterns) {
      const sortedPts = [...mp.points]
        .filter(p => isFinite(p.price) && p.price > 0)
        .sort((a, b) => a.time - b.time);
      if (sortedPts.length < 2) continue;
      const structSer = chart.addSeries(LineSeries, {
        color: lineColor(mp.pattern_type),
        lineWidth: 2,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      structSer.setData(sortedPts.map(pt => ({ time: pt.time as Time, value: pt.price })));
    }

    // ── S/R tolerance bands (±dif%) ──
    if (showSRBands) {
      validLevels.filter(l => !l.obsolete).forEach(l => {
        const col = l.type === 'support' ? '#22c55e' : '#ef4444';
        const alpha = '30';
        candles.createPriceLine({
          price: l.price * (1 + dif / 100),
          color: col + alpha,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        });
        candles.createPriceLine({
          price: l.price * (1 - dif / 100),
          color: col + alpha,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `±${dif}%`,
        });
      });
    }

    // ── Theoretical structure overlays ──
    if (templates && templates.length > 0) {
      for (let mpIdx = 0; mpIdx < Math.min(matchedPatterns.length, 3); mpIdx++) {
        if (!overlayIndices.has(mpIdx)) continue;
        const mp = matchedPatterns[mpIdx];
        const tmpl = templates.find(t => t.pattern_type === mp.pattern_type);
        if (!tmpl || tmpl.points.length < 2) continue;

        const winStart = mp.bar_start;
        const winEnd = mp.bar_end;
        const winBars = ohlcv.slice(winStart, winEnd + 1);
        if (winBars.length < 2) continue;

        const timeStart = winBars[0].time;
        const timeEnd = winBars[winBars.length - 1].time;
        const priceMin = Math.min(...winBars.map(b => b.low));
        const priceMax = Math.max(...winBars.map(b => b.high));
        const priceRange = priceMax - priceMin;
        if (priceRange <= 0) continue;

        // Project template keypoints into chart space
        const idealPoints = tmpl.points.map(kp => ({
          time: Math.round(timeStart + kp.mean_x * (timeEnd - timeStart)) as Time,
          value: priceMin + kp.mean_y * priceRange,
          std_y: kp.std_y * priceRange,
        }));

        // Draw dashed ideal structure line
        const idealSer = chart.addSeries(LineSeries, {
          color: lineColor(mp.pattern_type),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        idealSer.setData(idealPoints.map(p => ({ time: p.time, value: p.value })));

        // Draw ±std_y bands for each keypoint as horizontal price lines
        for (const pt of idealPoints) {
          const col = lineColor(mp.pattern_type);
          const alpha = '40';
          candles.createPriceLine({
            price: pt.value + pt.std_y,
            color: col + alpha,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: '',
          });
          candles.createPriceLine({
            price: pt.value - pt.std_y,
            color: col + alpha,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: '',
          });
        }
      }
    }

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
    };
  }, [visible, ohlcv, srLevels, wPatterns, matchedPatterns, overlayIndices, templates, showSRBands, dif]);

  const supports = srLevels.filter(l => l.type === 'support');
  const resistances = srLevels.filter(l => l.type === 'resistance');
  const hasWPatterns = wPatterns.length > 0;
  const confirmed = wPatterns.filter(w => w.confirmed);
  const forming = wPatterns.filter(w => !w.confirmed);

  const borderClass =
    isFavorite                              ? 'border-yellow-500/80 shadow-[0_0_0_1px_rgba(234,179,8,0.25)]' :
    matchedPatterns.some(m => m.score >= 70) ? 'border-blue-600/70' :
    matchedPatterns.length > 0             ? 'border-blue-800/50' :
    wPatterns.some(w => w.confirmed)        ? 'border-green-700/50' :
    wPatterns.length > 0                    ? 'border-yellow-700/50' :
    isCoiling                               ? 'border-purple-700/50' :
                                              'border-slate-700';

  return (
    <div ref={cardRef} className={`bg-slate-900 border rounded-2xl p-4 hover:border-slate-500 transition-colors ${borderClass}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-base tracking-wide">{ticker}</h3>
          <div className="flex gap-3 text-xs font-medium mt-0.5">
            <span className="text-green-400">{supports.length} supp</span>
            <span className="text-red-400">{resistances.length} rés</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ScoreBadge score={score} />
          <button
            onClick={() => setShowSRBands(v => !v)}
            className={`text-xs px-1.5 py-1 rounded-lg transition-colors font-mono ${
              showSRBands
                ? 'text-amber-400 bg-amber-900/30 hover:bg-amber-900/50'
                : 'text-slate-500 hover:text-amber-400 hover:bg-slate-800'
            }`}
            title={showSRBands ? `Masquer zones ±${dif}%` : `Afficher zones de tolérance ±${dif}%`}
          >±</button>
          {onCreateReference && (
            <button
              onClick={onCreateReference}
              className="text-sm px-1.5 py-1 rounded-lg transition-colors text-slate-500 hover:text-blue-400 hover:bg-slate-800"
              title="Créer une référence manuelle"
            >📌</button>
          )}
          {interval && (
            <a
              href={tradingViewUrl(ticker, interval)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-1.5 py-1 rounded-lg transition-colors text-slate-500 hover:text-blue-400 hover:bg-slate-800"
              title={`Ouvrir ${ticker} sur TradingView`}
            >TV</a>
          )}
          <button
            onClick={onToggleFavorite}
            className={`text-sm px-1.5 py-1 rounded-lg transition-colors ${
              isFavorite
                ? 'text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50'
                : 'text-slate-500 hover:text-yellow-400 hover:bg-slate-800'
            }`}
            title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >{isFavorite ? '★' : '☆'}</button>
        </div>
      </div>

      {/* Pattern tags */}
      {(hasWPatterns || isCoiling || matchedPatterns.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-2">
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
          {matchedPatterns.slice(0, 3).map((mp, i) => (
            <span key={i} className="inline-flex items-center">
              <span
                className={`text-xs border ${onPromotePattern ? 'border-r-0 rounded-l-full' : 'rounded-full'} px-2 py-0.5 font-medium ${badgeColor(mp.pattern_type)}`}
                title={`Score: ${mp.score}/100 · ${mp.confidence}`}
              >
                {mp.pattern_type} {mp.score}%
              </span>
              {onPromotePattern && (
                <button
                  onClick={() => onPromotePattern(mp)}
                  className={`text-xs border px-1.5 py-0.5 ${templates && templates.some(t => t.pattern_type === mp.pattern_type) ? 'border-r-0' : 'rounded-r-full'} font-medium ${badgeColor(mp.pattern_type)} hover:opacity-70 transition-opacity`}
                  title="Promouvoir en template — créer une référence et annoter"
                >✏</button>
              )}
              {templates && templates.some(t => t.pattern_type === mp.pattern_type) && (
                <button
                  onClick={() => toggleOverlay(i)}
                  className={`text-xs border px-1.5 py-0.5 rounded-r-full font-medium ${badgeColor(mp.pattern_type)} ${overlayIndices.has(i) ? 'opacity-100' : 'opacity-40'} hover:opacity-80 transition-opacity`}
                  title="Afficher la structure théorique du template"
                >◈</button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Score detail bar */}
      {score.label && (
        <div className="flex gap-2 mb-2">
          {[
            { label: 'Range', val: score.tightness,    max: 40, color: 'bg-blue-500' },
            { label: 'Prox',  val: score.proximity,    max: 40, color: 'bg-orange-500' },
            { label: 'Accum', val: score.accumulation, max: 20, color: 'bg-purple-500' },
            ...(score.pattern_bonus ?? 0) > 0 ? [{ label: 'Pattern', val: score.pattern_bonus, max: 60, color: 'bg-cyan-500' }] : [],
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

      <div ref={containerRef} style={{ minHeight: 300 }}>
        {!visible && (
          <div className="h-[300px] flex items-center justify-center text-slate-700 text-xs">◌</div>
        )}
      </div>
    </div>
  );
}
