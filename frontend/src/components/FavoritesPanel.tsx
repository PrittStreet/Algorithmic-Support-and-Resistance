import { useState } from 'react';
import type { Favorite } from '../lib/api-storage';
import { updateFavoriteNote, removeFavorite, favoriteKey } from '../lib/api-storage';
import { TVChartModal } from './TVChartModal';

interface Props {
  favorites: Favorite[];
  onFavoritesChange: (updated: Favorite[]) => void;
  onLoad: (fav: Favorite) => void;
}

export function FavoritesPanel({ favorites, onFavoritesChange, onLoad }: Props) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [tvModal, setTvModal] = useState<{ ticker: string; interval: string } | null>(null);

  const handleRemove = async (fav: Favorite) => {
    await removeFavorite(fav.ticker, fav.period, fav.interval);
    onFavoritesChange(favorites.filter(f => favoriteKey(f) !== favoriteKey(fav)));
  };

  const handleSaveNote = async (fav: Favorite) => {
    const next = noteDraft.trim() || null;
    await updateFavoriteNote(fav.ticker, fav.period, fav.interval, next);
    onFavoritesChange(favorites.map(f =>
      favoriteKey(f) === favoriteKey(fav) ? { ...f, note: next } : f,
    ));
    setEditingKey(null);
    setNoteDraft('');
  };

  const fmt = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short',
  });

  return (
    <>
    {tvModal && (
      <TVChartModal
        ticker={tvModal.ticker}
        interval={tvModal.interval}
        onClose={() => setTvModal(null)}
      />
    )}
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">★ Favoris</span>
          {favorites.length > 0 && (
            <span className="text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-800 px-2 py-0.5 rounded-full">
              {favorites.length}
            </span>
          )}
        </div>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5 space-y-2">
          {favorites.length === 0 ? (
            <p className="text-slate-600 text-sm italic">
              Clique sur ☆ sur un chart pour l'ajouter aux favoris.
            </p>
          ) : (
            favorites.map(fav => {
              const key = favoriteKey(fav);
              const editing = editingKey === key;
              return (
                <div key={key} className="bg-slate-800 rounded-xl px-3 py-2.5 border border-transparent hover:border-slate-600 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onLoad(fav)}
                      className="text-left min-w-0 flex-1 group"
                      title={`Charger ${fav.ticker} en ${fav.interval} / ${fav.period}`}
                    >
                      <p className="text-white text-sm font-mono font-semibold group-hover:text-yellow-400 transition-colors">{fav.ticker}</p>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {fav.interval} · {fav.period} · {fmt(fav.createdAt)}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setTvModal({ ticker: fav.ticker, interval: fav.interval })}
                        className="text-xs text-slate-600 hover:text-blue-400 px-1.5 py-1 transition-colors"
                        title={`Ouvrir ${fav.ticker} dans TradingView`}
                      >📈</button>
                      <button
                        onClick={() => { setEditingKey(key); setNoteDraft(fav.note ?? ''); }}
                        className="text-xs text-slate-600 hover:text-slate-300 px-1.5 py-1 transition-colors"
                        title="Éditer la note"
                      >✎</button>
                      <button
                        onClick={() => handleRemove(fav)}
                        className="text-xs text-slate-600 hover:text-red-400 px-1.5 py-1 transition-colors"
                        title="Retirer"
                      >✕</button>
                    </div>
                  </div>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-2">
                      <input
                        autoFocus
                        type="text"
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveNote(fav);
                          if (e.key === 'Escape') { setEditingKey(null); setNoteDraft(''); }
                        }}
                        placeholder="Note courte…"
                        maxLength={200}
                        className="flex-1 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-white text-xs focus:outline-none"
                      />
                      <button onClick={() => handleSaveNote(fav)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors">OK</button>
                    </div>
                  ) : fav.note ? (
                    <p className="text-slate-400 text-xs mt-1.5 italic truncate">{fav.note}</p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
    </>
  );
}
