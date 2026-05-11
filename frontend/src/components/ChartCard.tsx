import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { OHLCVBar, SRLevel, BreakoutScore } from '../api';
import { tradingViewUrl } from '../lib/tradingview';
import { SRZonePrimitive } from '../lib/srZonePrimitive';

interface ChartCardProps {
  ticker: string;
  ohlcv: OHLCVBar[];
  srLevels: SRLevel[];
  score: BreakoutScore;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  interval?: string;
  dif?: number;
  srTypeFilter?: 'all' | 'support' | 'resistance';
  zoneOpacity?: number;
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
  ticker, ohlcv, srLevels, score, isFavorite, onToggleFavorite, interval,
  srTypeFilter = 'all', zoneOpacity = 0.4,
}: ChartCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [visible, setVisible] = useState(false);

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

    // S/R zones — rectangle rempli + ligne centrale
    const allValid = srLevels.filter(l => isFinite(l.price) && l.price > 0);
    const validLevels = srTypeFilter === 'all'
      ? allValid
      : allValid.filter(l => l.type === srTypeFilter);

    const topSupports    = [...allValid].filter(l => l.type === 'support' && !l.obsolete).sort((a, b) => b.touches - a.touches).slice(0, 2);
    const topResistances = [...allValid].filter(l => l.type === 'resistance' && !l.obsolete).sort((a, b) => b.touches - a.touches).slice(0, 2);
    const labeledLevels = new Set<typeof srLevels[number]>([...topSupports, ...topResistances]);

    const lastBarTime = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].time : 0;

    validLevels.forEach(l => {
      const isLabeled       = labeledLevels.has(l);
      const isObsolete      = l.obsolete === true;
      const isCleanBreakout = !isObsolete && !!l.broken_out && !l.re_entered;

      const fillColor = isObsolete
        ? '#64748b'
        : isCleanBreakout
          ? '#f59e0b'
          : l.type === 'support' ? '#22c55e' : '#ef4444';

      // Rectangle rempli
      if (l.upper != null && l.lower != null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candles.attachPrimitive(new SRZonePrimitive({
          startTime: l.start_time as never,
          endTime:   (isObsolete ? l.end_time : lastBarTime) as never,
          upper: l.upper,
          lower: l.lower,
          fillColor,
          opacity: isObsolete ? zoneOpacity * 0.35 : zoneOpacity,
        }) as never);
      }

      // Ligne centrale (référence prix précise)
      candles.createPriceLine({
        price: l.price,
        color: fillColor,
        lineWidth: 1,
        lineStyle: isObsolete ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: isLabeled && !isObsolete,
        title: isLabeled && !isObsolete ? `${l.type === 'support' ? 'S' : 'R'} ×${l.touches}` : '',
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
    };
  }, [visible, ohlcv, srLevels, srTypeFilter, zoneOpacity]);

  const supports = srLevels.filter(l => l.type === 'support');
  const resistances = srLevels.filter(l => l.type === 'resistance');

  return (
    <div ref={cardRef} className={`bg-slate-900 border rounded-2xl p-4 hover:border-slate-500 transition-colors ${isFavorite ? 'border-yellow-500/80 shadow-[0_0_0_1px_rgba(234,179,8,0.25)]' : 'border-slate-700'}`}>
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

      {/* Score detail bar */}
      {score.label && (
        <div className="flex gap-2 mb-2">
          {[
            { label: 'Range', val: score.tightness,    max: 40, color: 'bg-blue-500' },
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

      <div ref={containerRef} style={{ minHeight: 300 }}>
        {!visible && (
          <div className="h-[300px] flex items-center justify-center text-slate-700 text-xs">◌</div>
        )}
      </div>
    </div>
  );
}
