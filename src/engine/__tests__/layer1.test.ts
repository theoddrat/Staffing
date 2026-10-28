import { describe, expect, it } from 'vitest';
import { defaultParams, runScenario, securityWaterfall } from '../index';
import { makeBundle } from '../__fixtures__/makeBundle';
import type { ScenarioParams } from '../../types/engine';

const b = makeBundle();
const close = (a: number, x: number, d = 1e-9) => expect(Math.abs(a - x)).toBeLessThan(d);
const origin = (r: ReturnType<typeof runScenario>, t: string) => r.origins.find((o) => o.ticker === t)!;

function params(preset: ScenarioParams['preset'], values: ScenarioParams['values'] = {}, horizon: ScenarioParams['horizon'] = '1M'): ScenarioParams {
  const p = defaultParams(b, preset, horizon);
  return { ...p, values: { ...p.values, ...values } };
}

describe('Layer 1 — valuation math and waterfall', () => {
  it('capex channel: revenue hit = c·ψ·s, EPS cut = hit·OL, move = (1-e)(1-d)-1', () => {
    const r = runScenario(b, params('capex', { c: 0.3, psi_supplier: 1, kappa: 0 }));
    const nvda = origin(r, 'NVDA');
    close(nvda.revenue_hit, 0.3 * 1 * 0.5);
    close(nvda.e, 0.15 * 1.2);
    close(nvda.d, 0);
    close(nvda.move, (1 - 0.18) * (1 - 0) - 1);
    // waterfall: price -> EPS cut -> de-rating -> new price
    close(nvda.price_after_eps!, 200 * (1 - 0.18));
    close(nvda.price_new!, 200 * (1 + nvda.move));
    close(nvda.mcap_change_usd!, 5e12 * nvda.move, 1);
    close(nvda.mcap_change_inr_cr!, (5e12 * nvda.move * 95) / 1e7, 1e-3);
    const wf = securityWaterfall(b, r, 'NVDA')!;
    expect(wf.steps.map((s) => s.label)).toEqual(['Price (last close)', 'EPS cut', 'Multiple de-rating', 'Sympathy / contagion']);
    close(wf.steps[1].price!, 164);
    close(wf.steps[1].change, -0.18);
  });

  it('capex channel: κ adds a growth de-rating d = κ·e', () => {
    const r = runScenario(b, params('capex', { c: 0.3, kappa: 0.5 }));
    const amd = origin(r, 'AMD');
    const e = 0.3 * 0.29 * 2.0;
    close(amd.e, e);
    close(amd.d, 0.5 * e);
    close(amd.move, (1 - e) * (1 - 0.5 * e) - 1);
  });

  it('capex channel: hyperscalers and software are not hit; EPS cut capped at 95%', () => {
    const r = runScenario(b, params('capex', { c: 0.99 }));
    expect(origin(r, 'MSFT').move).toBe(0);
    expect(origin(r, 'ORCL').move).toBe(0);
    expect(origin(r, 'ADBE').move).toBe(0);
    close(origin(r, 'CRWV').e, 0.95); // 0.99*0.67*3 > 0.95
  });

  it('capex_absorbed_share = Σ revenue_hit·revenue / (c·Σ capex)', () => {
    const r = runScenario(b, params('capex', { c: 0.3 }));
    const lost = 0.15 * 300e9 + 0.3 * 0.29 * 40e9 + 0.3 * 0.67 * 6e9 + 0.3 * 0.75 * 10e9;
    close(r.factors.capex_cut_usd!, 0.3 * (300e9 + 100e9), 1);
    close(r.factors.capex_absorbed_share!, lost / (0.3 * 400e9), 1e-9);
  });

  it('capex sanity: a supplier whose revenue loss exceeds the whole cut is flagged and excluded', () => {
    const bad = makeBundle();
    bad.securities['NVDA'].revenue_ttm = 300e9 * 32; // e.g. statement currency mistaken for USD
    const p = defaultParams(bad, 'capex', '1M');
    const r = runScenario(bad, { ...p, values: { ...p.values, c: 0.3 } });
    expect(r.warnings.some((w) => w.includes('capex sanity') && w.includes('NVDA'))).toBe(true);
    const lost = 0.3 * 0.29 * 40e9 + 0.3 * 0.67 * 6e9 + 0.3 * 0.75 * 10e9;
    close(r.factors.capex_absorbed_share!, lost / (0.3 * 400e9), 1e-9);
  });

  it('guidance: target hit with κ de-rating, peers move via peer beta (sympathy)', () => {
    const r = runScenario(b, params('guidance', { target: 'AMD', g: 0.2, kappa: 0.5, sympathy: 1 }));
    const amd = origin(r, 'AMD');
    close(amd.e, 0.4);
    close(amd.d, 0.2);
    close(amd.move, 0.6 * 0.8 - 1);
    const nvda = origin(r, 'NVDA');
    close(nvda.move_direct, 0);
    close(nvda.move_sympathy, Math.exp(0.6 * Math.log(0.48)) - 1);
    close(nvda.move, nvda.move_sympathy);
  });

  it('restatement at an origin: (1-r)(1-d)-1 and same-group contagion', () => {
    const r = runScenario(b, params('restatement', { target: 'CRWV', r: 0.3, d: 0.25, contagion: null }));
    const crwv = origin(r, 'CRWV');
    close(crwv.move, 0.7 * 0.75 - 1);
    // VRT is in the same group (infra); contagion defaults to calib.contagion_us = 0.15
    close(origin(r, 'VRT').move, 0.15 * (0.7 * 0.75 - 1));
    expect(origin(r, 'NVDA').move).toBe(0);
  });

  it('multiple compression: basket reverts toward pre-ChatGPT median; floor at zero; per-name option', () => {
    const r = runScenario(b, params('multiple', { lambda: 1, mode: 'median', per_name: false, floor_zero: true }));
    // aggregate P/E over names with both P/Es (CRWV excluded): ΣM / Σ(M/PE)
    const names = [
      { m: 5e12, pe: 40, pre: 50 },
      { m: 0.9e12, pe: 80, pre: 40 },
      { m: 4e12, pe: 35, pre: 30 },
      { m: 0.37e12, pe: 25, pre: 18 },
      { m: 80e9, pe: 45, pre: 25 },
      { m: 0.1e12, pe: 20, pre: 40 },
    ];
    const M = names.reduce((a, x) => a + x.m, 0);
    const now = M / names.reduce((a, x) => a + x.m / x.pe, 0);
    const pre = M / names.reduce((a, x) => a + x.m / x.pre, 0);
    const d = Math.max(0, 1 - pre / now);
    for (const o of r.origins) close(o.d, d, 1e-12);
    close(origin(r, 'NVDA').e, 0);
    // target multiple mode
    const r2 = runScenario(b, params('multiple', { mode: 'multiple', target_pe: 20 }));
    close(origin(r2, 'MSFT').d, 1 - 20 / now, 1e-12);
    // per-name: NVDA trades below its pre-ChatGPT median -> floored at 0; AMD compresses to its own median
    const r3 = runScenario(b, params('multiple', { lambda: 1, mode: 'median', per_name: true, floor_zero: true }));
    close(origin(r3, 'NVDA').d, 0);
    close(origin(r3, 'AMD').d, 1 - 40 / 80);
    // floor off: NVDA re-rates up
    const r4 = runScenario(b, params('multiple', { lambda: 1, mode: 'median', per_name: true, floor_zero: false }));
    close(origin(r4, 'NVDA').d, 1 - 50 / 40);
    expect(origin(r4, 'NVDA').move).toBeGreaterThan(0);
  });

  it('multiple compression uses history.ai_basket_pe when present', () => {
    const bh = makeBundle({ aiBasketFromHistory: true });
    const p = defaultParams(bh, 'multiple');
    const r = runScenario(bh, { ...p, values: { ...p.values, lambda: 0.5, mode: 'median' } });
    // now 40, pre 30 -> target 35 -> d = 1 - 35/40
    close(r.origins[0].d, 1 - 35 / 40);
  });

  it('credit: stressed equity hit = Δs·dur·net debt/mcap, suppliers lose k·ψ·neocloud share', () => {
    const r = runScenario(b, params('credit', { ds_bps: 400, duration: 5, k: 0.3, d_credit: 0.15, psi_supplier: 1 }));
    const crwv = origin(r, 'CRWV');
    close(crwv.e, (0.04 * 5 * 46e9) / 30e9);
    close(crwv.d, 0.15);
    const orcl = origin(r, 'ORCL');
    close(orcl.e, (0.04 * 5 * 130e9) / 0.37e12);
    const nvda = origin(r, 'NVDA');
    close(nvda.revenue_hit, 0.3 * 0.2);
    close(nvda.e, 0.06 * 1.2);
    expect(r.lowConfidence).toBe(true);
  });

  it('fullpop combines capex + multiple + credit multiplicatively', () => {
    const p = defaultParams(b, 'fullpop', '12M');
    const r = runScenario(b, p);
    const crwv = origin(r, 'CRWV');
    const eCapex = Math.min(0.35 * 1 * 0.67 * 3, 0.95);
    const eCredit = Math.min((0.05 * 5 * 46e9) / 30e9, 0.9);
    close(crwv.e, 1 - (1 - eCapex) * (1 - eCredit));
    const dMult = origin(r, 'MSFT').d; // MSFT only has the multiple component
    close(crwv.d, 1 - (1 - dMult) * (1 - 0.2));
    close(crwv.move, (1 - crwv.e) * (1 - crwv.d) - 1);
    expect(r.lowConfidence).toBe(true);
  });
});
