import { useState, useEffect } from 'react';
import type { FetchParams } from '../api';
import type { TickerList } from '../lib/storage';

interface TickerFormProps {
  onFetch: (params: FetchParams) => void;
  loading: boolean;
  loadedTickers: Set<string>;
  selectedList: TickerList | null;
  activeTimeframe: { period: string; interval: string } | null;
  onClearAll: () => void;
}

const PERIODS = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'];
const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk'];

export function TickerForm({ onFetch, loading, loadedTickers, selectedList, activeTimeframe, onClearAll }: TickerFormProps) {
  const [tickersInput, setTickersInput] = useState('AAPL, MSFT, NVDA, GOOGL');
  const [period, setPeriod] = useState('3mo');
  const [interval, setInterval] = useState('1d');

  useEffect(() => {
    if (selectedList) setTickersInput(selectedList.tickers.join(', '));
  }, [selectedList]);

  const parsedTickers = tickersInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const sameTimeframe = !!activeTimeframe &&
    activeTimeframe.period === period && activeTimeframe.interval === interval;
  const alreadyLoaded = sameTimeframe ? parsedTickers.filter(t => loadedTickers.has(t)) : [];
  const toFetch = parsedTickers.filter(t => !alreadyLoaded.includes(t));
  const utWillChange = !!activeTimeframe && !sameTimeframe && loadedTickers.size > 0;

  const handleFetch = (e: React.FormEvent) => {
    e.preventDefault();
    const tickers = toFetch.length > 0 ? toFetch : parsedTickers;
    if (tickers.length === 0) return;
    onFetch({ tickers: utWillChange ? parsedTickers : tickers, period, interval });
  };

  const inputClass = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 mb-4">
      <form onSubmit={handleFetch}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Données Yahoo Finance
          </p>
          {activeTimeframe && loadedTickers.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                Chargé : <span className="text-blue-400 font-mono">{activeTimeframe.interval} · {activeTimeframe.period}</span>
                <span className="text-slate-500 ml-1">({loadedTickers.size} ticker{loadedTickers.size > 1 ? 's' : ''})</span>
              </span>
              <button
                type="button"
                onClick={onClearAll}
                className="text-xs text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-700 px-2 py-0.5 rounded transition-colors"
              >
                Tout décharger
              </button>
            </div>
          )}
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Tickers <span className="text-slate-500">(séparés par des virgules)</span>
          </label>
          <textarea
            value={tickersInput}
            onChange={e => setTickersInput(e.target.value)}
            placeholder="AAPL, MSFT, NVDA, TSLA"
            rows={3}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-mono resize-none"
          />
          {parsedTickers.length > 0 && loadedTickers.size > 0 && (
            <p className="text-xs mt-1.5 text-slate-500">
              {parsedTickers.length} tickers
              {alreadyLoaded.length > 0 && <span className="text-green-500"> · {alreadyLoaded.length} déjà chargés</span>}
              {toFetch.length > 0 && <span className="text-amber-400"> · {toFetch.length} à fetcher</span>}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Période</label>
            <select value={period} onChange={e => setPeriod(e.target.value)} className={inputClass}>
              {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Intervalle</label>
            <select value={interval} onChange={e => setInterval(e.target.value)} className={inputClass}>
              {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        {utWillChange && (
          <p className="text-xs text-amber-400 mb-3">
            L'UT change ({activeTimeframe!.interval} · {activeTimeframe!.period} → {interval} · {period}) — les données actuelles seront remplacées.
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading
            ? 'Chargement...'
            : utWillChange
            ? `Charger en ${interval} · ${period}`
            : toFetch.length > 0 && loadedTickers.size > 0
            ? `Fetcher ${toFetch.length} ticker${toFetch.length > 1 ? 's' : ''} manquants`
            : 'Charger les données'}
        </button>
      </form>
    </div>
  );
}
