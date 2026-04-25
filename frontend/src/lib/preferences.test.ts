import { describe, it, expect } from 'vitest';
import {
  computeFingerprint,
  buildPreferenceModel,
  computePreferenceScore,
  computePreferenceBonus,
  getTopInfluencingFeatures,
  MIN_FEEDBACK,
  FEATURE_KEYS,
} from './preferences';
import type { OHLCVBar } from '../api';
import type { RoiAnnotation } from './api-storage';

function mkBars(n: number, trend: 'up' | 'down' | 'flat' = 'flat'): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const startTs = 1_700_000_000;
  let price = 100;
  for (let i = 0; i < n; i++) {
    if (trend === 'up')   price += 0.5;
    if (trend === 'down') price -= 0.5;
    bars.push({
      time: startTs + i * 86400,
      open:  price,
      high:  price * 1.01,
      low:   price * 0.99,
      close: price,
      volume: 1_000_000,
    });
  }
  return bars;
}

describe('computeFingerprint', () => {
  it('returns neutral values for short series', () => {
    const fp = computeFingerprint([], [], false, []);
    expect(fp.compression).toBe(0.5);
    expect(fp.trend_slope).toBe(0.5);
  });

  it('covers all FEATURE_KEYS', () => {
    const fp = computeFingerprint(mkBars(60), [], false, []);
    for (const k of FEATURE_KEYS) {
      expect(fp).toHaveProperty(k);
      expect(typeof fp[k]).toBe('number');
    }
  });

  it('detects uptrend vs downtrend via trend_slope', () => {
    const up   = computeFingerprint(mkBars(60, 'up'),   [], false, []);
    const down = computeFingerprint(mkBars(60, 'down'), [], false, []);
    expect(up.trend_slope).toBeGreaterThan(down.trend_slope);
  });

  it('encodes pattern flags', () => {
    const fp = computeFingerprint(mkBars(60), [], true, []);
    expect(fp.is_coiling).toBe(1);
    const fp2 = computeFingerprint(mkBars(60), [], false, []);
    expect(fp2.is_coiling).toBe(0);
  });
});

describe('buildPreferenceModel', () => {
  it('returns null when feedback count below threshold', () => {
    const fp = computeFingerprint(mkBars(40), [], false, []);
    const model = buildPreferenceModel([
      { vote: 'like', fingerprint: fp, tags: [] },
    ]);
    // MIN_FEEDBACK should be >= 3 post-refactor
    expect(MIN_FEEDBACK).toBeGreaterThanOrEqual(3);
    if (MIN_FEEDBACK > 1) expect(model).toBeNull();
  });

  it('trains a model from enough examples', () => {
    const upFp   = computeFingerprint(mkBars(60, 'up'),   [], false, []);
    const downFp = computeFingerprint(mkBars(60, 'down'), [], false, []);
    const model = buildPreferenceModel([
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
    ]);
    expect(model).not.toBeNull();
    expect(model!.liked_count).toBe(3);
    expect(model!.disliked_count).toBe(3);
    expect(model!.lr_weights.length).toBe(FEATURE_KEYS.length);
  });

  it('scores liked-like inputs higher than disliked-like inputs', () => {
    const upFp   = computeFingerprint(mkBars(60, 'up'),   [], false, []);
    const downFp = computeFingerprint(mkBars(60, 'down'), [], false, []);
    const model = buildPreferenceModel([
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'like',    fingerprint: upFp,   tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
      { vote: 'dislike', fingerprint: downFp, tags: [] },
    ])!;
    expect(computePreferenceScore(upFp, model)).toBeGreaterThan(computePreferenceScore(downFp, model));
  });
});

describe('computePreferenceBonus', () => {
  it('returns 0 for neutral scores', () => {
    const upFp = computeFingerprint(mkBars(60, 'up'), [], false, []);
    // Degenerate model: all weights zero → sigmoid(bias=0) = 0.5 → bonus = 0
    const bonus = computePreferenceBonus(upFp, {
      lr_weights: new Array(FEATURE_KEYS.length).fill(0),
      lr_bias: 0,
      liked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      disliked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      liked_count: 0,
      disliked_count: 0,
    });
    expect(bonus).toBe(0);
  });

  it('is in [-25, +25]', () => {
    const fp = computeFingerprint(mkBars(60, 'up'), [], false, []);
    const model = {
      lr_weights: new Array(FEATURE_KEYS.length).fill(100),
      lr_bias: 0,
      liked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      disliked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      liked_count: 3,
      disliked_count: 0,
    };
    const bonus = computePreferenceBonus(fp, model);
    expect(bonus).toBeGreaterThanOrEqual(-25);
    expect(bonus).toBeLessThanOrEqual(25);
  });
});

describe('ROI annotation features', () => {
  it('returns neutral 0.5 when no annotation is provided', () => {
    const fp = computeFingerprint(mkBars(60, 'flat'), [], false, []);
    expect(fp.roi_duration).toBe(0.5);
    expect(fp.roi_depth).toBe(0.5);
    expect(fp.roi_age).toBe(0.5);
    expect(fp.roi_touches_top).toBe(0.5);
    expect(fp.roi_touches_bot).toBe(0.5);
    expect(fp.roi_position).toBe(0.5);
  });

  it('computes ROI features inside [0,1] when an annotation is provided', () => {
    const bars = mkBars(60, 'flat');
    const annotation: RoiAnnotation = {
      type: 'roi',
      t1: bars[10].time,
      t2: bars[40].time,
      p1: 95, p2: 105,
    };
    const fp = computeFingerprint(bars, [], false, [], annotation);
    expect(fp.roi_duration).toBeGreaterThan(0);
    expect(fp.roi_duration).toBeLessThanOrEqual(1);
    expect(fp.roi_depth).toBeGreaterThan(0);
    expect(fp.roi_depth).toBeLessThanOrEqual(1);
    expect(fp.roi_position).toBeGreaterThanOrEqual(0);
    expect(fp.roi_position).toBeLessThanOrEqual(1);
  });

  it('roi_duration reflects number of bars inside the zone', () => {
    const bars = mkBars(100, 'flat');
    const shortAnn: RoiAnnotation = { type: 'roi', t1: bars[5].time, t2: bars[10].time, p1: 95, p2: 105 };
    const longAnn:  RoiAnnotation = { type: 'roi', t1: bars[5].time, t2: bars[70].time, p1: 95, p2: 105 };
    const fpShort = computeFingerprint(bars, [], false, [], shortAnn);
    const fpLong  = computeFingerprint(bars, [], false, [], longAnn);
    expect(fpLong.roi_duration).toBeGreaterThan(fpShort.roi_duration);
  });
});

describe('getTopInfluencingFeatures', () => {
  it('returns N features sorted by absolute contribution', () => {
    const fp = computeFingerprint(mkBars(60, 'up'), [], false, []);
    const model = {
      lr_weights: FEATURE_KEYS.map((_, i) => (i === 0 ? 5 : 0.1)),
      lr_bias: 0,
      liked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      disliked_centroid: new Array(FEATURE_KEYS.length).fill(0.5),
      liked_count: 3,
      disliked_count: 0,
    };
    const top = getTopInfluencingFeatures(fp, model, 3);
    expect(top).toHaveLength(3);
    expect(Math.abs(top[0].contribution)).toBeGreaterThanOrEqual(Math.abs(top[1].contribution));
    expect(Math.abs(top[1].contribution)).toBeGreaterThanOrEqual(Math.abs(top[2].contribution));
  });
});
