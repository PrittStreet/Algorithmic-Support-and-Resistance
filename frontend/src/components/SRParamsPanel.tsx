import type { AnalysisParams } from '../sr';

interface Props {
  params: AnalysisParams;
  hasData: boolean;
  onParamsChange: (p: AnalysisParams) => void;
  zoneOpacity: number;
  onZoneOpacityChange: (v: number) => void;
}

export function SRParamsPanel({ params, hasData, onParamsChange, zoneOpacity, onZoneOpacityChange }: Props) {
  const maxAgeBars  = params.maxAgeBars   ?? 0;
  const dif         = params.dif          ?? 1.5;
  const pivotOrder  = params.pivot_order  ?? 5;
  const minTouches  = params.min_touches  ?? 2;

  const pivotLabels: Record<number, string> = {
    2: 'Sensible', 3: 'Fin', 4: 'Modéré', 5: 'Équilibré',
    6: 'Large', 7: 'Fort', 8: 'Majeur', 9: 'Très majeur', 10: 'Extrémités seules',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Paramètres S/R
        {hasData && <span className="ml-2 text-blue-400 normal-case font-normal tracking-normal">· live</span>}
      </p>

      {/* ── Regroupement dif ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Largeur de zone</span>
          <span className="text-xs font-mono text-amber-400">±{dif.toFixed(1)}%</span>
        </div>
        <input
          type="range" min={0.1} max={5} step={0.1} value={dif}
          onChange={e => onParamsChange({ ...params, dif: parseFloat(e.target.value) })}
          className="w-full accent-amber-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>0.1% micro</span><span>5% large</span>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
        Largeur de la zone (± du prix central). Regroupe les pivots proches.
      </p>

      {/* ── Pivot order ── */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Ordre des pivots</span>
          <span className="text-xs font-mono text-blue-400">{pivotOrder} — {pivotLabels[pivotOrder] ?? pivotOrder}</span>
        </div>
        <input
          type="range" min={2} max={10} step={1} value={pivotOrder}
          onChange={e => onParamsChange({ ...params, pivot_order: parseInt(e.target.value) })}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>2 sensible</span><span>10 extrémités</span>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
        Nombre de barres de chaque côté pour valider un pivot. Élevé = seuls les vrais creux/sommets de range sont comptés.
      </p>

      {/* ── Min touches ── */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Touches minimum</span>
          <span className="text-xs font-mono text-blue-400">{minTouches}</span>
        </div>
        <input
          type="range" min={2} max={5} step={1} value={minTouches}
          onChange={e => onParamsChange({ ...params, min_touches: parseInt(e.target.value) })}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>2 min</span><span>5 fort</span>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
        Pivots minimum pour valider un niveau. 3+ = niveaux bien testés uniquement.
      </p>

      {/* ── Opacité zones ── */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Opacité des zones</span>
          <span className="text-xs font-mono text-slate-300">{Math.round(zoneOpacity * 100)}%</span>
        </div>
        <input
          type="range" min={5} max={80} step={5}
          value={Math.round(zoneOpacity * 100)}
          onChange={e => onZoneOpacityChange(parseInt(e.target.value) / 100)}
          className="w-full accent-slate-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>5% discret</span><span>80% plein</span>
        </div>
      </div>

      {/* ── Ancienneté ── */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Ancienneté max</span>
          <span className="text-xs font-mono text-slate-400">
            {maxAgeBars === 0 ? 'Désactivé' : `${maxAgeBars} bars`}
          </span>
        </div>
        <input
          type="range" min={0} max={200} step={5} value={maxAgeBars}
          onChange={e => onParamsChange({ ...params, maxAgeBars: parseFloat(e.target.value) })}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>0 = off</span><span>200 bars</span>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
        Marque obsolète tout niveau dont la dernière touche dépasse N bars.
      </p>

    </div>
  );
}
