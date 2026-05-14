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

export interface FundamentalResult {
  ticker: string;
  fundamental_score: number;
  sentiment: 'positif' | 'neutre' | 'négatif';
  news_summary: string;
  projections: string;
  earnings_summary: string;
  analyst_consensus: string;
  error?: string;
}

export async function* analyzeFundamentalsStream(
  tickers: string[],
  apiKey: string,
  model: string,
): AsyncGenerator<FundamentalResult> {
  const response = await fetch('/api/gemini-fundamental', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers, api_key: apiKey, model }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = (body as { detail?: string } | null)?.detail ?? response.statusText;
    throw new Error(detail);
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as FundamentalResult;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as FundamentalResult;
}

export interface TradeJournalEntry {
  id: string;
  ticker: string;
  date_in: string;
  result_pct: number | null;
  result_label: 'Win' | 'Loss' | null;
  fundamental_score: number | null;
  sentiment: 'positif' | 'neutre' | 'négatif' | null;
  news_summary: string | null;
  projections: string | null;
  earnings_summary: string | null;
  analyst_consensus: string | null;
  error: string | null;
  analyzed_at: number | null;
  created_at: number;
  is_favorite?: boolean;
}

export interface TradeInput {
  ticker: string;
  date_in: string;
  result_pct: number | null;
  result_label?: 'Win' | 'Loss' | null;
}

export async function* analyzeTradeJournalStream(
  tradeIds: string[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  force = false,
): AsyncGenerator<TradeJournalEntry> {
  const response = await fetch('/api/trade-journal/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade_ids: tradeIds, api_key: apiKey, model, force }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = (body as { detail?: string } | null)?.detail ?? response.statusText;
    throw new Error(detail);
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as TradeJournalEntry;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as TradeJournalEntry;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}

export async function testConnection(): Promise<{ ok: boolean; cache_entries: number; ts: number }> {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
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
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = (body as { detail?: string } | null)?.detail ?? response.statusText;
    throw new Error(`Erreur ${response.status}: ${detail}`);
  }
  return response.json();
}
