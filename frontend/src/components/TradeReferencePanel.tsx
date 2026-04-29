import { useState } from 'react';
import type { TradeReference, PatternAnnotation } from '../lib/api-storage';
import { createTradeReference, deleteTradeReference } from '../lib/api-storage';
import { tradingViewUrl } from '../lib/tradingview';

const INTERVALS = ['1d', '1wk', '1h', '30m', '15m'];

interface Props {
  refs: TradeReference[];
  annotations: PatternAnnotation[];
  onRefsChange: (refs: TradeReference[]) => void;
  onAnnotate: (ref: TradeReference) => void;
}

export function TradeReferencePanel({ refs, annotations, onRefsChange, onAnnotate }: Props) {
  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [ticker, setTicker] = useState('');
  const [dateIn, setDateIn] = useState('');
  const [dateOut, setDateOut] = useState('');
  const [interval, setInterval] = useState('1d');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const annotationCountByRef = new Map<string, number>();
  for (const ann of annotations) {
    annotationCountByRef.set(ann.tradeRefId, (annotationCountByRef.get(ann.tradeRefId) ?? 0) + 1);
  }

  const patternTypesByRef = new Map<string, string[]>();
  for (const ann of annotations) {
    if (!patternTypesByRef.has(ann.tradeRefId)) patternTypesByRef.set(ann.tradeRefId, []);
    patternTypesByRef.get(ann.tradeRefId)!.push(ann.patternType);
  }

  // Aggregate stats
  const totalAnnotations = annotations.length;
  const patternCounts = new Map<string, number>();
  for (const ann of annotations) {
    patternCounts.set(ann.patternType, (patternCounts.get(ann.patternType) ?? 0) + 1);
  }
  // Max annotations sharing the same pattern type (determines if engine is reliable)
  const maxSameTypeCount = patternCounts.size > 0
    ? Math.max(...Array.from(patternCounts.values()))
    : 0;

  const handleAdd = async () => {
    if (!ticker || !dateIn || !dateOut) { setError('Ticker et dates requis'); return; }
    if (dateOut <= dateIn) { setError('Date de sortie doit être après la date d\'entrée'); return; }
    setSaving(true);
    setError(null);
    try {
      const ref = await createTradeReference(ticker.toUpperCase(), dateIn, dateOut, interval, notes || null);
      onRefsChange([ref, ...refs]);
      setShowForm(false);
      setTicker(''); setDateIn(''); setDateOut(''); setNotes('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[TradeReference] Save failed:', e);
      setError(`Erreur: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTradeReference(id);
    onRefsChange(refs.filter(r => r.id !== id));
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-semibold text-sm">TRADE REFERENCE</span>
          {totalAnnotations > 0 && (
            <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700/50 px-1.5 py-0.5 rounded-full">
              {totalAnnotations} pattern{totalAnnotations > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">

          {/* Stats résumé */}
          {totalAnnotations > 0 && (
            <div className="flex flex-wrap gap-1 px-1 py-1.5 border-b border-slate-800">
              {Array.from(patternCounts.entries()).map(([type, count]) => (
                <span key={type} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                  {type} ×{count}
                </span>
              ))}
            </div>
          )}

          {/* Bouton ajouter */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full text-xs bg-blue-700 hover:bg-blue-600 text-white py-1.5 rounded-lg transition-colors font-medium"
            >
              + Ajouter une référence
            </button>
          )}

          {/* Formulaire d'ajout */}
          {showForm && (
            <div className="bg-slate-800 rounded-xl p-3 space-y-2 border border-slate-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">Nouveau trade de référence</span>
                <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-0.5">Ticker</label>
                  <input
                    type="text"
                    value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    placeholder="AAPL"
                    className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 focus:border-blue-500 outline-none uppercase"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-0.5">Unité de temps</label>
                  <select
                    value={interval}
                    onChange={e => setInterval(e.target.value)}
                    className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 focus:border-blue-500 outline-none"
                  >
                    {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-0.5">Date entrée</label>
                  <input
                    type="date"
                    value={dateIn}
                    onChange={e => setDateIn(e.target.value)}
                    className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-0.5">Date sortie</label>
                  <input
                    type="date"
                    value={dateOut}
                    onChange={e => setDateOut(e.target.value)}
                    className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-0.5">Note (optionnel)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Double fond avant earnings…"
                  className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-slate-600 focus:border-blue-500 outline-none"
                  maxLength={200}
                />
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {saving ? 'Sauvegarde…' : 'Sauvegarder'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setError(null); }}
                  className="text-slate-400 hover:text-white text-xs px-3 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Liste des références */}
          {refs.length === 0 && !showForm && (
            <p className="text-xs text-slate-500 text-center py-2">
              Ajoute des trades de référence pour apprendre tes setups.
            </p>
          )}

          {refs.map(ref => {
            const annCount = annotationCountByRef.get(ref.id) ?? 0;
            const types = patternTypesByRef.get(ref.id) ?? [];
            return (
              <div key={ref.id} className="bg-slate-800 rounded-xl border border-slate-700 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-bold text-sm">{ref.ticker}</span>
                      <span className="text-slate-500 text-xs font-mono">{ref.interval}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono">
                      {ref.dateIn} → {ref.dateOut}
                    </div>
                    {ref.notes && (
                      <div className="text-xs text-slate-500 mt-0.5 truncate" title={ref.notes}>{ref.notes}</div>
                    )}
                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {types.map(t => (
                          <span key={t} className="text-xs bg-blue-900/50 text-blue-300 border border-blue-700/40 px-1.5 py-0 rounded-full">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={tradingViewUrl(ref.ticker, ref.interval)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-600 hover:text-blue-400 px-1.5 py-1 transition-colors"
                      title={`Ouvrir ${ref.ticker} sur TradingView`}
                    >TV</a>
                    <button
                      onClick={() => onAnnotate(ref)}
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded-lg transition-colors"
                      title="Annoter ce trade"
                    >
                      {annCount > 0 ? '✏ Éditer' : '+ Annoter'}
                    </button>
                    <button
                      onClick={() => handleDelete(ref.id)}
                      className="text-slate-600 hover:text-red-400 text-xs px-1 transition-colors"
                      title="Supprimer"
                    >✕</button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Aide pattern types */}
          {refs.length > 0 && totalAnnotations === 0 && (
            <div className="mt-1 p-2 bg-slate-800/50 rounded-xl border border-slate-700/50 text-xs text-slate-500">
              Clique sur "+ Annoter" pour dessiner les structures sur chaque trade.
            </div>
          )}

          {totalAnnotations > 0 && maxSameTypeCount < 3 && (
            <div className="mt-1 p-2 bg-yellow-950/30 rounded-xl border border-yellow-800/30 text-xs text-yellow-600">
              Ajoute au moins 3 annotations du même type pour une détection fiable ({maxSameTypeCount}/3).
            </div>
          )}

          {maxSameTypeCount >= 3 && (
            <div className="mt-1 p-2 bg-green-950/30 rounded-xl border border-green-800/30 text-xs text-green-600">
              Moteur actif — les templates sont appliqués à tous les graphiques.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
