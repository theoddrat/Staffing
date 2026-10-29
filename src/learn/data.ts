// Data helpers for the Learn layer: every live example and data-driven illustration reads the
// bundle / scenario result through these, so missing data degrades to `null` instead of NaN.
import type { DataBundle, IndiaTarget, Quantity, Security, Status, Tier } from '../types/data';
import type { IndiaResult, ParamValue, PresetId, ScenarioResult } from '../types/engine';
import { isNum } from '../lib/format';

export interface LearnData {
  bundle: DataBundle | null;
  result: ScenarioResult | null;
}

/** log return -> simple return */
export const simple = (x: number) => Math.exp(x) - 1;

export function sec(b: DataBundle | null, ticker: string): Security | null {
  return b?.securities?.[ticker] ?? null;
}

export function target(b: DataBundle | null, tickerOrDisplay: string): IndiaTarget | null {
  if (!b) return null;
  const u = tickerOrDisplay.toUpperCase();
  return b.india.find((t) => t.ticker.toUpperCase() === u || t.display.toUpperCase() === u) ?? null;
}

export function displayOf(b: DataBundle | null, ticker: string): string {
  const t = target(b, ticker);
  if (t) return t.display;
  return ticker.replace(/\.(NS|BO)$/, '').replace(/^\^/, '');
}

export function nameOf(b: DataBundle | null, ticker: string): string {
  return target(b, ticker)?.name ?? sec(b, ticker)?.name ?? displayOf(b, ticker);
}

/** First n characters of a name, cut at a word boundary. */
export function short(name: string, n = 18): string {
  if (name.length <= n) return name;
  const cut = name.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 6 ? cut.slice(0, sp) : cut).trim() + '…';
}

export function resultFor(r: ScenarioResult | null, ticker: string): IndiaResult | null {
  return r?.india.find((x) => x.ticker === ticker) ?? null;
}

/** True when the scenario on screen is one of these presets. */
export function isActive(r: ScenarioResult | null, preset: PresetId | PresetId[]): boolean {
  const ids = Array.isArray(preset) ? preset : [preset];
  return !!r && ids.includes(r.params.preset);
}

/** A preset parameter: the on-screen value when that preset is active, else the bundle default of the first preset. */
export function paramValue(b: DataBundle | null, r: ScenarioResult | null, preset: PresetId | PresetId[], key: string): ParamValue {
  const ids = Array.isArray(preset) ? preset : [preset];
  if (r && ids.includes(r.params.preset) && r.params.values[key] !== undefined) return r.params.values[key] ?? null;
  const spec = b?.presets.find((p) => p.id === ids[0])?.params.find((s) => s.key === key);
  return spec?.value ?? null;
}

/** Stock in the result with the most negative value of `key` (finite only). */
export function extremeBy(r: ScenarioResult | null, key: (x: IndiaResult) => number | null | undefined, dir: 'min' | 'max' = 'min'): IndiaResult | null {
  if (!r) return null;
  let best: IndiaResult | null = null;
  let bv = dir === 'min' ? Infinity : -Infinity;
  for (const x of r.india) {
    const v = key(x);
    if (!isNum(v)) continue;
    if ((dir === 'min' && v < bv) || (dir === 'max' && v > bv)) {
      bv = v;
      best = x;
    }
  }
  return best;
}

/** Points of the "US chip shock vs Indian next-session move" scatter for one stock (log units). */
export function shockPoints(b: DataBundle | null, ticker: string): { x: number; y: number; date: string }[] {
  const pts = b?.history?.us_vs_india ?? [];
  return pts.filter((p) => p.ticker === ticker && isNum(p.x_sox) && isNum(p.r)).map((p) => ({ x: p.x_sox, y: p.r, date: p.date }));
}

/** Plain OLS fit y = a + b·x. Null when fewer than 3 points or no x variation. */
export function fitLine(pts: { x: number; y: number }[]): { a: number; b: number; n: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx <= 1e-12) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n };
}

/** The stock used in data-driven beta illustrations: prefer NETWEB, else the one with most points. */
export function betaShowcase(b: DataBundle | null, preferred?: string): string | null {
  if (!b) return null;
  const pts = b.history?.us_vs_india ?? [];
  if (!pts.length) return null;
  const tickers = new Set(pts.map((p) => p.ticker));
  for (const t of [preferred, 'NETWEB.NS', 'SIFY', 'HFCL.NS'].filter(Boolean) as string[]) if (tickers.has(t)) return t;
  const counts = new Map<string, number>();
  for (const p of pts) counts.set(p.ticker, (counts.get(p.ticker) ?? 0) + 1);
  return [...counts.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? null;
}

/** Every Quantity / ParamSpec status in the bundle, counted (for the data-provenance examples). */
export function statusCounts(b: DataBundle | null): Record<Status, number> {
  const c: Record<Status, number> = { SOURCED: 0, UNVERIFIED: 0, USER_ASSUMPTION: 0, COMPUTED: 0, DERIVED: 0 };
  if (!b) return c;
  const q = (x: Quantity | null | undefined) => {
    if (x && x.status in c) c[x.status] += 1;
  };
  for (const o of b.origins) {
    q(o.hyperscaler_share);
    q(o.neocloud_share);
  }
  for (const t of b.india) {
    for (const e of t.exposures) q(e.share);
    q(t.fx_margin_sens_bps);
    q(t.parent_stake);
  }
  for (const a of b.assumptions) q(a);
  for (const p of b.presets) for (const s of p.params) if (s.status in c) c[s.status] += 1;
  const tickers = new Set([...b.origins.map((o) => o.ticker), ...b.india.map((t) => t.ticker)]);
  for (const t of tickers) q(b.securities[t]?.op_leverage);
  q(b.fx?.default_f);
  q(b.calibration?.contagion_us);
  q(b.calibration?.contagion_india);
  return c;
}

/** Tier → number of India targets. */
export function tierCounts(b: DataBundle | null): Record<Tier, number> {
  const c: Record<Tier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const t of b?.india ?? []) c[t.tier] += 1;
  return c;
}

/** Total trailing-twelve-month capex of the hyperscalers (USD) and per company. */
export function hyperscalerCapex(b: DataBundle | null): { total: number; rows: { ticker: string; value: number }[] } | null {
  const rows = (b?.origins ?? [])
    .filter((o) => o.group === 'hyperscalers' && isNum(o.capex_ttm_usd) && (o.capex_ttm_usd as number) > 0)
    .map((o) => ({ ticker: o.ticker, value: o.capex_ttm_usd as number }))
    .sort((a, c) => c.value - a.value);
  if (!rows.length) return null;
  return { total: rows.reduce((s, r) => s + r.value, 0), rows };
}

/** Latest point of an overlay series, e.g. today's SOX relative to its all-time high. */
export function overlay(b: DataBundle | null, ticker: string, todayPeak: boolean) {
  const ss = b?.history?.overlay ?? [];
  const year = (d: string) => Number(d.slice(0, 4));
  const pick = ss.filter((s) => s.ticker === ticker && (todayPeak ? year(s.peak_date) >= 2020 : year(s.peak_date) < 2010));
  return pick[0] ?? null;
}

export function fmtPct(x: number | null | undefined, digits = 1, signed = true): string {
  if (!isNum(x)) return '—';
  const v = x * 100;
  const s = v.toFixed(digits);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
}

/** Round-trip through toFixed so values that round to zero never print as "-0". */
const noNegZero = (x: number, digits: number) => (Number(x.toFixed(digits)) === 0 ? 0 : x);

export function fmtNum(x: number | null | undefined, digits = 1): string {
  return isNum(x) ? noNegZero(x, digits).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}

export function fmtUsdB(x: number | null | undefined): string {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)} billion`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)} million`;
  return `${s}$${a.toFixed(0)}`;
}

/** ₹ crore → readable "₹1.3 lakh crore" / "₹4,327 crore". */
export function fmtCrore(x: number | null | undefined): string {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} lakh crore`;
  return `${s}₹${Math.round(a).toLocaleString('en-IN')} crore`;
}

/** "−16.5%" style for a fraction, using a real minus sign for readability. */
export function pctWord(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return '—';
  const v = Math.abs(x * 100).toFixed(digits);
  if (Number(v) === 0) return `${v}%`;
  return x < 0 ? `−${v}%` : `+${v}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-28" → "28 Oct 2026" (or "Oct 2026" with monthOnly). Unknown → ''. */
export function fmtDate(d: string | null | undefined, monthOnly = false): string {
  if (!d || !/^\d{4}-\d{2}/.test(d)) return '';
  const [y, m, day] = d.split('-');
  const mon = MONTHS[Number(m) - 1] ?? '';
  return monthOnly || !day ? `${mon} ${y}` : `${Number(day)} ${mon} ${y}`;
}
