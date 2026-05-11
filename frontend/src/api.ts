export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SRLevel {
  price: number;
  upper?: number;       // borne haute de la zone (price * (1 + dif/100))
  lower?: number;       // borne basse de la zone  (price * (1 - dif/100))
  start_time: number;
  end_time: number;
  type: 'support' | 'resistance';
  touches: number;
  broken_out?: boolean;  // close > upper (résistance) ou close < lower (support)
  re_entered?: boolean;  // après broken_out, repassé de l'autre côté → zone obsolète
  obsolete?: boolean;
}

export interface BreakoutScore {
  total: number;        // 0–100
  tightness: number;    // 0–40 : range étroit
  proximity: number;    // 0–40 : prix proche de la résistance
  accumulation: number; // 0–20 : asymétrie touches support/résistance
  pattern_bonus: number;
  label: 'fort' | 'modéré' | 'faible' | null;
}

export interface TickerResult {
  ticker: string;
  ohlcv: OHLCVBar[];
  sr_levels: SRLevel[];
  score: BreakoutScore;
}

export interface FetchParams {
  tickers: string[];
  period: string;
  interval: string;
}

export async function fetchOhlcv(
  params: FetchParams,
  signal?: AbortSignal,
): Promise<{ results: { ticker: string; ohlcv: OHLCVBar[]; from_cache: boolean }[] }> {
  const response = await fetch('/api/ohlcv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!response.ok) throw new Error(`API error: ${response.statusText}`);
  return response.json();
}
