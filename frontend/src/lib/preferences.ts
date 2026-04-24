import type { OHLCVBar, SRLevel, WPattern } from '../api';

// ── Fingerprint ────────────────────────────────────────────────────────────────

export interface ChartFingerprint {
  // Prix / structure
  compression:      number; // 0–1, 1 = consolidation serrée (range 5 bars << range 20)
  trend_slope:      number; // 0–1, 0.5 = flat, >0.5 = haussier (régression 20 bars)
  trend_consistency:number; // 0–1, % bougies dans le sens de la tendance linéaire
  body_ratio:       number; // 0–1, ratio corps/mèche moyen sur 10 bougies
  price_pos:        number; // 0–1, position dans le canal S/R le plus proche
  hh_hl_score:      number; // 0–1, ratio HH+HL sur les derniers pivots

  // Patterns
  is_coiling:       number; // 0 ou 1
  w_confirmed:      number; // 0 ou 1
  w_forming:        number; // 0 ou 1

  // Base / consolidation
  base_duration_n:  number; // 0–1, durée base en bars depuis le pic (cap 80)
  base_depth:       number; // 0–1, 1 = correction légère (<10%), 0 = profonde (>40%)
  atr_pct:          number; // 0–1, ATR14/prix normalisé (0 = calme, 1 = trop volatile)
  atr_contraction:  number; // 0–1, 1 = ATR5 << ATR20 (contraction de volatilité)

  // Volume
  volume_trend:     number; // 0–1, 1 = volume décroissant sur 20 bars (assèchement bullish)
  up_vol_ratio:     number; // 0–1, volume haussier / total (0.5 = neutre)
  vol_contraction:  number; // 0–1, 1 = volume 5 bars << 20 bars (base qui s'assèche)

  // Qualité S/R
  sr_precision:     number; // 0–1, précision des touches (1 = niveaux nets)
  nearsup_touches:  number; // 0–1, nb touches support proche (cap 6)
  nearres_touches:  number; // 0–1, nb touches résistance proche (cap 6)

  // Contexte macro
  pos_52w:          number; // 0–1, position dans le range 52 semaines disponibles
  bars_since_ath_n: number; // 0–1, 1 = near ATH dans les données disponibles
}

export const FEATURE_KEYS = [
  'compression', 'trend_slope', 'trend_consistency', 'body_ratio', 'price_pos', 'hh_hl_score',
  'is_coiling', 'w_confirmed', 'w_forming',
  'base_duration_n', 'base_depth', 'atr_pct', 'atr_contraction',
  'volume_trend', 'up_vol_ratio', 'vol_contraction',
  'sr_precision', 'nearsup_touches', 'nearres_touches',
  'pos_52w', 'bars_since_ath_n',
] as const satisfies (keyof ChartFingerprint)[];

export const FEATURE_LABELS: Record<keyof ChartFingerprint, string> = {
  compression:       'Compression prix',
  trend_slope:       'Tendance haussière',
  trend_consistency: 'Consistance tendance',
  body_ratio:        'Corps bougies',
  price_pos:         'Position S/R',
  hh_hl_score:       'Structure HH/HL',
  is_coiling:        'Coil',
  w_confirmed:       'W confirmé',
  w_forming:         'W formation',
  base_duration_n:   'Durée de base',
  base_depth:        'Légèreté correction',
  atr_pct:           'Volatilité ATR',
  atr_contraction:   'Contraction ATR',
  volume_trend:      'Volume décroissant',
  up_vol_ratio:      'Volume haussier',
  vol_contraction:   'Assèchement volume',
  sr_precision:      'Précision niveaux S/R',
  nearsup_touches:   'Touches support proche',
  nearres_touches:   'Touches résistance proche',
  pos_52w:           'Position 52 semaines',
  bars_since_ath_n:  'Proximité ATH',
};

export const LIKE_TAGS = [
  'Volume en assèchement',
  'Range qui se comprime',
  'Tendance propre HH/HL',
  'Base mature',
  'Correction légère',
  'Près de la résistance',
  'Support bien défendu',
  'Volatilité maîtrisée',
];
export const DISLIKE_TAGS = [
  'Trop volatile',
  'Volume croissant (distrib)',
  'Action choppy',
  'Correction profonde',
  'Niveaux imprécis',
  'Trop étendu',
  'Tendance baissière',
  'Base trop courte',
];

type TagMapping = Array<{ feature: keyof ChartFingerprint; dir: 1 | -1 }>;

export const TAG_FEATURE_MAP: Record<string, TagMapping> = {
  // ── LIKE ──────────────────────────────────────────────────────────────────────
  'Volume en assèchement':  [{ feature: 'vol_contraction', dir: 1 }, { feature: 'volume_trend',      dir: 1 }],
  'Range qui se comprime':  [{ feature: 'compression',     dir: 1 }, { feature: 'atr_contraction',   dir: 1 }],
  'Tendance propre HH/HL':  [{ feature: 'hh_hl_score',     dir: 1 }, { feature: 'trend_consistency', dir: 1 }],
  'Base mature':            [{ feature: 'base_duration_n', dir: 1 }],
  'Correction légère':      [{ feature: 'base_depth',      dir: 1 }],
  'Près de la résistance':  [{ feature: 'price_pos',       dir: 1 }],
  'Support bien défendu':   [{ feature: 'nearsup_touches', dir: 1 }, { feature: 'sr_precision',      dir: 1 }],
  'Volatilité maîtrisée':   [{ feature: 'atr_pct',         dir: -1 }],
  // ── DISLIKE ───────────────────────────────────────────────────────────────────
  'Trop volatile':             [{ feature: 'atr_pct',         dir: 1 }],
  'Volume croissant (distrib)':[{ feature: 'vol_contraction', dir: -1 }, { feature: 'up_vol_ratio',    dir: -1 }],
  'Action choppy':             [{ feature: 'hh_hl_score',     dir: -1 }, { feature: 'body_ratio',      dir: -1 }],
  'Correction profonde':       [{ feature: 'base_depth',      dir: -1 }],
  'Niveaux imprécis':          [{ feature: 'sr_precision',    dir: -1 }],
  'Trop étendu':               [{ feature: 'pos_52w',         dir: 1  }, { feature: 'base_duration_n', dir: -1 }],
  'Tendance baissière':        [{ feature: 'hh_hl_score',     dir: -1 }, { feature: 'trend_slope',     dir: -1 }],
  'Base trop courte':          [{ feature: 'base_duration_n', dir: -1 }],
};

export const MIN_FEEDBACK = 1;
const TAG_WEIGHT = 0.5;

// ── Helpers ────────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

// ── Computation ───────────────────────────────────────────────────────────────

export function computeFingerprint(
  ohlcv: OHLCVBar[],
  srLevels: SRLevel[],
  isCoiling: boolean,
  wPatterns: WPattern[],
): ChartFingerprint {
  const n = ohlcv.length;
  const empty: ChartFingerprint = {
    compression: 0.5, trend_slope: 0.5, trend_consistency: 0.5,
    body_ratio: 0.5, price_pos: 0.5, hh_hl_score: 0.5,
    is_coiling: 0, w_confirmed: 0, w_forming: 0,
    base_duration_n: 0.5, base_depth: 0.5, atr_pct: 0.5, atr_contraction: 0.5,
    volume_trend: 0.5, up_vol_ratio: 0.5, vol_contraction: 0.5,
    sr_precision: 0.5, nearsup_touches: 0, nearres_touches: 0,
    pos_52w: 0.5, bars_since_ath_n: 0.5,
  };
  if (n < 10) return empty;

  const lastPrice = ohlcv[n - 1].close;

  // ── Compression: range 5 bars vs 20 bars précédents ──────────────────────────
  const last5  = ohlcv.slice(-5);
  const prev20 = ohlcv.slice(-25, -5);
  const range5  = Math.max(...last5.map(b => b.high))  - Math.min(...last5.map(b => b.low));
  const range20 = prev20.length > 0
    ? Math.max(...prev20.map(b => b.high)) - Math.min(...prev20.map(b => b.low))
    : range5;
  const compression = range20 > 0 ? 1 - Math.min(range5 / range20, 1) : 0.5;

  // ── Trend slope + consistency (régression 20 bars) ────────────────────────────
  const closes20 = ohlcv.slice(-20).map(b => b.close);
  const meanClose = avg(closes20);
  const meanX     = (closes20.length - 1) / 2;
  let num = 0, den = 0;
  closes20.forEach((y, x) => { num += (x - meanX) * (y - meanClose); den += (x - meanX) ** 2; });
  const slopePct = meanClose > 0 ? (den > 0 ? num / den : 0) / meanClose * 100 : 0;
  const trend_slope = Math.max(0, Math.min(1, (slopePct + 1.5) / 3));

  const trendDir = slopePct >= 0 ? 1 : -1;
  let consistent = 0;
  for (let i = 1; i < closes20.length; i++) {
    if (trendDir > 0 && closes20[i] > closes20[i - 1]) consistent++;
    if (trendDir < 0 && closes20[i] < closes20[i - 1]) consistent++;
  }
  const trend_consistency = consistent / (closes20.length - 1);

  // ── Body ratio (10 dernières bougies) ─────────────────────────────────────────
  const bodies = ohlcv.slice(-10).map(b => {
    const r = b.high - b.low;
    return r > 0 ? Math.abs(b.close - b.open) / r : 0;
  });
  const body_ratio = avg(bodies);

  // ── Position S/R + touches niveaux proches ────────────────────────────────────
  const supBelow = srLevels.filter(l => l.type === 'support'    && l.price < lastPrice);
  const resAbove = srLevels.filter(l => l.type === 'resistance' && l.price > lastPrice);
  let price_pos = 0.5;
  if (supBelow.length > 0 && resAbove.length > 0) {
    const nearSupPrice = Math.max(...supBelow.map(l => l.price));
    const nearResPrice = Math.min(...resAbove.map(l => l.price));
    const ch = nearResPrice - nearSupPrice;
    price_pos = ch > 0 ? Math.max(0, Math.min(1, (lastPrice - nearSupPrice) / ch)) : 0.5;
  }
  const nearSup = [...supBelow].sort((a, b) => b.price - a.price)[0];
  const nearRes = [...resAbove].sort((a, b) => a.price - b.price)[0];
  const nearsup_touches = nearSup ? Math.min(1, nearSup.touches / 6) : 0;
  const nearres_touches = nearRes ? Math.min(1, nearRes.touches / 6) : 0;

  // ── HH/HL score (structure de pivots) ────────────────────────────────────────
  const pivotWin = 2;
  const swingHighs: number[] = [];
  const swingLows:  number[] = [];
  for (let i = pivotWin; i < n - pivotWin; i++) {
    const h = ohlcv[i].high;
    const l = ohlcv[i].low;
    let isH = true, isL = true;
    for (let d = 1; d <= pivotWin; d++) {
      if (ohlcv[i - d].high >= h || ohlcv[i + d].high >= h) isH = false;
      if (ohlcv[i - d].low  <= l || ohlcv[i + d].low  <= l) isL = false;
    }
    if (isH) swingHighs.push(h);
    if (isL) swingLows.push(l);
  }
  let hhhlNum = 0, hhhlDen = 0;
  const lastH = swingHighs.slice(-5);
  const lastL = swingLows.slice(-5);
  for (let i = 1; i < lastH.length; i++) { hhhlDen++; if (lastH[i] > lastH[i - 1]) hhhlNum++; }
  for (let i = 1; i < lastL.length; i++) { hhhlDen++; if (lastL[i] > lastL[i - 1]) hhhlNum++; }
  const hh_hl_score = hhhlDen > 0 ? hhhlNum / hhhlDen : 0.5;

  // ── Base duration + depth ─────────────────────────────────────────────────────
  const lookback = Math.min(120, n);
  const win = ohlcv.slice(-lookback);
  let peakClose = 0, peakIdx = 0;
  win.forEach((b, i) => { if (b.close > peakClose) { peakClose = b.close; peakIdx = i; } });
  const barsSincePeak  = win.length - 1 - peakIdx;
  const base_duration_n = Math.min(1, barsSincePeak / 80);
  const afterPeak  = win.slice(peakIdx);
  const troughClose = Math.min(...afterPeak.map(b => b.close));
  const depth = peakClose > 0 ? (peakClose - troughClose) / peakClose : 0;
  const base_depth = Math.max(0, Math.min(1, 1 - (depth - 0.10) / 0.30));

  // ── ATR (14 / 5 / 20) ────────────────────────────────────────────────────────
  const trs: number[] = [];
  for (let i = Math.max(1, n - 25); i < n; i++) {
    trs.push(Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
      Math.abs(ohlcv[i].low  - ohlcv[i - 1].close),
    ));
  }
  const atr14  = trs.length >= 14 ? avg(trs.slice(-14)) : avg(trs);
  const atr5v  = trs.length >= 5  ? avg(trs.slice(-5))  : atr14;
  const atr20v = trs.length >= 20 ? avg(trs.slice(-20)) : atr14;
  const atr_pct = lastPrice > 0 && atr14 > 0
    ? Math.max(0, Math.min(1, (atr14 / lastPrice) / 0.05))
    : 0.5;
  const atr_contraction = atr20v > 0
    ? Math.max(0, Math.min(1, 1 - atr5v / atr20v))
    : 0.5;

  // ── S/R precision ─────────────────────────────────────────────────────────────
  let totalPrec = 0, precCount = 0;
  for (const level of srLevels) {
    if (level.price <= 0) continue;
    const threshold = level.price * 0.015;
    const nearBars = ohlcv.filter(b =>
      Math.abs((level.type === 'support' ? b.low : b.high) - level.price) <= threshold,
    );
    if (nearBars.length < 2) continue;
    const exts = nearBars.map(b => level.type === 'support' ? b.low : b.high);
    const m    = avg(exts);
    const std  = Math.sqrt(avg(exts.map(v => (v - m) ** 2))) / level.price;
    totalPrec += Math.max(0, Math.min(1, 1 - std / 0.005));
    precCount++;
  }
  const sr_precision = precCount > 0 ? totalPrec / precCount : 0.5;

  // ── Position dans le range 52 semaines ───────────────────────────────────────
  const bars252 = ohlcv.slice(-252);
  const min52   = Math.min(...bars252.map(b => b.low));
  const max52   = Math.max(...bars252.map(b => b.high));
  const pos_52w = max52 > min52
    ? Math.max(0, Math.min(1, (lastPrice - min52) / (max52 - min52)))
    : 0.5;

  // ── Bars since ATH (dans les données disponibles) ─────────────────────────────
  let athClose = 0, athIdx = 0;
  ohlcv.forEach((b, i) => { if (b.close > athClose) { athClose = b.close; athIdx = i; } });
  const bars_since_ath_n = Math.max(0, Math.min(1, 1 - (n - 1 - athIdx) / 60));

  // ── Volume ────────────────────────────────────────────────────────────────────
  let volume_trend = 0.5, up_vol_ratio = 0.5, vol_contraction = 0.5;
  const vols20 = ohlcv.slice(-20).filter(b => b.volume != null && b.volume! > 0);
  if (vols20.length >= 5) {
    const volValues = vols20.map(b => b.volume!);
    const meanVol   = avg(volValues);
    const meanXv    = (volValues.length - 1) / 2;
    let numV = 0, denV = 0;
    volValues.forEach((y, x) => { numV += (x - meanXv) * (y - meanVol); denV += (x - meanXv) ** 2; });
    const slopeVol = meanVol > 0 ? (denV > 0 ? numV / denV : 0) / meanVol : 0;
    volume_trend = Math.max(0, Math.min(1, 0.5 - slopeVol / 0.06));

    const totalVol = vols20.reduce((s, b) => s + b.volume!, 0);
    const upVol    = vols20.filter(b => b.close >= b.open).reduce((s, b) => s + b.volume!, 0);
    up_vol_ratio   = totalVol > 0 ? upVol / totalVol : 0.5;

    const vols5 = ohlcv.slice(-5).filter(b => b.volume != null && b.volume! > 0);
    const avg5v = vols5.length > 0 ? avg(vols5.map(b => b.volume!)) : meanVol;
    vol_contraction = meanVol > 0 ? Math.max(0, Math.min(1, 1 - avg5v / meanVol)) : 0.5;
  }

  return {
    compression,
    trend_slope,
    trend_consistency,
    body_ratio,
    price_pos,
    hh_hl_score,
    is_coiling:       isCoiling ? 1 : 0,
    w_confirmed:      wPatterns.some(w => w.confirmed) ? 1 : 0,
    w_forming:        wPatterns.some(w => !w.confirmed) ? 1 : 0,
    base_duration_n,
    base_depth,
    atr_pct,
    atr_contraction,
    volume_trend,
    up_vol_ratio,
    vol_contraction,
    sr_precision,
    nearsup_touches,
    nearres_touches,
    pos_52w,
    bars_since_ath_n,
  };
}

function toVector(fp: ChartFingerprint): number[] {
  const raw = fp as unknown as Record<string, unknown>;
  return FEATURE_KEYS.map(k => {
    const v = raw[k];
    return typeof v === 'number' ? v : 0.5;
  });
}

function weightedCentroid(items: { vec: number[]; w: number }[]): number[] {
  const neutral = FEATURE_KEYS.map(() => 0.5);
  if (items.length === 0) return neutral;
  const totalW = items.reduce((s, { w }) => s + w, 0);
  if (totalW === 0) return neutral;
  const sum = new Array<number>(items[0].vec.length).fill(0);
  for (const { vec, w } of items) vec.forEach((x, i) => { sum[i] += x * w; });
  return sum.map(x => x / totalW);
}

// ── Logistic regression ───────────────────────────────────────────────────────

const LR = { rate: 0.1, epochs: 600, lambda: 0.05 };

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

function trainLR(
  examples: { vec: number[]; label: number; w: number }[],
): { weights: number[]; bias: number } {
  const D = examples[0]?.vec.length ?? 0;
  if (D === 0) return { weights: [], bias: 0 };
  const weights = new Array<number>(D).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < LR.epochs; epoch++) {
    const dw = new Array<number>(D).fill(0);
    let db = 0, totalW = 0;
    for (const { vec, label, w } of examples) {
      const err = (sigmoid(vec.reduce((s, x, i) => s + x * weights[i], bias)) - label) * w;
      vec.forEach((x, i) => { dw[i] += err * x; });
      db += err;
      totalW += w;
    }
    if (totalW === 0) break;
    for (let i = 0; i < D; i++) {
      weights[i] -= LR.rate * (dw[i] / totalW + LR.lambda * weights[i]);
    }
    bias -= LR.rate * db / totalW;
  }
  return { weights, bias };
}

// ── Preference model ──────────────────────────────────────────────────────────

export interface PreferenceModel {
  lr_weights:        number[]; // logistic regression coefficients
  lr_bias:           number;
  liked_centroid:    number[]; // for bar display in PreferencePanel
  disliked_centroid: number[]; // for bar display
  liked_count:       number;
  disliked_count:    number;
}

export interface FeatureInsight {
  key:          string;
  label:        string;
  liked_avg:    number;
  disliked_avg: number;
  delta:        number; // positive = tu préfères les valeurs hautes
}

export function buildPreferenceModel(
  feedback: Array<{ vote: 'like' | 'dislike'; fingerprint: ChartFingerprint; tags?: string[] }>,
): PreferenceModel | null {
  if (feedback.length < MIN_FEEDBACK) return null;

  const likedItems:    { vec: number[]; w: number }[] = [];
  const dislikedItems: { vec: number[]; w: number }[] = [];

  for (const f of feedback) {
    const vec = toVector(f.fingerprint);
    if (f.vote === 'like') likedItems.push({ vec, w: 1 });
    else                   dislikedItems.push({ vec, w: 1 });

    for (const tag of (f.tags ?? [])) {
      const mapping = TAG_FEATURE_MAP[tag];
      if (!mapping) continue;
      const pseudo = FEATURE_KEYS.map(() => 0.5);
      for (const { feature, dir } of mapping) {
        const idx = FEATURE_KEYS.findIndex(k => k === feature);
        if (idx >= 0) pseudo[idx] = dir > 0 ? 0.85 : 0.15;
      }
      if (f.vote === 'like') likedItems.push({ vec: pseudo, w: TAG_WEIGHT });
      else                   dislikedItems.push({ vec: pseudo, w: TAG_WEIGHT });
    }
  }

  const liked_centroid    = weightedCentroid(likedItems);
  const disliked_centroid = weightedCentroid(dislikedItems);

  // Build full training set: liked → label 1, disliked → label 0
  const allExamples = [
    ...likedItems.map(({ vec, w }) => ({ vec, label: 1, w })),
    ...dislikedItems.map(({ vec, w }) => ({ vec, label: 0, w })),
  ];
  const { weights: lr_weights, bias: lr_bias } = trainLR(allExamples);

  const liked_count    = feedback.filter(f => f.vote === 'like').length;
  const disliked_count = feedback.filter(f => f.vote === 'dislike').length;
  return { lr_weights, lr_bias, liked_centroid, disliked_centroid, liked_count, disliked_count };
}

// Returns sigmoid probability 0–1 (>0.5 = setup favori, <0.5 = défavorisé)
export function computePreferenceScore(fp: ChartFingerprint, model: PreferenceModel): number {
  const vec = toVector(fp);
  return sigmoid(vec.reduce((s, x, i) => s + x * model.lr_weights[i], model.lr_bias));
}

// Returns additive bonus in [-25, +25] for sort compatibility
export function computePreferenceBonus(fp: ChartFingerprint, model: PreferenceModel): number {
  return Math.round((computePreferenceScore(fp, model) - 0.5) * 50);
}

export interface TopFeature {
  label:        string;
  contribution: number; // (x - 0.5) * lr_weight — logit delta vs neutre
  value:        number; // feature value 0–1
}

// Top N features that most influenced the score for a specific chart
export function getTopInfluencingFeatures(
  fp: ChartFingerprint,
  model: PreferenceModel,
  n = 3,
): TopFeature[] {
  const vec = toVector(fp);
  return FEATURE_KEYS
    .map((key, i) => ({
      label:        FEATURE_LABELS[key],
      contribution: (vec[i] - 0.5) * model.lr_weights[i],
      value:        vec[i],
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, n);
}

export function getFeatureInsights(model: PreferenceModel): FeatureInsight[] {
  return FEATURE_KEYS.map((key, i) => ({
    key,
    label:        FEATURE_LABELS[key],
    liked_avg:    model.liked_centroid[i] ?? 0.5,
    disliked_avg: model.disliked_centroid[i] ?? 0.5,
    delta:        model.lr_weights[i] ?? 0,  // LR weight = discriminative power
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
