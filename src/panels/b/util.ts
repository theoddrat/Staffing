// Pure helpers for the F4/F5/F6 panels (UI-B). No React, no DOM — unit-tested in __tests__.
import type {
  CrashType,
  DataBundle,
  ParamSpec,
  Part,
  Quantity,
  Rolling,
  Status,
  Tier,
} from '../../types/data';
import type { ScenarioParams } from '../../types/engine';

export const TIERS: Tier[] = ['A', 'B', 'C', 'D'];

export function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Log move -> simple move (exp(x) - 1); null-safe. */
export function logToSimple(x: number | null | undefined): number | null {
  return isFiniteNum(x) ? Math.expm1(x) : null;
}

export function mean(xs: (number | null | undefined)[]): number | null {
  let s = 0;
  let n = 0;
  for (const x of xs) {
    if (isFiniteNum(x)) {
      s += x;
      n += 1;
    }
  }
  return n ? s / n : null;
}

/** Ordinary least squares y = a + b x over finite pairs. Null when < 3 points or no x-variance. */
export function olsLine(
  xs: number[],
  ys: number[],
): { a: number; b: number; r2: number; n: number; xmin: number; xmax: number } | null {
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (isFiniteNum(xs[i]) && isFiniteNum(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }
  const n = px.length;
  if (n < 3) return null;
  const mx = px.reduce((s, v) => s + v, 0) / n;
  const my = py.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i] - mx;
    const dy = py[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { a, b, r2, n, xmin: Math.min(...px), xmax: Math.max(...px) };
}

/** Average of each rolling coefficient for windows ending before vs on/after `pivot` (ISO date). */
export function prePostAverages(
  rolling: Rolling | null | undefined,
  pivot: string,
): { key: 'SOX' | 'NDX' | 'PARENT' | 'NIFTY' | 'r2'; pre: number | null; post: number | null }[] {
  if (!rolling || !rolling.dates?.length) return [];
  const keys: ('SOX' | 'NDX' | 'PARENT' | 'NIFTY' | 'r2')[] = ['SOX', 'NDX'];
  if (rolling.PARENT) keys.push('PARENT');
  keys.push('NIFTY', 'r2');
  return keys.map((key) => {
    const series = (key === 'PARENT' ? rolling.PARENT : rolling[key]) ?? [];
    const pre: (number | null)[] = [];
    const post: (number | null)[] = [];
    rolling.dates.forEach((d, i) => {
      (d < pivot ? pre : post).push(series[i] ?? null);
    });
    return { key, pre: mean(pre), post: mean(post) };
  });
}

/** Symmetric colour-scale bound: the q-quantile of |values| (robust to outliers), at least `floor`. */
export function symmetricBound(values: (number | null | undefined)[], q = 0.95, floor = 1e-6): number {
  const abs = values.filter(isFiniteNum).map((v) => Math.abs(v)).sort((a, b) => a - b);
  if (!abs.length) return 1;
  const idx = Math.min(abs.length - 1, Math.max(0, Math.ceil(q * abs.length) - 1));
  return Math.max(abs[idx], floor);
}

const STATUS_RANK: Record<Status, number> = {
  COMPUTED: 0,
  SOURCED: 1,
  DERIVED: 1,
  UNVERIFIED: 2,
  USER_ASSUMPTION: 3,
};

/** True when the quantity (or any of its parts) rests on an unverified figure or a user assumption. */
export function needsAttention(q: Pick<Quantity, 'status' | 'parts'> | null | undefined): boolean {
  if (!q) return false;
  if (q.status === 'USER_ASSUMPTION' || q.status === 'UNVERIFIED') return true;
  return (q.parts ?? []).some((p: Part) => p.status === 'USER_ASSUMPTION' || p.status === 'UNVERIFIED');
}

/** Worst status among a quantity's own status and its parts (USER_ASSUMPTION > UNVERIFIED > SOURCED > COMPUTED). */
export function worstStatus(q: Pick<Quantity, 'status' | 'parts'>): Status {
  let worst: Status = q.status;
  for (const p of q.parts ?? []) if (STATUS_RANK[p.status] > STATUS_RANK[worst]) worst = p.status;
  return worst;
}

export type RegisterGroup = 'global' | 'origin' | 'india' | 'calibration' | 'preset';

export interface RegisterRow {
  kind: 'quantity';
  id: string;
  group: RegisterGroup;
  owner: string; // ticker or 'GLOBAL'
  q: Quantity;
}

export interface RegisterParamRow {
  kind: 'param';
  id: string; // `${presetId}.${key}`
  group: 'preset';
  owner: string; // preset label
  spec: ParamSpec;
}

/** Every Quantity in the bundle, tagged with its group and owner (de-duplicated by id, first wins). */
export function allQuantities(bundle: DataBundle): RegisterRow[] {
  const rows: RegisterRow[] = [];
  const seen = new Set<string>();
  const push = (q: Quantity | null | undefined, group: RegisterGroup, owner: string) => {
    if (!q || !q.id || seen.has(q.id)) return;
    seen.add(q.id);
    rows.push({ kind: 'quantity', id: q.id, group, owner, q });
  };
  for (const q of bundle.assumptions ?? []) push(q, 'global', 'GLOBAL');
  for (const o of bundle.origins ?? []) {
    push(o.hyperscaler_share, 'origin', o.ticker);
    push(o.neocloud_share, 'origin', o.ticker);
    push(bundle.securities?.[o.ticker]?.op_leverage, 'origin', o.ticker);
  }
  for (const t of bundle.india ?? []) {
    for (const e of t.exposures ?? []) push(e.share, 'india', t.display || t.ticker);
    push(t.parent_stake, 'india', t.display || t.ticker);
    push(t.fx_margin_sens_bps, 'india', t.display || t.ticker);
    push(bundle.securities?.[t.ticker]?.op_leverage, 'india', t.display || t.ticker);
  }
  push(bundle.fx?.default_f, 'calibration', 'FX');
  push(bundle.calibration?.contagion_us, 'calibration', 'US');
  push(bundle.calibration?.contagion_india, 'calibration', 'INDIA');
  return rows;
}

/** Assumption register: quantities resting on USER_ASSUMPTION / UNVERIFIED inputs + the active preset's assumption params. */
export function collectRegister(bundle: DataBundle, presetId: string | null): (RegisterRow | RegisterParamRow)[] {
  const out: (RegisterRow | RegisterParamRow)[] = allQuantities(bundle).filter((r) => needsAttention(r.q));
  const preset = (bundle.presets ?? []).find((p) => p.id === presetId);
  if (preset) {
    for (const spec of preset.params ?? []) {
      if (spec.status === 'USER_ASSUMPTION' || spec.status === 'UNVERIFIED') {
        out.push({ kind: 'param', id: `${preset.id}.${spec.key}`, group: 'preset', owner: preset.label, spec });
      }
    }
  }
  return out;
}

/** Effective value of a quantity after user overrides. */
export function effectiveValue(q: Quantity, params: ScenarioParams | null | undefined): number | null {
  const o = params?.overrides?.[q.id];
  return isFiniteNum(o) ? o : q.value;
}

/** Sensible slider bounds for a quantity lacking explicit min/max. */
export function sliderBounds(q: Pick<Quantity, 'min' | 'max' | 'step' | 'unit' | 'value'>): { min: number; max: number; step: number } {
  const v = isFiniteNum(q.value) ? q.value : 0;
  let min = isFiniteNum(q.min) ? q.min : null;
  let max = isFiniteNum(q.max) ? q.max : null;
  let step = isFiniteNum(q.step) ? q.step : null;
  const unit = q.unit ?? '';
  if (min === null || max === null) {
    if (unit === 'frac') {
      min = min ?? 0;
      max = max ?? Math.max(1, v * 2);
    } else if (unit === 'bps') {
      min = min ?? Math.min(0, v * 2);
      max = max ?? Math.max(100, v * 2);
    } else if (unit === 'x') {
      min = min ?? 0;
      max = max ?? Math.max(5, v * 2);
    } else {
      const span = Math.max(Math.abs(v), 1);
      min = min ?? Math.min(0, v - span);
      max = max ?? v + span;
    }
  }
  if (step === null) step = unit === 'frac' ? 0.01 : unit === 'bps' ? 1 : (max - min) / 100 || 0.01;
  if (min > max) [min, max] = [max, min];
  return { min, max, step };
}

/** Where each source id is cited (labels), plus ids cited but missing from bundle.sources. */
export function sourceUsage(bundle: DataBundle): { usage: Map<string, string[]>; missing: Map<string, string[]> } {
  const usage = new Map<string, string[]>();
  const known = new Set((bundle.sources ?? []).map((s) => s.id));
  const missing = new Map<string, string[]>();
  const cite = (ids: string[] | null | undefined, where: string) => {
    for (const id of ids ?? []) {
      if (!id) continue;
      const target = known.has(id) ? usage : missing;
      const list = target.get(id) ?? [];
      if (!list.includes(where)) list.push(where);
      target.set(id, list);
    }
  };
  const citeQ = (q: Quantity | null | undefined, where?: string) => {
    if (!q) return;
    const w = where ?? q.id;
    cite(q.src, w);
    for (const p of q.parts ?? []) cite(p.src, w);
  };
  for (const r of allQuantities(bundle)) citeQ(r.q);
  for (const o of bundle.origins ?? []) for (const c of o.concentration ?? []) cite(c.src, `${o.ticker}.concentration`);
  for (const p of bundle.presets ?? []) for (const s of p.params ?? []) cite(s.src, `preset.${p.id}.${s.key}`);
  cite(bundle.meta?.pre_chatgpt?.src, 'meta.pre_chatgpt');
  const h = bundle.history;
  if (h) {
    for (const c of h.cases ?? []) {
      cite(c.src, `case.${c.id}`);
      for (const d of c.drawdowns ?? []) cite(d.src, `case.${c.id}.drawdown.${d.label}`);
    }
    for (const e of h.event_studies ?? []) cite(e.src, `event.${e.id}`);
    for (const p of h.pe_vs_drawdown ?? []) cite(p.src, `pe_vs_drawdown.${p.id}`);
    for (const w of h.replay_windows ?? []) cite(w.src, `replay.${w.id}`);
  }
  return { usage, missing };
}

export const CRASH_TYPE_LABEL: Record<CrashType, string> = {
  earnings_collapse: 'EARNINGS COLLAPSE',
  multiple_compression: 'MULTIPLE COMPRESSION',
  fraud_trust: 'FRAUD & TRUST',
  credit_liquidity: 'CREDIT & LIQUIDITY',
  capex_overbuild: 'CAPEX OVERBUILD',
};

export const CRASH_TYPE_SHORT: Record<CrashType, string> = {
  earnings_collapse: 'EARN',
  multiple_compression: 'MULT',
  fraud_trust: 'FRAUD',
  credit_liquidity: 'CREDIT',
  capex_overbuild: 'CAPEX',
};

/** Match a `HIST <ID>` focus string against case / event ids & names (case-insensitive). */
export function matchFocus(
  focus: string | null | undefined,
  cases: { id: string; name: string }[],
  events: { id: string; label: string }[],
): { caseId: string | null; eventId: string | null } {
  if (!focus) return { caseId: null, eventId: null };
  const f = focus.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!f) return { caseId: null, eventId: null };
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const pick = <T,>(xs: T[], id: (x: T) => string, name: (x: T) => string): T | undefined =>
    xs.find((x) => norm(id(x)) === f) ??
    xs.find((x) => norm(id(x)).startsWith(f) || norm(name(x)).startsWith(f)) ??
    xs.find((x) => norm(id(x)).includes(f) || norm(name(x)).includes(f));
  const c = pick(cases, (x) => x.id, (x) => x.name);
  const e = pick(events, (x) => x.id, (x) => x.label);
  return { caseId: c?.id ?? null, eventId: e?.id ?? null };
}

/** Day offsets for an event window, e.g. [-5, 60] -> [-5, ..., 60]. */
export function windowDays(win: [number, number] | null | undefined, len: number): number[] {
  const start = win && isFiniteNum(win[0]) ? win[0] : -5;
  return Array.from({ length: len }, (_, i) => start + i);
}

/**
 * Robust axis range: [q_lo, q_hi] quantiles of the finite values, padded by `pad` of the span and
 * widened to include 0. Returns the number of values outside the range (shown as a caption).
 */
export function robustRange(
  values: (number | null | undefined)[],
  qlo = 0.005,
  qhi = 0.995,
  pad = 0.15,
): { min: number; max: number; outside: number } | null {
  const xs = values.filter(isFiniteNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  let lo = Math.min(at(qlo), 0);
  let hi = Math.max(at(qhi), 0);
  const span = hi - lo || Math.abs(hi) || 1;
  lo -= pad * span;
  hi += pad * span;
  const outside = xs.filter((v) => v < lo || v > hi).length;
  return { min: lo, max: hi, outside };
}

/** Hostname for a URL, or the raw string when it does not parse. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
