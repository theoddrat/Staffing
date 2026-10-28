import { describe, expect, it } from 'vitest';
import { defaultParams, runMonteCarlo, runScenario, withRanges } from '../index';
import { Rng } from '../rng';
import { makeBundle } from '../__fixtures__/makeBundle';
import { badNumbers } from './helpers';

const b = makeBundle();

describe('rng', () => {
  it('is deterministic per seed and samples inside bounds', () => {
    const a = new Rng(42);
    const c = new Rng(42);
    const d = new Rng(43);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => c.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => d.next())).not.toEqual(xs);
    const r = new Rng(1);
    let m = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const t = r.triangular(0.1, 0.3, 0.8);
      expect(t).toBeGreaterThanOrEqual(0.1);
      expect(t).toBeLessThanOrEqual(0.8);
      m += t;
      const u = r.uniform(-1, 2);
      expect(u).toBeGreaterThanOrEqual(-1);
      expect(u).toBeLessThan(2);
    }
    expect(m / N).toBeCloseTo((0.1 + 0.3 + 0.8) / 3, 2);
  });
});

describe('Monte Carlo', () => {
  it('seeded determinism; different seeds differ', () => {
    const p = defaultParams(b, 'fullpop', '1M');
    const a = runMonteCarlo(b, p, { runs: 800, seed: 9, fanTicker: 'INFY.NS' });
    const c = runMonteCarlo(b, p, { runs: 800, seed: 9, fanTicker: 'INFY.NS' });
    const d = runMonteCarlo(b, p, { runs: 800, seed: 10, fanTicker: 'INFY.NS' });
    expect(c).toEqual(a);
    expect(d.perStock['INFY.NS'].market.p50).not.toBe(a.perStock['INFY.NS'].market.p50);
    expect(badNumbers(a)).toEqual([]);
  });

  it('percentiles are ordered and the median sits near the deterministic move', () => {
    const p = defaultParams(b, 'replay'); // no shock sampling: residual noise only
    const det = runScenario(b, p);
    const mc = runMonteCarlo(b, p, { runs: 5000, seed: 3 });
    for (const x of det.india) {
      const q = mc.perStock[x.ticker].market;
      expect(q.p5).toBeLessThanOrEqual(q.p50);
      expect(q.p50).toBeLessThanOrEqual(q.p95);
      expect(Math.abs(Math.log(1 + q.p50) - Math.log(1 + x.market_move))).toBeLessThan(0.01);
    }
    expect(mc.perStock[det.india[0].ticker].fundamental).toBeNull(); // replay: not modelled
    for (const f of ['SOX', 'NDX', 'NIFTY'] as const) {
      expect(mc.factors[f].p5).toBeLessThanOrEqual(mc.factors[f].p50);
      expect(mc.factors[f].p50).toBeLessThanOrEqual(mc.factors[f].p95);
    }
  });

  it('shock-size sampling widens the fundamental range around the base case', () => {
    const p = defaultParams(b, 'capex', '1M');
    const det = runScenario(b, p).india.find((x) => x.ticker === 'NETWEB.NS')!;
    const mc = runMonteCarlo(b, p, { runs: 3000, seed: 5 });
    const f = mc.perStock['NETWEB.NS'].fundamental!;
    expect(f.p5).toBeLessThan(det.fundamental_net!);
    expect(f.p95).toBeGreaterThan(det.fundamental_net!);
  });

  it('joint bootstrap shares date indices across stocks (cross-correlation preserved)', () => {
    // two stocks with identical residual series and identical (zero) deterministic moves must get
    // identical draws; an independent series must be ~uncorrelated with them
    const bb = makeBundle({ residDays: 400 });
    const R = bb.resid_dates.length;
    const rng = new Rng(77);
    const common = Array.from({ length: R }, () => rng.uniform(-0.02, 0.02));
    const indep = Array.from({ length: R }, () => rng.uniform(-0.02, 0.02));
    bb.nifty_resid = bb.nifty_resid.map(() => 0);
    const [a, c, d] = [bb.india[2], bb.india[3], bb.india[5]];
    a.resid = [...common];
    c.resid = [...common];
    d.resid = [...indep];
    const p = defaultParams(bb, 'replay', '1D');
    const zeroWin = { ...p, values: { ...p.values, window: 'ZERO' } };
    bb.history.replay_windows.push({ id: 'ZERO', label: 'zero', start: '2025-01-24', end: '2025-01-27', moves: { SOX: 0, NDX: 0 }, status: 'COMPUTED', src: [], note: null });
    // capture per-run draws via 1-run MCs with consecutive seeds
    const xa: number[] = [];
    const xc: number[] = [];
    const xd: number[] = [];
    for (let s = 0; s < 300; s++) {
      const mc = runMonteCarlo(bb, zeroWin, { runs: 1, seed: s });
      xa.push(mc.perStock[a.ticker].market.p50);
      xc.push(mc.perStock[c.ticker].market.p50);
      xd.push(mc.perStock[d.ticker].market.p50);
    }
    expect(xc).toEqual(xa);
    const corr = (u: number[], v: number[]) => {
      const mu = u.reduce((s, x) => s + x, 0) / u.length;
      const mv = v.reduce((s, x) => s + x, 0) / v.length;
      let num = 0;
      let du = 0;
      let dv = 0;
      for (let i = 0; i < u.length; i++) {
        num += (u[i] - mu) * (v[i] - mv);
        du += (u[i] - mu) ** 2;
        dv += (v[i] - mv) ** 2;
      }
      return num / Math.sqrt(du * dv);
    };
    expect(Math.abs(corr(xa, xd))).toBeLessThan(0.2);
  });

  it('fan chart: day 0 = 0, ordered bands, horizon end matches', () => {
    const p = defaultParams(b, 'fullpop', '12M');
    const mc = runMonteCarlo(b, p, { runs: 1000, seed: 2, fanTicker: 'NETWEB.NS' });
    expect(mc.fan).not.toBeNull();
    const f = mc.fan!;
    expect(f.days[0]).toBe(0);
    expect(f.days[f.days.length - 1]).toBe(252);
    expect(f.p50[0]).toBe(0);
    for (let k = 0; k < f.days.length; k++) {
      expect(f.p5[k]).toBeLessThanOrEqual(f.p25[k] + 1e-12);
      expect(f.p25[k]).toBeLessThanOrEqual(f.p50[k] + 1e-12);
      expect(f.p50[k]).toBeLessThanOrEqual(f.p75[k] + 1e-12);
      expect(f.p75[k]).toBeLessThanOrEqual(f.p95[k] + 1e-12);
    }
  });

  it('withRanges fills IndiaResult.range from MC percentiles', () => {
    const p = defaultParams(b, 'capex', '1M');
    const r = runScenario(b, p);
    const mc = runMonteCarlo(b, p, { runs: 500, seed: 1 });
    const rr = withRanges(r, mc);
    for (const x of rr.india) expect(x.range).toEqual(mc.perStock[x.ticker].market);
    expect(r.india[0].range).toBeNull(); // input untouched
  });

  it('5,000 runs on a realistic-size universe finish quickly', () => {
    const big = makeBundle({ residDays: 750, extraIndia: 30, extraOrigins: 24 });
    const p = defaultParams(big, 'fullpop', '12M');
    const t0 = performance.now();
    const mc = runMonteCarlo(big, p, { runs: 5000, seed: 1, fanTicker: 'INFY.NS' });
    const ms = performance.now() - t0;
    console.log(`MC 5000 runs × ${big.india.length} stocks × 252d: ${ms.toFixed(0)} ms`);
    expect(Object.keys(mc.perStock).length).toBe(big.india.length);
    expect(ms).toBeLessThan(4000);
  });
});
