import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from '../api';

// ── Fingerprint ────────────────────────────────────────────────────────────────

export interface ChartFingerprint {
  compression:    number; // 0–1, 1 = consolidation très serrée
  trend_slope:    number; // 0–1, 0.5 = flat, >0.5 = haussier
  body_ratio:     number; // 0–1, ratio corps/mèche moyen sur 10 bougies
  price_pos:      number; // 0–1, position du prix dans le canal S/R
  tightness_n:    number; // score.tightness normalisé 0–1
  proximity_n:    number; // score.proximity normalisé 0–1
  accumulation_n: number; // score.accumulation normalisé 0–1
  is_coiling:     number; // 0 ou 1
  w_confirmed:    number; // 0 ou 1
  w_forming:      number; // 0 ou 1
  sr_density:     number; // 0–1, densité de niveaux (capé à 10)
}

export const FEATURE_KEYS = [
  'compression', 'trend_slope', 'body_ratio', 'price_pos',
  'tightness_n', 'proximity_n', 'accumulation_n',
  'is_coiling', 'w_confirmed', 'w_forming', 'sr_density',
] as const satisfies (keyof ChartFingerprint)[];

export const FEATURE_LABELS: Record<keyof ChartFingerprint, string> = {
  compression:    'Compression',
  trend_slope:    'Tendance haussière',
  body_ratio:     'Corps bougies',
  price_pos:      'Position S/R',
  tightness_n:    'Range étroit',
  proximity_n:    'Proximité résistance',
  accumulation_n: 'Accumulation supports',
  is_coiling:     'Coil',
  w_confirmed:    'W confirmé',
  w_forming:      'W formation',
  sr_density:     'Densité niveaux',
};

export const LIKE_TAGS = [
  'Coil serré', 'Pattern propre', 'W profond',
  'Près support', 'Trend clair', 'Range compressé', 'Setup net',
];
export const DISLIKE_TAGS = [
  'Trop volatile', 'Niveaux éparpillés', 'Range large',
  'Pattern flou', 'Tendance floue', 'Trop étendu',
];

// ── Computation ───────────────────────────────────────────────────────────────

export function computeFingerprint(
  ohlcv: OHLCVBar[],
  srLevels: SRLevel[],
  score: BreakoutScore,
  isCoiling: boolean,
  wPatterns: WPattern[],
): ChartFingerprint {
  const n = ohlcv.length;
  const empty: ChartFingerprint = {
    compression: 0.5, trend_slope: 0.5, body_ratio: 0.5, price_pos: 0.5,
    tightness_n: 0, proximity_n: 0, accumulation_n: 0,
    is_coiling: 0, w_confirmed: 0, w_forming: 0, sr_density: 0,
  };
  if (n < 10) return empty;

  // Compression : range 5 dernières bougies / range 20 précédentes
  const last5 = ohlcv.slice(-5);
  const prev20 = ohlcv.slice(-25, -5);
  const range5 = Math.max(...last5.map(b => b.high)) - Math.min(...last5.map(b => b.low));
  const range20 = prev20.length > 0
    ? Math.max(...prev20.map(b => b.high)) - Math.min(...prev20.map(b => b.low))
    : range5;
  const compression = range20 > 0 ? 1 - Math.min(range5 / range20, 1) : 0.5;

  // Tendance : régression linéaire sur 20 bougies, normalisée
  const closes20 = ohlcv.slice(-20).map(b => b.close);
  const meanClose = closes20.reduce((a, b) => a + b, 0) / closes20.length;
  const meanX = (closes20.length - 1) / 2;
  let num = 0, den = 0;
  closes20.forEach((y, x) => { num += (x - meanX) * (y - meanClose); den += (x - meanX) ** 2; });
  const slopePct = meanClose > 0 ? (den > 0 ? num / den : 0) / meanClose * 100 : 0;
  const trend_slope = Math.max(0, Math.min(1, (slopePct + 1.5) / 3));

  // Corps bougies moyen (10 dernières)
  const bodies = ohlcv.slice(-10).map(b => {
    const range = b.high - b.low;
    return range > 0 ? Math.abs(b.close - b.open) / range : 0;
  });
  const body_ratio = bodies.reduce((a, b) => a + b, 0) / bodies.length;

  // Position dans le canal S/R
  const lastPrice = ohlcv[n - 1].close;
  const supBelow = srLevels.filter(l => l.type === 'support' && l.price < lastPrice);
  const resAbove = srLevels.filter(l => l.type === 'resistance' && l.price > lastPrice);
  let price_pos = 0.5;
  if (supBelow.length > 0 && resAbove.length > 0) {
    const nearSup = Math.max(...supBelow.map(l => l.price));
    const nearRes = Math.min(...resAbove.map(l => l.price));
    const ch = nearRes - nearSup;
    price_pos = ch > 0 ? Math.max(0, Math.min(1, (lastPrice - nearSup) / ch)) : 0.5;
  }

  return {
    compression,
    trend_slope,
    body_ratio,
    price_pos,
    tightness_n:    Math.min(1, score.tightness / 40),
    proximity_n:    Math.min(1, score.proximity / 40),
    accumulation_n: Math.min(1, score.accumulation / 20),
    is_coiling:     isCoiling ? 1 : 0,
    w_confirmed:    wPatterns.some(w => w.confirmed) ? 1 : 0,
    w_forming:      wPatterns.some(w => !w.confirmed) ? 1 : 0,
    sr_density:     Math.min(1, srLevels.length / 10),
  };
}

function toVector(fp: ChartFingerprint): number[] {
  return FEATURE_KEYS.map(k => fp[k]);
}

function centroid(vecs: number[][]): number[] {
  if (vecs.length === 0) return FEATURE_KEYS.map(() => 0.5);
  const dim = vecs[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vecs) v.forEach((x, i) => { sum[i] += x; });
  return sum.map(x => x / vecs.length);
}

// ── Preference model ──────────────────────────────────────────────────────────

export interface PreferenceModel {
  liked_centroid:    number[];
  disliked_centroid: number[];
  weights:           number[]; // liked - disliked per feature
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
  feedback: Array<{ vote: 'like' | 'dislike'; fingerprint: ChartFingerprint }>,
): PreferenceModel | null {
  if (feedback.length < 3) return null;
  const liked    = feedback.filter(f => f.vote === 'like').map(f => toVector(f.fingerprint));
  const disliked = feedback.filter(f => f.vote === 'dislike').map(f => toVector(f.fingerprint));
  const liked_centroid    = centroid(liked);
  const disliked_centroid = centroid(disliked);
  const weights = liked_centroid.map((l, i) => l - disliked_centroid[i]);
  return { liked_centroid, disliked_centroid, weights, liked_count: liked.length, disliked_count: disliked.length };
}

// Returns a bonus in [-25, +25]
export function computePreferenceBonus(fp: ChartFingerprint, model: PreferenceModel): number {
  const vec = toVector(fp);
  const raw = vec.reduce((s, x, i) => s + x * model.weights[i], 0);
  const maxRaw = model.weights.reduce((s, w) => s + Math.abs(w), 0);
  if (maxRaw === 0) return 0;
  return Math.round((raw / maxRaw) * 25);
}

export function getFeatureInsights(model: PreferenceModel): FeatureInsight[] {
  return FEATURE_KEYS.map((key, i) => ({
    key,
    label:        FEATURE_LABELS[key],
    liked_avg:    model.liked_centroid[i] ?? 0.5,
    disliked_avg: model.disliked_centroid[i] ?? 0.5,
    delta:        model.weights[i] ?? 0,
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
