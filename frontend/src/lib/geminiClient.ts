import type { CandidateTrade } from './patternEngine';

export interface GeminiAnalysis {
  note: number;              // 0–10
  tendance: 'haussier' | 'neutre' | 'baissier';
  justification: string;
  point_attention: string;
}

/**
 * Envoie un screenshot (base64 PNG) + contexte au proxy backend /api/gemini-analyze.
 * Le backend appelle Gemini Vision sans jamais exposer la clé dans les logs.
 */
export async function analyzeWithGemini(
  imageBase64: string,
  trade: CandidateTrade,
  timeframe: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  promptTemplate?: string,
): Promise<GeminiAnalysis> {
  let custom_prompt: string | undefined;
  if (promptTemplate) {
    custom_prompt = promptTemplate
      .replace(/\{ticker\}/g, trade.ticker)
      .replace(/\{timeframe\}/g, timeframe)
      .replace(/\{pattern_type\}/g, trade.pattern_type)
      .replace(/\{score_quantitatif\}/g, String(trade.score_total));
  }

  const body: Record<string, unknown> = {
    image_base64: imageBase64,
    ticker: trade.ticker,
    pattern_type: trade.pattern_type,
    score_quantitatif: trade.score_total,
    timeframe,
    api_key: apiKey,
    model,
  };
  if (custom_prompt) body.custom_prompt = custom_prompt;

  const resp = await fetch('/api/gemini-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini API: ${resp.status} — ${detail.slice(0, 200)}`);
  }

  return resp.json() as Promise<GeminiAnalysis>;
}

// ── Clé API + modèle + prompt stockés en localStorage ────────────────────────

const STORAGE_KEY = 'gemini_api_key';
const MODEL_KEY   = 'gemini_model';
const PROMPT_KEY  = 'gemini_prompt';

export const DEFAULT_PROMPT =
`Tu es un analyste technique expert en trading. Analyse ce graphique {ticker} ({timeframe}).

CONTEXTE DU SETUP :
- Pattern détecté : {pattern_type}
- Score quantitatif interne : {score_quantitatif}/100
- Lignes rouges = résistances | Lignes vertes = supports

MISSION : Évalue si ce setup est favorable pour un trade, en analysant :
1. La qualité du rebond/cassure sur les niveaux S/R visibles
2. La structure des chandeliers autour du pattern ({pattern_type})
3. La cohérence globale du setup avec le score quantitatif de {score_quantitatif}/100

Réponds UNIQUEMENT avec ce JSON (aucun texte autour) :
{"note": <entier 0-10>, "tendance": "<haussier|neutre|baissier>", "justification": "<2 phrases précises>", "point_attention": "<1 risque principal ou vide>"}`;


export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const GEMINI_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash' },
  { id: 'gemini-3-flash-preview',    label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',     label: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3.1-pro-preview',    label: 'Gemini 3.1 Pro Preview' },
];

export async function testGeminiApi(apiKey: string, model: string): Promise<void> {
  const resp = await fetch('/api/gemini-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, model }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`${resp.status} — ${detail.slice(0, 300)}`);
  }
}

export function loadGeminiApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function saveGeminiApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function loadGeminiModel(): string {
  return localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODEL;
}

export function saveGeminiModel(model: string): void {
  localStorage.setItem(MODEL_KEY, model);
}

export function loadGeminiPrompt(): string {
  return localStorage.getItem(PROMPT_KEY) ?? DEFAULT_PROMPT;
}

export function saveGeminiPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  if (trimmed && trimmed !== DEFAULT_PROMPT) {
    localStorage.setItem(PROMPT_KEY, trimmed);
  } else {
    localStorage.removeItem(PROMPT_KEY);
  }
}
