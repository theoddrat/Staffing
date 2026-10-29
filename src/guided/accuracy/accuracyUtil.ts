// Pure helpers for the "How accurate is it?" page. Everything reads bundle.backtest / models /
// nowcast (all optional) and returns nulls instead of NaN when a piece is missing.
import type { Backtest, BacktestEvent, DataBundle, ModelSpec, Tier } from '../../types/data';
import { isNum } from '../../lib/format';

export type Mode = 'scenario' | 'nowcast';
export type Subset = 'all' | 'shock' | 'events';
export type SummaryRow = Backtest['summary'][number];

/** Log return → simple return. */
export const simple = (x: number) => Math.exp(x) - 1;

export function hasLab(b: DataBundle | null | undefined): b is DataBundle & { backtest: Backtest } {
  return !!b?.backtest && Array.isArray(b.backtest.summary) && b.backtest.summary.length > 0;
}

export function summaryRow(bt: Backtest, mode: Mode, subset: Subset, model: string): SummaryRow | null {
  return bt.summary.find((s) => s.mode === mode && s.subset === subset && s.model === model) ?? null;
}

const ZERO_NOTE = 'Shrinks predictions toward no change, which helps when daily moves are mostly noise.';

export function modelSpec(bt: Backtest, id: string): ModelSpec | null {
  return bt.models.find((m) => m.id === id) ?? null;
}

export function modelLabel(bt: Backtest, id: string): string {
  if (id === 'zero') return modelSpec(bt, id)?.label ?? 'No change';
  return modelSpec(bt, id)?.label ?? id;
}

export function modelDescription(bt: Backtest, id: string, inBlend = false): string {
  const d = modelSpec(bt, id)?.description ?? '';
  return id === 'zero' && inBlend ? `${d} In the blend it ${ZERO_NOTE.charAt(0).toLowerCase()}${ZERO_NOTE.slice(1)}` : d;
}

export interface Headline {
  hitShock: number | null;
  corrShock: number | null;
  r2Shock: number | null;
  r2All: number | null;
  r2Events: number | null;
  hitEvents: number | null;
  maeShock: number | null;
  maeShockZero: number | null;
  nShock: number;
  nAll: number;
  cover90: number | null;
  start: string;
  end: string;
}

export function headline(bt: Backtest): Headline {
  const sh = summaryRow(bt, 'scenario', 'shock', 'ensemble');
  const al = summaryRow(bt, 'scenario', 'all', 'ensemble');
  const ev = summaryRow(bt, 'scenario', 'events', 'ensemble');
  const z = summaryRow(bt, 'scenario', 'shock', 'zero');
  const c90 = bt.calibration.find((c) => Math.abs(c.nominal - 0.9) < 1e-6);
  return {
    hitShock: sh?.hit ?? null,
    corrShock: sh?.corr_xs ?? null,
    r2Shock: sh?.r2 ?? null,
    r2All: al?.r2 ?? null,
    r2Events: ev?.r2 ?? null,
    hitEvents: ev?.hit ?? null,
    maeShock: sh?.mae ?? null,
    maeShockZero: z?.mae ?? null,
    nShock: sh?.n ?? 0,
    nAll: al?.n ?? 0,
    cover90: c90 && isNum(c90.coverage) ? c90.coverage : null,
    start: bt.start,
    end: bt.end,
  };
}

export interface ScoreRow {
  id: string;
  label: string;
  description: string;
  r2: number;
  mae: number;
  hit: number | null;
  corr: number | null;
  n: number;
  usedByApp: boolean;
  baseline: boolean;
}

/** One row per model for a mode/subset, best R² first, the no-change baseline last. */
export function scoreboard(bt: Backtest, mode: Mode, subset: Subset): ScoreRow[] {
  const rows = bt.summary
    .filter((s) => s.mode === mode && s.subset === subset && isNum(s.r2))
    .map((s) => ({
      id: s.model,
      label: modelLabel(bt, s.model),
      description: modelDescription(bt, s.model),
      r2: s.r2,
      mae: s.mae,
      hit: s.hit,
      corr: s.corr_xs,
      n: s.n,
      usedByApp: s.model === 'ensemble',
      baseline: s.model === 'zero',
    }));
  return rows.sort((a, b) => (a.baseline !== b.baseline ? (a.baseline ? 1 : -1) : b.r2 - a.r2));
}

export interface BlendPart {
  id: string;
  label: string;
  weight: number;
  note: string;
}

/** Ensemble weights (all stocks, or one tier's own weights when it has them), largest first. */
export function blendWeights(bt: Backtest, tier?: Tier): BlendPart[] {
  const w = (tier && bt.ensemble.weights_by_tier?.[tier]) || bt.ensemble.weights;
  return Object.entries(w)
    .filter(([, v]) => isNum(v) && v > 0.005)
    .map(([id, v]) => ({ id, label: modelLabel(bt, id), weight: v, note: id === 'zero' ? ZERO_NOTE : modelDescription(bt, id) }))
    .sort((a, b) => b.weight - a.weight);
}

export function eventsByDate(bt: Backtest): BacktestEvent[] {
  return [...bt.events].sort((a, b) => a.india_date.localeCompare(b.india_date));
}

export function defaultEvent(bt: Backtest): BacktestEvent | null {
  const evs = eventsByDate(bt);
  return evs.find((e) => /deepseek/i.test(e.id)) ?? [...evs].reverse().find((e) => e.kind === 'named') ?? evs[evs.length - 1] ?? null;
}

export interface EventPoint {
  ticker: string;
  display: string;
  tier: Tier;
  pred: number; // simple
  actual: number; // simple
  lo: number | null;
  hi: number | null;
  inside: boolean | null;
}

export function eventPoints(ev: BacktestEvent, model = 'ensemble'): EventPoint[] {
  return ev.rows
    .filter((r) => isNum(r.actual) && isNum(r.pred[model]))
    .map((r) => {
      const lo = isNum(r.lo90) ? simple(r.lo90) : null;
      const hi = isNum(r.hi90) ? simple(r.hi90) : null;
      const actual = simple(r.actual);
      return {
        ticker: r.ticker,
        display: r.display,
        tier: r.tier,
        pred: simple(r.pred[model] as number),
        actual,
        lo,
        hi,
        inside: lo !== null && hi !== null ? actual >= lo && actual <= hi : null,
      };
    });
}

export interface EventStats {
  n: number;
  corr: number | null;
  mae: number | null;
  maeZero: number | null;
  hit: number | null;
  inside: number;
  withBand: number;
  meanActual: number | null;
  meanPred: number | null;
}

export function eventStats(ev: BacktestEvent, model = 'ensemble'): EventStats {
  const pts = eventPoints(ev, model);
  const m = ev.metrics[model];
  const z = ev.metrics.zero;
  const banded = pts.filter((p) => p.inside !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    n: pts.length,
    corr: m && isNum(m.corr) ? m.corr : null,
    mae: m && isNum(m.mae) ? m.mae : null,
    maeZero: z && isNum(z.mae) ? z.mae : null,
    hit: m && isNum(m.hit) ? m.hit : null,
    inside: banded.filter((p) => p.inside).length,
    withBand: banded.length,
    meanActual: mean(pts.map((p) => p.actual)),
    meanPred: mean(pts.map((p) => p.pred)),
  };
}

export interface StockAccuracy {
  ticker: string;
  display: string;
  name: string;
  tier: Tier;
  /** false when the stock has no out-of-sample history yet (e.g. listed recently) */
  tested: boolean;
  r2All: number | null;
  r2Shock: number | null;
  hitShock: number | null;
  cover90: number | null;
  n: number;
  nShock: number;
}

/** Per-stock out-of-sample accuracy of the blend, best on shock days first; untested stocks last. */
export function perStock(b: DataBundle): StockAccuracy[] {
  const byT = new Map((b.models ?? []).map((m) => [m.ticker, m]));
  const rows = b.india.map((t) => {
    const m = byT.get(t.ticker);
    const all = m?.oos?.ensemble;
    const sh = m?.oos_shock?.ensemble;
    const tested = !!all && all.n > 0 && isNum(all.r2) && (m?.oos_resid ?? []).some(isNum);
    return {
      ticker: t.ticker,
      display: t.display,
      name: t.name,
      tier: t.tier,
      tested,
      r2All: tested && isNum(all!.r2) ? all!.r2 : null,
      r2Shock: tested && sh && sh.n > 0 && isNum(sh.r2) ? sh.r2 : null,
      hitShock: tested && sh && isNum(sh.hit) ? sh.hit : null,
      cover90: tested && m && isNum(m.coverage90) ? m.coverage90 : null,
      n: all?.n ?? 0,
      nShock: sh?.n ?? 0,
    };
  });
  const key = (r: StockAccuracy) => (r.tested ? (isNum(r.r2Shock) ? r.r2Shock : isNum(r.r2All) ? r.r2All : -1e9) : -Infinity);
  return rows.sort((a, c) => key(c) - key(a));
}

export interface NowcastRow {
  ticker: string;
  display: string;
  pred: number;
  lo: number | null;
  hi: number | null;
  actual: number | null;
}

export function nowcastRows(b: DataBundle): NowcastRow[] {
  return (b.nowcast?.rows ?? [])
    .filter((r) => isNum(r.pred))
    .map((r) => ({
      ticker: r.ticker,
      display: r.display,
      pred: simple(r.pred),
      lo: isNum(r.lo90) ? simple(r.lo90) : null,
      hi: isNum(r.hi90) ? simple(r.hi90) : null,
      actual: isNum(r.actual) ? simple(r.actual as number) : null,
    }))
    .sort((a, c) => a.pred - c.pred);
}

/** In-sample R² of the current 3-year fit per stock (fallback view when the lab has not run). */
export function inSampleR2(b: DataBundle): { display: string; tier: Tier; r2: number }[] {
  return b.india
    .filter((t) => t.reg && isNum(t.reg.r2))
    .map((t) => ({ display: t.display, tier: t.tier, r2: t.reg!.r2 }))
    .sort((a, c) => c.r2 - a.r2);
}

export function median(xs: number[]): number | null {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
