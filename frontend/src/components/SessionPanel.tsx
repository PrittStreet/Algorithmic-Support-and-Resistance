import { useState, useEffect } from 'react';
import { getSessions, saveSession, deleteSession } from '../lib/api-storage';
import type { Session, SessionEntry } from '../lib/api-storage';
import type { AnalysisParams } from '../sr';

interface Props {
  hasData: boolean;
  period: string;
  interval: string;
  params: AnalysisParams;
  results: SessionEntry[];
  onRestore: (session: Session) => void;
}

export function SessionPanel({ hasData, period, interval, params, results, onRestore }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => getSessions().then(setSessions);
  useEffect(() => { refresh(); }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaveError(null);
    try {
      const tickers = results.map(r => r.ticker);
      await saveSession(name.trim(), period, interval, params, tickers, results);
      setName('');
      setSaving(false);
      refresh();
    } catch {
      setSaveError('Erreur lors de la sauvegarde. Le serveur est-il démarré ?');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId === id) {
      await deleteSession(id);
      refresh();
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const fmt = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={e => { setName(e.target.value); setSaveError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
                    placeholder="Nom de la session (ex: NYSE 1d swing)"
                    className="flex-1 bg-slate-800 border border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                  />
                  <button onClick={handleSave} className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap">
                    Sauvegarder
                  </button>
                  <button onClick={() => { setSaving(false); setSaveError(null); }} className="text-slate-500 hover:text-slate-300 px-2 py-2 transition-colors">✕</button>
                </div>
                {saveError && (
                  <p className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{saveError}</p>
                )}
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
                      {fmt(s.createdAt)} · {s.period} / {s.interval} · {s.tickers.length} tickers
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onRestore(s)}
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Restaurer
                    </button>
                    {confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1.5 rounded-lg transition-colors"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-xs text-slate-600 hover:text-red-400 px-2 py-1.5 transition-colors"
                        title="Supprimer"
                      >
                        ✕
                      </button>
                    )}
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
