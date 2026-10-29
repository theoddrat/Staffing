import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Backtest, DataBundle } from '../../../types/data';
import {
  blendWeights,
  defaultEvent,
  eventPoints,
  eventsByDate,
  eventStats,
  hasLab,
  headline,
  inSampleR2,
  median,
  modelLabel,
  nowcastRows,
  perStock,
  scoreboard,
} from '../accuracyUtil';

const PATH = fileURLToPath(new URL('../../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);
const bundle = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle | null;
const LAB = !!bundle?.backtest;

function tinyBacktest(): Backtest {
  return {
    method: 'test',
    start: '2024-01-02',
    end: '2024-06-28',
    refit_every: 21,
    train_years: 3,
    dates: [],
    models: [
      { id: 'zero', label: 'No change', description: 'Predicts nothing.', family: 'baseline', mode: 'scenario', scenario_usable: false, features: [] },
      { id: 'ols', label: 'Original fit', description: 'OLS.', family: 'linear', mode: 'scenario', scenario_usable: true, features: [] },
      { id: 'ensemble', label: 'Blend', description: 'Blend.', family: 'stack', mode: 'scenario', scenario_usable: true, features: [] },
    ],
    ensemble: { method: 'nnls', weights: { ols: 0.7, zero: 0.3 } },
    summary: [
      { mode: 'scenario', subset: 'shock', model: 'zero', rmse: 0.03, mae: 0.02, r2: 0, hit: null, corr_xs: null, n: 10 },
      { mode: 'scenario', subset: 'shock', model: 'ols', rmse: 0.029, mae: 0.019, r2: -0.01, hit: 0.6, corr_xs: 0.1, n: 10 },
      { mode: 'scenario', subset: 'shock', model: 'ensemble', rmse: 0.028, mae: 0.018, r2: 0.05, hit: 0.65, corr_xs: 0.2, n: 10 },
    ],
    calibration: [{ nominal: 0.5, coverage: 0.4, n: 10 }],
    events: [],
    horizon_check: [],
    nifty_horizons: [],
  };
}

describe('accuracy helpers on a synthetic backtest', () => {
  const bt = tinyBacktest();
  it('headline reads the shock-day ensemble row and leaves missing pieces null', () => {
    const h = headline(bt);
    expect(h.hitShock).toBe(0.65);
    expect(h.corrShock).toBe(0.2);
    expect(h.r2Shock).toBe(0.05);
    expect(h.r2All).toBeNull();
    expect(h.cover90).toBeNull();
    expect(h.maeShockZero).toBe(0.02);
  });
  it('scoreboard: best first, negative allowed, the no-change baseline last', () => {
    const rows = scoreboard(bt, 'scenario', 'shock');
    expect(rows.map((r) => r.id)).toEqual(['ensemble', 'ols', 'zero']);
    expect(rows[0].usedByApp).toBe(true);
    expect(rows[2].baseline).toBe(true);
    expect(scoreboard(bt, 'nowcast', 'shock')).toEqual([]);
  });
  it('blend weights explain the no-change share in plain words', () => {
    const w = blendWeights(bt);
    expect(w.map((p) => p.id)).toEqual(['ols', 'zero']);
    expect(w[1].note).toMatch(/toward no change/);
    expect(modelLabel(bt, 'zero')).toBe('No change');
  });
  it('no events → no default event', () => {
    expect(defaultEvent(bt)).toBeNull();
    expect(eventsByDate(bt)).toEqual([]);
  });
  it('hasLab is false without a backtest; median ignores non-numbers', () => {
    expect(hasLab(null)).toBe(false);
    expect(hasLab({ ...(bundle ?? ({} as DataBundle)), backtest: undefined } as DataBundle)).toBe(false);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe.skipIf(!HAS || !LAB)('accuracy helpers on the real bundle', () => {
  const b = bundle as DataBundle;
  const bt = b.backtest as Backtest;
  it('the headline matches the summary table', () => {
    const h = headline(bt);
    const row = bt.summary.find((s) => s.mode === 'scenario' && s.subset === 'shock' && s.model === 'ensemble')!;
    expect(h.hitShock).toBe(row.hit);
    expect(h.r2Shock).toBe(row.r2);
    expect(h.nShock).toBe(row.n);
    if (h.cover90 !== null) expect(h.cover90).toBeGreaterThan(0.5);
  });
  it('blend weights sum to ~1 for all stocks and each tier', () => {
    const sum = (xs: { weight: number }[]) => xs.reduce((s, x) => s + x.weight, 0);
    expect(sum(blendWeights(bt))).toBeGreaterThan(0.97);
    for (const t of ['A', 'B', 'C', 'D'] as const) if (bt.ensemble.weights_by_tier?.[t]) expect(sum(blendWeights(bt, t))).toBeGreaterThan(0.97);
  });
  it('events: sorted by date, points are simple returns, band counts consistent', () => {
    const evs = eventsByDate(bt);
    for (let i = 1; i < evs.length; i++) expect(evs[i].india_date >= evs[i - 1].india_date).toBe(true);
    const ev = defaultEvent(bt)!;
    expect(ev).not.toBeNull();
    const pts = eventPoints(ev);
    expect(pts.length).toBeGreaterThan(5);
    const r0 = ev.rows.find((r) => r.ticker === pts[0].ticker)!;
    expect(pts[0].actual).toBeCloseTo(Math.exp(r0.actual) - 1, 10);
    for (const e of evs) {
      const s = eventStats(e);
      expect(s.inside).toBeLessThanOrEqual(s.withBand);
      expect(s.n).toBeLessThanOrEqual(e.rows.length);
    }
  });
  it('per stock: untested stocks are flagged and carry no accuracy figure', () => {
    const rows = perStock(b);
    expect(rows.length).toBe(b.india.length);
    for (const r of rows) {
      if (!r.tested) {
        expect(r.r2All).toBeNull();
        expect(r.r2Shock).toBeNull();
        expect(r.cover90).toBeNull();
      }
    }
    const untested = rows.filter((r) => !r.tested).map((r) => r.ticker);
    const noOos = b.india.filter((t) => !b.models?.find((m) => m.ticker === t.ticker)?.oos?.ensemble).map((t) => t.ticker);
    for (const t of noOos) expect(untested).toContain(t);
    // tested stocks come first
    const firstUntested = rows.findIndex((r) => !r.tested);
    if (firstUntested >= 0) expect(rows.slice(firstUntested).every((r) => !r.tested)).toBe(true);
  });
  it('nowcast rows are finite and sorted', () => {
    const rows = nowcastRows(b);
    for (let i = 1; i < rows.length; i++) expect(rows[i].pred >= rows[i - 1].pred).toBe(true);
    for (const r of rows) expect(Number.isFinite(r.pred)).toBe(true);
  });
  it('in-sample fallback is sorted, highest first', () => {
    const r = inSampleR2(b);
    for (let i = 1; i < r.length; i++) expect(r[i].r2 <= r[i - 1].r2).toBe(true);
  });
});
