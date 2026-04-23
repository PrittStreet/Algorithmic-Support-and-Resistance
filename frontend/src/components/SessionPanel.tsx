import { useState } from 'react';
import { getSessions, saveSession, deleteSession } from '../lib/storage';
import type { Session } from '../lib/storage';
import type { OHLCVBar, SRLevel } from '../api';
import type { AnalysisParams } from '../sr';

interface Props {
  hasData: boolean;
  period: string;
  interval: string;
  params: AnalysisParams;
  results: { ticker: string; ohlcv: OHLCVBar[]; sr_levels: SRLevel[] }[];
  onRestore: (session: Session) => void;
}

export function SessionPanel({ hasData, period, interval, params, results, onRestore }: Props) {
  const [sessions, setSessions] = useState(getSessions);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);

  const refresh = () => setSessions(getSessions());

  const handleSave = () => {
    if (!name.trim()) return;
    saveSession(name.trim(), period, interval, params, results);
    setName('');
    setSaving(false);
    refresh();
  };

  const handleDelete = (id: string) => {
    deleteSession(id);
    refresh();
  };

  const fmt = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl mb-8 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Sessions</span>
          {sessions.length > 0 && (
            <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">{sessions.length}</span>
          )}
        </div>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5 space-y-4">
          {hasData && (
            saving ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
                  placeholder="Nom de la session (ex: NASDAQ 3mo swing)"
                  className="flex-1 bg-slate-800 border border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                />
                <button onClick={handleSave} className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap">
                  Sauvegarder
                </button>
                <button onClick={() => setSaving(false)} className="text-slate-500 hover:text-slate-300 px-2 py-2 transition-colors">✕</button>
              </div>
            ) : (
              <button
                onClick={() => setSaving(true)}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg transition-colors"
              >
                + Sauvegarder cette vue ({results.length} ticker{results.length > 1 ? 's' : ''})
              </button>
            )
          )}

          {sessions.length === 0 ? (
            <p className="text-slate-600 text-sm italic">Aucune session sauvegardée.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{s.name}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {fmt(s.createdAt)} · {s.period} / {s.interval} · {s.snapshot.length} tickers
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onRestore(s)}
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Restaurer
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs text-slate-600 hover:text-red-400 px-2 py-1.5 transition-colors"
                      title="Supprimer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
