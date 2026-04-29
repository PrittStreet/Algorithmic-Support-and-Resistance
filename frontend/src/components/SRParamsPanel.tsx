import type { AnalysisParams } from '../sr';

interface Props {
  params: AnalysisParams;
  hasData: boolean;
  onParamsChange: (p: AnalysisParams) => void;
}

export function SRParamsPanel({ params, hasData, onParamsChange }: Props) {
  const tolerance = params.tolerance ?? 1.5;
  const maxAgeBars = params.maxAgeBars ?? 0;
  const dif = params.dif ?? 1.5;

  const handleTolerance = (v: number) => {
    onParamsChange({ ...params, tolerance: v });
  };

  const handleMaxAge = (v: number) => {
    onParamsChange({ ...params, maxAgeBars: v });
  };

  const handleDif = (v: number) => {
    onParamsChange({ ...params, dif: v });
  };

  const labels: Record<number, string> = {
    1: 'Strict',
    1.5: 'Équilibré',
    2: 'Souple',
    2.5: 'Large',
    3: 'Très large',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Tolérance de détection
        {hasData && <span className="ml-2 text-blue-400 normal-case font-normal tracking-normal">· live</span>}
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">
            {labels[tolerance] ?? tolerance.toFixed(1)}
          </span>
          <span className="text-xs font-mono text-blue-400">{tolerance.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.5}
          value={tolerance}
          onChange={e => handleTolerance(parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>Strict</span>
          <span>Très large</span>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-2 leading-relaxed">
        Précision de reconnaissance des structures apprises (templates).
      </p>

      <div className="mt-5 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">
            {maxAgeBars === 0 ? 'Ancienneté max' : `${maxAgeBars} bars`}
          </span>
          <span className="text-xs font-mono text-slate-400">
            {maxAgeBars === 0 ? 'Désactivé' : `${maxAgeBars} bars`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={maxAgeBars}
          onChange={e => handleMaxAge(parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>0</span>
          <span>200</span>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-2 leading-relaxed">
        Marque les niveaux S/R dont le dernier contact est plus ancien que N bars.
      </p>

      <div className="mt-5 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Regroupement S/R</span>
          <span className="text-xs font-mono text-amber-400">±{dif.toFixed(1)}%</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.5}
          value={dif}
          onChange={e => handleDif(parseFloat(e.target.value))}
          className="w-full accent-amber-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>0.5%</span>
          <span>5%</span>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-2 leading-relaxed">
        Distance max entre 2 pivots pour les grouper en un même niveau S/R.
      </p>
    </div>
  );
}
