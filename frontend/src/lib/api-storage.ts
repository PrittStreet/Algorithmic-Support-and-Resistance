import type { AnalysisParams } from '../sr';
import type { OHLCVBar, SRLevel, BreakoutScore, TradeJournalEntry, TradeInput } from '../api';

export interface TickerList {
  id: string;
  name: string;
  tickers: string[];
  createdAt: number;
}

export interface Preset {
  id: string;
  name: string;
  params: AnalysisParams;
  createdAt: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  period: string;
  interval: string;
  params: AnalysisParams;
  tickers: string[];
  snapshot: SessionEntry[];
}

export interface SessionEntry {
  ticker: string;
  ohlcv?: OHLCVBar[];
  sr_levels: SRLevel[];
  score?: BreakoutScore;
}

export interface Favorite {
  ticker: string;
  period: string;
  interval: string;
  note: string | null;
  createdAt: number;
}

export function favoriteKey(f: { ticker: string; period: string; interval: string }): string {
  return `${f.ticker}|${f.period}|${f.interval}`;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Lists ─────────────────────────────────────────────────────────────────────

export async function getLists(): Promise<TickerList[]> {
  return api<TickerList[]>('GET', '/lists');
}

export async function saveList(name: string, tickers: string[]): Promise<TickerList> {
  return api<TickerList>('POST', '/lists', { name, tickers });
}

export async function updateList(id: string, patch: Partial<Pick<TickerList, 'name' | 'tickers'>>) {
  return api<void>('PUT', `/lists/${id}`, patch);
}

export async function deleteList(id: string) {
  return api<void>('DELETE', `/lists/${id}`);
}

// ── Presets ───────────────────────────────────────────────────────────────────

export async function getPresets(): Promise<Preset[]> {
  return api<Preset[]>('GET', '/presets');
}

export async function savePreset(name: string, params: AnalysisParams): Promise<Preset> {
  return api<Preset>('POST', '/presets', { name, params });
}

export async function deletePreset(id: string) {
  return api<void>('DELETE', `/presets/${id}`);
}

export async function renamePreset(id: string, name: string): Promise<void> {
  return api<void>('PATCH', `/presets/${id}`, { name });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface AppStats {
  db_size_bytes: number;
  yahoo_requests: number;
  cache_entries: number;
}

export async function fetchStats(): Promise<AppStats> {
  return api<AppStats>('GET', '/stats');
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<Session[]> {
  return api<Session[]>('GET', '/sessions');
}

export async function saveSession(
  name: string,
  period: string,
  interval: string,
  params: AnalysisParams,
  tickers: string[],
  snapshot: SessionEntry[],
  keepOhlcv = false,
): Promise<Session> {
  const lightSnapshot = keepOhlcv
    ? snapshot
    : snapshot.map(({ ohlcv: _ohlcv, ...rest }) => rest);
  return api<Session>('POST', '/sessions', { name, period, interval, params, tickers, snapshot: lightSnapshot });
}

export async function deleteSession(id: string) {
  return api<void>('DELETE', `/sessions/${id}`);
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export async function getFavorites(): Promise<Favorite[]> {
  return api<Favorite[]>('GET', '/favorites');
}

export async function upsertFavorite(
  ticker: string,
  period: string,
  interval: string,
  note?: string | null,
): Promise<Favorite> {
  return api<Favorite>('POST', '/favorites', { ticker, period, interval, note: note ?? null });
}

export async function updateFavoriteNote(
  ticker: string,
  period: string,
  interval: string,
  note: string | null,
): Promise<void> {
  return api<void>('PATCH', `/favorites/${ticker}/${period}/${interval}`, { note });
}

export async function removeFavorite(ticker: string, period: string, interval: string): Promise<void> {
  return api<void>('DELETE', `/favorites/${ticker}/${period}/${interval}`);
}

// ── Trade Journal ─────────────────────────────────────────────────────────────

export async function getTradeJournal(): Promise<TradeJournalEntry[]> {
  return api<TradeJournalEntry[]>('GET', '/trade-journal');
}

export async function createTradeJournalEntries(trades: TradeInput[]): Promise<TradeJournalEntry[]> {
  return api<TradeJournalEntry[]>('POST', '/trade-journal', trades);
}

export async function deleteTradeJournalEntry(id: string): Promise<void> {
  return api<void>('DELETE', `/trade-journal/${id}`);
}

export async function clearTradeJournal(): Promise<void> {
  return api<void>('DELETE', '/trade-journal');
}

export async function updateTradeFavorite(id: string, isFavorite: boolean): Promise<TradeJournalEntry> {
  return api<TradeJournalEntry>('PATCH', `/trade-journal/${id}/favorite`, { is_favorite: isFavorite });
}

// ── One-time migration from localStorage → SQLite ─────────────────────────────

export async function migrateFromLocalStorage(): Promise<void> {
  if (localStorage.getItem('sr_migrated_v2')) return;

  const readLocal = <T>(key: string): T[] => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]'); }
    catch { return []; }
  };

  const lists    = readLocal<TickerList>('sr_ticker_lists');
  const presets  = readLocal<Preset>('sr_presets');
  const sessions = readLocal<Session>('sr_sessions');

  if (lists.length === 0 && presets.length === 0 && sessions.length === 0) {
    localStorage.setItem('sr_migrated_v2', 'true');
    return;
  }

  try {
    await api<{ migrated: number }>('POST', '/migrate', { lists, presets, sessions });
    localStorage.setItem('sr_migrated_v2', 'true');
    console.log('[migration] localStorage → SQLite done');
  } catch (e) {
    console.warn('[migration] Failed, will retry next load:', e);
  }
}
