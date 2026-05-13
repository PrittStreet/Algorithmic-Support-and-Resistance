import { useState, useEffect } from 'react';
import { fetchStats } from '../lib/api-storage';
import type { AppStats } from '../lib/api-storage';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function StatsBar() {
  const [stats, setStats] = useState<AppStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetchStats().then(s => { setStats(s); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
        <span className="uppercase tracking-widest font-semibold text-slate-600 text-[10px]">Stockage</span>
        {stats ? (
          <>
            <span title="Taille base SQLite">
              DB <span className="text-slate-400 font-mono">{fmtBytes(stats.db_size_bytes)}</span>
            </span>
            <span className="text-slate-700">·</span>
            <span title="Requêtes Yahoo Finance depuis démarrage">
              Yahoo <span className="text-slate-400 font-mono">{stats.yahoo_requests}</span> req
            </span>
            <span className="text-slate-700">·</span>
            <span title="Entrées OHLCV en cache mémoire">
              Cache <span className="text-slate-400 font-mono">{stats.cache_entries}</span>
            </span>
          </>
        ) : (
          <span className="text-slate-600 italic">{loading ? '…' : 'indisponible'}</span>
        )}
      </div>
      <button
        onClick={load}
        disabled={loading}
        className="text-slate-600 hover:text-slate-400 transition-colors text-xs shrink-0"
        title="Rafraîchir les stats"
      >
        ↻
      </button>
    </div>
  );
}
