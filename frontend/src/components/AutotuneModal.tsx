import { useEffect, useRef, useState } from 'react';
import type { AnalysisParams } from '../sr';
import { analyzeOhlcv } from '../sr';
import type { OHLCVBar } from '../api';
import type { FeedbackEntry } from '../lib/api-storage';
import { buildPreferenceModel } from '../lib/preferences';
import type { AutotuneCombo, AutotuneMessage } from '../workers/autotune.worker';

interface Props {
  ohlcvByTicker: Record<string, OHLCVBar[]>;
  feedback: FeedbackEntry[];
  current: AnalysisParams;
  onApply: (params: AnalysisParams) => void;
  onClose: () => void;
}

const GRID = {
  dif:         [0.5, 1.0, 1.5, 2.0, 3.0],
  pivot_order: [3, 5, 7, 10, 15],
  min_touches: [2, 3, 4],
};
const SAMPLE_SIZE = 50;

export function AutotuneModal({ ohlcvByTicker, feedback, current, onApply, onClose }: Props) {
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [results, setResults] = useState<AutotuneCombo[] | null>(null);
  const [currentComposite, setCurrentComposite] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/autotune.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<AutotuneMessage>) => {
      const msg = e.data;
      if (msg.kind === 'progress') {
        setProgress({ done: msg.done, total: msg.total });
      } else if (msg.kind === 'done') {
        setResults(msg.combos);
      }
    };

    const likedTickers    = feedback.filter(f => f.vote === 'like').map(f => f.ticker);
    const dislikedTickers = feedback.filter(f => f.vote === 'dislike').map(f => f.ticker);
    const preferenceModel = buildPreferenceModel(feedback);

    worker.postMessage({
      ohlcvByTicker,
      likedTickers,
      dislikedTickers,
      preferenceModel,
      sampleSize: SAMPLE_SIZE,
      grid: GRID,
    });

    // Also evaluate the current params (quick, sync) for delta display.
    // Composite approx: avg sr_precision on the same sample — a lightweight proxy for UX only.
    const allTickers = Object.keys(ohlcvByTicker);
    const sample = allTickers.slice(0, SAMPLE_SIZE);
    let sum = 0, n = 0;
    for (const t of sample) {
      const r = analyzeOhlcv(ohlcvByTicker[t], current);
      sum += r.fingerprint.sr_precision; n++;
    }
    setCurrentComposite(n > 0 ? sum / n : 0);

    return () => { worker.terminate(); workerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = progress.total > 0 ? Math.round(100 * progress.done / progress.total) : 0;
  const delta = (combo: AutotuneCombo): number => {
    if (currentComposite === null) return 0;
    return Math.round((combo.avgPrecision - currentComposite) * 100);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-xl w-full max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">✨ Auto-tune paramètres S/R</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
          >✕</button>
        </div>

        <p className="text-slate-400 text-sm mb-4">
          Grid search sur {GRID.dif.length * GRID.pivot_order.length * GRID.min_touches.length} combinaisons ×{' '}
          {Math.min(Object.keys(ohlcvByTicker).length, SAMPLE_SIZE)} tickers échantillonnés. Combine précision S/R
          {feedback.length >= 3 && ', accord avec tes likes/dislikes'}.
        </p>

        {!results ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Évaluation en cours…</span>
              <span className="text-xs text-blue-400 font-mono">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Top 3 configurations</p>
            <div className="space-y-2">
              {results.map((combo, i) => {
                const d = delta(combo);
                return (
                  <div
                    key={i}
                    className={`rounded-xl px-4 py-3 border ${
                      i === 0 ? 'border-blue-600 bg-blue-950/40' : 'border-slate-700 bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {i === 0 && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-semibold">Recommandé</span>}
                        <span className="text-white font-mono text-sm">
                          dif={combo.params.dif} · pivot={combo.params.pivot_order} · touches={combo.params.min_touches}
                        </span>
                      </div>
                      <button
                        onClick={() => { onApply(combo.params); onClose(); }}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          i === 0 ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                        }`}
                      >
                        Appliquer
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500">Précision</span>
                        <p className="text-white font-mono">
                          {(combo.avgPrecision * 100).toFixed(0)}%
                          {d !== 0 && (
                            <span className={d > 0 ? 'text-green-400 ml-1.5' : 'text-red-400 ml-1.5'}>
                              {d > 0 ? '+' : ''}{d}pt
                            </span>
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Niveaux/chart</span>
                        <p className="text-white font-mono">{combo.levelsCount.toFixed(1)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">
                          {combo.likeMinusDislike !== 0 ? 'Δ Likes/Dislikes' : 'Pref ML'}
                        </span>
                        <p className="text-white font-mono">
                          {combo.likeMinusDislike !== 0
                            ? `${combo.likeMinusDislike > 0 ? '+' : ''}${(combo.likeMinusDislike * 100).toFixed(0)}%`
                            : `${(combo.prefAgreement * 100).toFixed(0)}%`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-slate-600 text-xs mt-4 italic">
              La précision mesure la netteté des niveaux (tolérance ≤ 0.5%). Le delta est vs tes paramètres actuels.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
