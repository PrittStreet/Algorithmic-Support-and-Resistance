import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from './api';
import { computeFingerprint } from './lib/preferences';
import type { ChartFingerprint } from './lib/preferences';
import type { RoiAnnotation } from './lib/api-storage';

export type { ChartFingerprint };

export interface AnalysisParams {
  dif: number;
  pivot_order: number;
  min_touches: number;
}

export interface OhlcvAnalysis {
  sr_levels: SRLevel[];
  w_patterns: WPattern[];
  score: BreakoutScore;
  is_coiling: boolean;
  fingerprint: ChartFingerprint;
}

// ── Pivot detection ────────────────────────────────────────────────────────────

function findPivotHighs(highs: number[], order: number): [number, number][] {
  const pivots: [number, number][] = [];
  for (let i = order; i < highs.length - order; i++) {
    let maxLeft = -Infinity, maxRight = -Infinity;
    for (let k = 1; k <= order; k++) maxLeft = Math.max(maxLeft, highs[i - k]);
    for (let k = 1; k <= order; k++) maxRight = Math.max(maxRight, highs[i + k]);
    if (highs[i] > maxLeft && highs[i] >= maxRight) pivots.push([i, highs[i]]);
  }
  return pivots;
}

function findPivotLows(lows: number[], order: number): [number, number][] {
  const pivots: [number, number][] = [];
  for (let i = order; i < lows.length - order; i++) {
    let minLeft = Infinity, minRight = Infinity;
    for (let k = 1; k <= order; k++) minLeft = Math.min(minLeft, lows[i - k]);
    for (let k = 1; k <= order; k++) minRight = Math.min(minRight, lows[i + k]);
    if (lows[i] < minLeft && lows[i] <= minRight) pivots.push([i, lows[i]]);
  }
  return pivots;
}

// ── S/R clustering ─────────────────────────────────────────────────────────────

function clusterLevels(
  points: [number, number][],
  difPct: number,
  minTouches: number,
  type: 'support' | 'resistance',
  timestamps: number[]
): SRLevel[] {
  const sorted = [...points].sort((a, b) => a[1] - b[1]);
  const used = new Set<number>();
  const levels: SRLevel[] = [];
  const n = timestamps.length;

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const [idxI, priceI] = sorted[i];
    const clusterIdxs = [idxI];
    const clusterPrices = [priceI];
    used.add(i);

    for (let j = 0; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const [idxJ, priceJ] = sorted[j];
      if (Math.abs(priceI / priceJ - 1) * 100 < difPct) {
        clusterIdxs.push(idxJ);
        clusterPrices.push(priceJ);
        used.add(j);
      }
    }

    if (clusterIdxs.length >= minTouches) {
      const avg = clusterPrices.reduce((a, b) => a + b, 0) / clusterPrices.length;
      const startIdx = Math.min(...clusterIdxs);
      const endIdx = Math.max(...clusterIdxs);
      levels.push({
        price: Math.round(avg * 10000) / 10000,
        start_time: timestamps[Math.min(startIdx, n - 1)],
        end_time: timestamps[Math.min(endIdx, n - 1)],
        type,
        touches: clusterIdxs.length,
      });
    }
  }

  return levels;
}

// ── W pattern (double bottom) detection ───────────────────────────────────────

function detectWPatterns(
  pivotLows: [number, number][],
  highs: number[],
  timestamps: number[],
  difPct: number,
  lastPrice: number
): WPattern[] {
  if (pivotLows.length < 2) return [];

  const sorted = [...pivotLows].sort((a, b) => a[0] - b[0]);
  const patterns: WPattern[] = [];
  const n = timestamps.length;

  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [idxA, priceA] = sorted[i];
      const [idxB, priceB] = sorted[j];

      // Prix similaires entre les deux creux
      if (Math.abs(priceA / priceB - 1) * 100 > difPct * 1.5) continue;

      // Séparation temporelle suffisante
      if (idxB - idxA < 5) continue;

      // Le 2e creux ne doit pas être nettement plus bas que le 1er
      if (priceB < priceA * 0.97) continue;

      // Trouver le pic (neckline) entre les deux creux
      const betweenHighs = highs.slice(idxA + 1, idxB);
      if (betweenHighs.length === 0) continue;
      const necklinePrice = Math.max(...betweenHighs);
      const necklineOffset = betweenHighs.indexOf(necklinePrice);
      const necklineIdx = idxA + 1 + necklineOffset;

      // Le pic doit être significativement au-dessus des creux
      const avgLow = (priceA + priceB) / 2;
      if (necklinePrice < avgLow * 1.02) continue;

      patterns.push({
        low1_price: Math.round(priceA * 10000) / 10000,
        low1_time: timestamps[Math.min(idxA, n - 1)],
        low2_price: Math.round(priceB * 10000) / 10000,
        low2_time: timestamps[Math.min(idxB, n - 1)],
        neckline_price: Math.round(necklinePrice * 10000) / 10000,
        neckline_time: timestamps[Math.min(necklineIdx, n - 1)],
        confirmed: lastPrice > necklinePrice,
      });
    }
  }

  // Garder les 3 patterns les plus récents (par 2e creux)
  return patterns.sort((a, b) => b.low2_time - a.low2_time).slice(0, 3);
}

// ── Coil detection (support ascendant + résistance plate) ────────────────────

function detectCoil(
  pivotLows: [number, number][],
  pivotHighs: [number, number][],
): boolean {
  if (pivotLows.length < 3 || pivotHighs.length < 2) return false;

  const sortedLows = [...pivotLows].sort((a, b) => a[0] - b[0]);
  const recent3Lows = sortedLows.slice(-3);

  // Les 3 derniers creux doivent être ascendants
  const lowsAscending = recent3Lows.every((low, i) =>
    i === 0 || low[1] > recent3Lows[i - 1][1] * 0.995
  );
  if (!lowsAscending) return false;

  // Les 2 derniers pics doivent être quasi plats (résistance plate)
  const sortedHighs = [...pivotHighs].sort((a, b) => a[0] - b[0]);
  const recent2Highs = sortedHighs.slice(-2);
  const highsDiffPct = Math.abs(recent2Highs[0][1] / recent2Highs[1][1] - 1) * 100;

  return highsDiffPct < 3;
}

// ── Breakout score ─────────────────────────────────────────────────────────────

function computeBreakoutScore(
  ohlcv: OHLCVBar[],
  srLevels: SRLevel[]
): BreakoutScore {
  const empty: BreakoutScore = { total: 0, tightness: 0, proximity: 0, accumulation: 0, label: null };
  if (srLevels.length === 0 || ohlcv.length === 0) return empty;

  const lastPrice = ohlcv[ohlcv.length - 1].close;

  const supportsBelow = srLevels.filter(l => l.type === 'support' && l.price < lastPrice);
  const resistsAbove = srLevels.filter(l => l.type === 'resistance' && l.price > lastPrice);

  // Accumulation partielle même sans range complet
  const totalSuppTouches = srLevels.filter(l => l.type === 'support').reduce((s, l) => s + l.touches, 0);
  const totalResisTouches = srLevels.filter(l => l.type === 'resistance').reduce((s, l) => s + l.touches, 0);
  const totalTouches = totalSuppTouches + totalResisTouches;
  const accumulation = totalTouches > 0
    ? Math.round((totalSuppTouches / totalTouches) * 20)
    : 10;

  if (supportsBelow.length === 0 || resistsAbove.length === 0) {
    const total = accumulation;
    return { total, tightness: 0, proximity: 0, accumulation, label: total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null };
  }

  // Niveau le plus proche de chaque côté
  const nearestSupport = supportsBelow.reduce((a, b) => a.price > b.price ? a : b);
  const nearestResist = resistsAbove.reduce((a, b) => a.price < b.price ? a : b);

  // Tightness (0–40) : range étroit = score haut
  const rangeWidthPct = (nearestResist.price - nearestSupport.price) / nearestSupport.price * 100;
  const tightness = Math.max(0, Math.round(40 - rangeWidthPct * 3));

  // Proximity (0–40) : prix proche de la résistance = score haut
  const distPct = (nearestResist.price - lastPrice) / nearestResist.price * 100;
  const proximity = Math.max(0, Math.round(40 - distPct * 6));

  const total = Math.min(100, tightness + proximity + accumulation);
  const label: BreakoutScore['label'] =
    total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null;

  return { total, tightness, proximity, accumulation, label };
}

// ── Main analysis entry point ─────────────────────────────────────────────────

export function analyzeOhlcv(
  ohlcv: OHLCVBar[],
  params: AnalysisParams,
  annotation?: RoiAnnotation | null,
): OhlcvAnalysis {
  if (ohlcv.length < params.pivot_order * 2 + 1) {
    return {
      sr_levels: [],
      w_patterns: [],
      score: { total: 0, tightness: 0, proximity: 0, accumulation: 0, label: null },
      is_coiling: false,
      fingerprint: computeFingerprint(ohlcv, [], false, [], annotation),
    };
  }

  const highs = ohlcv.map(b => b.high);
  const lows = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);
  const lastPrice = ohlcv[ohlcv.length - 1].close;

  const pivotHighs = findPivotHighs(highs, params.pivot_order);
  const pivotLows = findPivotLows(lows, params.pivot_order);

  const resistances = clusterLevels(pivotHighs, params.dif, params.min_touches, 'resistance', timestamps);
  const supports = clusterLevels(pivotLows, params.dif, params.min_touches, 'support', timestamps);
  const sr_levels = [...resistances, ...supports].sort((a, b) => b.price - a.price);

  const w_patterns = detectWPatterns(pivotLows, highs, timestamps, params.dif, lastPrice);
  const score = computeBreakoutScore(ohlcv, sr_levels);
  const is_coiling = detectCoil(pivotLows, pivotHighs);
  const fingerprint = computeFingerprint(ohlcv, sr_levels, is_coiling, w_patterns, annotation);

  return { sr_levels, w_patterns, score, is_coiling, fingerprint };
}

// Kept for backward compatibility (session restore uses sr_levels directly)
export function computeSRLevels(ohlcv: OHLCVBar[], params: AnalysisParams): SRLevel[] {
  return analyzeOhlcv(ohlcv, params).sr_levels;
}
