// Mild / Severe / Extreme, taken from the data bundle rather than invented: each preset's
// shock-size parameters already carry a Monte Carlo range (low … high) around the default, so
// Mild = the low end, Severe = the default, Extreme = the high end of that published range.
import type { DataBundle, ParamSpec } from '../../types/data';
import type { Horizon, ParamValue, PresetId } from '../../types/engine';
import { intensityValues as engineIntensity } from '../../engine';

export type Intensity = 'mild' | 'severe' | 'extreme';

export const INTENSITY_LABEL: Record<Intensity, string> = { mild: 'Mild', severe: 'Severe', extreme: 'Extreme' };

/** The parameters that set how big the shock is (pass-throughs and switches are left alone). */
export const SHOCK_KEYS: Record<PresetId, string[]> = {
  capex: ['c'],
  guidance: ['g'],
  restatement: ['r', 'd'],
  multiple: ['lambda', 'lambda_india'],
  credit: ['ds_bps', 'k', 'd_credit'],
  replay: [],
  fullpop: ['c', 'lambda', 'ds_bps', 'k', 'd_credit', 'lambda_india'],
};

/** Values for the shock-size keys at an intensity; keys without a usable MC range keep their default. */
export function intensityValues(preset: PresetId, specs: ParamSpec[], level: Intensity): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const key of SHOCK_KEYS[preset] ?? []) {
    const s = specs.find((x) => x.key === key);
    if (!s || typeof s.value !== 'number') continue;
    const lo = s.mc && s.mc.dist !== 'fixed' ? s.mc.low : null;
    const hi = s.mc && s.mc.dist !== 'fixed' ? s.mc.high : null;
    if (level === 'mild' && typeof lo === 'number') out[key] = lo;
    else if (level === 'extreme' && typeof hi === 'number') out[key] = hi;
    else out[key] = s.value;
  }
  return out;
}

/** Which intensity (if any) the current values match exactly. */
export function detectIntensity(preset: PresetId, specs: ParamSpec[], values: Record<string, ParamValue>): Intensity | null {
  const keys = SHOCK_KEYS[preset] ?? [];
  if (!keys.length) return null;
  for (const level of ['severe', 'mild', 'extreme'] as Intensity[]) {
    const iv = intensityValues(preset, specs, level);
    const match = Object.keys(iv).every((k) => {
      const cur = values[k] ?? specs.find((s) => s.key === k)?.value;
      return typeof cur === 'number' && typeof iv[k] === 'number' && Math.abs(cur - (iv[k] as number)) < 1e-9;
    });
    if (match && Object.keys(iv).length) return level;
  }
  return null;
}

/** Short caption under an intensity chip ("30% cut"), read off the shock-size values themselves. */
export function intensityCaption(preset: PresetId, values: Record<string, ParamValue>): string | null {
  const n = (k: string) => (typeof values[k] === 'number' && Number.isFinite(values[k]) ? (values[k] as number) : null);
  const p = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  switch (preset) {
    case 'capex':
    case 'fullpop':
      return n('c') !== null ? `${p(n('c')!)} cut` : null;
    case 'guidance':
      return n('g') !== null ? `sales −${p(n('g')!)}` : null;
    case 'restatement':
      return n('r') !== null ? `profit −${p(n('r')!)}` : null;
    case 'multiple':
      return n('lambda') !== null ? `${p(n('lambda')!)} of the gap` : null;
    case 'credit':
      return n('ds_bps') !== null ? `+${(n('ds_bps')! / 100).toFixed(1)} pts` : null;
    default:
      return null;
  }
}

export type Levels = Record<Intensity, Record<string, ParamValue>>;

/**
 * Mild / Severe / Extreme values for a preset at a horizon. The engine's intensityValues is the
 * single source (it moves every sampled dial to the end of its published range); the local
 * shock-size-only version above is the fallback when the engine has none for this preset.
 */
export function levelsFor(bundle: DataBundle, preset: PresetId, horizon: Horizon, specs: ParamSpec[]): Levels {
  try {
    const v = engineIntensity(bundle, preset, horizon);
    if (v && v.mild && v.severe && v.extreme && Object.keys(v.severe).length) return v;
  } catch {
    /* fall back to the local mapping */
  }
  return {
    mild: intensityValues(preset, specs, 'mild'),
    severe: intensityValues(preset, specs, 'severe'),
    extreme: intensityValues(preset, specs, 'extreme'),
  };
}

/** Which level the current values sit at exactly (null = customised, or no levels for this preset). */
export function levelOf(levels: Levels, values: Record<string, ParamValue>, specs: ParamSpec[]): Intensity | null {
  for (const level of ['severe', 'mild', 'extreme'] as Intensity[]) {
    const iv = levels[level];
    const keys = Object.keys(iv);
    if (!keys.length) continue;
    const hit = keys.every((k) => {
      const cur = values[k] ?? specs.find((s) => s.key === k)?.value;
      const want = iv[k];
      return typeof cur === 'number' && typeof want === 'number' && Math.abs(cur - want) < 1e-9;
    });
    if (hit) return level;
  }
  return null;
}
