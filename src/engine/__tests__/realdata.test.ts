// Smoke test against the real public/data.json (skipped when the bundle has not been built yet).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DataBundle, Quantity, Status } from '../../types/data';
import { defaultParams, explainStock, intensityValues, quantityIndex, runMonteCarlo, runScenario, scenarioHeadline, withRanges } from '../index';
import { badNumbers } from './helpers';

const PATH = fileURLToPath(new URL('../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);
const BUNDLE = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle | null;
const HAS_MODELS = !!BUNDLE?.models?.length;
const PRESETS = ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'replay', 'fullpop'] as const;
const HORIZONS = ['1D', '1M', '12M'] as const;
const STATUSES: Status[] = ['SOURCED', 'UNVERIFIED', 'USER_ASSUMPTION', 'COMPUTED', 'DERIVED'];

describe.skipIf(!HAS)('real data.json', () => {
  const bundle = BUNDLE as DataBundle;

  it('contract basics: origins / India targets / presets present and resolvable', () => {
    expect(bundle.origins.length).toBeGreaterThan(0);
    expect(bundle.india.length).toBeGreaterThan(0);
    for (const id of PRESETS) expect(bundle.presets.some((p) => p.id === id)).toBe(true);
    for (const o of bundle.origins) expect(bundle.securities[o.ticker], `security for origin ${o.ticker}`).toBeDefined();
    for (const t of bundle.india) expect(bundle.securities[t.ticker], `security for India ${t.ticker}`).toBeDefined();
    for (const q of quantityIndex(bundle).values() as Iterable<Quantity>) expect(STATUSES).toContain(q.status);
  });

  it('every preset × horizon yields finite results (no NaN / undefined)', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const r = runScenario(bundle, defaultParams(bundle, preset, h));
        expect(badNumbers(r), `${preset} ${h}`).toEqual([]);
      }
  });

  it('full bubble pop magnitudes are sane', () => {
    for (const h of HORIZONS) {
      const r = runScenario(bundle, defaultParams(bundle, 'fullpop', h));
      expect(r.factors.SOX).toBeLessThan(0);
      expect(r.factors.SOX).toBeGreaterThan(-0.95);
      expect(r.factors.NDX).toBeLessThan(0);
      expect(r.factors.NDX).toBeGreaterThan(-0.95);
      for (const x of r.india) {
        expect(x.market_move).toBeGreaterThan(-0.99);
        expect(x.market_move).toBeLessThan(0.5);
      }
      expect(r.lowConfidence).toBe(true);
    }
  });

  it("calibrated multiple mode produces the fit-implied de-rating (and median mode explains itself)", () => {
    const fit = bundle.history?.pe_fit;
    const p = defaultParams(bundle, 'fullpop', '12M');
    const cal = runScenario(bundle, { ...p, values: { ...p.values, mode: 'calibrated' } });
    expect(badNumbers(cal)).toEqual([]);
    if (fit && fit.n > 0 && bundle.history.ai_basket_pe?.now) {
      const implied = fit.intercept + fit.slope * bundle.history.ai_basket_pe.now;
      const lambda = Number(p.values.lambda);
      const msft = cal.origins.find((o) => o.group === 'hyperscalers' && !bundle.origins.find((x) => x.ticker === o.ticker)!.credit.stressed)!;
      expect(Math.abs(msft.d - lambda * Math.max(0, -implied))).toBeLessThan(1e-9);
      const med = runScenario(bundle, { ...p, values: { ...p.values, mode: 'median' } });
      expect(cal.factors.SOX).toBeLessThanOrEqual(med.factors.SOX + 1e-12);
      const pre = bundle.history.ai_basket_pe.pre_chatgpt_median;
      if (pre && bundle.history.ai_basket_pe.now <= pre) expect(med.warnings.some((w) => w.includes('below its pre-ChatGPT median'))).toBe(true);
    }
  });

  it('Monte Carlo on the real bundle: ordered percentiles, fast', () => {
    const p = defaultParams(bundle, 'fullpop', '12M');
    const t0 = performance.now();
    const mc = runMonteCarlo(bundle, p, { runs: 5000, seed: 20221130, fanTicker: bundle.india[0].ticker });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(4000);
    for (const q of Object.values(mc.perStock)) {
      expect(q.market.p5).toBeLessThanOrEqual(q.market.p50);
      expect(q.market.p50).toBeLessThanOrEqual(q.market.p95);
    }
    expect(badNumbers(mc)).toEqual([]);
  });
});

describe.skipIf(!HAS)('real data.json: V2 explanations (with or without models)', () => {
  const bundle = BUNDLE as DataBundle;

  it('explainStock / scenarioHeadline / intensityValues are finite for every stock, preset and horizon', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const r = runScenario(bundle, defaultParams(bundle, preset, h));
        const s = scenarioHeadline(bundle, r);
        expect(s, `${preset} ${h}`).not.toMatch(/NaN|undefined|Infinity/);
        for (const x of r.india) {
          const e = explainStock(bundle, r, x.ticker);
          expect(badNumbers(e), `${preset} ${h} ${x.ticker}`).toEqual([]);
          for (const t of [e.headline, e.confidence.text, e.accuracy?.text ?? '', ...e.reasons.map((z) => z.text)]) expect(t).not.toMatch(/NaN|undefined|Infinity/);
          if (e.reasons.length) expect(e.reasons[0].channel).toBe(x.dominant_channel);
        }
        const iv = intensityValues(bundle, preset, h);
        for (const k of Object.keys(iv.severe)) {
          expect(iv.mild[k]).toBeLessThanOrEqual(iv.severe[k]);
          expect(iv.extreme[k]).toBeGreaterThanOrEqual(iv.severe[k]);
        }
      }
  });
});

describe.skipIf(!HAS_MODELS)('real data.json: V2 validated ensemble', () => {
  const bundle = BUNDLE as DataBundle;
  const withModel = new Set((bundle?.models ?? []).map((m) => m.ticker));

  it('every preset × horizon: finite, ensemble used where bundle.models has the stock, OLS comparison present', () => {
    for (const preset of PRESETS)
      for (const h of HORIZONS) {
        const r = runScenario(bundle, defaultParams(bundle, preset, h));
        expect(badNumbers(r), `${preset} ${h}`).toEqual([]);
        for (const x of r.india) {
          expect(x.model_used === 'ensemble' || x.model_used === 'ols').toBe(true);
          expect(Number.isFinite(x.market_move_ols)).toBe(true);
          if (!withModel.has(x.ticker)) expect(x.model_used).toBe('ols');
        }
        expect(r.india.filter((x) => x.model_used === 'ensemble').length).toBeGreaterThan(0);
      }
  });

  it('Monte Carlo bootstraps the out-of-sample residuals: ordered, finite, fast', () => {
    const p = defaultParams(bundle, 'fullpop', '12M');
    const t0 = performance.now();
    const mc = runMonteCarlo(bundle, p, { runs: 5000, seed: 20221130, fanTicker: bundle.india[0].ticker });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(mc.residual_source).toBe('oos');
    for (const q of Object.values(mc.perStock)) {
      expect(q.market.p5).toBeLessThanOrEqual(q.market.p50);
      expect(q.market.p50).toBeLessThanOrEqual(q.market.p95);
    }
    expect(badNumbers(mc)).toEqual([]);
    const r = withRanges(runScenario(bundle, p), mc);
    for (const x of r.india) {
      const e = explainStock(bundle, r, x.ticker);
      expect(e.headline).toContain('9 in 10 simulations');
      if (withModel.has(x.ticker)) expect(e.accuracy).not.toBeNull();
    }
  });
});
