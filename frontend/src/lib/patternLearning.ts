import type { OHLCVBar } from '../api';
import type { AnnotationPoint, PatternAnnotation } from './api-storage';

// ── Pattern type definitions ──────────────────────────────────────────────────

export const PATTERN_DEFINITIONS: Record<string, string[]> = {
  'W': ['haut_gauche', 'bas_gauche', 'pic_central', 'bas_droit', 'breakout'],
  'Triple Bottom': ['haut_1', 'bas_1', 'pic_1', 'bas_2', 'pic_2', 'bas_3', 'pic_3'],
  'ETE': ['départ_gauche', 'épaule_gauche', 'neckline_gauche', 'tête', 'neckline_droite', 'épaule_droite', 'fin_droite'],
  'Range': ['top_gauche', 'bot_gauche', 'bot_droit', 'top_droit'],
  'Three Drive': ['départ', 'drive1', 'retrace1', 'drive2', 'retrace2', 'drive3'],
  'Triangle Ascendant': ['bas1', 'top_plat', 'bas2', 'top_plat2'],
  'Custom': [],
};

export const PATTERN_SHAPES: Record<string, Array<'U' | 'D'>> = {
  'W':                  ['D', 'U', 'D', 'U'],
  'Triple Bottom':      ['D', 'U', 'D', 'U', 'D', 'U'],
  'ETE':                ['U', 'D', 'U', 'D', 'U', 'D'],
  'Range':              ['D', 'U', 'U'],
  'Three Drive':        ['U', 'D', 'U', 'D', 'U'],
  'Triangle Ascendant': ['D', 'U', 'D'],
};

// ── Geometric rules per pattern ───────────────────────────────────────────────

export interface RangeRules {
  enabled: boolean;
  pivotLookback: number;       // bars each side for pivot detection
  touchTolerance: number;      // % of range height = touch zone
  minTouchesMaxSide: number;   // dominant side min touches (rule: 3)
  minTouchesMinSide: number;   // secondary side min touches (rule: 2)
  flatnessMax: number;         // max (std of touches / range height) %
  minDurationBars: number;     // min bars between first and last touch
  minHeightPct: number;        // min range height as % of price
  maxHeightPct: number;        // max range height as % of price
}

export interface WRules {
  enabled: boolean;
  pivotLookback: number;
  legSymmetryMax: number;      // max % diff between the two lows
  necklineMinLiftPct: number;  // neckline must be X% above avg low
  minBarsBetweenLows: number;  // min bars separating the two lows
  minDurationBars: number;
}

export interface ETERules {
  enabled: boolean;
  pivotLookback: number;
  shoulderSymmetryMax: number; // max % diff between shoulder peaks
  headLiftMin: number;         // head must be X% above avg shoulder
  necklineSlopeMax: number;    // max % diff between neckline troughs
  minDurationBars: number;
}

export interface TriangleAscRules {
  enabled: boolean;
  pivotLookback: number;
  resistanceSlopeMax: number;  // max resistance slope (% per 100 bars)
  supportSlopeMin: number;     // min support slope (% per 100 bars, must rise)
  minPivots: number;           // min pivot count per side
  minDurationBars: number;
}

export interface PatternRulesConfig {
  Range: RangeRules;
  W: WRules;
  ETE: ETERules;
  TriangleAscendant: TriangleAscRules;
}

export const DEFAULT_PATTERN_RULES: PatternRulesConfig = {
  Range: {
    enabled: true,
    pivotLookback: 3,
    touchTolerance: 4,
    minTouchesMaxSide: 3,
    minTouchesMinSide: 2,
    flatnessMax: 6,
    minDurationBars: 15,
    minHeightPct: 1.5,
    maxHeightPct: 20,
  },
  W: {
    enabled: true,
    pivotLookback: 3,
    legSymmetryMax: 8,
    necklineMinLiftPct: 2,
    minBarsBetweenLows: 5,
    minDurationBars: 10,
  },
  ETE: {
    enabled: true,
    pivotLookback: 4,
    shoulderSymmetryMax: 15,
    headLiftMin: 3,
    necklineSlopeMax: 5,
    minDurationBars: 20,
  },
  TriangleAscendant: {
    enabled: true,
    pivotLookback: 3,
    resistanceSlopeMax: 2,
    supportSlopeMin: 0.5,
    minPivots: 3,
    minDurationBars: 20,
  },
};

// ── Template types ────────────────────────────────────────────────────────────

export interface TemplatePoint {
  label: string;
  order: number;
  mean_x: number;
  mean_y: number;
  std_x: number;
  std_y: number;
}

export interface PriceRatio {
  from: number;
  to: number;
  mean: number;
  std: number;
}

export interface PatternTemplate {
  pattern_type: string;
  sample_count: number;
  points: TemplatePoint[];
  ratios: PriceRatio[];
}

export interface DetectedPattern {
  pattern_type: string;
  score: number;
  confidence: 'fort' | 'modéré' | 'faible';
  points: Array<{ label: string; price: number; time: number }>;
  bar_start: number;
  bar_end: number;
  source?: 'template' | 'géométrique';
}

// ── Range quality ─────────────────────────────────────────────────────────────

export interface RangeQuality {
  score: number;
  topSkew: number;
  botSkew: number;
}

export function computeRangeQuality(points: AnnotationPoint[]): RangeQuality | null {
  const byLabel: Record<string, number> = {};
  for (const p of points) byLabel[p.label] = p.price;
  const topG = byLabel['top_gauche'];
  const botG = byLabel['bot_gauche'];
  const botD = byLabel['bot_droit'];
  const topD = byLabel['top_droit'];
  if (topG == null || botG == null || botD == null || topD == null) return null;
  const height = Math.max(0.01, Math.abs(topG - botG));
  const topSkew = Math.min(1, Math.abs(topG - topD) / height);
  const botSkew = Math.min(1, Math.abs(botG - botD) / height);
  return { score: Math.round((1 - topSkew) * (1 - botSkew) * 100), topSkew, botSkew };
}

// ── Geometry validation for buildTemplates ────────────────────────────────────

function isAnnotationGeometryValid(ann: PatternAnnotation): boolean {
  if (ann.patternType !== 'Range') return true;
  const byLabel: Record<string, AnnotationPoint> = {};
  for (const p of ann.points) byLabel[p.label] = p;
  const topG = byLabel['top_gauche'];
  const botG = byLabel['bot_gauche'];
  const botD = byLabel['bot_droit'];
  const topD = byLabel['top_droit'];
  if (!topG || !botG || !botD || !topD) return true;
  const height = Math.abs(topG.y_rel - botG.y_rel);
  if (height < 0.04) return false;
  const topSkew = Math.abs(topG.y_rel - topD.y_rel) / height;
  const botSkew = Math.abs(botG.y_rel - botD.y_rel) / height;
  return topSkew < 0.25 && botSkew < 0.25;
}

// ── Maths helpers ─────────────────────────────────────────────────────────────

function _mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _std(arr: number[], m: number): number {
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// ── Build templates from all annotations ─────────────────────────────────────

export function buildTemplates(annotations: PatternAnnotation[]): PatternTemplate[] {
  const byType = new Map<string, PatternAnnotation[]>();
  for (const ann of annotations) {
    if (!byType.has(ann.patternType)) byType.set(ann.patternType, []);
    byType.get(ann.patternType)!.push(ann);
  }

  const templates: PatternTemplate[] = [];

  for (const [pattern_type, anns] of byType.entries()) {
    if (anns.length === 0) continue;

    const validAnns = anns.filter(isAnnotationGeometryValid);
    const workingAnns = validAnns.length > 0 ? validAnns : anns;

    const pointCount = Math.max(...workingAnns.map(a => a.points.length));
    if (pointCount < 2) continue;

    const templatePoints: TemplatePoint[] = [];
    for (let i = 0; i < pointCount; i++) {
      const pts = workingAnns.map(a => a.points[i]).filter(Boolean);
      if (pts.length === 0) continue;
      const xVals = pts.map((p: AnnotationPoint) => p.x_rel);
      const yVals = pts.map((p: AnnotationPoint) => p.y_rel);
      const mx = _mean(xVals);
      const my = _mean(yVals);
      templatePoints.push({
        label: pts[0].label || `pt${i}`,
        order: i,
        mean_x: mx,
        mean_y: my,
        std_x: Math.max(_std(xVals, mx), 0.04),
        std_y: Math.max(_std(yVals, my), 0.04),
      });
    }

    const ratios: PriceRatio[] = [];
    for (let i = 0; i < pointCount - 1; i++) {
      const ratioVals = workingAnns
        .filter(a => a.points[i] && a.points[i + 1] && a.points[i].price > 0)
        .map(a => a.points[i + 1].price / a.points[i].price);
      if (ratioVals.length === 0) continue;
      const m = _mean(ratioVals);
      ratios.push({ from: i, to: i + 1, mean: m, std: Math.max(_std(ratioVals, m), 0.015) });
    }

    templates.push({ pattern_type, sample_count: workingAnns.length, points: templatePoints, ratios });
  }

  return templates;
}

// ── Template-based detection ──────────────────────────────────────────────────

export function detectWithTemplates(
  ohlcv: OHLCVBar[],
  templates: PatternTemplate[],
  tolerance: number = 1.5,
): DetectedPattern[] {
  if (templates.length === 0 || ohlcv.length < 15) return [];

  const allMatches: DetectedPattern[] = [];

  for (const template of templates) {
    if (template.points.length < 2) continue;

    const minWin = Math.max(15, Math.round(ohlcv.length * 0.12));
    const maxWin = Math.round(ohlcv.length * 0.92);
    const step = Math.max(3, Math.round(minWin * 0.25));

    for (let winSize = minWin; winSize <= maxWin; winSize += Math.round(winSize * 0.35)) {
      for (let start = 0; start + winSize <= ohlcv.length; start += step) {
        const window = ohlcv.slice(start, start + winSize);
        const match = _matchWindow(window, template, tolerance, start);
        if (match && match.score >= 35) allMatches.push({ ...match, source: 'template' });
      }
    }
  }

  return _deduplicate(allMatches)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// ── Range bounce counter ──────────────────────────────────────────────────────

function _countRangeBounces(
  window: OHLCVBar[],
  topLevel: number,
  botLevel: number,
): { topBounces: number; botBounces: number } {
  const rangeH = topLevel - botLevel;
  if (rangeH <= 0) return { topBounces: 0, botBounces: 0 };
  const tol = rangeH * 0.04;

  let topBounces = 0;
  let botBounces = 0;
  let inTopTouch = false;
  let inBotTouch = false;

  for (const bar of window) {
    const nearTop = bar.high >= topLevel - tol;
    const nearBot = bar.low  <= botLevel + tol;
    if (nearTop) { if (!inTopTouch) { topBounces++; inTopTouch = true; } } else { inTopTouch = false; }
    if (nearBot) { if (!inBotTouch) { botBounces++; inBotTouch = true; } } else { inBotTouch = false; }
  }

  return { topBounces, botBounces };
}

// ── Window matching ───────────────────────────────────────────────────────────

function _matchWindow(
  window: OHLCVBar[],
  template: PatternTemplate,
  tolerance: number,
  offset: number,
): DetectedPattern | null {
  const n = window.length;
  const priceMin = Math.min(...window.map(b => b.low));
  const priceMax = Math.max(...window.map(b => b.high));
  const priceRange = priceMax - priceMin;
  if (priceRange <= 0) return null;

  const candidatePoints: Array<{ label: string; price: number; time: number }> = [];

  for (const tpt of template.points) {
    const targetIdx = Math.round(tpt.mean_x * (n - 1));
    const tolX = Math.round(tpt.std_x * tolerance * n);
    const searchStart = Math.max(0, targetIdx - tolX);
    const searchEnd = Math.min(n - 1, targetIdx + tolX);

    const targetPrice = priceMin + tpt.mean_y * priceRange;
    const tolPrice = tpt.std_y * tolerance * priceRange;

    let bestBar = window[targetIdx];
    let bestDist = Infinity;
    for (let i = searchStart; i <= searchEnd; i++) {
      const barMid = (window[i].high + window[i].low) / 2;
      const dist = Math.abs(barMid - targetPrice);
      if (dist < bestDist) { bestDist = dist; bestBar = window[i]; }
    }

    if (bestDist > tolPrice * 2.5) return null;

    candidatePoints.push({ label: tpt.label, price: bestBar.close, time: bestBar.time });
  }

  for (let i = 1; i < candidatePoints.length; i++) {
    if (candidatePoints[i].time < candidatePoints[i - 1].time) return null;
  }

  // Range: enforce 3+2 bounce rule
  if (template.pattern_type === 'Range') {
    const byLabel: Record<string, number> = {};
    for (const cp of candidatePoints) byLabel[cp.label] = cp.price;
    const topLevel = ((byLabel['top_gauche'] ?? 0) + (byLabel['top_droit'] ?? 0)) / 2;
    const botLevel = ((byLabel['bot_gauche'] ?? 0) + (byLabel['bot_droit'] ?? 0)) / 2;
    if (topLevel > 0 && botLevel > 0 && topLevel > botLevel) {
      const { topBounces, botBounces } = _countRangeBounces(window, topLevel, botLevel);
      if (Math.max(topBounces, botBounces) < 3 || Math.min(topBounces, botBounces) < 2) return null;
    }
  }

  let totalScore = 0;
  let checks = 0;
  for (const ratio of template.ratios) {
    const from = candidatePoints[ratio.from];
    const to = candidatePoints[ratio.to];
    if (!from || !to || from.price <= 0) continue;
    const actual = to.price / from.price;
    const diff = Math.abs(actual - ratio.mean) / (ratio.std * tolerance);
    totalScore += Math.max(0, 1 - diff);
    checks++;
  }

  const score = checks > 0 ? Math.round((totalScore / checks) * 100) : 55;
  const confidence: DetectedPattern['confidence'] =
    score >= 70 ? 'fort' : score >= 50 ? 'modéré' : 'faible';

  return {
    pattern_type: template.pattern_type,
    score,
    confidence,
    points: candidatePoints,
    bar_start: offset,
    bar_end: offset + n - 1,
  };
}

// ── Deduplicate overlapping matches (keep best score) ────────────────────────

function _deduplicate(matches: DetectedPattern[]): DetectedPattern[] {
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const kept: DetectedPattern[] = [];
  for (const m of sorted) {
    const overlapsPrev = kept.some(k => {
      if (k.pattern_type !== m.pattern_type) return false;
      const overlapLen = Math.min(m.bar_end, k.bar_end) - Math.max(m.bar_start, k.bar_start);
      const minLen = Math.min(m.bar_end - m.bar_start, k.bar_end - k.bar_start);
      return overlapLen > minLen * 0.5;
    });
    if (!overlapsPrev) kept.push(m);
  }
  return kept;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Geometric rule-based detection ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Internal pivot detection (uses strict inequality: must be strictly higher/lower)
type PivotPt = [number, number]; // [bar_index, price]

function _pivotHighsGeo(highs: number[], order: number): PivotPt[] {
  const out: PivotPt[] = [];
  for (let i = order; i < highs.length - order; i++) {
    let ok = true;
    for (let k = 1; k <= order; k++) {
      if (highs[i] <= highs[i - k] || highs[i] < highs[i + k]) { ok = false; break; }
    }
    if (ok) out.push([i, highs[i]]);
  }
  return out;
}

function _pivotLowsGeo(lows: number[], order: number): PivotPt[] {
  const out: PivotPt[] = [];
  for (let i = order; i < lows.length - order; i++) {
    let ok = true;
    for (let k = 1; k <= order; k++) {
      if (lows[i] >= lows[i - k] || lows[i] > lows[i + k]) { ok = false; break; }
    }
    if (ok) out.push([i, lows[i]]);
  }
  return out;
}

// Cluster nearby pivots into levels
interface PivotCluster {
  level: number;   // centroid price
  std: number;     // price std within cluster
  count: number;   // number of distinct pivots
  firstBar: number;
  lastBar: number;
  firstTime: number;
  lastTime: number;
}

function _clusterPivots(
  pivots: PivotPt[],
  timestamps: number[],
  tolerancePct: number,
): PivotCluster[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a[1] - b[1]);
  const used = new Set<number>();
  const clusters: PivotCluster[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const group: PivotPt[] = [sorted[i]];
    used.add(i);
    const seed = sorted[i][1];

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(sorted[j][1] / seed - 1) * 100 < tolerancePct) {
        group.push(sorted[j]);
        used.add(j);
      }
    }

    const prices = group.map(p => p[1]);
    const bars   = group.map(p => p[0]);
    const lvl = _mean(prices);
    const std = _std(prices, lvl);

    const safeTs = (idx: number) => timestamps[Math.min(idx, timestamps.length - 1)] ?? 0;

    clusters.push({
      level: lvl, std, count: group.length,
      firstBar: Math.min(...bars), lastBar: Math.max(...bars),
      firstTime: safeTs(Math.min(...bars)), lastTime: safeTs(Math.max(...bars)),
    });
  }

  return clusters.sort((a, b) => a.level - b.level);
}

// Simple OLS linear regression on [x, y] points
function _linReg(pts: PivotPt[]): { slope: number; intercept: number; r2: number } {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: pts[0]?.[1] ?? 0, r2: 0 };
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const sx2 = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p[1] - yMean) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p[1] - (slope * p[0] + intercept)) ** 2, 0);
  const r2 = ssTot > 1e-10 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  return { slope, intercept, r2 };
}

// Safe timestamp lookup
function _ts(timestamps: number[], idx: number): number {
  return timestamps[Math.max(0, Math.min(idx, timestamps.length - 1))] ?? 0;
}

// ── Range geometric detector ──────────────────────────────────────────────────

function _detectRangeGeo(ohlcv: OHLCVBar[], rules: RangeRules): DetectedPattern[] {
  if (!rules.enabled || ohlcv.length < rules.minDurationBars) return [];

  const highs      = ohlcv.map(b => b.high);
  const lows       = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);
  const midPrice   = (_mean(highs) + _mean(lows)) / 2;

  const pivHigh = _pivotHighsGeo(highs, rules.pivotLookback);
  const pivLow  = _pivotLowsGeo(lows,  rules.pivotLookback);

  if (pivHigh.length < rules.minTouchesMinSide || pivLow.length < rules.minTouchesMinSide) return [];

  const resClusters = _clusterPivots(pivHigh, timestamps, rules.touchTolerance);
  const supClusters = _clusterPivots(pivLow,  timestamps, rules.touchTolerance);

  const results: DetectedPattern[] = [];

  for (const res of resClusters) {
    for (const sup of supClusters) {
      if (res.level <= sup.level) continue;

      const rangeH    = res.level - sup.level;
      const heightPct = (rangeH / midPrice) * 100;
      if (heightPct < rules.minHeightPct || heightPct > rules.maxHeightPct) continue;

      const maxTouches = Math.max(res.count, sup.count);
      const minTouches = Math.min(res.count, sup.count);
      if (maxTouches < rules.minTouchesMaxSide || minTouches < rules.minTouchesMinSide) continue;

      const resFlatness = (res.std / rangeH) * 100;
      const supFlatness = (sup.std / rangeH) * 100;
      if (resFlatness > rules.flatnessMax || supFlatness > rules.flatnessMax) continue;

      const barStart = Math.min(res.firstBar, sup.firstBar);
      const barEnd   = Math.max(res.lastBar,  sup.lastBar);
      if (barEnd - barStart < rules.minDurationBars) continue;

      // Score: base 35, +touch bonus (max 40), +flatness bonus (max 25)
      const touchBonus   = Math.min(40, Math.max(0, (maxTouches + minTouches - 5) / 7 * 40));
      const flatBonus    = Math.max(0, (1 - (resFlatness + supFlatness) / (2 * rules.flatnessMax)) * 25);
      const score        = Math.round(Math.min(100, 35 + touchBonus + flatBonus));
      const confidence: DetectedPattern['confidence'] =
        score >= 70 ? 'fort' : score >= 50 ? 'modéré' : 'faible';

      results.push({
        pattern_type: 'Range',
        score,
        confidence,
        source: 'géométrique',
        points: [
          { label: 'top_gauche', price: res.level, time: res.firstTime },
          { label: 'bot_gauche', price: sup.level, time: sup.firstTime },
          { label: 'bot_droit',  price: sup.level, time: sup.lastTime  },
          { label: 'top_droit',  price: res.level, time: res.lastTime  },
        ],
        bar_start: barStart,
        bar_end:   barEnd,
      });
    }
  }

  return results;
}

// ── W (Double Bottom) geometric detector ─────────────────────────────────────

function _detectWGeo(ohlcv: OHLCVBar[], rules: WRules): DetectedPattern[] {
  if (!rules.enabled || ohlcv.length < rules.minDurationBars) return [];

  const highs      = ohlcv.map(b => b.high);
  const lows       = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);

  const pivLow = _pivotLowsGeo(lows, rules.pivotLookback);
  if (pivLow.length < 2) return [];

  const sorted  = [...pivLow].sort((a, b) => a[0] - b[0]);
  const results: DetectedPattern[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [idxA, priceA] = sorted[i];
      const [idxB, priceB] = sorted[j];

      if (idxB - idxA < rules.minBarsBetweenLows) continue;
      if (idxB - idxA < rules.minDurationBars) continue;

      // Leg symmetry
      const symPct = Math.abs(priceA / priceB - 1) * 100;
      if (symPct > rules.legSymmetryMax) continue;

      // Second low must not undercut first significantly
      if (priceB < priceA * 0.97) continue;

      // Neckline = highest high between the two lows
      const between = highs.slice(idxA + 1, idxB);
      if (between.length === 0) continue;
      const necklinePrice = Math.max(...between);
      const necklineOffset = between.indexOf(necklinePrice);
      const necklineIdx = idxA + 1 + necklineOffset;

      // Neckline must be sufficiently above the lows
      const avgLow = (priceA + priceB) / 2;
      const liftPct = (necklinePrice - avgLow) / avgLow * 100;
      if (liftPct < rules.necklineMinLiftPct) continue;

      // haut_gauche: highest high to the left of first low
      const leftHighs = highs.slice(0, idxA);
      const hgPrice = leftHighs.length > 0 ? Math.max(...leftHighs) : necklinePrice;
      const hgIdx   = leftHighs.length > 0
        ? leftHighs.reduce((mi, h, k) => h > leftHighs[mi] ? k : mi, 0)
        : idxA;

      // breakout point: a few bars after second low
      const boIdx = Math.min(idxB + Math.round((idxB - idxA) * 0.15), ohlcv.length - 1);

      const symBonus  = Math.max(0, (rules.legSymmetryMax - symPct) / rules.legSymmetryMax * 20);
      const liftBonus = Math.min(20, liftPct * 2);
      const score     = Math.round(Math.min(100, 50 + symBonus + liftBonus));
      const confidence: DetectedPattern['confidence'] =
        score >= 70 ? 'fort' : score >= 50 ? 'modéré' : 'faible';

      results.push({
        pattern_type: 'W',
        score,
        confidence,
        source: 'géométrique',
        points: [
          { label: 'haut_gauche', price: hgPrice,        time: _ts(timestamps, hgIdx) },
          { label: 'bas_gauche',  price: priceA,          time: _ts(timestamps, idxA) },
          { label: 'pic_central', price: necklinePrice,   time: _ts(timestamps, necklineIdx) },
          { label: 'bas_droit',   price: priceB,          time: _ts(timestamps, idxB) },
          { label: 'breakout',    price: necklinePrice,   time: _ts(timestamps, boIdx) },
        ],
        bar_start: hgIdx,
        bar_end:   boIdx,
      });
    }
  }

  return _deduplicate(results).sort((a, b) => b.score - a.score).slice(0, 3);
}

// ── ETE (Head & Shoulders) geometric detector ─────────────────────────────────

function _detectETEGeo(ohlcv: OHLCVBar[], rules: ETERules): DetectedPattern[] {
  if (!rules.enabled || ohlcv.length < rules.minDurationBars) return [];

  const highs      = ohlcv.map(b => b.high);
  const lows       = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);

  const pivHigh = _pivotHighsGeo(highs, rules.pivotLookback);
  if (pivHigh.length < 3) return [];

  const sorted  = [...pivHigh].sort((a, b) => a[0] - b[0]);
  const results: DetectedPattern[] = [];

  // Look for triplets: S1 (left shoulder), H (head), S2 (right shoulder)
  for (let i = 0; i < sorted.length - 2; i++) {
    for (let j = i + 1; j < sorted.length - 1; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        const [idxS1, priceS1] = sorted[i];
        const [idxH,  priceH ] = sorted[j];
        const [idxS2, priceS2] = sorted[k];

        if (idxS2 - idxS1 < rules.minDurationBars) continue;

        // Head strictly above both shoulders
        if (priceH <= priceS1 || priceH <= priceS2) continue;

        const avgShoulder = (priceS1 + priceS2) / 2;
        const headLiftPct = (priceH - avgShoulder) / avgShoulder * 100;
        if (headLiftPct < rules.headLiftMin) continue;

        const symPct = Math.abs(priceS1 / priceS2 - 1) * 100;
        if (symPct > rules.shoulderSymmetryMax) continue;

        // Neckline: trough between S1-H and trough between H-S2
        const seg1 = lows.slice(idxS1, idxH + 1);
        const seg2 = lows.slice(idxH, idxS2 + 1);
        if (seg1.length === 0 || seg2.length === 0) continue;

        const nl1Price = Math.min(...seg1);
        const nl1Idx   = idxS1 + seg1.indexOf(nl1Price);
        const nl2Price = Math.min(...seg2);
        const nl2Idx   = idxH + seg2.indexOf(nl2Price);

        const nlSlopePct = Math.abs(nl1Price / nl2Price - 1) * 100;
        if (nlSlopePct > rules.necklineSlopeMax) continue;

        const deptIdx = Math.max(0, idxS1 - rules.pivotLookback * 2);
        const finIdx  = Math.min(ohlcv.length - 1, idxS2 + rules.pivotLookback * 2);

        const headBonus = Math.min(20, headLiftPct * 3);
        const symBonus  = Math.max(0, (rules.shoulderSymmetryMax - symPct) / rules.shoulderSymmetryMax * 20);
        const nlBonus   = Math.max(0, (rules.necklineSlopeMax - nlSlopePct) / rules.necklineSlopeMax * 10);
        const score     = Math.round(Math.min(100, 50 + headBonus + symBonus + nlBonus));
        const confidence: DetectedPattern['confidence'] =
          score >= 70 ? 'fort' : score >= 50 ? 'modéré' : 'faible';

        results.push({
          pattern_type: 'ETE',
          score,
          confidence,
          source: 'géométrique',
          points: [
            { label: 'départ_gauche',   price: ohlcv[deptIdx].close, time: _ts(timestamps, deptIdx) },
            { label: 'épaule_gauche',   price: priceS1,               time: _ts(timestamps, idxS1)  },
            { label: 'neckline_gauche', price: nl1Price,              time: _ts(timestamps, nl1Idx) },
            { label: 'tête',            price: priceH,                time: _ts(timestamps, idxH)   },
            { label: 'neckline_droite', price: nl2Price,              time: _ts(timestamps, nl2Idx) },
            { label: 'épaule_droite',   price: priceS2,               time: _ts(timestamps, idxS2)  },
            { label: 'fin_droite',      price: ohlcv[finIdx].close,   time: _ts(timestamps, finIdx) },
          ],
          bar_start: deptIdx,
          bar_end:   finIdx,
        });
      }
    }
  }

  return _deduplicate(results).sort((a, b) => b.score - a.score).slice(0, 2);
}

// ── Triangle Ascendant geometric detector ─────────────────────────────────────

function _detectTriangleAscGeo(ohlcv: OHLCVBar[], rules: TriangleAscRules): DetectedPattern[] {
  if (!rules.enabled || ohlcv.length < rules.minDurationBars) return [];

  const highs      = ohlcv.map(b => b.high);
  const lows       = ohlcv.map(b => b.low);
  const timestamps = ohlcv.map(b => b.time);
  const midPrice   = (_mean(highs) + _mean(lows)) / 2;
  if (midPrice <= 0) return [];

  const pivHigh = _pivotHighsGeo(highs, rules.pivotLookback);
  const pivLow  = _pivotLowsGeo(lows,  rules.pivotLookback);

  if (pivHigh.length < rules.minPivots || pivLow.length < rules.minPivots) return [];

  const regHigh = _linReg(pivHigh);
  const regLow  = _linReg(pivLow);

  // Resistance slope as % per 100 bars
  const resSlopePct = Math.abs(regHigh.slope / midPrice) * 100 * 100;
  if (resSlopePct > rules.resistanceSlopeMax) return [];

  // Support slope must be rising
  const supSlopePct = (regLow.slope / midPrice) * 100 * 100;
  if (supSlopePct < rules.supportSlopeMin) return [];

  const barStart = Math.min(pivHigh[0][0], pivLow[0][0]);
  const barEnd   = Math.max(pivHigh[pivHigh.length - 1][0], pivLow[pivLow.length - 1][0]);
  if (barEnd - barStart < rules.minDurationBars) return [];

  const touchBonus = Math.min(20, (pivHigh.length + pivLow.length - 2 * rules.minPivots) * 5);
  const r2Bonus    = (regHigh.r2 * 20) + (regLow.r2 * 20);
  const score      = Math.round(Math.min(100, 40 + r2Bonus + touchBonus));
  const confidence: DetectedPattern['confidence'] =
    score >= 70 ? 'fort' : score >= 50 ? 'modéré' : 'faible';

  const topFirst = pivHigh[0];
  const topLast  = pivHigh[pivHigh.length - 1];
  const botFirst = pivLow[0];
  const botLast  = pivLow[pivLow.length - 1];

  return [{
    pattern_type: 'Triangle Ascendant',
    score,
    confidence,
    source: 'géométrique',
    points: [
      { label: 'bas1',      price: botFirst[1], time: _ts(timestamps, botFirst[0]) },
      { label: 'top_plat',  price: topFirst[1], time: _ts(timestamps, topFirst[0]) },
      { label: 'bas2',      price: botLast[1],  time: _ts(timestamps, botLast[0])  },
      { label: 'top_plat2', price: topLast[1],  time: _ts(timestamps, topLast[0])  },
    ],
    bar_start: barStart,
    bar_end:   barEnd,
  }];
}

// ── Main geometric detection entry point ──────────────────────────────────────

export function detectPatternsGeometric(
  ohlcv: OHLCVBar[],
  rules: PatternRulesConfig,
): DetectedPattern[] {
  const all: DetectedPattern[] = [
    ..._detectRangeGeo(ohlcv, rules.Range),
    ..._detectWGeo(ohlcv, rules.W),
    ..._detectETEGeo(ohlcv, rules.ETE),
    ..._detectTriangleAscGeo(ohlcv, rules.TriangleAscendant),
  ];
  return _deduplicate(all).sort((a, b) => b.score - a.score);
}

// ── Merge template + geometric results ───────────────────────────────────────
// Template results take priority; geo results fill in where no template match exists.

export function mergeDetections(
  templateMatches: DetectedPattern[],
  geoMatches: DetectedPattern[],
): DetectedPattern[] {
  const merged = [...templateMatches];
  for (const geo of geoMatches) {
    const overlaps = merged.some(t => {
      if (t.pattern_type !== geo.pattern_type) return false;
      const overlapLen = Math.min(t.bar_end, geo.bar_end) - Math.max(t.bar_start, geo.bar_start);
      const minLen = Math.min(t.bar_end - t.bar_start, geo.bar_end - geo.bar_start);
      return overlapLen > minLen * 0.5;
    });
    if (!overlaps) merged.push(geo);
  }
  return _deduplicate(merged).sort((a, b) => b.score - a.score).slice(0, 10);
}
