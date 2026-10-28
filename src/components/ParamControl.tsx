// One scenario parameter rendered from its ParamSpec: slider / select / toggle + provenance.
import type { DataBundle, ParamSpec, Preset } from '../types/data';
import type { Horizon, ParamValue } from '../types/engine';
import { StatusBadge, SourceLinks } from './StatusBadge';
import { isNum } from '../lib/format';

export function fmtParam(v: ParamValue, unit: string | null): string {
  if (v == null) return 'AUTO';
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  if (typeof v === 'string') return v;
  if (!isNum(v)) return '—';
  switch (unit) {
    case 'frac':
      return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
    case 'pct':
      return `${v.toFixed(1)}%`;
    case 'bps':
      return `${v.toFixed(0)} bps`;
    case 'yrs':
      return `${v.toFixed(1)} yrs`;
    case 'x':
      return `${v.toFixed(1)}x`;
    case 'days':
      return `${v.toFixed(0)} d`;
    default:
      return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  }
}

/** Effective MC low/high for a param, including fullpop horizon overrides. */
export function mcBounds(spec: ParamSpec, preset: Preset, horizon: Horizon): { low: number | null; high: number | null; dist: string } | null {
  if (!spec.mc || spec.mc.dist === 'fixed') return null;
  const ov = preset.horizon_overrides?.[horizon]?.[spec.key];
  return {
    low: ov?.low ?? spec.mc.low,
    high: ov?.high ?? spec.mc.high,
    dist: spec.mc.dist,
  };
}

function tickerOptions(spec: ParamSpec, bundle: DataBundle): string[] {
  if (spec.options?.length) return spec.options;
  if (spec.key === 'target') {
    return [...bundle.origins.map((o) => o.ticker), ...bundle.india.map((t) => t.ticker)];
  }
  return [];
}

function windowOptions(spec: ParamSpec, bundle: DataBundle): string[] {
  if (spec.options?.length) return spec.options;
  return bundle.history.replay_windows.map((w) => w.id);
}

export default function ParamControl({
  spec,
  value,
  preset,
  horizon,
  bundle,
  onChange,
}: {
  spec: ParamSpec;
  value: ParamValue;
  preset: Preset;
  horizon: Horizon;
  bundle: DataBundle;
  onChange: (v: ParamValue) => void;
}) {
  const v = value === undefined ? spec.value : value;
  const mc = mcBounds(spec, preset, horizon);
  const label = (
    <span className="param-label" title={spec.note ?? undefined}>
      {spec.label}
      <StatusBadge status={spec.status} />
      <SourceLinks ids={spec.src} bundle={bundle} />
    </span>
  );

  if (spec.kind === 'bool') {
    return (
      <div className="param-row">
        {label}
        <button className={`btn ${v ? 'active' : ''}`} onClick={() => onChange(!v)}>
          {v ? 'ON' : 'OFF'}
        </button>
      </div>
    );
  }

  if (spec.kind === 'enum' || spec.kind === 'ticker' || spec.kind === 'window') {
    const opts =
      spec.kind === 'ticker' ? tickerOptions(spec, bundle) : spec.kind === 'window' ? windowOptions(spec, bundle) : spec.options ?? [];
    const labelFor = (o: string) => {
      if (spec.kind === 'window') {
        const w = bundle.history.replay_windows.find((x) => x.id === o);
        return w ? `${o} — ${w.label}` : o;
      }
      if (spec.kind === 'ticker') {
        const t = bundle.india.find((x) => x.ticker === o);
        const s = bundle.securities[o];
        return t ? `${t.display} (IN)` : s ? `${o} — ${s.name}` : o;
      }
      return o;
    };
    return (
      <div className="param-row">
        {label}
        <select value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => (
            <option key={o} value={o}>
              {labelFor(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // number
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const step = spec.step ?? (max - min) / 100;
  const isAuto = v == null;
  const numV = isNum(v) ? v : isNum(spec.value) ? (spec.value as number) : min;
  return (
    <div className="param-row param-num">
      {label}
      <div className="param-ctrl">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={numV}
          className={isAuto ? 'auto' : ''}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={spec.label}
        />
        <span className="param-val white">{isAuto ? 'AUTO' : fmtParam(numV, spec.unit)}</span>
        {spec.value == null && !isAuto && (
          <button className="btn btn-xs" onClick={() => onChange(null)} title="Return to automatic (data-calibrated) value">
            AUTO
          </button>
        )}
      </div>
      {mc && (
        <span className="param-mc muted" title={`Monte Carlo sampling: ${mc.dist}(low, mode = current value, high)`}>
          MC {mc.dist === 'triangular' ? 'TRI' : 'UNI'} {fmtParam(mc.low, spec.unit)}–{fmtParam(mc.high, spec.unit)}
        </span>
      )}
    </div>
  );
}
