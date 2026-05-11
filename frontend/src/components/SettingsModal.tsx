import { useState } from 'react';
import { saveGeminiApiKey, saveGeminiModel, saveGeminiPrompt, GEMINI_MODELS, testGeminiApi, DEFAULT_PROMPT } from '../lib/geminiClient';

interface SettingsModalProps {
  apiKey: string;
  onSave: (key: string) => void;
  geminiModel: string;
  onSaveModel: (model: string) => void;
  geminiPrompt: string;
  onSavePrompt: (p: string) => void;
  onClose: () => void;
}

type TestStatus = 'idle' | 'loading' | 'ok' | 'error';

export function SettingsModal({ apiKey, onSave, geminiModel, onSaveModel, geminiPrompt, onSavePrompt, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState(apiKey);
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState('');
  const [draftPrompt, setDraftPrompt] = useState(geminiPrompt);
  const [promptSaved, setPromptSaved] = useState(false);

  const handleSave = () => {
    const trimmed = draft.trim();
    saveGeminiApiKey(trimmed);
    onSave(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleClear = () => {
    setDraft('');
    saveGeminiApiKey('');
    onSave('');
    setTestStatus('idle');
  };

  const handleModelChange = (m: string) => {
    saveGeminiModel(m);
    onSaveModel(m);
    setTestStatus('idle');
  };

  const handleSavePrompt = () => {
    saveGeminiPrompt(draftPrompt);
    onSavePrompt(draftPrompt);
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 1800);
  };

  const handleResetPrompt = () => {
    setDraftPrompt(DEFAULT_PROMPT);
    saveGeminiPrompt(DEFAULT_PROMPT);
    onSavePrompt(DEFAULT_PROMPT);
  };

  const handleTest = async () => {
    const key = draft.trim() || apiKey;
    if (!key) return;
    setTestStatus('loading');
    setTestError('');
    try {
      await testGeminiApi(key, geminiModel);
      setTestStatus('ok');
    } catch (err) {
      setTestStatus('error');
      setTestError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-xl space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">Paramètres</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Clé Gemini */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">Clé API Gemini</label>
          <p className="text-xs text-slate-500 leading-relaxed">
            Utilisée pour l'analyse qualitative des trades détectés (Gemini Vision).
            La clé est stockée localement dans votre navigateur et n'est jamais envoyée
            à un tiers — elle transite uniquement vers Google via le proxy backend local.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={visible ? 'text' : 'password'}
                value={draft}
                onChange={e => { setDraft(e.target.value); setTestStatus('idle'); }}
                placeholder="AIzaSy…"
                className="w-full px-3 py-2 pr-10 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setVisible(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs transition-colors"
                tabIndex={-1}
              >
                {visible ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* Indicateur clé actuelle */}
          {apiKey && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-green-400">Clé configurée :</span>
              <span className="font-mono text-slate-400">
                {apiKey.slice(0, 8)}…{apiKey.slice(-4)}
              </span>
              <button
                onClick={handleClear}
                className="ml-auto text-red-500 hover:text-red-400 transition-colors"
              >
                Supprimer
              </button>
            </div>
          )}

          {!apiKey && (
            <p className="text-xs text-slate-600 italic">Aucune clé configurée.</p>
          )}
        </div>

        {/* Sélecteur de modèle + bouton test */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">Modèle Gemini</label>
          <div className="flex gap-2">
            <select
              value={geminiModel}
              onChange={e => handleModelChange(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
            >
              {GEMINI_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button
              onClick={handleTest}
              disabled={testStatus === 'loading' || !(draft.trim() || apiKey)}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0"
            >
              {testStatus === 'loading' && (
                <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
              )}
              {testStatus === 'ok' && <span className="text-green-400">✓</span>}
              {testStatus === 'error' && <span className="text-red-400">✗</span>}
              {testStatus === 'idle' && <span>▶</span>}
              Tester
            </button>
          </div>

          {/* Résultat du test */}
          {testStatus === 'ok' && (
            <p className="text-green-400 text-xs">Connexion OK — le modèle répond correctement.</p>
          )}
          {testStatus === 'error' && (
            <p className="text-red-400 text-xs break-words">Erreur : {testError}</p>
          )}
          {testStatus === 'idle' && (
            <p className="text-xs text-slate-500">
              Cliquez sur Tester pour vérifier que la clé et le modèle fonctionnent.
            </p>
          )}
        </div>

        {/* Prompt Gemini */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">Prompt Gemini</label>
            <span className="text-xs text-slate-500">
              Variables : <code className="text-slate-400">{'{ticker}'}</code>{' '}
              <code className="text-slate-400">{'{timeframe}'}</code>{' '}
              <code className="text-slate-400">{'{pattern_type}'}</code>{' '}
              <code className="text-slate-400">{'{score_quantitatif}'}</code>
            </span>
          </div>
          <textarea
            value={draftPrompt}
            onChange={e => setDraftPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-xs font-mono leading-relaxed placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors resize-y"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleResetPrompt}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white text-xs transition-colors"
            >
              Réinitialiser
            </button>
            <button
              onClick={handleSavePrompt}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                promptSaved
                  ? 'bg-green-700 text-green-100'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {promptSaved ? 'Enregistré ✓' : 'Appliquer'}
            </button>
          </div>
        </div>

        {/* Lien obtenir une clé */}
        <div className="bg-slate-800 rounded-xl p-3 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-slate-300">Comment obtenir une clé Gemini ?</p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-500">
            <li>Aller sur <span className="text-blue-400 font-mono">aistudio.google.com</span></li>
            <li>Cliquer sur "Get API key" → "Create API key"</li>
            <li>Copier la clé et la coller ci-dessus</li>
          </ol>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 text-sm transition-colors"
          >
            Fermer
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.trim()}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              saved
                ? 'bg-green-700 text-green-100'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40'
            }`}
          >
            {saved ? 'Enregistré ✓' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
