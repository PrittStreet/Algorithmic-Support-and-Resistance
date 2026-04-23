export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SRLevel {
  price: number;
  start_time: number;
  end_time: number;
  type: 'support' | 'resistance';
  touches: number;
}

export interface WPattern {
  low1_price: number;
  low1_time: number;
  low2_price: number;
  low2_time: number;
  neckline_price: number;
  neckline_time: number;
  confirmed: boolean;
}

export interface BreakoutScore {
  total: number;        // 0–100
  tightness: number;    // 0–40 : range étroit
  proximity: number;    // 0–40 : prix proche de la résistance
  accumulation: number; // 0–20 : asymétrie touches support/résistance
  label: 'fort' | 'modéré' | 'faible' | null;
}

export interface TickerResult {
  ticker: string;
  ohlcv: OHLCVBar[];
  sr_levels: SRLevel[];
  w_patterns: WPattern[];
  score: BreakoutScore;
  is_coiling: boolean;
}

export interface FetchParams {
  tickers: string[];
  period: string;
  interval: string;
}

export async function fetchOhlcv(
  params: FetchParams
): Promise<{ results: { ticker: string; ohlcv: OHLCVBar[]; from_cache: boolean }[] }> {
  const response = await fetch('/api/ohlcv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`API error: ${response.statusText}`);
  return response.json();
}
