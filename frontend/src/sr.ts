import type { OHLCVBar, SRLevel, BreakoutScore } from './api';

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
  score: BreakoutScore;
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
      const rawMax = Math.max(...clusterPrices);
      const rawMin = Math.min(...clusterPrices);
      const minSpread = avg * 0.0005;
      const startIdx = Math.min(...clusterIdxs);
      const endIdx = Math.max(...clusterIdxs);
      levels.push({
        price:  Math.round(avg * 10000) / 10000,
        upper:  Math.round(Math.max(rawMax, avg + minSpread) * 10000) / 10000,
        lower:  Math.round(Math.min(rawMin, avg - minSpread) * 10000) / 10000,
        start_time:  timestamps[Math.min(startIdx, n - 1)],
        end_time:    timestamps[Math.min(endIdx, n - 1)],
        type,
        touches:     clusterIdxs.length,
        broken_out:  false,
        re_entered:  false,
      });
    }
  }

  return levels;
}

// ── Zone status (breakout / re-entry invalidation) ────────────────────────────

function markZoneStatus(levels: SRLevel[], ohlcv: OHLCVBar[]): void {
  for (const lvl of levels) {
    if (lvl.upper == null || lvl.lower == null) continue;
    // Scan uniquement après la dernière touche (le niveau est alors confirmé)
    const startIdx = ohlcv.findIndex(b => b.time > lvl.end_time);
    if (startIdx < 0) continue;

    if (lvl.type === 'resistance') {
      let breakoutIdx = -1;
      for (let i = startIdx; i < ohlcv.length; i++) {
        if (!lvl.broken_out && ohlcv[i].close > lvl.upper!) {
          lvl.broken_out = true;
          breakoutIdx = i;
        }
        if (lvl.broken_out && i > breakoutIdx && ohlcv[i].close < lvl.lower!) {
          lvl.re_entered = true;
          lvl.obsolete   = true;
          break;
        }
      }
    } else {
      // support : breakdown = close < lower, re-entry = close > upper
      let breakdownIdx = -1;
      for (let i = startIdx; i < ohlcv.length; i++) {
        if (!lvl.broken_out && ohlcv[i].close < lvl.lower!) {
          lvl.broken_out = true;
          breakdownIdx = i;
        }
        if (lvl.broken_out && i > breakdownIdx && ohlcv[i].close > lvl.upper!) {
          lvl.re_entered = true;
          lvl.obsolete   = true;
          break;
        }
      }
    }
  }
}

// ── Breakout score ─────────────────────────────────────────────────────────────

function computeBreakoutScore(
  ohlcv: OHLCVBar[],
  srLevels: SRLevel[]
): BreakoutScore {
  const empty: BreakoutScore = { total: 0, tightness: 0, proximity: 0, accumulation: 0, pattern_bonus: 0, label: null };
  if (srLevels.length === 0 || ohlcv.length === 0) return empty;

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const valid = srLevels.filter(l => !l.obsolete);

  const totalSuppTouches  = valid.filter(l => l.type === 'support').reduce((s, l) => s + l.touches, 0);
  const totalResisTouches = valid.filter(l => l.type === 'resistance').reduce((s, l) => s + l.touches, 0);
  const totalTouches = totalSuppTouches + totalResisTouches;
  const accumulation = totalTouches > 0
    ? Math.round((totalSuppTouches / totalTouches) * 20)
    : 10;

  const supportsBelow = valid.filter(l => l.type === 'support' && l.price < lastPrice);
  // Résistances encore pertinentes : borne haute > lastPrice (zone au-dessus ou autour)
  const resistsRelevant = valid.filter(l =>
    l.type === 'resistance' && (l.upper ?? l.price) > lastPrice
  );

  if (supportsBelow.length === 0 || resistsRelevant.length === 0) {
    const total = accumulation;
    return { total, tightness: 0, proximity: 0, accumulation, pattern_bonus: 0, label: total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null };
  }

  const nearestSupport = supportsBelow.reduce((a, b) => a.price > b.price ? a : b);
  // Résistance la plus proche : center le plus bas parmi les zones encore au-dessus
  const nearestResist = resistsRelevant.reduce((a, b) => a.price < b.price ? a : b);

  const rangeWidthPct = (nearestResist.price - nearestSupport.price) / nearestSupport.price * 100;
  const tightness = Math.max(0, Math.round(40 - rangeWidthPct * 3));

  // Proximité : distance de lastPrice à la borne basse de la zone de résistance
  const zoneL = nearestResist.lower ?? nearestResist.price;
  let proximity: number;
  let pattern_bonus = 0;

  if (lastPrice >= zoneL) {
    // Prix dans la zone ou au-dessus de la borne basse → test actif, proximité max
    proximity = 40;
    if (nearestResist.broken_out && !nearestResist.re_entered) {
      // Breakout propre confirmé → bonus
      pattern_bonus = 10;
    }
  } else {
    // Prix en dessous : distance à la borne basse
    const distPct = (zoneL - lastPrice) / lastPrice * 100;
    proximity = Math.max(0, Math.round(40 - distPct * 6));
  }

  const total = Math.min(100, tightness + proximity + accumulation + pattern_bonus);
  const label: BreakoutScore['label'] =
    total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null;

  return { total, tightness, proximity, accumulation, pattern_bonus, label };
}

// ── Main analysis entry point ─────────────────────────────────────────────────

export function analyzeOhlcv(
  ohlcv: OHLCVBar[],
  params: AnalysisParams,
): OhlcvAnalysis {
  const dif = params.dif ?? _DIF;
  const pivot_order = params.pivot_order ?? _PIVOT_ORDER;
  const min_touches = params.min_touches ?? _MIN_TOUCHES;

  const empty: OhlcvAnalysis = {
    sr_levels: [],
    score: { total: 0, tightness: 0, proximity: 0, accumulation: 0, pattern_bonus: 0, label: null },
  };

  if (ohlcv.length < pivot_order * 2 + 1) return empty;

  const highs = ohlcv.map(b => b.high);
  const lows = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);

  const pivotHighs = findPivotHighs(highs, pivot_order);
  const pivotLows = findPivotLows(lows, pivot_order);

  const resistances = clusterLevels(pivotHighs, dif, min_touches, 'resistance', timestamps);
  const supports = clusterLevels(pivotLows, dif, min_touches, 'support', timestamps);
  const sr_levels = [...resistances, ...supports].sort((a, b) => b.price - a.price);

  // Règle de non-rerentrée : invalide les zones cassées puis recrossées
  markZoneStatus(sr_levels, ohlcv);

  // Option complémentaire : obsolescence par ancienneté
  const maxAgeBars = params.maxAgeBars ?? 0;
  if (maxAgeBars > 0) {
    const lastBarIdx = ohlcv.length - 1;
    for (const level of sr_levels) {
      if (level.obsolete) continue;
      const endIdx = timestamps.lastIndexOf(level.end_time);
      const age = endIdx >= 0 ? lastBarIdx - endIdx : 0;
      if (age > maxAgeBars) level.obsolete = true;
    }
  }

  const score = computeBreakoutScore(ohlcv, sr_levels);

  return { sr_levels, score };
}

// Score centré sur les supports (mode "Supports only")
export function computeSupportScore(ohlcv: OHLCVBar[], srLevels: SRLevel[]): BreakoutScore {
  const empty: BreakoutScore = { total: 0, tightness: 0, proximity: 0, accumulation: 0, pattern_bonus: 0, label: null };
  if (srLevels.length === 0 || ohlcv.length === 0) return empty;

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const activeSupports = srLevels.filter(l => l.type === 'support' && !l.obsolete);
  if (activeSupports.length === 0) return empty;

  const nearestSupport = activeSupports
    .filter(l => l.price <= lastPrice)
    .sort((a, b) => b.price - a.price)[0];
  if (!nearestSupport) return empty;

  const zoneUpper = nearestSupport.upper ?? nearestSupport.price;
  let proximity: number;
  if (lastPrice <= zoneUpper) {
    proximity = 50;
  } else {
    const distPct = (lastPrice - zoneUpper) / lastPrice * 100;
    proximity = Math.max(0, Math.round(50 - distPct * 8));
  }

  const totalTouches = activeSupports.reduce((s, l) => s + l.touches, 0);
  const strength = Math.min(50, totalTouches * 8);

  const total = Math.min(100, proximity + strength);
  const label: BreakoutScore['label'] =
    total >= 60 ? 'fort' : total >= 40 ? 'modéré' : total >= 20 ? 'faible' : null;

  return { total, tightness: 0, proximity, accumulation: strength, pattern_bonus: 0, label };
}

// Conservé pour compatibilité avec les sessions sauvegardées
export function computeSRLevels(ohlcv: OHLCVBar[], params: AnalysisParams): SRLevel[] {
  return analyzeOhlcv(ohlcv, params).sr_levels;
}
