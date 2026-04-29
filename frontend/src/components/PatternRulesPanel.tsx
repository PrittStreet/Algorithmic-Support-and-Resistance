import { useState } from 'react';
import type { PatternRulesConfig, RangeRules, WRules, ETERules, TriangleAscRules } from '../lib/patternLearning';
import { DEFAULT_PATTERN_RULES } from '../lib/patternLearning';

interface Props {
  rules: PatternRulesConfig;
  onRulesChange: (r: PatternRulesConfig) => void;
}

// ── Compact slider + number row ───────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  tooltip?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, unit, tooltip, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2 py-0.5" title={tooltip}>
      <span className="text-xs text-slate-500 w-28 shrink-0 leading-tight">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 cursor-pointer accent-blue-500"
      />
      <span className="text-xs text-slate-300 font-mono w-14 text-right shrink-0">
        {value}{unit}
      </span>
    </div>
  );
}

// ── Pattern section wrapper ───────────────────────────────────────────────────

interface SectionProps {
  name: string;
  color: string;
  enabled: boolean;
  onToggle: () => void;
  onReset: () => void;
  children: React.ReactNode;
}

function PatternSection({ name, color, enabled, onToggle, onReset, children }: SectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-xl border transition-colors ${enabled ? 'border-slate-700 bg-slate-800/40' : 'border-slate-800 bg-slate-900/30'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => enabled && setOpen(o => !o)}
        >
          <span className="text-xs font-semibold" style={{ color: enabled ? color : '#475569' }}>{name}</span>
          {enabled && (
            <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
          )}
        </button>
        {/* Enable toggle */}
        <button
          onClick={onToggle}
          className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
          title={enabled ? 'Désactiver' : 'Activer'}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Collapsible body */}
      {enabled && open && (
        <div className="px-3 pb-3 border-t border-slate-700/50 pt-2 space-y-0.5">
          {children}
          <div className="pt-2">
            <button
              onClick={onReset}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              ↺ Réinitialiser {name}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PatternRulesPanel({ rules, onRulesChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const setRange = (patch: Partial<RangeRules>) =>
    onRulesChange({ ...rules, Range: { ...rules.Range, ...patch } });
  const setW = (patch: Partial<WRules>) =>
    onRulesChange({ ...rules, W: { ...rules.W, ...patch } });
  const setETE = (patch: Partial<ETERules>) =>
    onRulesChange({ ...rules, ETE: { ...rules.ETE, ...patch } });
  const setTri = (patch: Partial<TriangleAscRules>) =>
    onRulesChange({ ...rules, TriangleAscendant: { ...rules.TriangleAscendant, ...patch } });

  const activeCount = [rules.Range.enabled, rules.W.enabled, rules.ETE.enabled, rules.TriangleAscendant.enabled]
    .filter(Boolean).length;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
      {/* Panel header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Règles géométriques</span>
          {activeCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-900/60 text-blue-400 font-mono">
              {activeCount} actif{activeCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-slate-600 text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-800">
          <p className="text-xs text-slate-600 pt-2 leading-relaxed">
            Détection sans annotations — basée sur des règles géométriques pures.
          </p>

          {/* ── Range ── */}
          <PatternSection
            name="Range"
            color="#f59e0b"
            enabled={rules.Range.enabled}
            onToggle={() => setRange({ enabled: !rules.Range.enabled })}
            onReset={() => onRulesChange({ ...rules, Range: { ...DEFAULT_PATTERN_RULES.Range } })}
          >
            <SliderRow label="Lookback pivot" value={rules.Range.pivotLookback}
              min={1} max={10} step={1} unit=" bars"
              tooltip="Nombre de bars de chaque côté pour valider un pivot haut/bas"
              onChange={v => setRange({ pivotLookback: v })} />
            <SliderRow label="Tolérance touch" value={rules.Range.touchTolerance}
              min={0.5} max={15} step={0.5} unit="%"
              tooltip="Zone de touch en % de la hauteur du range"
              onChange={v => setRange({ touchTolerance: v })} />
            <SliderRow label="Min touches (fort)" value={rules.Range.minTouchesMaxSide}
              min={2} max={7} step={1} unit=""
              tooltip="Nombre minimum de touches côté dominant (la règle 3)"
              onChange={v => setRange({ minTouchesMaxSide: v })} />
            <SliderRow label="Min touches (faible)" value={rules.Range.minTouchesMinSide}
              min={1} max={5} step={1} unit=""
              tooltip="Nombre minimum de touches côté secondaire (la règle 2)"
              onChange={v => setRange({ minTouchesMinSide: v })} />
            <SliderRow label="Planéité max" value={rules.Range.flatnessMax}
              min={1} max={20} step={0.5} unit="%"
              tooltip="Dispersion maximale des touches (std / hauteur range)"
              onChange={v => setRange({ flatnessMax: v })} />
            <SliderRow label="Durée minimum" value={rules.Range.minDurationBars}
              min={5} max={100} step={5} unit=" bars"
              tooltip="Nombre minimal de bars entre le premier et le dernier touch"
              onChange={v => setRange({ minDurationBars: v })} />
            <SliderRow label="Hauteur min" value={rules.Range.minHeightPct}
              min={0.5} max={10} step={0.5} unit="%"
              tooltip="Hauteur minimale du range en % du prix"
              onChange={v => setRange({ minHeightPct: v })} />
            <SliderRow label="Hauteur max" value={rules.Range.maxHeightPct}
              min={5} max={50} step={1} unit="%"
              tooltip="Hauteur maximale du range en % du prix"
              onChange={v => setRange({ maxHeightPct: v })} />
          </PatternSection>

          {/* ── W ── */}
          <PatternSection
            name="W (Double Fond)"
            color="#3b82f6"
            enabled={rules.W.enabled}
            onToggle={() => setW({ enabled: !rules.W.enabled })}
            onReset={() => onRulesChange({ ...rules, W: { ...DEFAULT_PATTERN_RULES.W } })}
          >
            <SliderRow label="Lookback pivot" value={rules.W.pivotLookback}
              min={1} max={10} step={1} unit=" bars"
              tooltip="Nombre de bars de chaque côté pour valider un creux"
              onChange={v => setW({ pivotLookback: v })} />
            <SliderRow label="Symétrie jambes" value={rules.W.legSymmetryMax}
              min={1} max={20} step={0.5} unit="%"
              tooltip="Écart maximal entre les deux bas du W"
              onChange={v => setW({ legSymmetryMax: v })} />
            <SliderRow label="Lift neckline min" value={rules.W.necklineMinLiftPct}
              min={0.5} max={10} step={0.5} unit="%"
              tooltip="La neckline doit être au moins X% au-dessus des bas"
              onChange={v => setW({ necklineMinLiftPct: v })} />
            <SliderRow label="Bars entre bas" value={rules.W.minBarsBetweenLows}
              min={3} max={50} step={1} unit=" bars"
              tooltip="Nombre minimal de bars séparant les deux creux"
              onChange={v => setW({ minBarsBetweenLows: v })} />
            <SliderRow label="Durée minimum" value={rules.W.minDurationBars}
              min={5} max={60} step={5} unit=" bars"
              onChange={v => setW({ minDurationBars: v })} />
          </PatternSection>

          {/* ── ETE ── */}
          <PatternSection
            name="ÉTE (Tête & Épaules)"
            color="#ec4899"
            enabled={rules.ETE.enabled}
            onToggle={() => setETE({ enabled: !rules.ETE.enabled })}
            onReset={() => onRulesChange({ ...rules, ETE: { ...DEFAULT_PATTERN_RULES.ETE } })}
          >
            <SliderRow label="Lookback pivot" value={rules.ETE.pivotLookback}
              min={1} max={10} step={1} unit=" bars"
              onChange={v => setETE({ pivotLookback: v })} />
            <SliderRow label="Symétrie épaules" value={rules.ETE.shoulderSymmetryMax}
              min={1} max={30} step={1} unit="%"
              tooltip="Écart maximal entre les deux épaules"
              onChange={v => setETE({ shoulderSymmetryMax: v })} />
            <SliderRow label="Lift tête min" value={rules.ETE.headLiftMin}
              min={1} max={20} step={0.5} unit="%"
              tooltip="La tête doit être au moins X% plus haute que les épaules"
              onChange={v => setETE({ headLiftMin: v })} />
            <SliderRow label="Pente neckline max" value={rules.ETE.necklineSlopeMax}
              min={0.5} max={15} step={0.5} unit="%"
              tooltip="Écart maximal entre les deux points de neckline"
              onChange={v => setETE({ necklineSlopeMax: v })} />
            <SliderRow label="Durée minimum" value={rules.ETE.minDurationBars}
              min={10} max={120} step={5} unit=" bars"
              onChange={v => setETE({ minDurationBars: v })} />
          </PatternSection>

          {/* ── Triangle Ascendant ── */}
          <PatternSection
            name="Triangle Ascendant"
            color="#22c55e"
            enabled={rules.TriangleAscendant.enabled}
            onToggle={() => setTri({ enabled: !rules.TriangleAscendant.enabled })}
            onReset={() => onRulesChange({ ...rules, TriangleAscendant: { ...DEFAULT_PATTERN_RULES.TriangleAscendant } })}
          >
            <SliderRow label="Lookback pivot" value={rules.TriangleAscendant.pivotLookback}
              min={1} max={10} step={1} unit=" bars"
              onChange={v => setTri({ pivotLookback: v })} />
            <SliderRow label="Pente résistance max" value={rules.TriangleAscendant.resistanceSlopeMax}
              min={0.1} max={5} step={0.1} unit="%/100b"
              tooltip="Pente maximale de la droite de résistance (doit être quasi plate)"
              onChange={v => setTri({ resistanceSlopeMax: v })} />
            <SliderRow label="Pente support min" value={rules.TriangleAscendant.supportSlopeMin}
              min={0.1} max={5} step={0.1} unit="%/100b"
              tooltip="Pente minimale du support (doit monter)"
              onChange={v => setTri({ supportSlopeMin: v })} />
            <SliderRow label="Min pivots / côté" value={rules.TriangleAscendant.minPivots}
              min={2} max={6} step={1} unit=""
              tooltip="Nombre minimal de pivots pour établir chaque droite"
              onChange={v => setTri({ minPivots: v })} />
            <SliderRow label="Durée minimum" value={rules.TriangleAscendant.minDurationBars}
              min={10} max={120} step={5} unit=" bars"
              onChange={v => setTri({ minDurationBars: v })} />
          </PatternSection>

          {/* Reset all */}
          <button
            onClick={() => onRulesChange({ ...DEFAULT_PATTERN_RULES })}
            className="w-full text-xs text-slate-600 hover:text-slate-400 py-1.5 transition-colors border border-slate-800 rounded-lg hover:border-slate-700"
          >
            ↺ Tout réinitialiser aux valeurs par défaut
          </button>
        </div>
      )}
    </div>
  );
}
