// Resolve ScenarioParams (+ user overrides) into plain numbers for the numeric core.
import type { ParamValue, ScenarioParams } from '../types/engine';
import type { Prep } from './prepare';
import { effective, quantityIndex } from './quantities';
import type { ResolvedParams } from './types-extra';
import { clamp, isFiniteNum } from './util';

/**
 * Neutral values used ONLY when neither the active preset nor bundle.assumptions define a key.
 * Shock sizes fall back to 0 (no shock); transmission multipliers to 1 (identity, i.e. the
 * DESIGN.md formula without attenuation). Every use is reported in warnings.
 */
const NEUTRAL: Record<string, number> = {
  c: 0,
  g: 0,
  r: 0,
  d: 0,
  lambda: 0,
  kappa: 0,
  ds_bps: 0,
  duration: 0,
  k: 0,
  d_credit: 0,
  lambda_india: 0,
  psi_supplier: 1,
  psi_india_dc: 1,
  phi_it: 1,
  sympathy: 1,
};

/** Keys each preset needs; used to decide when a missing key deserves a warning. */
const NEEDS: Record<string, string[]> = {
  capex: ['c', 'psi_supplier', 'kappa', 'phi_it', 'psi_india_dc', 'lambda_india'],
  guidance: ['g', 'kappa', 'sympathy', 'phi_it', 'psi_india_dc', 'lambda_india'],
  restatement: ['r', 'd', 'lambda_india'],
  multiple: ['lambda', 'lambda_india'],
  credit: ['ds_bps', 'duration', 'k', 'd_credit', 'psi_supplier', 'psi_india_dc', 'lambda_india'],
  replay: [],
  fullpop: ['c', 'psi_supplier', 'psi_india_dc', 'phi_it', 'lambda', 'ds_bps', 'duration', 'k', 'd_credit', 'lambda_india'],
};

const COMPONENTS: Record<string, ResolvedParams['comp']> = {
  capex: { capex: true, guidance: false, restatement: false, multiple: false, credit: false, replay: false },
  guidance: { capex: false, guidance: true, restatement: false, multiple: false, credit: false, replay: false },
  restatement: { capex: false, guidance: false, restatement: true, multiple: false, credit: false, replay: false },
  multiple: { capex: false, guidance: false, restatement: false, multiple: true, credit: false, replay: false },
  credit: { capex: false, guidance: false, restatement: false, multiple: false, credit: true, replay: false },
  replay: { capex: false, guidance: false, restatement: false, multiple: false, credit: false, replay: true },
  fullpop: { capex: true, guidance: false, restatement: false, multiple: true, credit: true, replay: false },
};

function asNumber(v: ParamValue | undefined): number | null {
  if (isFiniteNum(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asBool(v: ParamValue | undefined, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return dflt;
}

/** Sanity clamps on numeric params (shock fractions cannot exceed 100%). Mutates and returns v. */
export function clampValues(v: Record<string, number>): Record<string, number> {
  for (const key of ['c', 'g', 'r', 'd', 'k', 'd_credit']) if (key in v) v[key] = clamp(v[key], -1, 0.99);
  if ('lambda' in v) v.lambda = clamp(v.lambda, -1, 1);
  if ('lambda_india' in v) v.lambda_india = clamp(v.lambda_india, -1, 1);
  if ('ds_bps' in v) v.ds_bps = Math.max(0, v.ds_bps);
  if ('duration' in v) v.duration = Math.max(0, v.duration);
  for (const key of ['psi_supplier', 'psi_india_dc', 'phi_it', 'sympathy']) if (key in v) v[key] = Math.max(0, v[key]);
  return v;
}

export function resolveParams(prep: Prep, params: ScenarioParams): ResolvedParams {
  const bundle = prep.bundle;
  const warnings: string[] = [];
  const values = params.values ?? {};
  const overrides = params.overrides ?? {};
  const qIdx = quantityIndex(bundle);
  const comp = COMPONENTS[params.preset] ?? COMPONENTS.capex;
  if (!COMPONENTS[params.preset]) warnings.push(`unknown preset '${params.preset}', treated as capex`);

  const v: Record<string, number> = {};
  // numeric values present in params
  for (const [k, raw] of Object.entries(values)) {
    const n = asNumber(raw);
    if (n !== null) v[k] = n;
  }
  // fill missing keys: override of assump.<key> → bundle assumption → neutral
  const needed = new Set([...(NEEDS[params.preset] ?? []), ...Object.keys(NEUTRAL)]);
  for (const key of needed) {
    if (key in v) continue;
    const id = `assump.${key}`;
    const eff = effective(qIdx.get(id), overrides, id);
    if (eff.value !== null) {
      v[key] = eff.value;
      continue;
    }
    v[key] = NEUTRAL[key] ?? 0;
    if ((NEEDS[params.preset] ?? []).includes(key)) {
      warnings.push(`parameter '${key}' not defined by preset or assumptions: neutral value ${v[key]} used`);
    }
  }
  clampValues(v);

  const modeRaw = typeof values.mode === 'string' ? values.mode.toLowerCase() : values.mode;
  const mode: ResolvedParams['mode'] = modeRaw === 'multiple' ? 'multiple' : modeRaw === 'calibrated' ? 'calibrated' : 'median';
  if (modeRaw !== undefined && modeRaw !== null && modeRaw !== 'median' && modeRaw !== mode)
    warnings.push(`unknown multiple mode '${String(values.mode)}': using median reversion`);
  const target_pe = asNumber(values.target_pe);
  const fo = asNumber(values.f_override);

  // targets
  let guidanceTarget = -1;
  if (comp.guidance) {
    const t = values.target;
    if (typeof t === 'string' && prep.originIdx.has(t)) guidanceTarget = prep.originIdx.get(t)!;
    else warnings.push(`guidance target '${String(t)}' is not a shock origin: no guidance shock applied`);
  }
  let restTarget: ResolvedParams['restTarget'] = null;
  let contagion = 0;
  if (comp.restatement) {
    const t = values.target;
    if (typeof t === 'string' && prep.originIdx.has(t)) restTarget = { kind: 'origin', idx: prep.originIdx.get(t)! };
    else if (typeof t === 'string' && prep.indiaIdx.has(t)) restTarget = { kind: 'india', idx: prep.indiaIdx.get(t)! };
    else warnings.push(`restatement target '${String(t)}' not found: no restatement applied`);
    const c = asNumber(values.contagion);
    if (c !== null) contagion = c;
    else if (restTarget) {
      const id = restTarget.kind === 'origin' ? 'calib.contagion_us' : 'calib.contagion_india';
      const eff = effective(qIdx.get(id), overrides, id);
      if (eff.value !== null) contagion = eff.value;
      else warnings.push(`${id} missing: contagion set to 0`);
    }
  }
  let windowId: string | null = null;
  if (comp.replay) {
    const w = values.window;
    if (typeof w === 'string' && prep.windows.has(w)) windowId = w;
    else {
      const first = prep.windows.keys().next();
      windowId = first.done ? null : first.value;
      warnings.push(
        windowId ? `replay window '${String(w)}' not found: using '${windowId}'` : 'no replay windows in bundle: replay applies no move',
      );
    }
  }

  const pf = effective(qIdx.get('assump.premium_fallback'), overrides, 'assump.premium_fallback').value;
  const horizon = params.horizon === '1D' || params.horizon === '1M' || params.horizon === '12M' ? params.horizon : '1M';
  if (horizon !== params.horizon) warnings.push(`horizon '${String(params.horizon)}' unknown: 1M used`);
  return {
    preset: params.preset,
    horizon,
    premiumFallback: pf === null ? true : pf !== 0,
    v,
    mode,
    per_name: asBool(values.per_name, false),
    floor_zero: asBool(values.floor_zero, true),
    target_pe: target_pe !== null && target_pe > 0 ? target_pe : null,
    f_override: fo !== null ? Math.max(-0.5, Math.min(fo, 1)) : null,
    guidanceTarget,
    restTarget,
    contagion,
    windowId,
    premiumFloorZero: params.premiumFloorZero !== false,
    comp,
    warnings,
  };
}

/** Quantities resolved to numbers (overrides applied) for one evaluation. */
/** Origins whose earnings respond to the capex/credit channels (hyperscalers/software only via multiples). */
function rqNeedsOL(group: string): boolean {
  return group === 'chips' || group === 'infra';
}

export interface ResolvedQuantities {
  s: Float64Array; // hyperscaler share per origin
  neo: Float64Array; // neocloud share per origin
  olO: Float64Array; // operating leverage per origin
  sNeoAvg: number; // mcap-weighted neocloud share of AI suppliers (credit → India capex channel)
  india: {
    shares: number[];
    shareAssump: boolean[];
    ol: number;
    olAssump: boolean;
    fxSens: number;
    fxAssump: boolean;
  }[];
  warnings: string[];
}

export function resolveQuantities(prep: Prep, overrides: Record<string, number> | undefined): ResolvedQuantities {
  const warnings: string[] = [];
  const qIdx = quantityIndex(prep.bundle);
  // declared fallback for missing operating leverage (assump.op_leverage_default), else identity 1.0
  const olDefault = effective(qIdx.get('assump.op_leverage_default'), overrides, 'assump.op_leverage_default').value;
  const olFallback = olDefault !== null ? olDefault : 1;
  const olFallbackLabel = olDefault !== null ? `assump.op_leverage_default ${olFallback}` : 'identity 1.0';
  const nO = prep.origins.length;
  const s = new Float64Array(nO);
  const neo = new Float64Array(nO);
  const olO = new Float64Array(nO);
  prep.origins.forEach((o, i) => {
    s[i] = clamp(effective(o.qS, overrides, `${o.ticker}.hyperscaler_share`).value ?? 0, 0, 1);
    neo[i] = clamp(effective(o.qNeo, overrides, `${o.ticker}.neocloud_share`).value ?? 0, 0, 1);
    const ol = effective(o.qOL, overrides, `${o.ticker}.op_leverage`).value;
    if (ol === null && (rqNeedsOL(o.group))) warnings.push(`${o.ticker}: operating leverage missing, ${olFallbackLabel} used`);
    olO[i] = clamp(ol ?? olFallback, 0, 10);
  });
  // mcap-weighted neocloud share across AI suppliers (chips + infra): the fraction of AI-supplier
  // value tied to neocloud / AI-cloud capex. Mcap (USD) is used rather than revenue so that
  // statement-currency differences (e.g. ADRs reporting in TWD/EUR) cannot distort the weights.
  let num = 0;
  let den = 0;
  prep.origins.forEach((o, i) => {
    if (o.group !== 'chips' && o.group !== 'infra') return;
    const w = o.mcapUsd ?? 0;
    num += w * neo[i];
    den += w;
  });
  const sNeoAvg = den > 0 ? num / den : 0;

  const india = prep.india.map((t) => {
    const effs = t.exposures.map((e) => effective(e.q, overrides, e.q?.id));
    const ol = effective(t.qOL, overrides, `${t.ticker}.op_leverage`);
    if (ol.value === null && t.exposures.length) warnings.push(`${t.ticker}: operating leverage missing, ${olFallbackLabel} used`);
    const fx = effective(t.qFx, overrides, `${t.ticker}.fx_margin_sens_bps`);
    return {
      shares: effs.map((e) => clamp(e.value ?? 0, 0, 1)),
      shareAssump: effs.map((e) => e.assumption),
      ol: clamp(ol.value ?? olFallback, 0, 10),
      olAssump: ol.value === null ? true : ol.assumption,
      fxSens: fx.value ?? 0,
      fxAssump: fx.value === null ? true : fx.assumption,
    };
  });
  return { s, neo, olO, sNeoAvg, india, warnings };
}
