import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import type { TradeJournalEntry, TradeInput } from '../api';
import { analyzeTradeJournalStream } from '../api';
import {
  createTradeJournalEntries,
  deleteTradeJournalEntry,
  clearTradeJournal,
  updateTradeFavorite,
} from '../lib/api-storage';

const MODELS = [
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite' },
];

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDateCell(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
    const fr2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (fr2) return `20${fr2[3]}-${fr2[2].padStart(2, '0')}-${fr2[1].padStart(2, '0')}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

// ── Result parsing ────────────────────────────────────────────────────────────

function normalizeHeader(s: string): string {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchesResultHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return (
    n.includes('resultat') || n.includes('result') || n.includes('perf') ||
    n.includes('gain') || n.includes('pnl') || n === '%' || n === 'p&l' ||
    n.includes('rende') || n.includes('retour') || n.includes('return') ||
    n === 'outcome' || n === 'issue'
  );
}

function parseWinLoss(raw: unknown): { result_pct: number; result_label: 'Win' | 'Loss' } | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (s === 'win' || s === 'w' || s === 'gagne' || s === 'gagné' || s === 'victoire') {
    return { result_pct: 1, result_label: 'Win' };
  }
  if (s === 'loss' || s === 'lose' || s === 'l' || s === 'perdu' || s === 'perte') {
    return { result_pct: -1, result_label: 'Loss' };
  }
  return null;
}

function parseResultValue(rawValue: unknown, cellFormat: string | undefined): number | null {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'number') {
    const isPercentCell = cellFormat != null && cellFormat.includes('%');
    const n = isPercentCell ? rawValue * 100 : rawValue;
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }
  if (typeof rawValue === 'string') {
    const s = rawValue.replace(',', '.').replace('%', '').trim();
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  return null;
}

// ── Excel parsing ─────────────────────────────────────────────────────────────

interface ParsedSheet {
  trades: TradeInput[];
  detectedHeaders: { date: string; ticker: string; result: string | null };
}

function parseExcelFile(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];

        const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        if (allRows.length < 2) {
          resolve({ trades: [], detectedHeaders: { date: '', ticker: '', result: null } });
          return;
        }

        const headerRow = allRows[0] as unknown[];
        const headerNorm = headerRow.map(h => normalizeHeader(String(h ?? '')));
        const headerOrig = headerRow.map(h => String(h ?? '').trim());

        const colDateIn = headerNorm.findIndex(h => h.includes('date'));
        const colTicker = headerNorm.findIndex(h =>
          h === 'ticker' || h === 'symbol' || h === 'symbole' || h === 'actif'
        );
        let colResult = headerNorm.findIndex(h => matchesResultHeader(h));

        // Fallback : 3 colonnes, la 3e non reconnue = résultat
        if (colResult === -1 && headerNorm.length === 3 && colDateIn !== -1 && colTicker !== -1) {
          colResult = headerNorm.findIndex((_, i) => i !== colDateIn && i !== colTicker);
        }

        if (colDateIn === -1 || colTicker === -1) {
          const found = headerOrig.join(' | ');
          reject(new Error(
            `Colonnes "Date" et "Ticker" requises.\nEn-têtes détectés : ${found || '(aucun)'}`
          ));
          return;
        }

        const ref = ws['!ref'];
        const range = ref ? XLSX.utils.decode_range(ref) : null;

        const trades: TradeInput[] = [];
        for (let rowIdx = 1; rowIdx < allRows.length; rowIdx++) {
          const row = allRows[rowIdx] as unknown[];
          const ticker = String(row[colTicker] ?? '').trim().toUpperCase();
          if (!ticker || ticker === 'NULL') continue;
          const date_in = parseDateCell(row[colDateIn]);
          if (!date_in) continue;

          let result_pct: number | null = null;
          let result_label: 'Win' | 'Loss' | null = null;

          if (colResult !== -1) {
            const rawVal = row[colResult];
            const wl = parseWinLoss(rawVal);
            if (wl) {
              result_pct = wl.result_pct;
              result_label = wl.result_label;
            } else {
              let cellFmt: string | undefined;
              if (range) {
                const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: colResult });
                cellFmt = ws[cellAddr]?.z;
              }
              result_pct = parseResultValue(rawVal, cellFmt);
            }
          }

          trades.push({ ticker, date_in, result_pct, result_label });
        }

        resolve({
          trades,
          detectedHeaders: {
            date: headerOrig[colDateIn] ?? '',
            ticker: headerOrig[colTicker] ?? '',
            result: colResult !== -1 ? (headerOrig[colResult] ?? null) : null,
          },
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Erreur de lecture du fichier'));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Sidebar controls ──────────────────────────────────────────────────────────

interface SidebarProps {
  trades: TradeJournalEntry[];
  onTradesChange: (t: TradeJournalEntry[]) => void;
  apiKey: string;
  onApiKeyChange: (k: string) => void;
  model: string;
  onModelChange: (m: string) => void;
}

export function TradeJournalPanel({ trades, onTradesChange, apiKey, onApiKeyChange, model, onModelChange }: SidebarProps) {
  const [preview, setPreview] = useState<TradeInput[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<{ date: string; ticker: string; result: string | null } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const analyzedCount = trades.filter(t => t.analyzed_at && !t.error).length;
  const pendingCount = trades.filter(t => !t.analyzed_at).length;
  const errorCount = trades.filter(t => t.error).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleFile = async (file: File) => {
    setParseError(null);
    setPreview([]);
    setDetectedHeaders(null);
    setFileName(file.name);
    try {
      const { trades: parsed, detectedHeaders: dh } = await parseExcelFile(file);
      setDetectedHeaders(dh);
      if (parsed.length === 0) {
        setParseError('Aucune ligne valide trouvée. Vérifiez les colonnes : Date, TICKER, Résultat');
        return;
      }
      if (!dh.result) {
        setParseError('Colonne résultat non détectée — importé sans résultats. Nommez-la : Résultat, Result, Win/Loss, PnL, Gain ou %');
      }
      setPreview(parsed);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (preview.length === 0) return;
    try {
      const inserted = await createTradeJournalEntries(preview);
      onTradesChange([...inserted, ...trades]);
      setPreview([]);
      setFileName(null);
      setDetectedHeaders(null);
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleAnalyze = async () => {
    if (!apiKey.trim()) { setAnalyzeError('Clé API Gemini requise'); return; }
    const toAnalyze = trades.filter(t => !t.analyzed_at || t.error);
    if (toAnalyze.length === 0) { setAnalyzeError('Tous les trades sont déjà analysés'); return; }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setAnalyzeError(null);
    setLoading(true);
    setDone(0);
    setTotal(toAnalyze.length);

    const updatedMap: Record<string, TradeJournalEntry> = {};
    trades.forEach(t => { updatedMap[t.id] = t; });

    try {
      for await (const result of analyzeTradeJournalStream(
        toAnalyze.map(t => t.id), apiKey.trim(), model, ctrl.signal
      )) {
        updatedMap[result.id] = result;
        onTradesChange(Object.values(updatedMap).sort((a, b) => b.date_in.localeCompare(a.date_in)));
        setDone(d => d + 1);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setAnalyzeError((e as Error).message ?? 'Erreur inconnue');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearTradeJournal();
    onTradesChange([]);
    setConfirmClear(false);
    setPreview([]);
    setFileName(null);
    setDetectedHeaders(null);
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
        Trade Journal
      </p>

      {/* Upload zone */}
      <div>
        <span className="text-xs text-slate-400 block mb-1">Importer un fichier Excel</span>
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl px-3 py-4 text-center transition-colors ${
            isDragging
              ? 'border-blue-400 bg-blue-900/20'
              : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
          }`}
        >
          <p className="text-xs text-slate-500">
            {fileName ? (
              <span className="text-slate-300">{fileName}</span>
            ) : (
              <>Glisser-déposer ou <span className="text-blue-400">parcourir</span></>
            )}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">Colonnes : Date · TICKER · Win/Loss ou %</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>

      {/* Colonnes détectées */}
      {detectedHeaders && (
        <div className="text-[10px] bg-slate-800/50 border border-slate-700 rounded-lg px-2 py-1.5 space-y-0.5">
          <p className="text-slate-500 font-medium mb-1">Colonnes détectées :</p>
          <div className="flex gap-2">
            <span className="text-slate-500 w-14">Date :</span>
            <span className="text-slate-300 font-mono">{detectedHeaders.date || '—'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500 w-14">Ticker :</span>
            <span className="text-slate-300 font-mono">{detectedHeaders.ticker || '—'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500 w-14">Résultat :</span>
            {detectedHeaders.result
              ? <span className="text-green-400 font-mono">{detectedHeaders.result}</span>
              : <span className="text-red-400">Non détecté</span>}
          </div>
        </div>
      )}

      {/* Erreur / avertissement parsing */}
      {parseError && (
        <div className={`text-xs rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-line ${
          preview.length > 0
            ? 'text-amber-400 bg-amber-950/30 border border-amber-900/50'
            : 'text-red-400 bg-red-950/50 border border-red-900'
        }`}>
          {parseError}
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-1">
            {preview.length} ligne{preview.length > 1 ? 's' : ''} détectée{preview.length > 1 ? 's' : ''}
          </p>
          <div className="max-h-32 overflow-y-auto space-y-0.5 text-[10px] font-mono">
            {preview.slice(0, 8).map((t, i) => (
              <div key={i} className="flex gap-2 text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded items-center">
                <span className="text-slate-200 w-16 shrink-0">{t.ticker}</span>
                <span className="text-slate-500">{t.date_in}</span>
                <span className="ml-auto">
                  {t.result_label === 'Win' ? (
                    <span className="text-green-400">Win</span>
                  ) : t.result_label === 'Loss' ? (
                    <span className="text-red-400">Loss</span>
                  ) : t.result_pct !== null ? (
                    <span className={t.result_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {t.result_pct >= 0 ? '+' : ''}{t.result_pct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </span>
              </div>
            ))}
            {preview.length > 8 && (
              <p className="text-slate-600 px-2">… et {preview.length - 8} autres</p>
            )}
          </div>
          <button
            onClick={handleImport}
            className="mt-2 w-full py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Importer {preview.length} trade{preview.length > 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Résumé */}
      {trades.length > 0 && (
        <div className="text-xs text-slate-500 space-y-0.5">
          <div className="flex justify-between">
            <span>Total</span>
            <span className="text-slate-300 font-semibold">{trades.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Analysés</span>
            <span className="text-green-400">{analyzedCount}</span>
          </div>
          {pendingCount > 0 && (
            <div className="flex justify-between">
              <span>En attente</span>
              <span className="text-yellow-400">{pendingCount}</span>
            </div>
          )}
          {errorCount > 0 && (
            <div className="flex justify-between">
              <span>Erreurs</span>
              <span className="text-red-400">{errorCount}</span>
            </div>
          )}
        </div>
      )}

      {/* Clé API */}
      <div>
        <span className="text-xs text-slate-400 block mb-1">Clé API Gemini</span>
        <div className="flex gap-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => onApiKeyChange(e.target.value)}
            placeholder="AIza..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setShowKey(s => !s)}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-xs hover:text-slate-200 transition-colors"
          >{showKey ? '●' : '○'}</button>
        </div>
      </div>

      {/* Sélecteur modèle */}
      <div>
        <span className="text-xs text-slate-400 block mb-1">Modèle</span>
        <select
          value={model}
          onChange={e => onModelChange(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {/* Bouton analyser / Stop */}
      {loading ? (
        <div className="flex gap-2">
          <div className="flex-1 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-slate-400 text-center cursor-not-allowed">
            Analyse… {done}/{total}
          </div>
          <button
            onClick={handleStop}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-700 hover:bg-red-600 text-white transition-colors"
            title="Arrêter l'analyse"
          >
            ■ Stop
          </button>
        </div>
      ) : (
        <button
          onClick={handleAnalyze}
          disabled={trades.length === 0}
          className={`w-full py-2 rounded-xl text-xs font-semibold transition-colors ${
            trades.length === 0
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          Analyser les fondamentaux
        </button>
      )}

      {/* Barre de progression */}
      {loading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{done} / {total}</span>
            <span className="font-mono text-slate-400">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {analyzeError && (
        <div className="text-xs text-red-400 bg-red-950/50 border border-red-900 rounded-lg px-2 py-1.5">
          {analyzeError}
        </div>
      )}

      {/* Vider le journal */}
      {trades.length > 0 && !loading && (
        <div className="space-y-1">
          <button
            onClick={handleClear}
            className={`w-full py-1.5 rounded-xl text-xs transition-colors ${
              confirmClear
                ? 'bg-red-700 hover:bg-red-600 text-white font-semibold'
                : 'text-slate-600 hover:text-red-400 border border-slate-800'
            }`}
          >
            {confirmClear ? 'Confirmer la suppression ?' : 'Vider le journal'}
          </button>
          {confirmClear && (
            <button
              onClick={() => setConfirmClear(false)}
              className="w-full py-1 text-xs text-slate-500 hover:text-slate-300"
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-slate-600">—</span>;
  const color = score >= 70
    ? 'text-green-400 bg-green-900/40 border-green-700'
    : score >= 40
    ? 'text-yellow-400 bg-yellow-900/40 border-yellow-700'
    : 'text-red-400 bg-red-900/40 border-red-700';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold border ${color}`}>
      {score}
    </span>
  );
}

function ResultBadge({ entry }: { entry: TradeJournalEntry }) {
  if (entry.result_label === 'Win') {
    return <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-green-900/50 text-green-400 border border-green-700">Win</span>;
  }
  if (entry.result_label === 'Loss') {
    return <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-red-900/50 text-red-400 border border-red-700">Loss</span>;
  }
  if (entry.result_pct !== null) {
    const positive = entry.result_pct >= 0;
    return (
      <span className={`font-mono font-semibold text-xs ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {positive ? '+' : ''}{entry.result_pct.toFixed(2)}%
      </span>
    );
  }
  return <span className="text-xs text-slate-600">—</span>;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <span className="text-xs text-slate-600">—</span>;
  const color = sentiment === 'positif' ? 'bg-green-500'
    : sentiment === 'négatif' ? 'bg-red-500'
    : 'bg-slate-500';
  return (
    <span className="flex items-center gap-1 text-xs text-slate-400">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      {sentiment}
    </span>
  );
}

// ── Statistics ────────────────────────────────────────────────────────────────

function computeWinLose(trades: TradeJournalEntry[]) {
  const analyzed = trades.filter(
    t => t.analyzed_at && t.result_pct !== null && t.fundamental_score !== null
  );
  const wins  = analyzed.filter(t => t.result_pct! > 0);
  const loses = analyzed.filter(t => t.result_pct! <= 0);

  const avgScore = (arr: typeof analyzed): number | null =>
    arr.length > 0
      ? Math.round(arr.reduce((s, t) => s + t.fundamental_score!, 0) / arr.length)
      : null;

  // Ne montrer le résultat moyen que si les données sont numériques (pas Win=1/Loss=-1)
  const isNumeric = analyzed.some(t => Math.abs(t.result_pct!) > 1);
  const avgResult = (arr: typeof analyzed): number | null =>
    isNumeric && arr.length > 0
      ? arr.reduce((s, t) => s + t.result_pct!, 0) / arr.length
      : null;

  return {
    wins:  { count: wins.length,  avgScore: avgScore(wins),  avgResult: avgResult(wins)  },
    loses: { count: loses.length, avgScore: avgScore(loses), avgResult: avgResult(loses) },
    total: analyzed.length,
    isNumeric,
  };
}

function computeScoreCorrelation(trades: TradeJournalEntry[]) {
  const analyzed = trades.filter(t => t.analyzed_at && t.result_pct !== null && t.fundamental_score !== null);
  return [
    { label: '0–19',   min: 0,  max: 19  },
    { label: '20–39',  min: 20, max: 39  },
    { label: '40–59',  min: 40, max: 59  },
    { label: '60–79',  min: 60, max: 79  },
    { label: '80–100', min: 80, max: 100 },
  ].map(b => {
    const inBucket = analyzed.filter(t => t.fundamental_score! >= b.min && t.fundamental_score! <= b.max);
    const winRate = inBucket.length > 0
      ? (inBucket.filter(t => t.result_pct! > 0).length / inBucket.length) * 100
      : null;
    return { ...b, count: inBucket.length, winRate };
  });
}

function ScoreWinRateChart({ data }: {
  data: { label: string; count: number; winRate: number | null }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [userH, setUserH] = useState(220);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onMouseDownHandle = (e: { preventDefault(): void; clientY: number }) => {
    e.preventDefault();
    dragRef.current = { y: e.clientY, h: userH };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setUserH(Math.max(120, dragRef.current.h + ev.clientY - dragRef.current.y));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const W = w, H = userH;
  const padL = 38, padB = 34, padT = 16, padR = 10;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const barW = chartW / data.length;
  const barGap = barW * 0.14;

  const yGrids = [0, 25, 50, 75, 100];
  const totalAnalyzed = data.reduce((s, b) => s + b.count, 0);

  const barColor = (wr: number | null) => {
    if (wr === null) return '#334155';
    if (wr >= 60) return '#22c55e';
    if (wr >= 40) return '#eab308';
    return '#ef4444';
  };

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={W} height={H}>
        {/* Grid lines */}
        {yGrids.map(pct => {
          const y = padT + chartH - (pct / 100) * chartH;
          return (
            <g key={pct}>
              <line
                x1={padL} y1={y} x2={W - padR} y2={y}
                stroke={pct === 50 ? '#475569' : '#1e293b'}
                strokeWidth={pct === 50 ? 1 : 0.5}
                strokeDasharray={pct === 50 ? '4 3' : undefined}
              />
              <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="#64748b">
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((b, i) => {
          const x = padL + i * barW + barGap;
          const bw = barW - barGap * 2;
          const wr = b.winRate ?? 0;
          const barH = (wr / 100) * chartH;
          const y = padT + chartH - barH;
          const color = barColor(b.winRate);
          return (
            <g key={b.label}>
              <rect
                x={x} y={y} width={bw} height={barH || 1}
                fill={color} rx={2} opacity={b.count === 0 ? 0.15 : 0.85}
              />
              {b.count > 0 && b.winRate !== null && (
                <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize={9} fill={color} fontWeight="600">
                  {b.winRate.toFixed(0)}%
                </text>
              )}
              <text x={x + bw / 2} y={H - padB + 12} textAnchor="middle" fontSize={9} fill="#94a3b8">
                {b.label}
              </text>
              <text x={x + bw / 2} y={H - padB + 23} textAnchor="middle" fontSize={8} fill="#475569">
                n={b.count}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#334155" strokeWidth={1} />
        <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="#334155" strokeWidth={1} />

        {/* Footer */}
        <text x={padL + chartW / 2} y={H - 1} textAnchor="middle" fontSize={8} fill="#334155">
          Score Gemini · {totalAnalyzed} analysés
        </text>
      </svg>
      <div
        style={{ height: 6, cursor: 'ns-resize', background: 'rgba(51,65,85,0.5)', borderRadius: '0 0 6px 6px' }}
        onMouseDown={onMouseDownHandle}
        title="Glisser pour redimensionner la hauteur"
      />
    </div>
  );
}

function computeSentimentBreakdown(trades: TradeJournalEntry[]) {
  const analyzed = trades.filter(t => t.analyzed_at && t.result_pct !== null && t.sentiment);
  return (['positif', 'neutre', 'négatif'] as const).map(s => {
    const inGroup = analyzed.filter(t => t.sentiment === s);
    const winRate = inGroup.length > 0
      ? (inGroup.filter(t => t.result_pct! > 0).length / inGroup.length) * 100
      : null;
    return { sentiment: s, count: inGroup.length, winRate };
  });
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface MainViewProps {
  trades: TradeJournalEntry[];
  onTradesChange: (t: TradeJournalEntry[]) => void;
  apiKey: string;
  model: string;
}

export function TradeJournalMainView({ trades, onTradesChange, apiKey, model }: MainViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'trades' | 'stats'>('trades');
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  const tradesRef = useRef(trades);
  useEffect(() => { tradesRef.current = trades; }, [trades]);

  const handleDelete = async (id: string) => {
    await deleteTradeJournalEntry(id);
    onTradesChange(trades.filter(t => t.id !== id));
  };

  const handleReanalyze = async (trade: TradeJournalEntry) => {
    if (!apiKey.trim() || analyzingIds.has(trade.id)) return;
    const ctrl = new AbortController();
    abortsRef.current.set(trade.id, ctrl);
    setAnalyzingIds(prev => new Set(prev).add(trade.id));
    try {
      for await (const result of analyzeTradeJournalStream([trade.id], apiKey, model, ctrl.signal, true)) {
        tradesRef.current = tradesRef.current.map(t => t.id === result.id ? result : t);
        onTradesChange([...tradesRef.current]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
    } finally {
      abortsRef.current.delete(trade.id);
      setAnalyzingIds(prev => { const s = new Set(prev); s.delete(trade.id); return s; });
    }
  };

  const handleToggleFav = async (trade: TradeJournalEntry) => {
    if (analyzingIds.has(trade.id)) return;
    const newFav = !trade.is_favorite;
    const updated = await updateTradeFavorite(trade.id, newFav);
    tradesRef.current = tradesRef.current.map(t => t.id === updated.id ? updated : t);
    onTradesChange([...tradesRef.current]);
    if (newFav && (!trade.analyzed_at || trade.error)) {
      const ctrl = new AbortController();
      abortsRef.current.set(trade.id, ctrl);
      setAnalyzingIds(prev => new Set(prev).add(trade.id));
      try {
        for await (const result of analyzeTradeJournalStream([trade.id], apiKey, model, ctrl.signal, true)) {
          tradesRef.current = tradesRef.current.map(t => t.id === result.id ? result : t);
          onTradesChange([...tradesRef.current]);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error(e);
      } finally {
        abortsRef.current.delete(trade.id);
        setAnalyzingIds(prev => { const s = new Set(prev); s.delete(trade.id); return s; });
      }
    }
  };

  const analyzed = trades.filter(
    t => t.analyzed_at && t.result_pct !== null && t.fundamental_score !== null
  );
  const winLose      = computeWinLose(trades);
  const scoreCorr    = computeScoreCorrelation(trades);
  const sentBreakdown = computeSentimentBreakdown(trades);

  const top5    = [...analyzed].sort((a, b) => b.result_pct! - a.result_pct!).slice(0, 5);
  const bottom5 = [...analyzed].sort((a, b) => a.result_pct! - b.result_pct!).slice(0, 5);

  const fmtAvg = (v: number | null) =>
    v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-600">
        <p className="text-4xl mb-3">📒</p>
        <p className="text-sm">Importez un fichier Excel pour commencer</p>
        <p className="text-xs mt-1 text-slate-700">Colonnes : Date · TICKER · Win/Loss (ou %)</p>
      </div>
    );
  }

  const winsAvgScore  = winLose.wins.avgScore;
  const losesAvgScore = winLose.loses.avgScore;
  const scoreDiff = winsAvgScore !== null && losesAvgScore !== null
    ? winsAvgScore - losesAvgScore
    : null;

  return (
    <div className="space-y-4">
      {/* Onglets internes */}
      <div className="flex gap-1 border-b border-slate-800 pb-1">
        {([['trades', 'Trades'], ['stats', 'Statistiques']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1 text-xs font-medium rounded-t transition-colors ${
              tab === k
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Onglet Trades ── */}
      {tab === 'trades' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-2 px-2 font-medium">Ticker</th>
                <th className="text-left py-2 px-2 font-medium">Date IN</th>
                <th className="text-center py-2 px-2 font-medium">Résultat</th>
                <th className="text-center py-2 px-2 font-medium">Score</th>
                <th className="text-left py-2 px-2 font-medium">Sentiment</th>
                <th className="text-left py-2 px-2 font-medium min-w-[160px]">Résumé</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {trades.map(t => (
                <>
                  <tr
                    key={t.id}
                    className={`transition-colors cursor-pointer hover:bg-slate-800/40 ${
                      analyzingIds.has(t.id) ? 'bg-blue-950/30' :
                      t.error ? 'opacity-60' : !t.analyzed_at ? 'opacity-50' : ''
                    }`}
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  >
                    <td className="py-2 px-2 font-mono font-semibold text-slate-200">{t.ticker}</td>
                    <td className="py-2 px-2 text-slate-500 font-mono">{t.date_in}</td>
                    <td className="py-2 px-2 text-center">
                      <ResultBadge entry={t} />
                    </td>
                    <td className="py-2 px-2 text-center">
                      {t.error ? (
                        <span className="text-xs text-red-400" title={t.error}>Erreur</span>
                      ) : !t.analyzed_at ? (
                        <span className="text-xs text-slate-600">—</span>
                      ) : (
                        <ScoreBadge score={t.fundamental_score} />
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <SentimentBadge sentiment={t.sentiment} />
                    </td>
                    <td className="py-2 px-2 text-slate-500 max-w-[180px] truncate text-[10px]">
                      {t.news_summary
                        ?? (t.error
                          ? <span className="text-red-400/70">{t.error.slice(0, 50)}</span>
                          : '—')}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={e => { e.stopPropagation(); void handleToggleFav(t); }}
                          disabled={analyzingIds.has(t.id)}
                          title={t.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                          className={`text-sm transition-colors disabled:opacity-30 ${
                            t.is_favorite ? 'text-amber-400 hover:text-amber-300' : 'text-slate-700 hover:text-amber-400'
                          }`}
                        >
                          {analyzingIds.has(t.id) && !t.analyzed_at
                            ? <span className="inline-block animate-spin text-xs">⟳</span>
                            : t.is_favorite ? '★' : '☆'}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); void handleReanalyze(t); }}
                          disabled={!apiKey.trim() || analyzingIds.has(t.id)}
                          title={!apiKey.trim() ? 'Clé API requise (sidebar)' : 'Relancer l\'analyse'}
                          className="text-slate-600 hover:text-blue-400 transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {analyzingIds.has(t.id)
                            ? <span className="inline-block animate-spin">⟳</span>
                            : '↺'}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); void handleDelete(t.id); }}
                          disabled={analyzingIds.has(t.id)}
                          className="text-slate-700 hover:text-red-400 transition-colors text-xs disabled:opacity-30"
                          title="Supprimer"
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === t.id && t.analyzed_at && (
                    <tr key={`${t.id}-exp`} className="bg-slate-800/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {t.news_summary && (
                            <div>
                              <p className="text-slate-500 font-medium mb-1">Actualité</p>
                              <p className="text-slate-300 leading-relaxed">{t.news_summary}</p>
                            </div>
                          )}
                          {t.projections && (
                            <div>
                              <p className="text-slate-500 font-medium mb-1">Projections</p>
                              <p className="text-slate-300 leading-relaxed">{t.projections}</p>
                            </div>
                          )}
                          {t.earnings_summary && (
                            <div>
                              <p className="text-slate-500 font-medium mb-1">Résultats financiers</p>
                              <p className="text-slate-300 leading-relaxed">{t.earnings_summary}</p>
                            </div>
                          )}
                          {t.analyst_consensus && (
                            <div>
                              <p className="text-slate-500 font-medium mb-1">Consensus analystes</p>
                              <p className="text-slate-300 leading-relaxed">{t.analyst_consensus}</p>
                            </div>
                          )}
                          {t.error && (
                            <div className="col-span-2">
                              <p className="text-red-400 font-medium mb-1">Erreur</p>
                              <p className="text-red-300/70 font-mono text-[10px]">{t.error}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Onglet Stats ── */}
      {tab === 'stats' && (
        <div className="space-y-6">
          {analyzed.length < 2 ? (
            <p className="text-sm text-slate-600 py-8 text-center">
              Analysez au moins 2 trades pour voir les statistiques.
            </p>
          ) : (
            <>
              {/* 1. WIN vs LOSE — section principale */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                  Score Gemini : Wins vs Losses
                </p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 px-2 font-medium"></th>
                      <th className="text-center py-2 px-2 font-medium text-green-500">Gagnants ✓</th>
                      <th className="text-center py-2 px-2 font-medium text-red-500">Perdants ✗</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    <tr>
                      <td className="py-2 px-2 text-slate-500">Nb trades</td>
                      <td className="py-2 px-2 text-center text-slate-300 font-semibold">{winLose.wins.count}</td>
                      <td className="py-2 px-2 text-center text-slate-300 font-semibold">{winLose.loses.count}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-slate-500">Score Gemini moyen</td>
                      <td className="py-2 px-2 text-center">
                        <ScoreBadge score={winLose.wins.avgScore} />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <ScoreBadge score={winLose.loses.avgScore} />
                      </td>
                    </tr>
                    {winLose.isNumeric && (
                      <tr>
                        <td className="py-2 px-2 text-slate-500">Résultat moyen</td>
                        <td className={`py-2 px-2 text-center font-mono font-semibold ${
                          winLose.wins.avgResult === null ? 'text-slate-600'
                          : winLose.wins.avgResult >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>{fmtAvg(winLose.wins.avgResult)}</td>
                        <td className={`py-2 px-2 text-center font-mono font-semibold ${
                          winLose.loses.avgResult === null ? 'text-slate-600'
                          : winLose.loses.avgResult >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>{fmtAvg(winLose.loses.avgResult)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Interprétation */}
                {scoreDiff !== null && winLose.wins.count > 0 && winLose.loses.count > 0 && (
                  <p className={`mt-2 text-xs rounded-lg px-3 py-2 ${
                    scoreDiff >= 5
                      ? 'text-green-400 bg-green-950/30 border border-green-900/50'
                      : scoreDiff <= -5
                      ? 'text-red-400 bg-red-950/30 border border-red-900/50'
                      : 'text-slate-500 bg-slate-800/40 border border-slate-700'
                  }`}>
                    {scoreDiff >= 5
                      ? `Les trades gagnants ont un meilleur score fondamental (+${scoreDiff} pts en moyenne).`
                      : scoreDiff <= -5
                      ? `Les trades perdants ont un score plus élevé (${scoreDiff} pts) — pas de corrélation positive.`
                      : `Corrélation faible sur ce jeu de données (écart : ${scoreDiff > 0 ? '+' : ''}${scoreDiff} pts).`}
                  </p>
                )}
              </div>

              {/* 2. Taux de réussite par tranche de score */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                  Taux de réussite par tranche de score
                </p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 px-2 font-medium">Score</th>
                      <th className="text-center py-2 px-2 font-medium">Trades</th>
                      <th className="text-right py-2 px-2 font-medium">Taux réussite</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {scoreCorr.map(b => (
                      <tr key={b.label} className={b.count === 0 ? 'opacity-30' : ''}>
                        <td className="py-2 px-2 font-mono text-slate-300">{b.label}</td>
                        <td className="py-2 px-2 text-center text-slate-400">{b.count}</td>
                        <td className={`py-2 px-2 text-right font-mono font-semibold ${
                          b.winRate === null ? 'text-slate-600'
                          : b.winRate >= 60 ? 'text-green-400'
                          : b.winRate >= 40 ? 'text-yellow-400'
                          : 'text-red-400'
                        }`}>
                          {b.winRate === null ? '—' : `${b.winRate.toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3">
                  <ScoreWinRateChart data={scoreCorr} />
                </div>
              </div>

              {/* 3. Sentiment */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                  Sentiment vs Taux de réussite
                </p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-2 px-2 font-medium">Sentiment</th>
                      <th className="text-center py-2 px-2 font-medium">Trades</th>
                      <th className="text-right py-2 px-2 font-medium">Taux réussite</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {sentBreakdown.map(s => (
                      <tr key={s.sentiment} className={s.count === 0 ? 'opacity-30' : ''}>
                        <td className="py-2 px-2"><SentimentBadge sentiment={s.sentiment} /></td>
                        <td className="py-2 px-2 text-center text-slate-400">{s.count}</td>
                        <td className={`py-2 px-2 text-right font-mono font-semibold ${
                          s.winRate === null ? 'text-slate-600'
                          : s.winRate >= 60 ? 'text-green-400'
                          : s.winRate >= 40 ? 'text-yellow-400'
                          : 'text-red-400'
                        }`}>
                          {s.winRate === null ? '—' : `${s.winRate.toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 4. Top 5 / Bottom 5 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-green-500 uppercase tracking-widest mb-2">
                    Meilleurs trades
                  </p>
                  <div className="space-y-1">
                    {top5.map(t => (
                      <div key={t.id} className="flex justify-between items-center text-xs bg-slate-800/40 rounded px-2 py-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-slate-200">{t.ticker}</span>
                          <ScoreBadge score={t.fundamental_score} />
                        </div>
                        <ResultBadge entry={t} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-widest mb-2">
                    Pires trades
                  </p>
                  <div className="space-y-1">
                    {bottom5.map(t => (
                      <div key={t.id} className="flex justify-between items-center text-xs bg-slate-800/40 rounded px-2 py-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-slate-200">{t.ticker}</span>
                          <ScoreBadge score={t.fundamental_score} />
                        </div>
                        <ResultBadge entry={t} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 5. Résumé global */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: 'Total analysés',
                    value: String(analyzed.length),
                    color: 'text-slate-300',
                  },
                  {
                    label: 'Taux de réussite',
                    value: `${Math.round((winLose.wins.count / (winLose.total || 1)) * 100)}%`,
                    color: winLose.wins.count / (winLose.total || 1) >= 0.5 ? 'text-green-400' : 'text-red-400',
                  },
                  {
                    label: 'Score moyen global',
                    value: analyzed.length > 0
                      ? String(Math.round(analyzed.reduce((s, t) => s + t.fundamental_score!, 0) / analyzed.length))
                      : '—',
                    color: 'text-blue-400',
                  },
                ].map(stat => (
                  <div key={stat.label} className="bg-slate-800/50 border border-slate-700 rounded-xl px-3 py-3 text-center">
                    <p className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
