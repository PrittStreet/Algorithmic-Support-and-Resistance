import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import type { OHLCVBar, SRLevel } from '../api';
import type { CandidateTrade } from './patternEngine';

/**
 * Rend un graphique off-screen (600×380) pour un CandidateTrade et retourne
 * son contenu en base64 PNG, prêt à être envoyé à Gemini.
 *
 * Le graphique fenêtre sur screenshot_hint ± 5 barres, affiche les
 * chandeliers + les niveaux S/R colorés rouge/vert.
 */
export async function captureTradeChart(
  ohlcv: OHLCVBar[],
  srLevels: SRLevel[],
  trade: CandidateTrade,
): Promise<string> {
  const W = 600;
  const H = 380;

  // Conteneur off-screen
  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-9999px;top:0;width:${W}px;height:${H}px;visibility:hidden;`;
  document.body.appendChild(container);

  const chart = createChart(container, {
    width: W,
    height: H,
    layout: {
      background: { type: ColorType.Solid, color: '#0f172a' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: '#1e293b' },
      horzLines: { color: '#1e293b' },
    },
    rightPriceScale: { borderColor: '#334155' },
    timeScale: { borderColor: '#334155', timeVisible: true },
    crosshair: { mode: 0 },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
  });

  // Fenêtrer sur le hint + marge
  const { dateStart, dateEnd } = trade.screenshot_hint;
  const startTs = dateStart ? Date.parse(dateStart) / 1000 - 5 * 86400 : 0;
  const endTs   = dateEnd   ? Date.parse(dateEnd)   / 1000 + 5 * 86400 : Infinity;
  const windowBars = ohlcv.filter(b => b.time >= startTs && b.time <= endTs);
  const bars = windowBars.length >= 10 ? windowBars : ohlcv;

  candles.setData(bars as never);

  // Niveaux S/R
  for (const lvl of srLevels) {
    if (lvl.obsolete) continue;
    candles.createPriceLine({
      price: lvl.price,
      color: lvl.type === 'resistance' ? '#ef4444' : '#22c55e',
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: true,
      title: '',
    });
  }

  chart.timeScale().fitContent();

  // Attendre 2 frames pour que LW Charts finisse le rendu canvas
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  // Récupérer le canvas (LW Charts l'injecte en premier enfant)
  const canvas = container.querySelector('canvas');
  if (!canvas) {
    chart.remove();
    document.body.removeChild(container);
    throw new Error('chartCapture: canvas introuvable');
  }

  const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

  chart.remove();
  document.body.removeChild(container);
  return base64;
}
