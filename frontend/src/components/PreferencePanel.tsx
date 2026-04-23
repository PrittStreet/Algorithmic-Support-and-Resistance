import { useState } from 'react';
import type { FeedbackEntry } from '../lib/api-storage';
import { clearFeedback, removeFeedback } from '../lib/api-storage';
import { buildPreferenceModel, getFeatureInsights, LIKE_TAGS, DISLIKE_TAGS } from '../lib/preferences';

interface Props {
  feedback: FeedbackEntry[];
  onFeedbackChange: (updated: FeedbackEntry[]) => void;
}

export function PreferencePanel({ feedback, onFeedbackChange }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const likeCount    = feedback.filter(f => f.vote === 'like').length;
  const dislikeCount = feedback.filter(f => f.vote === 'dislike').length;
  const model = buildPreferenceModel(feedback);

  const tagFreq: Record<string, { like: number; dislike: number }> = {};
  for (const f of feedback) {
    for (const tag of f.tags) {
      if (!tagFreq[tag]) tagFreq[tag] = { like: 0, dislike: 0 };
      tagFreq[tag][f.vote]++;
    }
  }
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => (b[1].like + b[1].dislike) - (a[1].like + a[1].dislike))
    .slice(0, 10);

  const handleClear = async () => {
    if (confirmClear) {
      await clearFeedback();
      onFeedbackChange([]);
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
    }
  };

  const handleRemove = async (ticker: string) => {
    await removeFeedback(ticker);
    onFeedbackChange(feedback.filter(f => f.ticker !== ticker));
  };

  const insights = model ? getFeatureInsights(model) : [];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl mb-4 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Préférences</span>
          {feedback.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-green-900/60 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                {likeCount} 👍
              </span>
              <span className="text-xs bg-red-900/60 text-red-400 border border-red-800 px-2 py-0.5 rounded-full">
                {dislikeCount} 👎
              </span>
              {model && (
                <span className="text-xs bg-blue-900/60 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-full">
                  modèle actif
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-5">
          {feedback.length === 0 ? (
            <p className="text-slate-600 text-sm italic">
              Aucun feedback enregistré. Like ou dislike des charts pour entraîner le modèle.
            </p>
          ) : (
            <>
              {model && insights.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                    Ce que tu aimes — top features discriminants
                  </p>
                  <div className="space-y-2">
                    {insights.slice(0, 7).map(f => (
                      <div key={f.key}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-slate-400">{f.label}</span>
                          <span className={`text-xs font-mono ${f.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {f.delta > 0 ? '+' : ''}{(f.delta * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex gap-1 h-2">
                          <div className="flex-1 bg-slate-800 rounded-full overflow-hidden" title={`Likes: ${(f.liked_avg * 100).toFixed(0)}%`}>
                            <div className="h-full bg-green-600 rounded-full" style={{ width: `${f.liked_avg * 100}%` }} />
                          </div>
                          <div className="flex-1 bg-slate-800 rounded-full overflow-hidden" title={`Dislikes: ${(f.disliked_avg * 100).toFixed(0)}%`}>
                            <div className="h-full bg-red-700 rounded-full" style={{ width: `${f.disliked_avg * 100}%` }} />
                          </div>
                        </div>
                        <div className="flex justify-between text-slate-600 text-xs mt-0.5">
                          <span>👍 {(f.liked_avg * 100).toFixed(0)}%</span>
                          <span>👎 {(f.disliked_avg * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-600 text-xs mt-2 italic">
                    Barres vertes = moyenne sur les likes · rouges = dislikes.
                  </p>
                </div>
              )}

              {!model && (
                <p className="text-amber-500 text-xs">
                  Minimum 3 feedbacks pour activer le modèle ({feedback.length}/3).
                </p>
              )}

              {topTags.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Tags utilisés</p>
                  <div className="flex flex-wrap gap-1.5">
                    {topTags.map(([tag, counts]) => {
                      const total = counts.like + counts.dislike;
                      const isLike    = LIKE_TAGS.includes(tag);
                      const isDislike = DISLIKE_TAGS.includes(tag);
                      return (
                        <span key={tag} className={`text-xs px-2 py-0.5 rounded-full border ${
                          isLike    ? 'bg-green-900/40 text-green-400 border-green-800' :
                          isDislike ? 'bg-red-900/40 text-red-400 border-red-800' :
                                      'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {tag} <span className="opacity-60">×{total}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                  Historique ({feedback.length})
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {feedback.map(f => (
                    <div key={f.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-1.5 gap-2">
                      <span className="text-xs">{f.vote === 'like' ? '👍' : '👎'}</span>
                      <span className="text-white text-xs font-mono font-semibold">{f.ticker}</span>
                      <div className="flex gap-1 flex-1 min-w-0 overflow-hidden">
                        {f.tags.map(t => (
                          <span key={t} className="text-xs text-slate-500 truncate">#{t}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleRemove(f.ticker)}
                        className="text-slate-600 hover:text-red-400 text-xs shrink-0 transition-colors"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                {confirmClear ? (
                  <>
                    <button onClick={handleClear} className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                      Confirmer la réinitialisation
                    </button>
                    <button onClick={() => setConfirmClear(false)} className="text-xs text-slate-500 hover:text-slate-300 px-2 transition-colors">
                      Annuler
                    </button>
                  </>
                ) : (
                  <button onClick={handleClear} className="text-xs text-slate-600 hover:text-red-400 border border-slate-700 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors">
                    Réinitialiser les préférences
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
