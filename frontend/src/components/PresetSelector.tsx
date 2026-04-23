import { useState, useEffect } from 'react';
import { getPresets, savePreset, deletePreset } from '../lib/api-storage';
import type { Preset } from '../lib/api-storage';
import type { AnalysisParams } from '../sr';

interface Props {
  current: AnalysisParams;
  onLoad: (params: AnalysisParams) => void;
}

export function PresetSelector({ current, onLoad }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const refresh = () => getPresets().then(setPresets);
  useEffect(() => { refresh(); }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    await savePreset(name.trim(), current);
    setName('');
    setSaving(false);
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deletePreset(id);
    refresh();
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets.length > 0 && (
        <select
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
          defaultValue=""
          onChange={e => {
            const p = presets.find(x => x.id === e.target.value);
            if (p) onLoad(p.params);
            e.target.value = '';
          }}
        >
          <option value="" disabled>Charger préréglage…</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {saving ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
            placeholder="Nom du préréglage"
            className="bg-slate-800 border border-blue-500 rounded-lg px-3 py-2 text-white text-sm focus:outline-none w-44"
          />
          <button onClick={handleSave} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors">
            OK
          </button>
          <button onClick={() => setSaving(false)} className="text-xs text-slate-500 hover:text-slate-300 px-2 py-2 transition-colors">
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-2 rounded-lg transition-colors"
        >
          + Sauver préréglage
        </button>
      )}

      {presets.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {presets.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1 text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">
              {p.name}
              <button
                onClick={() => handleDelete(p.id)}
                className="hover:text-red-400 transition-colors leading-none"
                title="Supprimer"
              >✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
