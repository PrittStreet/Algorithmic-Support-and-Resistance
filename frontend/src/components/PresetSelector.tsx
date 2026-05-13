import { useState, useEffect } from 'react';
import { getPresets, savePreset, deletePreset, renamePreset } from '../lib/api-storage';
import type { Preset } from '../lib/api-storage';
import type { AnalysisParams } from '../sr';

interface Props {
  current: AnalysisParams;
  onLoad: (params: AnalysisParams) => void;
}

export function PresetSelector({ current, onLoad }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = () => getPresets().then(setPresets);
  useEffect(() => { refresh(); }, []);

  const handleSave = async () => {
    if (!newName.trim()) return;
    await savePreset(newName.trim(), current);
    setNewName('');
    setSaving(false);
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId === id) {
      await deletePreset(id);
      refresh();
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const startRename = (p: Preset) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
    setConfirmDeleteId(null);
  };

  const commitRename = async (id: string) => {
    if (renameValue.trim()) {
      await renamePreset(id, renameValue.trim());
      refresh();
    }
    setRenamingId(null);
  };

  return (
    <div className="space-y-2">
      {presets.length === 0 && !saving && (
        <p className="text-slate-600 text-xs italic">Aucun préréglage sauvegardé.</p>
      )}

      {presets.map(p => (
        <div key={p.id} className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2 gap-2">
          {renamingId === p.id ? (
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename(p.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={() => commitRename(p.id)}
              className="flex-1 bg-slate-700 border border-blue-500 rounded-md px-2 py-1 text-white text-xs focus:outline-none"
            />
          ) : (
            <span className="text-white text-xs font-medium truncate flex-1">{p.name}</span>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {renamingId !== p.id && (
              <>
                <button
                  onClick={() => { onLoad(p.params); }}
                  className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded-md transition-colors"
                  title="Charger ce préréglage"
                >
                  Charger
                </button>
                <button
                  onClick={() => startRename(p)}
                  className="text-slate-500 hover:text-slate-300 px-1 py-1 transition-colors text-xs"
                  title="Renommer"
                >
                  ✏
                </button>
                {confirmDeleteId === p.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1 rounded-md transition-colors"
                    >
                      OK
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-slate-500 hover:text-slate-300 px-1 py-1 transition-colors"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-slate-600 hover:text-red-400 px-1 py-1 transition-colors text-xs"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}

      {saving ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
            placeholder="Nom du préréglage…"
            className="flex-1 bg-slate-800 border border-blue-500 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none"
          />
          <button onClick={handleSave} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors">
            OK
          </button>
          <button onClick={() => { setSaving(false); setNewName(''); }} className="text-xs text-slate-500 hover:text-slate-300 px-1 py-1.5 transition-colors">
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors w-full text-left"
        >
          + Sauver les paramètres actuels
        </button>
      )}
    </div>
  );
}
