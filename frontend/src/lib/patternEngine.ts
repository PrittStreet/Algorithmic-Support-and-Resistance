import type { OHLCVBar, SRLevel } from '../api';
import type { PatternTemplate, PatternRulesConfig, DetectedPattern } from './patternLearning';
import {
  detectWithTemplates,
  detectPatternsGeometric,
  mergeDetections,
} from './patternLearning';

// ── CandidateTrade ─────────────────────────────────────────────────────────────
// Interface unifiée pour un trade potentiel détecté.
// Étend DetectedPattern avec contexte S/R, scores décomposés et hint screenshot.

export interface SRContext {
  nearest_resistance: SRLevel | null;
  nearest_support: SRLevel | null;
  proximity_to_resistance_pct: number; // % entre le dernier prix et la résistance la plus proche
}

export interface ScreenshotHint {
  dateStart: string;   // ISO YYYY-MM-DD
  dateEnd: string;     // ISO YYYY-MM-DD
  priceMin: number;
  priceMax: number;
}

export interface CandidateTrade extends DetectedPattern {
  ticker: string;
  score_template: number;   // 0–100 : meilleur score template pour ce pattern
  score_geo: number;        // 0–100 : meilleur score géométrique pour ce pattern
  score_sr: number;         // 0–100 : score S/R de base (tightness+proximity+accumulation)
  score_total: number;      // 0–100 : score combiné final
  sr_context: SRContext;
  screenshot_hint: ScreenshotHint;
  // Futur : score_gemini?: number;
}

// ── PatternEngine ──────────────────────────────────────────────────────────────

export interface DetectOptions {
  tolerance?: number;          // 1.0–3.0, défaut 1.5
  srLevels?: SRLevel[];        // niveaux S/R déjà calculés par analyzeOhlcv
  srBaseScore?: number;        // score S/R brut (tightness+proximity+accumulation)
  ticker?: string;             // ticker courant (pour CandidateTrade.ticker)
}

export class PatternEngine {
  /**
   * Détecte tous les patterns (templates + géométrie) et retourne des CandidateTrade
   * avec scores décomposés et contexte S/R enrichi.
   */
  detect(
    ohlcv: OHLCVBar[],
    templates: PatternTemplate[],
    rules: PatternRulesConfig,
    opts: DetectOptions = {},
  ): CandidateTrade[] {
    const tolerance = opts.tolerance ?? 1.5;
    const srLevels  = opts.srLevels  ?? [];
    const srBase    = opts.srBaseScore ?? 0;
    const ticker    = opts.ticker ?? '';

    const templateMatches = detectWithTemplates(ohlcv, templates, tolerance);
    const geoMatches      = detectPatternsGeometric(ohlcv, rules, tolerance);
    const merged          = mergeDetections(templateMatches, geoMatches);

    const lastPrice = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : 0;

    return merged.map(pattern => {
      // Retrouver les scores sources individuels pour ce pattern
      const bestTemplate = templateMatches
        .filter(m => m.pattern_type === pattern.pattern_type && _overlaps(m, pattern))
        .reduce((best, m) => m.score > best ? m.score : best, 0);

      const bestGeo = geoMatches
        .filter(m => m.pattern_type === pattern.pattern_type && _overlaps(m, pattern))
        .reduce((best, m) => m.score > best ? m.score : best, 0);

      const pattern_bonus =
        Math.round(bestTemplate * 0.4) + Math.round(bestGeo * 0.2);
      const score_total = Math.min(100, Math.round(srBase * 0.6) + pattern_bonus);

      const sr_context = _buildSRContext(srLevels, lastPrice);
      const screenshot_hint = _buildScreenshotHint(ohlcv, pattern);

      return {
        ...pattern,
        ticker,
        score_template: bestTemplate,
        score_geo:      bestGeo,
        score_sr:       srBase,
        score_total,
        sr_context,
        screenshot_hint,
      } satisfies CandidateTrade;
    });
  }

  /**
   * Trie les candidats par score_total décroissant et retourne le top N.
   */
  rank(candidates: CandidateTrade[], topN = 10): CandidateTrade[] {
    return [...candidates]
      .sort((a, b) => b.score_total - a.score_total)
      .slice(0, topN);
  }

  // Stub pour future intégration Gemini Vision API
  async enrichWithGemini(
    _candidates: CandidateTrade[],
    _apiKey: string,
  ): Promise<CandidateTrade[]> {
    throw new Error('enrichWithGemini: not yet implemented — voir geminiClient.ts');
  }
}

// Singleton partagé — utiliser directement dans analyzeOhlcv / App.tsx
export const patternEngine = new PatternEngine();

// ── Helpers privés ─────────────────────────────────────────────────────────────

function _overlaps(a: DetectedPattern, b: DetectedPattern): boolean {
  const len = Math.min(a.bar_end, b.bar_end) - Math.max(a.bar_start, b.bar_start);
  const min = Math.min(a.bar_end - a.bar_start, b.bar_end - b.bar_start);
  return len > min * 0.5;
}

function _buildSRContext(srLevels: SRLevel[], lastPrice: number): SRContext {
  const above = srLevels.filter(l => l.type === 'resistance' && l.price > lastPrice);
  const below = srLevels.filter(l => l.type === 'support'    && l.price < lastPrice);

  const nearest_resistance = above.length > 0
    ? above.reduce((a, b) => a.price < b.price ? a : b)
    : null;
  const nearest_support = below.length > 0
    ? below.reduce((a, b) => a.price > b.price ? a : b)
    : null;

  const proximity_to_resistance_pct = nearest_resistance && lastPrice > 0
    ? Math.abs(nearest_resistance.price - lastPrice) / lastPrice * 100
    : Infinity;

  return { nearest_resistance, nearest_support, proximity_to_resistance_pct };
}

function _buildScreenshotHint(ohlcv: OHLCVBar[], pattern: DetectedPattern): ScreenshotHint {
  const startBar = Math.max(0, pattern.bar_start - 5);
  const endBar   = Math.min(ohlcv.length - 1, pattern.bar_end + 5);
  const window   = ohlcv.slice(startBar, endBar + 1);

  const priceMin = window.length > 0 ? Math.min(...window.map(b => b.low))  * 0.995 : 0;
  const priceMax = window.length > 0 ? Math.max(...window.map(b => b.high)) * 1.005 : 0;

  const fmt = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const dateStart = window.length > 0 ? fmt(window[0].time)                 : '';
  const dateEnd   = window.length > 0 ? fmt(window[window.length - 1].time) : '';

  return { dateStart, dateEnd, priceMin, priceMax };
}
