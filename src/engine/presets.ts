// Preset lookup, ParamSpecs with horizon overrides, and default ScenarioParams.
import type { DataBundle, ParamSpec, Preset } from '../types/data';
import type { Horizon, ParamValue, PresetId, ScenarioParams } from '../types/engine';
import { weekdaysBetween } from './util';

export function presetById(bundle: DataBundle, id: PresetId): Preset | null {
  return (bundle.presets ?? []).find((p) => p.id === id) ?? null;
}

/** A stub used when the bundle lacks a preset (keeps ScenarioResult.preset non-null). */
export function stubPreset(id: PresetId): Preset {
  return {
    id,
    num: 0,
    label: id.toUpperCase(),
    description: 'Preset not defined in data.json',
    low_confidence: id === 'credit' || id === 'fullpop',
    params: [],
    horizon_overrides: null,
  };
}

function tickerOptions(bundle: DataBundle, preset: PresetId): string[] {
  const origins = (bundle.origins ?? []).map((o) => o.ticker);
  if (preset === 'guidance') {
    const chips = (bundle.origins ?? []).filter((o) => o.group === 'chips').map((o) => o.ticker);
    return chips.length ? chips : origins;
  }
  if (preset === 'restatement') return [...origins, ...(bundle.india ?? []).map((t) => t.ticker)];
  return origins;
}

/**
 * ParamSpecs of a preset with horizon overrides (fullpop) applied to `value` and MC bounds,
 * and option lists filled in for ticker / window params when the bundle left them null.
 */
export function paramSpecs(bundle: DataBundle, presetId: PresetId, horizon: Horizon): ParamSpec[] {
  const preset = presetById(bundle, presetId);
  if (!preset) return [];
  const ov = preset.horizon_overrides?.[horizon] ?? null;
  return preset.params.map((spec) => {
    const o = ov?.[spec.key];
    let next: ParamSpec = { ...spec };
    if (o) {
      next.value = o.value;
      if (next.mc && (o.low !== undefined || o.high !== undefined)) {
        next.mc = { ...next.mc, low: o.low ?? next.mc.low, high: o.high ?? next.mc.high };
      }
    }
    if (next.kind === 'ticker' && (!next.options || next.options.length === 0)) {
      next = { ...next, options: tickerOptions(bundle, presetId) };
    }
    if (next.kind === 'window' && (!next.options || next.options.length === 0)) {
      next = { ...next, options: (bundle.history?.replay_windows ?? []).map((w) => w.id) };
    }
    return next;
  });
}

/** Horizon that matches a replay window's length (MC residual accumulation). */
export function horizonForWindow(bundle: DataBundle, windowId: string | null | undefined): Horizon {
  const w = (bundle.history?.replay_windows ?? []).find((x) => x.id === windowId);
  if (!w) return '1D';
  const n = weekdaysBetween(w.start, w.end);
  if (n <= 5) return '1D';
  if (n <= 45) return '1M';
  return '12M';
}

export function defaultParams(bundle: DataBundle, preset: PresetId, horizon?: Horizon): ScenarioParams {
  let h: Horizon = horizon ?? (preset === 'fullpop' ? '12M' : '1M');
  const specs0 = paramSpecs(bundle, preset, h);
  if (!horizon && preset === 'replay') {
    const win = specs0.find((s) => s.kind === 'window');
    h = horizonForWindow(bundle, (win?.value as string) ?? win?.options?.[0] ?? null);
  }
  const specs = paramSpecs(bundle, preset, h);
  const values: Record<string, ParamValue> = {};
  for (const s of specs) {
    let v = s.value;
    if ((s.kind === 'window' || s.kind === 'ticker') && (v === null || v === '') && s.options?.length) v = s.options[0];
    values[s.key] = v;
  }
  return { preset, horizon: h, values, overrides: {}, premiumFloorZero: true };
}

/**
 * Change the horizon. For presets with horizon overrides (fullpop) the overridden keys are
 * reset to that horizon's defaults; every other key keeps the user's value.
 */
export function withHorizon(bundle: DataBundle, params: ScenarioParams, horizon: Horizon): ScenarioParams {
  const preset = presetById(bundle, params.preset);
  const ov = preset?.horizon_overrides?.[horizon] ?? null;
  const values = { ...params.values };
  if (ov) for (const [k, o] of Object.entries(ov)) values[k] = o.value;
  return { ...params, horizon, values };
}
