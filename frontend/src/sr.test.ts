import { describe, it, expect } from 'vitest';
import { analyzeOhlcv } from './sr';
import type { OHLCVBar } from './api';

function mkBars(closes: number[], startTs = 1_700_000_000): OHLCVBar[] {
  return closes.map((c, i) => ({
    time: startTs + i * 86400,
    open:  c,
    high:  c * 1.01,
    low:   c * 0.99,
    close: c,
    volume: 1_000_000,
  }));
}

function mkBarsWithHL(points: { h: number; l: number; c: number }[], startTs = 1_700_000_000): OHLCVBar[] {
  return points.map((p, i) => ({
    time: startTs + i * 86400,
    open:  p.c,
    high:  p.h,
    low:   p.l,
    close: p.c,
    volume: 1_000_000,
  }));
}

const PARAMS = { dif: 1.5, pivot_order: 3, min_touches: 2 };

describe('analyzeOhlcv — empty / short inputs', () => {
  it('returns empty analysis for too-few bars', () => {
    const r = analyzeOhlcv(mkBars([100, 101, 102]), PARAMS);
    expect(r.sr_levels).toEqual([]);
    expect(r.w_patterns).toEqual([]);
    expect(r.score.total).toBe(0);
    expect(r.is_coiling).toBe(false);
  });

  it('handles empty OHLCV', () => {
    const r = analyzeOhlcv([], PARAMS);
    expect(r.sr_levels).toEqual([]);
  });
});

describe('analyzeOhlcv — pivot detection', () => {
  it('detects a repeated resistance from obvious highs', () => {
    // Series with 3 clear peaks at ~110
    const pts = [
      { h: 100, l: 95,  c: 98 }, { h: 102, l: 96,  c: 100 },
      { h: 104, l: 98,  c: 101 }, { h: 110, l: 103, c: 109 }, // peak 1
      { h: 105, l: 100, c: 102 }, { h: 101, l: 95,  c: 97 },
      { h: 99,  l: 94,  c: 96 },  { h: 103, l: 97,  c: 101 },
      { h: 108, l: 102, c: 106 }, { h: 110.5, l: 104, c: 110 }, // peak 2 (~110)
      { h: 106, l: 100, c: 102 }, { h: 102, l: 96,  c: 98 },
      { h: 100, l: 94,  c: 95 },  { h: 104, l: 98,  c: 102 },
      { h: 109, l: 103, c: 107 }, { h: 110.2, l: 104, c: 109 }, // peak 3 (~110)
      { h: 105, l: 99,  c: 100 }, { h: 98,  l: 92,  c: 94 },
      { h: 96,  l: 90,  c: 92 },  { h: 94,  l: 88,  c: 90 },
    ];
    const r = analyzeOhlcv(mkBarsWithHL(pts), PARAMS);
    const res = r.sr_levels.filter(l => l.type === 'resistance');
    expect(res.length).toBeGreaterThan(0);
    // At least one resistance in the 108-112 band
    expect(res.some(l => l.price >= 108 && l.price <= 112)).toBe(true);
  });
});

describe('breakout score', () => {
  it('is 0 when there are no S/R levels', () => {
    const r = analyzeOhlcv(mkBars([100, 101, 102, 103, 104, 105, 106]), PARAMS);
    expect(r.score.total).toBe(0);
  });

  it('stays within 0..100 bounds', () => {
    const pts = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + Math.sin(i / 5) * 5;
      return { h: base + 1, l: base - 1, c: base };
    });
    const r = analyzeOhlcv(mkBarsWithHL(pts), PARAMS);
    expect(r.score.total).toBeGreaterThanOrEqual(0);
    expect(r.score.total).toBeLessThanOrEqual(100);
    expect(r.score.tightness).toBeGreaterThanOrEqual(0);
    expect(r.score.proximity).toBeGreaterThanOrEqual(0);
    expect(r.score.accumulation).toBeGreaterThanOrEqual(0);
  });
});

describe('matched_patterns', () => {
  it('returns empty array when no templates provided', () => {
    const pts = Array.from({ length: 60 }, (_, i) => {
      const base = 100 + i * 0.3;
      return { h: base + 1, l: base - 1, c: base };
    });
    const r = analyzeOhlcv(mkBarsWithHL(pts), PARAMS);
    expect(r.matched_patterns).toEqual([]);
  });
});
