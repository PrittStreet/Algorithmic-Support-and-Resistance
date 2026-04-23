// Async API client — replaces localStorage-based storage.ts
// All data lives in SQLite via the FastAPI backend.

import type { ChartFingerprint } from './preferences';
import type { AnalysisParams } from '../sr';

// ── Shared types (identical to storage.ts for compatibility) ──────────────────

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
  ohlcv?: { time: number; open: number; high: number; low: number; close: number }[];
  sr_levels: { price: number; start_time: number; end_time: number; type: string; touches: number }[];
  w_patterns?: unknown[];
  score?: unknown;
  is_coiling?: boolean;
}

export interface FeedbackEntry {
  id: string;
  ticker: string;
  createdAt: number;
  vote: 'like' | 'dislike';
  tags: string[];
  fingerprint: ChartFingerprint;
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
): Promise<Session> {
  // Strip OHLCV to keep sessions compact even in SQLite
  const lightSnapshot = snapshot.map(({ ohlcv: _ohlcv, ...rest }) => rest);
  return api<Session>('POST', '/sessions', { name, period, interval, params, tickers, snapshot: lightSnapshot });
}

export async function deleteSession(id: string) {
  return api<void>('DELETE', `/sessions/${id}`);
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export async function getFeedback(): Promise<FeedbackEntry[]> {
  return api<FeedbackEntry[]>('GET', '/feedback');
}

export async function upsertFeedback(
  ticker: string,
  vote: 'like' | 'dislike',
  tags: string[],
  fingerprint: ChartFingerprint,
): Promise<FeedbackEntry> {
  return api<FeedbackEntry>('POST', '/feedback', { ticker, vote, tags, fingerprint });
}

export async function removeFeedback(ticker: string) {
  return api<void>('DELETE', `/feedback/${ticker}`);
}

export async function clearFeedback() {
  return api<void>('DELETE', '/feedback');
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
  const feedback = readLocal<FeedbackEntry>('sr_feedback');

  if (lists.length === 0 && presets.length === 0 && sessions.length === 0 && feedback.length === 0) {
    localStorage.setItem('sr_migrated_v2', 'true');
    return;
  }

  try {
    await api<{ migrated: number }>('POST', '/migrate', { lists, presets, sessions, feedback });
    localStorage.setItem('sr_migrated_v2', 'true');
    console.log('[migration] localStorage → SQLite done');
  } catch (e) {
    console.warn('[migration] Failed, will retry next load:', e);
  }
}
