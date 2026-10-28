import { describe, expect, it } from 'vitest';
import { defaultParams, runScenario } from '../index';
import { makeBundle } from '../__fixtures__/makeBundle';
import type { IndiaResult, ScenarioParams } from '../../types/engine';

const b = makeBundle();
const close = (a: number, x: number, d = 1e-9) => expect(Math.abs(a - x)).toBeLessThan(d);
const india = (r: ReturnType<typeof runScenario>, t: string): IndiaResult => r.india.find((x) => x.ticker === t)!;

function params(preset: ScenarioParams['preset'], values: ScenarioParams['values'] = {}): ScenarioParams {
  const p = defaultParams(b, preset, '1M');
  return { ...p, values: { ...p.values, ...values } };
}

describe('factor algebra (log space)', () => {
  it('x_chip = ln Σ w(1+move); x_SOX = β·x_chip; x_NDX = β·x_ai; Nifty = c_SOX x_SOX + c_NDX x_NDX', () => {
    const r = runScenario(b, params('capex', { c: 0.3 }));
    const chips = r.origins.filter((o) => o.group === 'chips');
    const mc = 5e12 + 0.9e12;
    const xChip = Math.log((5e12 / mc) * (1 + chips[0].move) + (0.9e12 / mc) * (1 + chips[1].move));
    close(r.factors.chip_basket, Math.exp(xChip) - 1);
    close(r.factors.x.SOX, 1.05 * xChip);
    const mAll = b.origins.reduce((a, o) => a + (b.securities[o.ticker].mcap_usd ?? 0), 0);
    const xAi = Math.log(r.origins.reduce((a, o) => a + ((b.securities[o.ticker].mcap_usd ?? 0) / mAll) * (1 + o.move), 0));
    close(r.factors.x.NDX, 0.85 * xAi);
    close(r.factors.x.NIFTY, 0.1 * r.factors.x.SOX + 0.15 * r.factors.x.NDX);
    close(r.factors.NIFTY, Math.exp(r.factors.x.NIFTY) - 1);
  });

  it('INR depreciation: auto = max(0, exp(β_inr·x_NDX)-1); override wins', () => {
    const r = runScenario(b, params('capex', { c: 0.3, f_override: null }));
    close(r.factors.inr_depr, Math.max(0, Math.exp(-0.08 * r.factors.x.NDX) - 1));
    expect(r.factors.inr_depr).toBeGreaterThan(0);
    const r2 = runScenario(b, params('capex', { c: 0.3, f_override: 0.05 }));
    close(r2.factors.inr_depr, 0.05);
  });

  it('tech revenue shock R_tech = mcap-weighted mean origin revenue hit', () => {
    const r = runScenario(b, params('capex', { c: 0.3 }));
    const mAll = b.origins.reduce((a, o) => a + (b.securities[o.ticker].mcap_usd ?? 0), 0);
    const rt = r.origins.reduce((a, o) => a + ((b.securities[o.ticker].mcap_usd ?? 0) / mAll) * o.revenue_hit, 0);
    close(r.factors.tech_revenue_shock, rt);
  });
});

describe('Layer 2 — market-implied India move', () => {
  it('contributions (parent + sentiment + fx_fpi + own) sum to ln(1+market_move)', () => {
    for (const preset of ['capex', 'guidance', 'credit', 'fullpop', 'replay', 'multiple'] as const) {
      const r = runScenario(b, defaultParams(b, preset));
      for (const x of r.india) {
        const c = x.market_contrib;
        close(Math.log(1 + x.market_move), c.parent + c.sentiment + c.fx_fpi + c.own, 1e-12);
      }
    }
  });

  it('b·x algebra: sentiment = b_SOX x_SOX + b_NDX x_NDX; fx_fpi = b_N x_N', () => {
    const r = runScenario(b, params('capex', { c: 0.3 }));
    const infy = india(r, 'INFY.NS');
    close(infy.market_contrib.sentiment, 0.05 * r.factors.x.SOX + 0.15 * r.factors.x.NDX);
    close(infy.market_contrib.fx_fpi, 0.9 * r.factors.x.NIFTY);
    expect(infy.market_contrib.parent).toBe(0);
  });

  it('parent channel: origin parent uses its Layer-1 move; non-origin parent uses parent_maps', () => {
    const r = runScenario(b, params('credit'));
    const orcl = r.origins.find((o) => o.ticker === 'ORCL')!;
    close(india(r, 'OFSS.NS').market_contrib.parent, 0.2 * Math.log(1 + orcl.move));
    close(india(r, 'POWERINDIA.NS').market_contrib.parent, 0.15 * (0.3 * r.factors.x.SOX + 0.2 * r.factors.x.NDX));
  });

  it('replay: factor moves come from the window; origin parent falls back to the co-movement slope', () => {
    const r = runScenario(b, params('replay', { window: 'DOTCOM' }));
    close(r.factors.x.SOX, -1.5);
    close(r.factors.x.NDX, -1.4);
    for (const o of r.origins) expect(o.move).toBe(0);
    close(india(r, 'OFSS.NS').market_contrib.parent, 0.2 * (0.5 * -1.5));
    for (const x of r.india) {
      expect(x.fundamental_net).toBeNull();
      expect(x.fundamental_gross).toBeNull();
      expect(x.gap).toBeNull();
    }
  });
});

describe('Layer 3 — fundamental damage + FX', () => {
  it('EaR: revenue channel = share·φ·R_tech·OL; capex channel = share·ψ_in·c·OL', () => {
    const r = runScenario(b, params('capex', { c: 0.3, phi_it: 1, psi_india_dc: 0.5, lambda_india: 0, f_override: 0 }));
    const infy = india(r, 'INFY.NS');
    close(infy.ear, 0.068 * 1 * r.factors.tech_revenue_shock * 1.4);
    close(infy.ear_contrib.revenue, infy.ear);
    const netweb = india(r, 'NETWEB.NS');
    close(netweb.ear, 0.584 * 0.5 * 0.3 * 1.4);
    close(netweb.fundamental_gross!, -netweb.ear);
    close(netweb.fundamental_net!, -netweb.ear); // no FX sensitivity
  });

  it('AI-premium unwind d = 1 − (1+prem)^(−λ); floored at 0 for discounts unless floor is off', () => {
    const p = params('multiple', { lambda: 0, lambda_india: 0.5 });
    const r = runScenario(b, p);
    close(india(r, 'STLTECH.NS').d, 1 - Math.pow(3, -0.5));
    close(india(r, 'INFY.NS').d, 0); // prem -30% -> floored
    const r2 = runScenario(b, { ...p, premiumFloorZero: false });
    close(india(r2, 'INFY.NS').d, 1 - Math.pow(0.7, -0.5));
    expect(india(r2, 'INFY.NS').fundamental_net!).toBeGreaterThan(0);
  });

  it('tier-median fallback when the AI premium is unavailable (USER_ASSUMPTION)', () => {
    const r = runScenario(b, params('multiple', { lambda: 0, lambda_india: 0.5 }));
    const nw = india(r, 'NETWEB.NS');
    expect(nw.ai_premium).toBe(2.0); // tier-C median of available premia (STLTECH only)
    expect(nw.ai_premium_status).toBe('USER_ASSUMPTION');
    expect(nw.notes.some((n) => n.includes('tier-C median'))).toBe(true);
    const ky = india(r, 'KAYNES.NS'); // tier D: no premia at all -> no unwind
    expect(ky.ai_premium).toBeNull();
    expect(ky.d).toBe(0);
  });

  it('FX EPS effect = (sens_bps/1e4 · f·100) / EBIT margin; net = (1−EaR)(1−d)(1+fx)−1; gap sign', () => {
    const r = runScenario(b, params('capex', { c: 0.3, f_override: 0.05, lambda_india: 0 }));
    const infy = india(r, 'INFY.NS');
    close(infy.fx_eps, ((30 / 1e4) * 5) / 0.21);
    close(infy.fundamental_net!, (1 - infy.ear) * (1 - infy.d) * (1 + infy.fx_eps) - 1);
    close(infy.gap!, infy.market_move - infy.fundamental_net!);
    // market falls (sentiment) while fundamentals improve with FX -> negative gap = overreaction
    expect(infy.market_move).toBeLessThan(0);
    expect(infy.gap!).toBeLessThan(0);
  });

  it('restatement of an India target: own move = (1−r)(1−d)−1, same-tier contagion, other tiers untouched', () => {
    const p = params('restatement', { target: 'INFY.NS', r: 0.4, d: 0.3, contagion: null });
    const r = runScenario(b, p);
    const own = 0.6 * 0.7 - 1;
    const infy = india(r, 'INFY.NS');
    close(infy.market_move, own);
    close(infy.fundamental_gross!, own);
    expect(infy.dominant_channel).toBe('own');
    const tcs = india(r, 'TCS.NS');
    close(tcs.market_move, 0.05 * own); // calib.contagion_india = 0.05
    expect(tcs.fundamental_net).toBe(0);
    close(tcs.gap!, tcs.market_move);
    expect(india(r, 'KAYNES.NS').market_move).toBe(0);
    for (const o of r.origins) expect(o.move).toBe(0);
  });

  it('confidence: score from R², n and assumption share; grades', () => {
    const r = runScenario(b, params('capex', { c: 0.3 }));
    const infy = india(r, 'INFY.NS'); // r2 0.4 -> full R² credit, sourced exposure & FX sens
    expect(infy.confidence.assumption_share).toBe(0);
    expect(infy.confidence.score).toBe(100);
    expect(infy.confidence.grade).toBe('HIGH');
    const ky = india(r, 'KAYNES.NS'); // n = 120 -> sample penalty; no fundamentals -> count-based share
    expect(ky.confidence.score).toBeLessThan(40);
    expect(ky.confidence.grade).toBe('LOW');
    const pw = india(r, 'POWERINDIA.NS'); // exposure is a USER_ASSUMPTION
    expect(pw.confidence.assumption_share).toBeGreaterThan(0.5);
  });
});
