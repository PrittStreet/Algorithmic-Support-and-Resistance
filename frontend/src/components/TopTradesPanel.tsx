import { useState, useMemo } from 'react';
import type { TickerResult } from '../api';
import type { CandidateTrade } from '../lib/patternEngine';
import type { GeminiAnalysis } from '../lib/geminiClient';
import { captureTradeChart } from '../lib/chartCapture';
import { analyzeWithGemini } from '../lib/geminiClient';

interface TopTradesPanelProps {
  results: TickerResult[];
  timeframe: string;
  apiKey: string;
  geminiModel: string;
  geminiPrompt: string;
  onOpenSettings: () => void;
}

interface CandidateWithGemini extends CandidateTrade {
  gemini?: GeminiAnalysis;
  geminiLoading?: boolean;
  geminiError?: string;
  scoreComposite?: number; // 0.6 * score_total + 0.4 * note*10
}

function tendanceBadge(t: string) {
  if (t === 'haussier') return 'bg-green-900 text-green-300';
  if (t === 'baissier') return 'bg-red-900 text-red-300';
  return 'bg-slate-800 text-slate-400';
}

function confidenceBadge(c: string) {
  if (c === 'fort')   return 'bg-blue-900 text-blue-300';
  if (c === 'modéré') return 'bg-yellow-900 text-yellow-300';
  return 'bg-slate-800 text-slate-500';
}

function noteDot(note: number) {
  if (note >= 7) return 'bg-green-400';
  if (note >= 4) return 'bg-yellow-400';
  return 'bg-red-400';
}

export function TopTradesPanel({ results, timeframe, apiKey, geminiModel, geminiPrompt, onOpenSettings }: TopTradesPanelProps) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateWithGemini[]>([]);
  const [analysingAll, setAnalysingAll] = useState(false);

  const top10: CandidateWithGemini[] = useMemo(() => {
    return results
      .flatMap(r => r.candidate_trades)
      .filter(c => c.ticker)
      .sort((a, b) => b.score_total - a.score_total)
      .slice(0, 10);
  }, [results]);

  const hasContent = top10.length > 0;

  // Fusionne résultats Gemini persistés avec le top10 recalculé
  const merged: CandidateWithGemini[] = top10.map(c => {
    const prev = candidates.find(
      p => p.ticker === c.ticker && p.pattern_type === c.pattern_type && p.bar_start === c.bar_start,
    );
    return prev ?? c;
  });

  const findOhlcvAndSR = (ticker: string) => {
    const r = results.find(r => r.ticker === ticker);
    return { ohlcv: r?.ohlcv ?? [], srLevels: r?.sr_levels ?? [] };
  };

  const analyseOne = async (candidate: CandidateWithGemini) => {
    if (!apiKey) return;
    const cKey = `${candidate.ticker}|${candidate.pattern_type}|${candidate.bar_start}`;

    setCandidates(prev => {
      const exists = prev.some(p => `${p.ticker}|${p.pattern_type}|${p.bar_start}` === cKey);
      const base = exists ? prev : [...prev, { ...candidate }];
      return base.map(c =>
        `${c.ticker}|${c.pattern_type}|${c.bar_start}` === cKey
          ? { ...c, geminiLoading: true, geminiError: undefined }
          : c,
      );
    });

    try {
      const { ohlcv, srLevels } = findOhlcvAndSR(candidate.ticker);
      const image = await captureTradeChart(ohlcv, srLevels, candidate);
      const gemini = await analyzeWithGemini(image, candidate, timeframe, apiKey, geminiModel, geminiPrompt);
      const scoreComposite = Math.round(candidate.score_total * 0.6 + gemini.note * 10 * 0.4);

      setCandidates(prev => prev.map(c =>
        `${c.ticker}|${c.pattern_type}|${c.bar_start}` === cKey
          ? { ...c, gemini, geminiLoading: false, scoreComposite }
          : c,
      ));
    } catch (err) {
      setCandidates(prev => prev.map(c =>
        `${c.ticker}|${c.pattern_type}|${c.bar_start}` === cKey
          ? { ...c, geminiLoading: false, geminiError: (err as Error).message }
          : c,
      ));
    }
  };

  const analyseAll = async () => {
    if (!apiKey || analysingAll) return;
    setAnalysingAll(true);
    for (const c of top10) {
      const existing = candidates.find(
        p => p.ticker === c.ticker && p.pattern_type === c.pattern_type && p.bar_start === c.bar_start,
      );
      if (!existing?.gemini) {
        await analyseOne(existing ?? c);
        await new Promise(r => setTimeout(r, 800));
      }
    }
    setAnalysingAll(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">Top Trades</span>
          {hasContent && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-900 text-blue-300 text-xs font-mono">
              {top10.length}
            </span>
          )}
          {merged.some(c => c.gemini) && (
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" title="Gemini actif" />
          )}
          {apiKey && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Clé Gemini configurée" />
          )}
        </div>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Bandeau clé manquante */}
          {!apiKey && (
            <div className="flex items-center justify-between bg-amber-950 border border-amber-800 rounded-xl px-3 py-2">
              <span className="text-amber-300 text-xs">Clé Gemini non configurée</span>
              <button
                onClick={onOpenSettings}
                className="text-amber-400 hover:text-amber-200 text-xs font-medium underline transition-colors"
              >
                Configurer →
              </button>
            </div>
          )}

          {!hasContent && (
            <p className="text-slate-600 text-xs text-center py-3">
              Lance une analyse pour voir les candidats.
            </p>
          )}

          {hasContent && (
            <>
              {/* Bouton analyser tout */}
              {apiKey && (
                <button
                  onClick={analyseAll}
                  disabled={analysingAll}
                  className="w-full py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {analysingAll && (
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {analysingAll ? 'Analyse en cours…' : 'Analyser top 10 avec Gemini'}
                </button>
              )}

              {/* Liste des candidats */}
              <div className="space-y-2">
                {merged.map((c, i) => {
                  const cKey = `${c.ticker}|${c.pattern_type}|${c.bar_start}`;
                  const state = candidates.find(
                    p => `${p.ticker}|${p.pattern_type}|${p.bar_start}` === cKey,
                  );

                  return (
                    <div key={cKey} className="bg-slate-800 rounded-xl p-3 space-y-2">
                      {/* Ligne principale */}
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 text-xs font-mono w-4 shrink-0">#{i + 1}</span>
                        <span className="font-mono text-sm text-white font-bold">{c.ticker}</span>
                        <span className="text-slate-400 text-xs truncate flex-1">{c.pattern_type}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-xs ${confidenceBadge(c.confidence)}`}>
                          {c.confidence}
                        </span>
                      </div>

                      {/* Scores */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScoreChip label="SR" value={c.score_sr} color="text-slate-300" />
                        <ScoreChip label="Tmpl" value={c.score_template} color="text-blue-300" />
                        <ScoreChip label="Géo" value={c.score_geo} color="text-cyan-300" />
                        <ScoreChip label="Total" value={c.score_total} color="text-white" bold />
                        {state?.scoreComposite != null && (
                          <ScoreChip label="★" value={state.scoreComposite} color="text-purple-300" bold />
                        )}
                      </div>

                      {/* Résultat Gemini */}
                      {state?.geminiLoading && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                          Gemini analyse le graphique…
                        </div>
                      )}
                      {state?.geminiError && (
                        <p className="text-red-400 text-xs truncate" title={state.geminiError}>
                          Erreur : {state.geminiError.slice(0, 80)}
                        </p>
                      )}
                      {state?.gemini && !state.geminiLoading && (
                        <div className="space-y-1.5 border-t border-slate-700 pt-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${noteDot(state.gemini.note)}`} />
                            <span className="text-white font-bold text-sm">{state.gemini.note}/10</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-xs ${tendanceBadge(state.gemini.tendance)}`}>
                              {state.gemini.tendance}
                            </span>
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed">{state.gemini.justification}</p>
                          {state.gemini.point_attention && (
                            <p className="text-amber-400 text-xs">⚠ {state.gemini.point_attention}</p>
                          )}
                        </div>
                      )}

                      {/* Bouton analyser individuel */}
                      {apiKey && !state?.gemini && !state?.geminiLoading && (
                        <button
                          onClick={() => analyseOne(c)}
                          className="w-full py-1 rounded-lg bg-slate-700 hover:bg-purple-700 text-slate-400 hover:text-white text-xs transition-colors"
                        >
                          Analyser avec Gemini
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreChip({ label, value, color, bold }: {
  label: string; value: number; color: string; bold?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-slate-900 rounded px-1.5 py-0.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className={`text-xs font-mono ${color} ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}
