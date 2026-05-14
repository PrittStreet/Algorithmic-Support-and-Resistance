import { useState } from 'react';
import type { FundamentalResult } from '../api';
import { analyzeFundamentalsStream } from '../api';

interface Props {
  topTickers: string[];
  onResults: (r: Record<string, FundamentalResult>) => void;
  apiKey: string;
  onApiKeyChange: (k: string) => void;
  model: string;
  onModelChange: (m: string) => void;
}

const MODELS = [
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite' },
];

export function FundamentalPanel({ topTickers, onResults, apiKey, onApiKeyChange, model, onModelChange }: Props) {
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(0);
  const [total, setTotal]     = useState(0);
  const [errors, setErrors]   = useState<string[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [localResults, setLocalResults] = useState<Record<string, FundamentalResult>>({});
  const [retrying, setRetrying]         = useState<Set<string>>(new Set());

  const count = Math.min(topTickers.length, 20);
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleAnalyze = async () => {
    if (!apiKey.trim()) { setError('Clé API Gemini requise (onglet Data)'); return; }
    if (count === 0)    { setError('Aucun ticker chargé'); return; }

    setError(null);
    setErrors([]);
    setLoading(true);
    setDone(0);
    setTotal(count);
    setLocalResults({});

    const resultMap: Record<string, FundamentalResult> = {};

    try {
      for await (const result of analyzeFundamentalsStream(topTickers.slice(0, 20), apiKey.trim(), model)) {
        resultMap[result.ticker] = result;
        if (result.error) setErrors(prev => [...prev, `${result.ticker}: ${result.error}`]);
        setDone(d => d + 1);
        setLocalResults({ ...resultMap });
        onResults({ ...resultMap });
      }
    } catch (e) {
      setError((e as Error).message ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryTicker = async (ticker: string) => {
    if (!apiKey.trim()) return; // apiKey vient des props
    setRetrying(prev => new Set(prev).add(ticker));
    try {
      for await (const result of analyzeFundamentalsStream([ticker], apiKey.trim(), model)) {
        setLocalResults(prev => {
          const next = { ...prev, [ticker]: result };
          onResults(next);
          return next;
        });
        if (result.error) {
          setErrors(prev => [...prev.filter(e => !e.startsWith(`${ticker}:`)), `${ticker}: ${result.error}`]);
        } else {
          setErrors(prev => prev.filter(e => !e.startsWith(`${ticker}:`)));
        }
      }
    } finally {
      setRetrying(prev => { const s = new Set(prev); s.delete(ticker); return s; });
    }
  };

  const handleClear = () => {
    onResults({});
    setDone(0);
    setTotal(0);
    setErrors([]);
    setError(null);
    setLocalResults({});
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Analyse Fondamentale IA
      </p>

      {/* Clé API */}
      <div className="mb-3">
        <span className="text-xs text-slate-400 block mb-1">Clé API Gemini</span>
        <div className="flex gap-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => onApiKeyChange(e.target.value)}
            placeholder="AIza..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setShowKey(s => !s)}
            title={showKey ? 'Masquer' : 'Afficher'}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-xs hover:text-slate-200 transition-colors"
          >{showKey ? '●' : '○'}</button>
        </div>
      </div>

      {/* Sélecteur modèle */}
      <div className="mb-3">
        <span className="text-xs text-slate-400 block mb-1">Modèle</span>
        <select
          value={model}
          onChange={e => onModelChange(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="text-xs text-slate-600 mt-1 font-mono">{model}</p>
      </div>

      {/* Info count */}
      <p className="text-xs text-slate-600 mb-3 leading-relaxed">
        Analysera les{' '}
        <span className="text-slate-400 font-semibold">{count}</span>
        {' '}meilleur{count > 1 ? 's' : ''} ticker{count > 1 ? 's' : ''} par score technique
        {count === 20 && ' (max 20)'}.
        <br />
        <span className="text-slate-700">Recherche web Google incluse. Retry auto sur surcharge.</span>
      </p>

      {/* Bouton */}
      <button
        onClick={loading ? undefined : handleAnalyze}
        disabled={loading}
        className={`w-full py-2 rounded-xl text-xs font-semibold transition-colors ${
          loading
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {loading ? `Analyse en cours… ${done}/${total}` : '▶ Analyser les fondamentaux'}
      </button>

      {/* Barre de progression */}
      {loading && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{done} / {total} analysés</span>
            <span className="font-mono text-slate-400">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          {done > 0 && (
            <p className="text-xs text-slate-600 text-right">
              {total - done} restant{total - done > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Succès */}
      {!loading && done > 0 && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-green-400">
            ✓ {done} ticker{done > 1 ? 's' : ''} analysés
            {errors.length > 0 && (
              <span className="text-amber-400 ml-1">· {errors.length} erreur{errors.length > 1 ? 's' : ''}</span>
            )}
          </span>
          <button
            onClick={handleClear}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >Effacer</button>
        </div>
      )}

      {/* Tableau résultats WIN/LOSS */}
      {Object.keys(localResults).length > 0 && (
        <div className="mt-3 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-slate-500">
                <th className="text-left px-2 py-1 font-medium">Ticker</th>
                <th className="text-center px-2 py-1 font-medium">Score</th>
                <th className="text-center px-2 py-1 font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(localResults).map(r => {
                const tag = r.error
                  ? { label: 'ERR', cls: 'bg-slate-700 text-slate-400' }
                  : r.sentiment === 'positif'
                    ? { label: 'WIN', cls: 'bg-green-900/60 text-green-300' }
                    : r.sentiment === 'négatif'
                      ? { label: 'LOSS', cls: 'bg-red-900/60 text-red-300' }
                      : { label: '—', cls: 'bg-slate-700/60 text-slate-400' };
                return (
                  <tr key={r.ticker} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="px-2 py-1 font-mono text-slate-300 font-semibold">{r.ticker}</td>
                    <td className="px-2 py-1 text-center text-slate-400 font-mono">
                      {r.error ? '—' : r.fundamental_score}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className={`px-1.5 py-0.5 rounded font-semibold text-xs ${tag.cls}`}>
                          {retrying.has(r.ticker) ? '…' : tag.label}
                        </span>
                        {r.error && !retrying.has(r.ticker) && (
                          <button
                            onClick={() => handleRetryTicker(r.ticker)}
                            title="Relancer l'analyse"
                            className="text-slate-500 hover:text-blue-400 transition-colors"
                          >↺</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Erreurs par ticker */}
      {errors.length > 0 && !loading && (
        <div className="mt-2 space-y-1">
          {errors.map((e, i) => (
            <div key={i} className="text-xs text-amber-400/80 bg-amber-950/30 border border-amber-900/50 rounded-lg px-2 py-1 font-mono leading-snug">
              {e}
            </div>
          ))}
        </div>
      )}

      {/* Erreur globale */}
      {error && (
        <div className="mt-2 text-xs text-red-400 bg-red-950/50 border border-red-900 rounded-lg px-2 py-1.5 leading-relaxed">
          {error}
        </div>
      )}
    </div>
  );
}
