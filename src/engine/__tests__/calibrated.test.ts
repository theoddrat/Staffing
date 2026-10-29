import { describe, expect, it } from 'vitest';
import { defaultParams, runScenario } from '../index';
import { makeBundle } from '../__fixtures__/makeBundle';
import type { DataBundle } from '../../types/data';
import type { ScenarioParams } from '../../types/engine';
import { badNumbers } from './helpers';

const close = (a: number, x: number, d = 1e-9) => expect(Math.abs(a - x)).toBeLessThan(d);

function multiple(b: DataBundle, values: ScenarioParams['values']): ScenarioParams {
  const p = defaultParams(b, 'multiple', '1M');
  return { ...p, values: { ...p.values, ...values } };
}

describe("shock 4 mode 'calibrated' (P/E-vs-drawdown fit)", () => {
  it('d_basket = λ·max(0, −(intercept + slope·PE_now)) for every origin, per_name included', () => {
    const b = makeBundle({ aiBasket: { now: 25, pre: 32 }, peFit: { intercept: -0.36, slope: -0.005 } });
    const implied = -0.36 - 0.005 * 25; // -0.485
    for (const per_name of [false, true]) {
      const r = runScenario(b, multiple(b, { mode: 'calibrated', lambda: 0.6, per_name }));
      for (const o of r.origins) {
        close(o.d, 0.6 * -implied, 1e-12);
        close(o.e, 0);
        close(o.move, -0.6 * -implied, 1e-12);
      }
      expect(badNumbers(r)).toEqual([]);
      expect(r.warnings.some((w) => w.includes('calibrated'))).toBe(true);
    }
  });

  it('is zero when the fit implies no drawdown at today’s P/E', () => {
    const b = makeBundle({ aiBasket: { now: 25, pre: 32 }, peFit: { intercept: 0.5, slope: -0.001 } });
    const r = runScenario(b, multiple(b, { mode: 'calibrated', lambda: 0.8 }));
    for (const o of r.origins) expect(o.d).toBe(0);
    for (const x of r.india) expect(Math.abs(x.market_move)).toBeLessThan(1e-12);
  });

  it('is monotone in λ (more of the implied drawdown realised ⇒ larger de-rating, lower prices)', () => {
    const b = makeBundle({ aiBasket: { now: 25, pre: 32 }, peFit: { intercept: -0.36, slope: -0.005 } });
    let prevD = -1;
    let prevSox = 1;
    for (const lambda of [0, 0.1, 0.3, 0.6, 0.9, 1]) {
      const r = runScenario(b, multiple(b, { mode: 'calibrated', lambda }));
      const d = r.origins[0].d;
      expect(d).toBeGreaterThanOrEqual(prevD);
      expect(r.factors.SOX).toBeLessThanOrEqual(prevSox + 1e-12);
      prevD = d;
      prevSox = r.factors.SOX;
    }
  });

  it('missing pe_fit: no compression, explicit warning', () => {
    const b = makeBundle({ aiBasket: { now: 25, pre: 32 }, peFit: { intercept: 0, slope: 0, n: 0 } });
    const r = runScenario(b, multiple(b, { mode: 'calibrated', lambda: 0.6 }));
    for (const o of r.origins) expect(o.d).toBe(0);
    expect(r.warnings.some((w) => w.includes('pe_fit unavailable'))).toBe(true);
  });

  it("median mode warns when the basket trades below its pre-ChatGPT median (and only then)", () => {
    const below = makeBundle({ aiBasket: { now: 25, pre: 32 } });
    const r = runScenario(below, multiple(below, { mode: 'median', lambda: 0.5 }));
    const msg = r.warnings.find((w) => w.includes('below its pre-ChatGPT median'));
    expect(msg).toBe(
      'AI-basket trailing P/E (25.0x) is below its pre-ChatGPT median (32.0x): reversion implies no de-rating — switch MODE to CALIBRATED (P/E-vs-drawdown fit) or MULTIPLE.',
    );
    for (const o of r.origins) expect(o.d).toBe(0); // floored
    const above = makeBundle({ aiBasket: { now: 40, pre: 30 } });
    const r2 = runScenario(above, multiple(above, { mode: 'median', lambda: 0.5 }));
    expect(r2.warnings.some((w) => w.includes('below its pre-ChatGPT median'))).toBe(false);
    // calibrated mode does not emit the median warning
    const r3 = runScenario(below, multiple(below, { mode: 'calibrated', lambda: 0.5 }));
    expect(r3.warnings.some((w) => w.includes('below its pre-ChatGPT median'))).toBe(false);
  });

  it('fullpop uses whatever mode its params specify', () => {
    const b = makeBundle({ aiBasket: { now: 25, pre: 32 }, peFit: { intercept: -0.36, slope: -0.005 } });
    const p = defaultParams(b, 'fullpop', '12M');
    const med = runScenario(b, p);
    expect(med.origins.find((o) => o.ticker === 'MSFT')!.d).toBe(0); // median: no compression
    const cal = runScenario(b, { ...p, values: { ...p.values, mode: 'calibrated' } });
    // MSFT carries only the multiple leg in fullpop (hyperscaler, not stressed)
    close(cal.origins.find((o) => o.ticker === 'MSFT')!.d, 0.6 * 0.485, 1e-12);
    // ORCL: multiple leg combined with the credit de-rating
    close(cal.origins.find((o) => o.ticker === 'ORCL')!.d, 1 - (1 - 0.6 * 0.485) * (1 - 0.2), 1e-12);
    expect(cal.factors.SOX).toBeLessThan(med.factors.SOX);
  });

  it('revenue_ttm_usd is preferred over converting revenue_ttm', () => {
    const b = makeBundle();
    b.securities['NVDA'].revenue_ttm = 9e15; // nonsense in the reporting currency...
    b.securities['NVDA'].financial_currency = 'TWD';
    b.securities['NVDA'].revenue_ttm_usd = 300e9; // ...but the pipeline's USD figure is used
    const p = defaultParams(b, 'capex', '1M');
    const r = runScenario(b, { ...p, values: { ...p.values, c: 0.3 } });
    const lost = 0.15 * 300e9 + 0.3 * 0.29 * 40e9 + 0.3 * 0.67 * 6e9 + 0.3 * 0.75 * 10e9;
    close(r.factors.capex_absorbed_share!, lost / (0.3 * 400e9), 1e-9);
    expect(r.warnings.some((w) => w.includes('capex sanity'))).toBe(false);
  });
});
