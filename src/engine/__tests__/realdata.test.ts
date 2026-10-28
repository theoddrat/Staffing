// Smoke test against the real public/data.json (skipped when the bundle has not been built yet).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DataBundle, Quantity, Status } from '../../types/data';
import { defaultParams, quantityIndex, runMonteCarlo, runScenario } from '../index';
import { badNumbers } from './helpers';

const PATH = fileURLToPath(new URL('../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);
const PRESETS = ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'replay', 'fullpop'] as const;
const HORIZONS = ['1D', '1M', '12M'] as const;
const STATUSES: Status[] = ['SOURCED', 'UNVERIFIED', 'USER_ASSUMPTION', 'COMPUTED', 'DERIVED'];

describe.skipIf(!HAS)('real data.json', () => {
  const bundle = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle;

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
