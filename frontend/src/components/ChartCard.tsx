import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
} from 'lightweight-charts';
import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from '../api';

interface ChartCardProps {
  ticker: string;
  ohlcv: OHLCVBar[];
  srLevels: SRLevel[];
  wPatterns: WPattern[];
  score: BreakoutScore;
  isCoiling: boolean;
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

export function ChartCard({ ticker, ohlcv, srLevels, wPatterns, score, isCoiling }: ChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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

    candles.setData(ohlcv as never);

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

    return () => { ro.disconnect(); chart.remove(); };
  }, [ohlcv, srLevels, wPatterns]);

  const supports = srLevels.filter(l => l.type === 'support');
  const resistances = srLevels.filter(l => l.type === 'resistance');
  const hasPatterns = wPatterns.length > 0 || isCoiling;

  return (
    <div className={`bg-slate-900 border rounded-2xl p-4 hover:border-slate-500 transition-colors ${
      wPatterns.some(w => w.confirmed) ? 'border-green-700/50' :
      wPatterns.length > 0             ? 'border-yellow-700/50' :
      isCoiling                        ? 'border-purple-700/50' :
                                         'border-slate-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-base tracking-wide">{ticker}</h3>
          <div className="flex gap-3 text-xs font-medium mt-0.5">
            <span className="text-green-400">{supports.length} supp{supports.length !== 1 ? 's' : ''}</span>
            <span className="text-red-400">{resistances.length} rés{resistances.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreBadge score={score} />
        </div>
      </div>

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

      <div ref={containerRef} />
    </div>
  );
}
