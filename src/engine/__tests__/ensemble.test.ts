// V2 (DESIGN §9.4): Layer 2 on the validated ensemble, OOS-residual Monte Carlo, explanations.
import { describe, expect, it } from 'vitest';
import engine, { defaultParams, explainStock, intensityValues, paramSpecs, runMonteCarlo, runScenario, scenarioHeadline, withRanges } from '../index';
import { FIXTURE_ENS_MULT, FIXTURE_NIFTY_H, makeBundle } from '../__fixtures__/makeBundle';
import { CHANNEL_VIS } from '../../guided/visual';
import type { DataBundle } from '../../types/data';
import type { Horizon, PresetId, SankeyGraph, ScenarioResult } from '../../types/engine';
import { Rng } from '../rng';
import { badNumbers } from './helpers';

const bOls = makeBundle();
const bEns = makeBundle({ models: true });
const HORIZONS: Horizon[] = ['1D', '1M', '12M'];
const HMAP: Record<Horizon, 1 | 21> = { '1D': 1, '1M': 21, '12M': 21 };
const PRESETS: PresetId[] = ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'replay', 'fullpop'];
const OLS_NIFTY = { SOX: 0.1, NDX: 0.15 }; // fixture nifty_model

const model = (b: DataBundle, ticker: string) => b.models?.find((m) => m.ticker === ticker) ?? null;
const coefOf = (b: DataBundle, ticker: string) => {
  const c = b.india.find((t) => t.ticker === ticker)!.reg!.coef;
  return { SOX: c.SOX?.b ?? 0, NDX: c.NDX?.b ?? 0, PARENT: c.PARENT?.b ?? 0, NIFTY: c.NIFTY?.b ?? 0 };
};
const xParent = (r: ScenarioResult, parent: string | null) => {
  const o = r.origins.find((x) => x.ticker === parent);
  return o ? Math.log(1 + o.move) : null;
};

/** Empirical quantile of a numeric array (linear interpolation). */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] * (1 - (pos - lo)) + s[hi] * (pos - lo);
}
const demeaned = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  const m = v.reduce((a, x) => a + x, 0) / v.length;
  return v.map((x) => x - m);
};

describe('Layer 2 with the validated ensemble', () => {
  it('uses models[i].horizons mapped 1D→h1, 1M→h21, 12M→h21 (applied to the 12-month factor move)', () => {
    for (const preset of ['fullpop', 'capex', 'guidance'] as PresetId[])
      for (const h of HORIZONS) {
        const r = runScenario(bEns, defaultParams(bEns, preset, h));
        const nh = FIXTURE_NIFTY_H.find((x) => x.h === HMAP[h])!;
        const xN = nh.SOX * r.factors.x.SOX + nh.NDX * r.factors.x.NDX;
        expect(r.factors.x.NIFTY).toBeCloseTo(xN, 12);
        expect(r.factors.NIFTY).toBeCloseTo(Math.expm1(xN), 12);
        for (const x of r.india) {
          const m = model(bEns, x.ticker);
          if (!m) continue;
          const c = m.horizons.find((z) => z.h === HMAP[h])!;
          expect(x.model_used, `${preset} ${h} ${x.ticker}`).toBe('ensemble');
          expect(x.market_contrib.sentiment).toBeCloseTo(c.SOX * r.factors.x.SOX + c.NDX * r.factors.x.NDX, 12);
          expect(x.market_contrib.fx_fpi).toBeCloseTo(c.NIFTY * xN, 12);
          const xp = xParent(r, bEns.india.find((t) => t.ticker === x.ticker)!.parent);
          if (xp !== null) expect(x.market_contrib.parent).toBeCloseTo((c.PARENT ?? 0) * xp, 12);
          const mc = x.market_contrib;
          expect(Math.log(1 + x.market_move)).toBeCloseTo(mc.parent + mc.sentiment + mc.fx_fpi + mc.own, 10);
        }
      }
  });

  it('the ensemble actually differs from the OLS (and 12M reuses the h21 coefficients)', () => {
    const r1 = runScenario(bEns, defaultParams(bEns, 'fullpop', '1M'));
    const r12 = runScenario(bEns, defaultParams(bEns, 'fullpop', '12M'));
    const n1 = r1.india.find((x) => x.ticker === 'NETWEB.NS')!;
    const n12 = r12.india.find((x) => x.ticker === 'NETWEB.NS')!;
    expect(Math.abs(n1.market_move - (n1.market_move_ols ?? 0))).toBeGreaterThan(0.005);
    const ols = coefOf(bEns, 'NETWEB.NS');
    // per unit of factor move the 1M and 12M sentiment channels use the same (h21) loadings
    const k = FIXTURE_ENS_MULT[21];
    expect(n1.market_contrib.sentiment).toBeCloseTo(ols.SOX * k.SOX * r1.factors.x.SOX + ols.NDX * k.NDX * r1.factors.x.NDX, 12);
    expect(n12.market_contrib.sentiment).toBeCloseTo(ols.SOX * k.SOX * r12.factors.x.SOX + ols.NDX * k.NDX * r12.factors.x.NDX, 12);
  });

  it('falls back to india[i].reg for a stock without a model (with the scenario-wide Nifty link)', () => {
    for (const h of HORIZONS) {
      const r = runScenario(bEns, defaultParams(bEns, 'fullpop', h));
      const k = r.india.find((x) => x.ticker === 'KAYNES.NS')!;
      const c = coefOf(bEns, 'KAYNES.NS');
      expect(k.model_used).toBe('ols');
      expect(k.notes.some((n) => n.includes('no validated ensemble'))).toBe(true);
      expect(k.market_contrib.sentiment).toBeCloseTo(c.SOX * r.factors.x.SOX + c.NDX * r.factors.x.NDX, 12);
      expect(k.market_contrib.fx_fpi).toBeCloseTo(c.NIFTY * r.factors.x.NIFTY, 12);
      expect(k.beta_total).toBe(bEns.india.find((t) => t.ticker === 'KAYNES.NS')!.beta_total);
    }
  });

  it('a bundle without models is the original OLS engine (model_used ols, market_move_ols = market_move)', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const r = runScenario(bOls, defaultParams(bOls, preset, h));
        expect(r.warnings.some((w) => w.includes('walk-forward-validated ensemble'))).toBe(false);
        const xN = OLS_NIFTY.SOX * r.factors.x.SOX + OLS_NIFTY.NDX * r.factors.x.NDX;
        expect(r.factors.x.NIFTY).toBeCloseTo(xN, 12);
        for (const x of r.india) {
          expect(x.model_used).toBe('ols');
          expect(x.market_move_ols).toBe(x.market_move);
          const c = coefOf(bOls, x.ticker);
          expect(x.market_contrib.fx_fpi).toBeCloseTo(c.NIFTY * xN, 12);
        }
      }
  });

  it('market_move_ols reproduces the pre-V2 result exactly, for every preset × horizon', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const p = defaultParams(bOls, preset, h);
        const old = new Map(runScenario(bOls, p).india.map((x) => [x.ticker, x.market_move]));
        const r = runScenario(bEns, p);
        expect(r.warnings.some((w) => w.startsWith('INFO: Layer 2 uses the walk-forward-validated ensemble'))).toBe(true);
        for (const x of r.india) expect(x.market_move_ols, `${preset} ${h} ${x.ticker}`).toBe(old.get(x.ticker));
        expect(badNumbers(r)).toEqual([]);
      }
  });

  it('beta_total: the ensemble value, else the DESIGN §3.3 formula on the ensemble coefficients', () => {
    const r = runScenario(bEns, defaultParams(bEns, 'fullpop', '1M'));
    const nw = r.india.find((x) => x.ticker === 'NETWEB.NS')!;
    expect(nw.beta_total).toBe(model(bEns, 'NETWEB.NS')!.horizons.find((z) => z.h === 21)!.beta_total);
    const inf = r.india.find((x) => x.ticker === 'INFY.NS')!; // fixture leaves INFY's beta_total null
    const c = model(bEns, 'INFY.NS')!.horizons.find((z) => z.h === 21)!;
    const nh = FIXTURE_NIFTY_H.find((x) => x.h === 21)!;
    const s = 0.6; // fixture slopes.ndx_on_sox
    expect(inf.beta_total).toBeCloseTo(c.SOX + c.NDX * s + c.NIFTY * (nh.SOX + nh.NDX * s), 12);
  });

  it('missing horizons fall back to the nearest ensemble fit; a parent stock without PARENT falls back to OLS', () => {
    const b = makeBundle({ models: true });
    const nw = model(b, 'NETWEB.NS')!;
    nw.horizons = nw.horizons.filter((z) => z.h !== 21);
    const pw = model(b, 'POWERINDIA.NS')!;
    pw.horizons = pw.horizons.map((z) => ({ ...z, PARENT: null }));
    const r = runScenario(b, defaultParams(b, 'fullpop', '1M'));
    const x = r.india.find((y) => y.ticker === 'NETWEB.NS')!;
    expect(x.model_used).toBe('ensemble');
    expect(x.notes.some((n) => n.includes('5-session coefficients'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('no 21-session fit yet') && w.includes('1 of 7 stocks'))).toBe(true);
    expect(runScenario(bEns, defaultParams(bEns, 'fullpop', '1M')).warnings.some((w) => w.includes('fit yet'))).toBe(false);
    const c5 = nw.horizons.find((z) => z.h === 5)!;
    expect(x.market_contrib.sentiment).toBeCloseTo(c5.SOX * r.factors.x.SOX + c5.NDX * r.factors.x.NDX, 12);
    const y = r.india.find((z) => z.ticker === 'POWERINDIA.NS')!;
    expect(y.model_used).toBe('ols');
    expect(y.market_move).toBeLessThan(0);
  });

  it('Sankey mass balance still holds on ensemble coefficients', () => {
    const balance = (g: SankeyGraph) => {
      const ch = new Set(g.nodes.filter((n) => n.kind === 'channel').map((n) => n.id));
      const io = new Map<string, number>();
      for (const l of g.links) {
        if (ch.has(l.target)) io.set(l.target, (io.get(l.target) ?? 0) + l.sign * l.value);
        if (ch.has(l.source)) io.set(l.source, (io.get(l.source) ?? 0) - l.sign * l.value);
      }
      return io;
    };
    for (const preset of ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'fullpop'] as PresetId[])
      for (const h of HORIZONS) {
        const r = runScenario(bEns, defaultParams(bEns, preset, h));
        for (const mode of ['market', 'fundamental'] as const) {
          for (const [, v] of balance(r.sankey[mode])) expect(Math.abs(v)).toBeLessThan(1e-6 * Math.max(1, Math.abs(r.totals.india_mcap_change_inr_cr)));
          const pairs = r.sankey[mode].links.map((l) => `${l.source}→${l.target}`);
          expect(new Set(pairs).size).toBe(pairs.length);
        }
        // market channel parts still sum to market_move × mcap for every stock
        for (const x of r.india) {
          const c = x.channel_inr_cr;
          const sum = (c.parent ?? 0) + (c.sentiment ?? 0) + (c.fx_fpi ?? 0) + (c.own ?? 0);
          expect(Math.abs(sum - (x.mcap_change_inr_cr ?? 0))).toBeLessThan(1e-6 * Math.max(1, Math.abs(x.mcap_change_inr_cr ?? 0)));
        }
        // and the Sankey's sentiment outflow equals Σ stock sentiment
        const sOut = r.sankey.market.links.filter((l) => l.source === 'c:sentiment').reduce((a, l) => a + l.sign * l.value, 0);
        const sSum = r.india.reduce((a, x) => a + (x.channel_inr_cr.sentiment ?? 0), 0);
        expect(Math.abs(sOut - sSum)).toBeLessThan(1e-6 * Math.max(1, Math.abs(sSum)));
      }
  });
});

describe('Monte Carlo on out-of-sample residuals', () => {
  it('reports the residual source; seeded determinism; ordered percentiles; no NaN', () => {
    const p = defaultParams(bEns, 'fullpop', '1M');
    const a = runMonteCarlo(bEns, p, { runs: 600, seed: 4, fanTicker: 'NETWEB.NS' });
    const c = runMonteCarlo(bEns, p, { runs: 600, seed: 4, fanTicker: 'NETWEB.NS' });
    expect(c).toEqual(a);
    expect(a.residual_source).toBe('oos');
    expect(a.residual_note).toContain('6 of 7 stocks');
    expect(runMonteCarlo(bOls, p, { runs: 50, seed: 4 }).residual_source).toBe('in_sample');
    for (const q of Object.values(a.perStock)) {
      expect(q.market.p5).toBeLessThanOrEqual(q.market.p50);
      expect(q.market.p50).toBeLessThanOrEqual(q.market.p95);
    }
    expect(badNumbers(a)).toEqual([]);
    // withRanges + explainStock work on the V2 result
    const rr = withRanges(runScenario(bEns, p), a);
    expect(rr.india.every((x) => x.range !== null)).toBe(true);
  });

  it('1D coverage sanity: the 90% band is the ensemble OOS residual 5–95% range (honest bands)', () => {
    const p = defaultParams(bEns, 'replay', '1D'); // no shock sampling: residual noise only
    const det = runScenario(bEns, p);
    const mc = runMonteCarlo(bEns, p, { runs: 8000, seed: 11 });
    const mcOls = runMonteCarlo(bOls, p, { runs: 8000, seed: 11 });
    for (const t of ['INFY.NS', 'NETWEB.NS', 'OFSS.NS']) {
      const x = det.india.find((y) => y.ticker === t)!;
      const d = Math.log(1 + x.market_move);
      const e = demeaned(model(bEns, t)!.oos_resid);
      const q = mc.perStock[t].market;
      const lo = Math.log(1 + q.p5) - d;
      const hi = Math.log(1 + q.p95) - d;
      expect(Math.abs(lo - quantile(e, 0.05))).toBeLessThan(0.003);
      expect(Math.abs(hi - quantile(e, 0.95))).toBeLessThan(0.003);
      const inside = e.filter((v) => v >= lo && v <= hi).length / e.length;
      expect(inside).toBeGreaterThan(0.86);
      expect(inside).toBeLessThan(0.94);
      // synthetic OOS errors are wider than the in-sample residuals: the bands must widen accordingly
      const qo = mcOls.perStock[t].market;
      expect(q.p95 - q.p5).toBeGreaterThan(1.2 * (qo.p95 - qo.p5));
    }
  });

  it('OOS residuals are demeaned (median stays at the deterministic move) and nothing is added on top', () => {
    // the fixture's OOS residuals carry a +0.4%/day offset: without demeaning a 1M median would drift ~+8%
    const p = defaultParams(bEns, 'replay', '1M');
    const det = runScenario(bEns, p);
    const mc = runMonteCarlo(bEns, p, { runs: 5000, seed: 3 });
    for (const x of det.india) {
      const q = mc.perStock[x.ticker].market;
      expect(Math.abs(Math.log(1 + q.p50) - Math.log(1 + x.market_move))).toBeLessThan(0.012);
    }
  });

  it('a stock without a model keeps its in-sample residuals (re-indexed by date onto the OOS axis)', () => {
    // compare the noise around each bundle's own deterministic move (the ensemble bundle's Nifty link differs)
    const p = defaultParams(bEns, 'replay', '1D');
    const band = (b: DataBundle, seed: number) => {
      const d = Math.log(1 + runScenario(b, p).india.find((x) => x.ticker === 'KAYNES.NS')!.market_move);
      const q = runMonteCarlo(b, p, { runs: 8000, seed }).perStock['KAYNES.NS'].market;
      return { lo: Math.log(1 + q.p5) - d, hi: Math.log(1 + q.p95) - d };
    };
    const a = band(bEns, 21);
    const b = band(bOls, 21);
    expect(Math.abs(a.lo - b.lo)).toBeLessThan(0.002);
    expect(Math.abs(a.hi - b.hi)).toBeLessThan(0.002);
  });

  it('Nifty bands come from backtest.nifty_oos_resid (in-sample when absent)', () => {
    const p = defaultParams(bEns, 'replay', '1D');
    const det = runScenario(bEns, p);
    const dN = Math.log(1 + det.factors.NIFTY);
    const mc = runMonteCarlo(bEns, p, { runs: 8000, seed: 5 });
    const e = demeaned(bEns.backtest!.nifty_oos_resid!);
    expect(Math.abs(Math.log(1 + mc.factors.NIFTY.p5) - dN - quantile(e, 0.05))).toBeLessThan(0.002);
    expect(Math.abs(Math.log(1 + mc.factors.NIFTY.p95) - dN - quantile(e, 0.95))).toBeLessThan(0.002);
    const bNo = makeBundle({ models: { noNiftyOos: true } });
    const mcNo = runMonteCarlo(bNo, p, { runs: 8000, seed: 5 });
    expect(mcNo.residual_note).toContain('Nifty in-sample');
    const eIn = demeaned(bNo.nifty_resid);
    expect(Math.abs(Math.log(1 + mcNo.factors.NIFTY.p95) - dN - quantile(eIn, 0.95))).toBeLessThan(0.002);
  });

  it('OOS draws share date indices across stocks (block bootstrap on the OOS axis)', () => {
    // two stocks given the same OOS series and the same deterministic move must get identical draws
    const b = makeBundle({ models: true });
    const [a, c] = [model(b, 'INFY.NS')!, model(b, 'TCS.NS')!];
    // no missing cells: each stock redraws its own missing cells independently, which would break the equality
    a.oos_resid = a.oos_resid.map((v) => v ?? 0.001);
    c.oos_resid = [...a.oos_resid];
    for (const z of c.horizons) Object.assign(z, a.horizons.find((y) => y.h === z.h));
    const ia = b.india.find((t) => t.ticker === 'INFY.NS')!;
    const ic = b.india.find((t) => t.ticker === 'TCS.NS')!;
    ic.reg = ia.reg;
    ic.slopes = ia.slopes;
    b.history.replay_windows.push({ id: 'ZERO', label: 'zero', start: '2025-01-01', end: '2025-02-03', moves: { SOX: 0, NDX: 0 }, status: 'COMPUTED', src: [], note: null });
    const p = defaultParams(b, 'replay', '1M');
    const zero = { ...p, values: { ...p.values, window: 'ZERO' } };
    for (let s = 0; s < 40; s++) {
      const mc = runMonteCarlo(b, zero, { runs: 1, seed: s });
      expect(mc.perStock['TCS.NS'].market.p50).toBe(mc.perStock['INFY.NS'].market.p50);
    }
  });

  it('falls back to in-sample residuals when OOS residuals are too short or backtest.dates is missing', () => {
    const b = makeBundle({ models: true });
    for (const m of b.models!) m.oos_resid = m.oos_resid.map((v, k) => (k < 10 ? v : null)); // < 20 usable values
    const p = defaultParams(b, 'replay', '1D');
    const mc = runMonteCarlo(b, p, { runs: 200, seed: 1 });
    expect(mc.residual_source).toBe('in_sample');
    expect(mc.residual_note).toContain('no usable out-of-sample residuals');
    const b2 = makeBundle({ models: true });
    b2.backtest!.dates = [];
    const r2 = runScenario(b2, p);
    expect(r2.warnings.some((w) => w.includes('backtest.dates missing'))).toBe(true);
    expect(runMonteCarlo(b2, p, { runs: 200, seed: 1 }).residual_source).toBe('in_sample');
    // the coefficients still come from the ensemble
    expect(r2.india.find((x) => x.ticker === 'NETWEB.NS')!.model_used).toBe('ensemble');
  });
});

describe('plain-language explanations', () => {
  const SCN = PRESETS.flatMap((preset) => HORIZONS.map((h) => [preset, h] as const));

  it('explainStock: shape, no NaN, reasons sorted by |₹ crore| and led by the dominant channel', () => {
    for (const b of [bEns, bOls])
      for (const [preset, h] of SCN) {
        const r = runScenario(b, defaultParams(b, preset, h));
        for (const x of r.india) {
          const e = explainStock(b, r, x.ticker);
          expect(badNumbers(e), `${preset} ${h} ${x.ticker}`).toEqual([]);
          expect(e.ticker).toBe(x.ticker);
          expect(e.headline).toMatch(/in this scenario/);
          expect(e.headline).toMatch(/Monte Carlo/);
          for (const s of [e.headline, e.confidence.text, e.accuracy?.text ?? '', ...e.reasons.map((z) => z.text)]) expect(s).not.toMatch(/NaN|undefined|Infinity/);
          for (let k = 1; k < e.reasons.length; k++) expect(Math.abs(e.reasons[k - 1].inr_cr)).toBeGreaterThanOrEqual(Math.abs(e.reasons[k].inr_cr));
          if (e.reasons.length) {
            expect(e.reasons[0].channel).toBe(x.dominant_channel);
            expect(e.reasons.reduce((a, z) => a + z.share, 0)).toBeCloseTo(1, 9);
          }
          for (const z of e.reasons) {
            expect(z.label).toBe(CHANNEL_VIS[z.channel].label);
            expect(z.text.length).toBeGreaterThan(20);
            expect(z.inr_cr).toBeCloseTo(x.channel_inr_cr[z.channel] ?? 0, 9);
          }
          expect(['HIGH', 'MED', 'LOW']).toContain(e.confidence.grade);
          expect(e.confidence.grade).toBe(x.confidence.grade);
        }
      }
  });

  it('headline uses the Monte Carlo range when available; accuracy comes from bundle.models', () => {
    const p = defaultParams(bEns, 'fullpop', '12M');
    const mc = runMonteCarlo(bEns, p, { runs: 400, seed: 2 });
    const r = withRanges(runScenario(bEns, p), mc);
    const x = r.india.find((y) => y.ticker === 'NETWEB.NS')!;
    const e = explainStock(bEns, r, 'NETWEB.NS');
    expect(e.headline).toContain('9 in 10 simulations');
    expect(e.headline).not.toContain('Monte Carlo');
    expect(e.headline).toContain(`${Math.abs(x.range!.p5 * 100).toFixed(0)}%`);
    const m = model(bEns, 'NETWEB.NS')!;
    expect(e.accuracy).not.toBeNull();
    expect(e.accuracy!.r2_oos).toBe(m.horizons.find((z) => z.h === 21)!.r2_oos);
    expect(e.accuracy!.coverage90).toBe(m.coverage90);
    expect(e.accuracy!.text).toContain('months it had not seen');
    const e1 = explainStock(bEns, runScenario(bEns, defaultParams(bEns, 'fullpop', '1D')), 'NETWEB.NS');
    expect(e1.accuracy!.r2_oos).toBe(m.horizons.find((z) => z.h === 1)!.r2_oos);
    expect(e1.accuracy!.text).toContain('next-day moves');
    expect(explainStock(bEns, r, 'KAYNES.NS').accuracy).toBeNull(); // no model
    expect(explainStock(bOls, runScenario(bOls, p), 'NETWEB.NS').accuracy).toBeNull();
    // reason texts quote the scenario's own numbers
    const parent = explainStock(bEns, r, 'OFSS.NS').reasons.find((z) => z.channel === 'parent')!;
    expect(parent.text).toContain('owns about 72%');
    const orcl = r.origins.find((o) => o.ticker === 'ORCL')!;
    expect(parent.text).toContain(`${Math.abs(orcl.move * 100).toFixed(0)}%`);
  });

  it('is pure, on the default engine object, and handles an unknown ticker', () => {
    const r = runScenario(bEns, defaultParams(bEns, 'capex', '1M'));
    const snap = JSON.stringify(r);
    expect(engine.explainStock).toBe(explainStock);
    expect(engine.explainStock!(bEns, r, 'INFY.NS')).toEqual(explainStock(bEns, r, 'INFY.NS'));
    expect(JSON.stringify(r)).toBe(snap);
    const u = explainStock(bEns, r, 'NOPE.NS');
    expect(u.reasons).toEqual([]);
    expect(u.accuracy).toBeNull();
    expect(u.confidence.grade).toBe('LOW');
  });

  it('scenarioHeadline: one sentence with SOX / NDX / Nifty and the India ₹ total', () => {
    for (const [preset, h] of SCN) {
      const r = runScenario(bEns, defaultParams(bEns, preset, h));
      const s = scenarioHeadline(bEns, r);
      expect(s).not.toMatch(/NaN|undefined|Infinity/);
      expect(s).toMatch(/hypothetical/);
      expect(s).toContain('US chip stocks');
      expect(s).toContain('the Nifty');
      expect(s).toContain('₹');
      expect(s.trim().endsWith('.')).toBe(true);
    }
    const rp = runScenario(bEns, defaultParams(bEns, 'replay', '1D'));
    expect(scenarioHeadline(bEns, rp)).toContain('DeepSeek day (synthetic)');
  });
});

describe('randomised scenarios on the ensemble bundle (seeded)', () => {
  it('no NaN anywhere, channels sum to the move, explanations stay finite and sorted', () => {
    const rng = new Rng(2026);
    for (let k = 0; k < 80; k++) {
      const preset = PRESETS[rng.int(PRESETS.length)];
      const h = HORIZONS[rng.int(HORIZONS.length)];
      const p = defaultParams(bEns, preset, h);
      const values = { ...p.values };
      // jitter every numeric parameter inside (and slightly beyond) its MC range
      for (const s of paramSpecs(bEns, preset, h)) {
        if (s.kind !== 'number' || typeof s.value !== 'number') continue;
        const lo = s.mc?.low ?? s.value * 0.5;
        const hi = s.mc?.high ?? s.value * 1.5;
        values[s.key] = rng.uniform(Math.min(lo, hi) - 0.1 * Math.abs(hi - lo), Math.max(lo, hi) + 0.1 * Math.abs(hi - lo));
      }
      if (preset === 'restatement') values.target = rng.next() < 0.5 ? 'NETWEB.NS' : 'CRWV';
      const r = runScenario(bEns, { ...p, values });
      expect(badNumbers(r), `${preset} ${h} #${k}`).toEqual([]);
      for (const x of r.india) {
        const c = x.channel_inr_cr;
        const sum = (c.parent ?? 0) + (c.sentiment ?? 0) + (c.fx_fpi ?? 0) + (c.own ?? 0);
        expect(Math.abs(sum - (x.mcap_change_inr_cr ?? 0))).toBeLessThan(1e-6 * Math.max(1, Math.abs(x.mcap_change_inr_cr ?? 0)));
        const e = explainStock(bEns, r, x.ticker);
        expect(badNumbers(e)).toEqual([]);
        for (let j = 1; j < e.reasons.length; j++) expect(Math.abs(e.reasons[j - 1].inr_cr)).toBeGreaterThanOrEqual(Math.abs(e.reasons[j].inr_cr));
      }
      expect(scenarioHeadline(bEns, r)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe('intensityValues', () => {
  it('Mild / Severe / Extreme = each spec’s MC low / default / MC high (horizon overrides applied)', () => {
    const d = intensityValues(bEns, 'fullpop', '1D');
    expect([d.mild.c, d.severe.c, d.extreme.c]).toEqual([0.05, 0.1, 0.15]);
    expect([d.mild.lambda, d.severe.lambda, d.extreme.lambda]).toEqual([0.05, 0.1, 0.2]);
    const y = intensityValues(bEns, 'fullpop', '12M');
    expect([y.mild.c, y.severe.c, y.extreme.c]).toEqual([0.2, 0.35, 0.5]);
    expect(intensityValues(bEns, 'fullpop')).toEqual(y); // default horizon = defaultParams'
    expect(intensityValues(bEns, 'capex')).toEqual(intensityValues(bEns, 'capex', '1M'));
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const iv = intensityValues(bEns, preset, h);
        const specs = paramSpecs(bEns, preset, h);
        for (const [k, v] of Object.entries(iv.mild)) {
          const s = specs.find((z) => z.key === k)!;
          expect(s.mc && s.mc.dist !== 'fixed').toBe(true);
          expect(v).toBeLessThanOrEqual(iv.severe[k]);
          expect(iv.severe[k]).toBe(s.value);
          expect(iv.extreme[k]).toBeGreaterThanOrEqual(iv.severe[k]);
        }
        expect('target_pe' in iv.mild || 'f_override' in iv.mild).toBe(false);
      }
  });

  it('feeding the levels into the engine orders the damage mild < severe < extreme', () => {
    for (const preset of ['capex', 'guidance', 'credit', 'fullpop'] as PresetId[]) {
      const iv = intensityValues(bEns, preset);
      const p = defaultParams(bEns, preset);
      const tot = (lvl: keyof typeof iv) => runScenario(bEns, { ...p, values: { ...p.values, ...iv[lvl] } }).totals.india_mcap_change_inr_cr;
      expect(tot('mild')).toBeGreaterThan(tot('severe'));
      expect(tot('severe')).toBeGreaterThan(tot('extreme'));
    }
  });
});
