/// <reference lib="webworker" />
import { analyzeOhlcv } from '../sr';
import type { AnalysisParams } from '../sr';
import type { OHLCVBar } from '../api';
import type { ChartFingerprint, PreferenceModel } from '../lib/preferences';
import { computePreferenceScore } from '../lib/preferences';

export interface AutotuneInput {
  ohlcvByTicker: Record<string, OHLCVBar[]>;
  likedTickers:    string[];          // tickers that the user liked
  dislikedTickers: string[];          // tickers the user disliked
  preferenceModel: PreferenceModel | null;  // optional — boosts combos aligned with preferences
  sampleSize: number;                 // max tickers to evaluate per combo
  grid: {
    dif:           number[];
    pivot_order:   number[];
    min_touches:   number[];
  };
}

export interface AutotuneCombo {
  params:         AnalysisParams;
  avgPrecision:   number;   // mean sr_precision across sampled charts
  likeMinusDislike: number; // avg(score) on likes − avg(score) on dislikes
  prefAgreement: number;    // mean preference score on sampled charts (0.5 = neutral)
  composite:     number;    // weighted combination used for ranking
  levelsCount:   number;    // avg nb of S/R levels per chart
}

export interface AutotuneProgress {
  kind: 'progress';
  done:  number;
  total: number;
}

export interface AutotuneDone {
  kind:  'done';
  combos: AutotuneCombo[];  // top 3
  evaluated: number;
}

export type AutotuneMessage = AutotuneProgress | AutotuneDone;

function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr.slice();
  const shuffled = arr.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, max);
}

function evaluateCombo(
  params: AnalysisParams,
  samples: { ticker: string; ohlcv: OHLCVBar[] }[],
  likedSet: Set<string>,
  dislikedSet: Set<string>,
  preferenceModel: PreferenceModel | null,
): AutotuneCombo {
  let sumPrecision = 0;
  let sumLevelsCount = 0;
  let sumPrefScore = 0;
  let likeScoreSum = 0, likeN = 0;
  let dislikeScoreSum = 0, dislikeN = 0;
  let n = 0;
  let prefN = 0;

  for (const { ticker, ohlcv } of samples) {
    const r = analyzeOhlcv(ohlcv, params);
    sumPrecision   += r.fingerprint.sr_precision;
    sumLevelsCount += r.sr_levels.length;
    n++;

    if (likedSet.has(ticker))    { likeScoreSum    += r.score.total; likeN++; }
    if (dislikedSet.has(ticker)) { dislikeScoreSum += r.score.total; dislikeN++; }

    if (preferenceModel) {
      sumPrefScore += computePreferenceScore(r.fingerprint as ChartFingerprint, preferenceModel);
      prefN++;
    }
  }

  const avgPrecision = n > 0 ? sumPrecision / n : 0;
  const levelsCount  = n > 0 ? sumLevelsCount / n : 0;
  const likeAvg    = likeN    > 0 ? likeScoreSum    / likeN    : 0;
  const dislikeAvg = dislikeN > 0 ? dislikeScoreSum / dislikeN : 0;
  const likeMinusDislike = (likeN > 0 && dislikeN > 0) ? (likeAvg - dislikeAvg) / 100 : 0;
  const prefAgreement = prefN > 0 ? sumPrefScore / prefN : 0.5;

  // Composite: precision is always useful; ML signals are used when they exist.
  // Normalize so each component is in roughly [0, 1].
  // Penalize combos that produce too few or too many levels per chart (sweet spot: 2–8).
  const levelsPenalty =
    levelsCount < 1 ? -0.3 :
    levelsCount > 12 ? -0.2 :
    0;

  const composite =
    0.45 * avgPrecision +
    0.30 * (likeMinusDislike > 0 ? likeMinusDislike : 0) +
    0.25 * (prefAgreement - 0.5) * 2 +  // rescaled to [-1, 1]
    levelsPenalty;

  return { params, avgPrecision, likeMinusDislike, prefAgreement, composite, levelsCount };
}

self.onmessage = (e: MessageEvent<AutotuneInput>) => {
  const input = e.data;
  const combos: AnalysisParams[] = [];
  for (const dif of input.grid.dif) {
    for (const pivot_order of input.grid.pivot_order) {
      for (const min_touches of input.grid.min_touches) {
        combos.push({ dif, pivot_order, min_touches });
      }
    }
  }

  const allTickers = Object.keys(input.ohlcvByTicker);
  const sampled = sample(allTickers, input.sampleSize);
  const samples = sampled.map(t => ({ ticker: t, ohlcv: input.ohlcvByTicker[t] }));
  const likedSet    = new Set(input.likedTickers);
  const dislikedSet = new Set(input.dislikedTickers);

  const results: AutotuneCombo[] = [];
  const total = combos.length;
  for (let i = 0; i < combos.length; i++) {
    results.push(evaluateCombo(combos[i], samples, likedSet, dislikedSet, input.preferenceModel));
    (self as DedicatedWorkerGlobalScope).postMessage({
      kind: 'progress', done: i + 1, total,
    } satisfies AutotuneProgress);
  }

  results.sort((a, b) => b.composite - a.composite);
  (self as DedicatedWorkerGlobalScope).postMessage({
    kind: 'done',
    combos: results.slice(0, 3),
    evaluated: combos.length,
  } satisfies AutotuneDone);
};
