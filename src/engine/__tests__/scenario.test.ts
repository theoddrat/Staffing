import { describe, expect, it } from 'vitest';
import { defaultParams, paramSpecs, runScenario, withHorizon, effectiveQuantity } from '../index';
import { makeBundle } from '../__fixtures__/makeBundle';
import type { ScenarioParams, ScenarioResult } from '../../types/engine';
import { badNumbers } from './helpers';

const b = makeBundle();
const PRESETS = ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'replay', 'fullpop'] as const;
const HORIZONS = ['1D', '1M', '12M'] as const;


function zero(preset: ScenarioParams['preset']): ScenarioParams {
  const p = defaultParams(b, preset, '1M');
  const v = { ...p.values };
  for (const k of ['c', 'g', 'r', 'd', 'lambda', 'kappa', 'ds_bps', 'k', 'd_credit', 'lambda_india']) if (k in v) v[k] = 0;
  return { ...p, values: v };
}

describe('scenario invariants', () => {
  it('every preset × horizon returns finite numbers only', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const r = runScenario(b, defaultParams(b, preset, h));
        expect(badNumbers(r)).toEqual([]);
        expect(r.india.length).toBe(b.india.length);
        expect(r.origins.length).toBe(b.origins.length);
      }
  });

  it('zero shock ⇒ zero moves everywhere', () => {
    for (const preset of ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'fullpop'] as const) {
      const r = runScenario(b, zero(preset));
      for (const o of r.origins) expect(Math.abs(o.move)).toBeLessThan(1e-12);
      for (const x of r.india) {
        expect(Math.abs(x.market_move)).toBeLessThan(1e-12);
        expect(Math.abs(x.fundamental_net ?? 0)).toBeLessThan(1e-12);
      }
      expect(Math.abs(r.factors.SOX)).toBeLessThan(1e-12);
      expect(r.factors.inr_depr).toBe(0);
    }
  });

  it('monotone in the capex cut c (market and fundamental moves never improve as c rises)', () => {
    let prev: ScenarioResult | null = null;
    for (const c of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]) {
      const p = defaultParams(b, 'capex', '1M');
      const r = runScenario(b, { ...p, values: { ...p.values, c, f_override: 0 } });
      if (prev) {
        for (const x of r.india) {
          const y = prev.india.find((z) => z.ticker === x.ticker)!;
          expect(x.market_move).toBeLessThanOrEqual(y.market_move + 1e-12);
          expect(x.fundamental_net!).toBeLessThanOrEqual(y.fundamental_net! + 1e-12);
        }
        expect(r.factors.SOX).toBeLessThanOrEqual(prev.factors.SOX + 1e-12);
      }
      prev = r;
    }
  });

  it('India results are sorted by market move (most negative first) and totals add up', () => {
    const r = runScenario(b, defaultParams(b, 'fullpop', '12M'));
    for (let i = 1; i < r.india.length; i++) expect(r.india[i].market_move).toBeGreaterThanOrEqual(r.india[i - 1].market_move);
    const tot = r.india.reduce((a, x) => a + (x.mcap_change_inr_cr ?? 0), 0);
    expect(Math.abs(r.totals.india_mcap_change_inr_cr - tot)).toBeLessThan(1e-6);
  });

  it('INR-crore channel contributions add up to the market and fundamental mcap changes', () => {
    const r = runScenario(b, defaultParams(b, 'fullpop', '12M'));
    for (const x of r.india) {
      const c = x.channel_inr_cr;
      const mkt = (c.parent ?? 0) + (c.sentiment ?? 0) + (c.fx_fpi ?? 0) + (c.own ?? 0);
      expect(Math.abs(mkt - (x.mcap_change_inr_cr ?? 0))).toBeLessThan(1e-6 * Math.max(1, Math.abs(mkt)));
    }
  });

  it('dominant channel is the largest |INR crore| contribution', () => {
    const r = runScenario(b, defaultParams(b, 'fullpop', '12M'));
    for (const x of r.india) {
      const best = Object.entries(x.channel_inr_cr).sort((a, z) => Math.abs(z[1] ?? 0) - Math.abs(a[1] ?? 0))[0];
      expect(Math.abs(x.channel_inr_cr[x.dominant_channel] ?? 0)).toBeCloseTo(Math.abs(best[1] ?? 0), 9);
    }
  });

  it('Sankey graphs conserve flow through every channel node and reference known nodes', () => {
    const r = runScenario(b, defaultParams(b, 'fullpop', '12M'));
    for (const g of [r.sankey.market, r.sankey.fundamental]) {
      const ids = new Set(g.nodes.map((n) => n.id));
      for (const l of g.links) {
        expect(ids.has(l.source)).toBe(true);
        expect(ids.has(l.target)).toBe(true);
        expect(l.value).toBeGreaterThan(0);
      }
      for (const n of g.nodes.filter((x) => x.kind === 'channel')) {
        const inn = g.links.filter((l) => l.target === n.id).reduce((a, l) => a + l.value, 0);
        const out = g.links.filter((l) => l.source === n.id).reduce((a, l) => a + l.value, 0);
        expect(Math.abs(inn - out)).toBeLessThan(1e-6 * Math.max(1, out));
      }
    }
  });

  it('low-confidence flag for credit and fullpop only', () => {
    for (const preset of PRESETS) {
      const r = runScenario(b, defaultParams(b, preset));
      expect(r.lowConfidence).toBe(preset === 'credit' || preset === 'fullpop');
    }
  });

  it('missing data degrades gracefully with warnings, never NaN', () => {
    const bad = makeBundle();
    bad.india[0].reg = null;
    bad.parent_maps = {};
    bad.india[1].slopes.parent_on_sox = null;
    (bad as any).factor_map = undefined;
    (bad as any).nifty_model = undefined;
    bad.securities['NVDA'].pe_ttm = null;
    bad.securities['INFY.NS'].ebit_margin = null;
    bad.origins[3].credit.net_debt_usd = null;
    bad.history.replay_windows = [];
    for (const preset of PRESETS) {
      const r = runScenario(bad, defaultParams(bad, preset));
      expect(badNumbers(r)).toEqual([]);
    }
    const r = runScenario(bad, defaultParams(bad, 'fullpop'));
    expect(r.warnings.some((w) => w.includes('factor_map'))).toBe(true);
    expect(r.india.find((x) => x.ticker === 'OFSS.NS')!.notes.some((n) => n.includes('no Layer-2 regression'))).toBe(true);
  });
});

describe('presets & quantities', () => {
  it('fullpop horizon overrides set values and MC bounds; withHorizon resets them', () => {
    const p1 = defaultParams(b, 'fullpop', '1D');
    expect(p1.values.c).toBe(0.1);
    const spec = paramSpecs(b, 'fullpop', '1D').find((s) => s.key === 'c')!;
    expect(spec.mc).toEqual({ dist: 'triangular', low: 0.05, high: 0.15 });
    const p12 = withHorizon(b, { ...p1, values: { ...p1.values, phi_it: 1.3 } }, '12M');
    expect(p12.values.c).toBe(0.35);
    expect(p12.values.phi_it).toBe(1.3);
    expect(p12.horizon).toBe('12M');
  });

  it('replay default horizon follows the window length', () => {
    expect(defaultParams(b, 'replay').horizon).toBe('1D'); // DEEPSEEK window (1 trading day)
  });

  it('overrides replace quantity values and mark them USER_ASSUMPTION', () => {
    const eq = effectiveQuantity(b, { 'INFY.NS.exposure.revenue': 0.2 }, 'INFY.NS.exposure.revenue');
    expect(eq.value).toBe(0.2);
    expect(eq.status).toBe('USER_ASSUMPTION');
    expect(eq.overridden).toBe(true);
    const amd = effectiveQuantity(b, {}, 'AMD.hyperscaler_share');
    expect(amd.assumption).toBe(true); // DERIVED with a USER_ASSUMPTION part
    const p = defaultParams(b, 'capex');
    const base = runScenario(b, p).india.find((x) => x.ticker === 'INFY.NS')!;
    const ov = runScenario(b, { ...p, overrides: { 'INFY.NS.exposure.revenue': 0.2 } }).india.find((x) => x.ticker === 'INFY.NS')!;
    expect(ov.ear).toBeGreaterThan(base.ear);
    expect(ov.confidence.assumption_share).toBeGreaterThan(base.confidence.assumption_share);
  });

  it('unknown preset / target produce warnings, not exceptions', () => {
    const p = defaultParams(b, 'guidance');
    const r = runScenario(b, { ...p, values: { ...p.values, target: 'NOPE' } });
    expect(r.warnings.some((w) => w.includes('NOPE'))).toBe(true);
    expect(badNumbers(r)).toEqual([]);
  });
});
