import { useState } from 'react';
import { getLists, saveList, updateList, deleteList } from '../lib/storage';
import type { TickerList } from '../lib/storage';

interface Props {
  selectedId: string | null;
  loadedTickers: Set<string>;
  onSelect: (list: TickerList) => void;
}

export function ListPanel({ selectedId, loadedTickers, onSelect }: Props) {
  const [lists, setLists] = useState(getLists);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newTickers, setNewTickers] = useState('');

  const refresh = () => setLists(getLists());

  const handleCreate = () => {
    if (!newName.trim() || !newTickers.trim()) return;
    const tickers = newTickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    saveList(newName.trim(), tickers);
    setNewName('');
    setNewTickers('');
    setCreating(false);
    refresh();
  };

  const handleRename = (id: string, name: string) => {
    updateList(id, { name });
    setEditing(null);
    refresh();
  };

  const handleDelete = (id: string) => {
    deleteList(id);
    refresh();
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl mb-4 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Mes listes</span>
          {lists.length > 0 && (
            <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">{lists.length}</span>
          )}
          {selectedId && (
            <span className="text-xs text-blue-400">
              · {lists.find(l => l.id === selectedId)?.name ?? ''}
            </span>
          )}
        </div>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5 space-y-3">
          <div className="space-y-2">
            {lists.map(list => {
              const cached = list.tickers.filter(t => loadedTickers.has(t)).length;
              const missing = list.tickers.length - cached;
              const isSelected = list.id === selectedId;

              return (
                <div
                  key={list.id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 gap-3 border transition-colors ${
                    isSelected
                      ? 'bg-blue-950 border-blue-700'
                      : 'bg-slate-800 border-transparent hover:border-slate-600'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {editing === list.id ? (
                      <input
                        autoFocus
                        defaultValue={list.name}
                        onBlur={e => handleRename(list.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(list.id, e.currentTarget.value); if (e.key === 'Escape') setEditing(null); }}
                        className="bg-slate-700 border border-blue-500 rounded px-2 py-0.5 text-white text-sm focus:outline-none w-full"
                      />
                    ) : (
                      <p
                        className="text-white text-sm font-medium truncate cursor-pointer"
                        onDoubleClick={() => setEditing(list.id)}
                      >
                        {list.name}
                      </p>
                    )}
                    <p className="text-slate-500 text-xs mt-0.5">
                      {list.tickers.length} tickers
                      {loadedTickers.size > 0 && (
                        <>
                          {' · '}
                          <span className="text-green-500">{cached} chargés</span>
                          {missing > 0 && <span className="text-amber-400"> · {missing} à fetcher</span>}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onSelect(list)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                      }`}
                    >
                      {isSelected ? 'Sélectionnée' : 'Utiliser'}
                    </button>
                    <button
                      onClick={() => setEditing(list.id)}
                      className="text-xs text-slate-600 hover:text-slate-300 px-1.5 py-1.5 transition-colors"
                      title="Renommer"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(list.id)}
                      className="text-xs text-slate-600 hover:text-red-400 px-1.5 py-1.5 transition-colors"
                      title="Supprimer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {creating ? (
            <div className="space-y-2 pt-1">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nom de la liste"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
              <textarea
                value={newTickers}
                onChange={e => setNewTickers(e.target.value)}
                placeholder="Coller les tickers séparés par des virgules (AAPL, MSFT, TSLA...)"
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none font-mono"
              />
              <div className="flex gap-2">
                <button onClick={handleCreate} className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors">
                  Créer
                </button>
                <button onClick={() => setCreating(false)} className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 transition-colors">
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg transition-colors"
            >
              + Nouvelle liste
            </button>
          )}
        </div>
      )}
    </div>
  );
}
