import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from './api';
import type { PatternTemplate, DetectedPattern, PatternRulesConfig } from './lib/patternLearning';
import { detectWithTemplates, detectPatternsGeometric, mergeDetections } from './lib/patternLearning';

export type { DetectedPattern };

export interface AnalysisParams {
  tolerance?: number;  // 1.0–3.0, défaut 1.5
  maxAgeBars?: number; // 0 = désactivé; >0 = marquer niveaux plus anciens que N bars
  // Champs legacy conservés pour compatibilité sessions sauvegardées
  dif?: number;
  pivot_order?: number;
  min_touches?: number;
}

export interface OhlcvAnalysis {
  sr_levels: SRLevel[];
  w_patterns: WPattern[];
  score: BreakoutScore;
  is_coiling: boolean;
  matched_patterns: DetectedPattern[];
}

const _DIF         = 1.5;
const _PIVOT_ORDER = 5;
const _MIN_TOUCHES = 2;

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

// ── W pattern (double bottom) ─────────────────────────────────────────────────

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

      if (Math.abs(priceA / priceB - 1) * 100 > difPct * 1.5) continue;
      if (idxB - idxA < 5) continue;
      if (priceB < priceA * 0.97) continue;

      const betweenHighs = highs.slice(idxA + 1, idxB);
      if (betweenHighs.length === 0) continue;
      const necklinePrice = Math.max(...betweenHighs);
      const necklineOffset = betweenHighs.indexOf(necklinePrice);
      const necklineIdx = idxA + 1 + necklineOffset;

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

  return patterns.sort((a, b) => b.low2_time - a.low2_time).slice(0, 3);
}

// ── Coil detection ────────────────────────────────────────────────────────────

function detectCoil(
  pivotLows: [number, number][],
  pivotHighs: [number, number][],
): boolean {
  if (pivotLows.length < 3 || pivotHighs.length < 2) return false;

  const sortedLows = [...pivotLows].sort((a, b) => a[0] - b[0]);
  const recent3Lows = sortedLows.slice(-3);
  const lowsAscending = recent3Lows.every((low, i) =>
    i === 0 || low[1] > recent3Lows[i - 1][1] * 0.995
  );
  if (!lowsAscending) return false;

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
  const empty: BreakoutScore = { total: 0, tightness: 0, proximity: 0, accumulation: 0, pattern_bonus: 0, label: null };
  if (srLevels.length === 0 || ohlcv.length === 0) return empty;

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const supportsBelow = srLevels.filter(l => l.type === 'support' && l.price < lastPrice);
  const resistsAbove = srLevels.filter(l => l.type === 'resistance' && l.price > lastPrice);

  const totalSuppTouches = srLevels.filter(l => l.type === 'support').reduce((s, l) => s + l.touches, 0);
  const totalResisTouches = srLevels.filter(l => l.type === 'resistance').reduce((s, l) => s + l.touches, 0);
  const totalTouches = totalSuppTouches + totalResisTouches;
  const accumulation = totalTouches > 0
    ? Math.round((totalSuppTouches / totalTouches) * 20)
    : 10;

  if (supportsBelow.length === 0 || resistsAbove.length === 0) {
    const total = accumulation;
    return { total, tightness: 0, proximity: 0, accumulation, pattern_bonus: 0, label: total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null };
  }

  const nearestSupport = supportsBelow.reduce((a, b) => a.price > b.price ? a : b);
  const nearestResist = resistsAbove.reduce((a, b) => a.price < b.price ? a : b);

  const rangeWidthPct = (nearestResist.price - nearestSupport.price) / nearestSupport.price * 100;
  const tightness = Math.max(0, Math.round(40 - rangeWidthPct * 3));

  const distPct = (nearestResist.price - lastPrice) / nearestResist.price * 100;
  const proximity = Math.max(0, Math.round(40 - distPct * 6));

  const total = Math.min(100, tightness + proximity + accumulation);
  const label: BreakoutScore['label'] =
    total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null;

  return { total, tightness, proximity, accumulation, pattern_bonus: 0, label };
}

// ── Main analysis entry point ─────────────────────────────────────────────────

export function analyzeOhlcv(
  ohlcv: OHLCVBar[],
  params: AnalysisParams,
  templates: PatternTemplate[] = [],
  patternRules?: PatternRulesConfig,
): OhlcvAnalysis {
  const dif = params.dif ?? _DIF;
  const pivot_order = params.pivot_order ?? _PIVOT_ORDER;
  const min_touches = params.min_touches ?? _MIN_TOUCHES;
  const tolerance = params.tolerance ?? 1.5;

  const empty: OhlcvAnalysis = {
    sr_levels: [],
    w_patterns: [],
    score: { total: 0, tightness: 0, proximity: 0, accumulation: 0, pattern_bonus: 0, label: null },
    is_coiling: false,
    matched_patterns: [],
  };

  if (ohlcv.length < pivot_order * 2 + 1) return empty;

  const highs = ohlcv.map(b => b.high);
  const lows = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);
  const lastPrice = ohlcv[ohlcv.length - 1].close;

  const pivotHighs = findPivotHighs(highs, pivot_order);
  const pivotLows = findPivotLows(lows, pivot_order);

  const resistances = clusterLevels(pivotHighs, dif, min_touches, 'resistance', timestamps);
  const supports = clusterLevels(pivotLows, dif, min_touches, 'support', timestamps);
  const sr_levels = [...resistances, ...supports].sort((a, b) => b.price - a.price);

  // Mark obsolete levels if maxAgeBars is set
  const maxAgeBars = params.maxAgeBars ?? 0;
  if (maxAgeBars > 0) {
    const lastBarIdx = ohlcv.length - 1;
    for (const level of sr_levels) {
      const endIdx = timestamps.lastIndexOf(level.end_time);
      const age = endIdx >= 0 ? lastBarIdx - endIdx : 0;
      if (age > maxAgeBars) level.obsolete = true;
    }
  }

  const w_patterns = detectWPatterns(pivotLows, highs, timestamps, dif, lastPrice);
  const is_coiling = detectCoil(pivotLows, pivotHighs);

  const templateMatches = detectWithTemplates(ohlcv, templates, tolerance);
  const geoMatches = patternRules ? detectPatternsGeometric(ohlcv, patternRules) : [];
  const matched_patterns = mergeDetections(templateMatches, geoMatches);

  // Compute S/R score and add pattern bonus
  const srScore = computeBreakoutScore(ohlcv, sr_levels);
  const bestTemplateScore = templateMatches.length > 0 ? Math.max(...templateMatches.map(m => m.score)) : 0;
  const bestGeoScore = geoMatches.length > 0 ? Math.max(...geoMatches.map(m => m.score)) : 0;
  // S/R base vaut 60% du score max ; templates + géo valent jusqu'à 60 pts (40+20)
  const pattern_bonus = Math.round(bestTemplateScore * 0.4) + Math.round(bestGeoScore * 0.2);
  const srBase = srScore.tightness + srScore.proximity + srScore.accumulation;
  const total = Math.min(100, Math.round(srBase * 0.6) + pattern_bonus);
  const label: BreakoutScore['label'] = total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null;
  const score: BreakoutScore = { ...srScore, pattern_bonus, total, label };

  return { sr_levels, w_patterns, score, is_coiling, matched_patterns };
}

// Conservé pour compatibilité avec les sessions sauvegardées
export function computeSRLevels(ohlcv: OHLCVBar[], params: AnalysisParams): SRLevel[] {
  return analyzeOhlcv(ohlcv, params).sr_levels;
}
