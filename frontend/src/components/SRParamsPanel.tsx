import { useState, useEffect, useRef } from 'react';
import type { AnalysisParams } from '../sr';
import type { OHLCVBar } from '../api';
import type { FeedbackEntry } from '../lib/api-storage';
import { PresetSelector } from './PresetSelector';
import { AutotuneModal } from './AutotuneModal';

interface Props {
  params: AnalysisParams;
  hasData: boolean;
  onParamsChange: (p: AnalysisParams) => void;
  onParamsSet: (p: AnalysisParams) => void;
  ohlcvByTicker: Record<string, OHLCVBar[]>;
  feedback: FeedbackEntry[];
}

export function SRParamsPanel({ params, hasData, onParamsChange, onParamsSet, ohlcvByTicker, feedback }: Props) {
  const [tuning, setTuning] = useState(false);
  const [difStr, setDifStr] = useState(String(params.dif));
  const [pivotStr, setPivotStr] = useState(String(params.pivot_order));
  const [touchStr, setTouchStr] = useState(String(params.min_touches));
  const ownChange = useRef(false);

  useEffect(() => {
    if (ownChange.current) { ownChange.current = false; return; }
    setDifStr(String(params.dif));
    setPivotStr(String(params.pivot_order));
    setTouchStr(String(params.min_touches));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.dif, params.pivot_order, params.min_touches]);

  const curDif   = parseFloat(difStr);
  const curPivot = parseInt(pivotStr);
  const curTouch = parseInt(touchStr);

  const emit = (dif: number, pivot_order: number, min_touches: number) => {
    ownChange.current = true;
    onParamsChange({ dif, pivot_order, min_touches });
  };

  const handleDif   = (v: string) => { setDifStr(v);   const n = parseFloat(v); if (!isNaN(n) && n >= 0.1 && n <= 10) emit(n, curPivot || params.pivot_order, curTouch || params.min_touches); };
  const handlePivot = (v: string) => { setPivotStr(v); const n = parseInt(v);   if (!isNaN(n) && n >= 2  && n <= 50) emit(curDif || params.dif, n, curTouch || params.min_touches); };
  const handleTouch = (v: string) => { setTouchStr(v); const n = parseInt(v);   if (!isNaN(n) && n >= 2  && n <= 10) emit(curDif || params.dif, curPivot || params.pivot_order, n); };

  const inputClass = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors';

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 mb-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Paramètres S/R
        {hasData && <span className="ml-2 text-blue-400 normal-case font-normal tracking-normal">· live</span>}
      </p>
      <div className="grid grid-cols-1 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Tolérance <span className="text-slate-500">(%)</span></label>
          <input type="number" value={difStr} onChange={e => handleDif(e.target.value)}
            onBlur={() => { if (!difStr || isNaN(parseFloat(difStr))) setDifStr(String(params.dif)); }}
            min={0.1} max={10} step={0.1} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Pivot <span className="text-slate-500">(bars)</span></label>
          <input type="number" value={pivotStr} onChange={e => handlePivot(e.target.value)}
            onBlur={() => { if (!pivotStr || isNaN(parseInt(pivotStr))) setPivotStr(String(params.pivot_order)); }}
            min={2} max={50} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Min touches</label>
          <input type="number" value={touchStr} onChange={e => handleTouch(e.target.value)}
            onBlur={() => { if (!touchStr || isNaN(parseInt(touchStr))) setTouchStr(String(params.min_touches)); }}
            min={2} max={10} className={inputClass} />
        </div>
      </div>
      <PresetSelector
        current={{ dif: curDif || params.dif, pivot_order: curPivot || params.pivot_order, min_touches: curTouch || params.min_touches }}
        onLoad={onParamsSet}
      />

      {hasData && (
        <button
          onClick={() => setTuning(true)}
          className="mt-3 w-full text-xs bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white px-3 py-2 rounded-lg transition-colors font-semibold"
          title="Grid search sur les tickers chargés pour trouver les meilleurs paramètres"
        >
          ✨ Optimiser automatiquement
        </button>
      )}

      {tuning && (
        <AutotuneModal
          ohlcvByTicker={ohlcvByTicker}
          feedback={feedback}
          current={params}
          onApply={onParamsSet}
          onClose={() => setTuning(false)}
        />
      )}
    </div>
  );
}
