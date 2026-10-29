// Guided helpers against the real public/data.json (skipped when the bundle has not been built).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../../types/data';
import { defaultParams, paramSpecs, runScenario } from '../../engine';
import { businessParts, getExplanation, marketParts, reasonText } from '../lib/explain';
import { buildFlow } from '../lib/flow';
import { headlineText } from '../lib/headline';
import { intensityValues, SHOCK_KEYS } from '../lib/intensity';
import { PARAM_COPY, SCENARIOS } from '../lib/scenarios';
import { parseHash, routeToHash } from '../router';

const PATH = fileURLToPath(new URL('../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);

describe.skipIf(!HAS)('guided helpers on real data', () => {
  const bundle = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle;
  const result = HAS ? runScenario(bundle, defaultParams(bundle, 'fullpop', '12M')) : null!;

  it('headline reads like the design example', () => {
    expect(headlineText(result)).toMatch(/^US chips −\d+% · Nifty [−+]?\d+% · India −₹[\d.,]+ (lakh )?cr$/);
  });

  it('channel splits add up exactly to the engine’s moves', () => {
    for (const r of result.india) {
      const m = marketParts(r).reduce((a, p) => a + p.frac, 0);
      expect(m).toBeCloseTo(r.market_move, 9);
      if (r.fundamental_net !== null) expect(businessParts(r).reduce((a, p) => a + p.frac, 0)).toBeCloseTo(r.fundamental_net, 9);
      const shares = marketParts(r).reduce((a, p) => a + p.share, 0);
      if (marketParts(r).length) expect(shares).toBeCloseTo(1, 9);
    }
  });

  it('every stock gets an explanation with no NaN / undefined in the words', () => {
    for (const r of result.india) {
      const e = getExplanation(bundle, result, r.ticker)!;
      expect(e.headline).not.toMatch(/NaN|undefined|null/);
      for (const p of [...marketParts(r), ...businessParts(r)]) expect(reasonText(p.channel, r, bundle, result)).not.toMatch(/NaN|undefined|null/);
      expect(parseHash(routeToHash({ mode: 'guided', view: 'stock', ticker: r.ticker, term: null }, bundle), bundle)).toMatchObject({ ticker: r.ticker });
    }
  });

  it('flow layout keeps the ₹ total of the Sankey', () => {
    for (const mode of ['market', 'fundamental'] as const) {
      const g = result.sankey[mode];
      const want = g.links.filter((l) => l.target.startsWith('t:')).reduce((a, l) => a + l.value, 0);
      const f = buildFlow(g, bundle, { mode, topN: 12 });
      expect(f.total).toBeCloseTo(want, 6);
      for (const n of f.nodes) expect(Number.isFinite(n.y + n.h + n.x)).toBe(true);
    }
  });

  it('every scenario card and intensity runs and every dial has plain copy', () => {
    for (const s of SCENARIOS) {
      const specs = paramSpecs(bundle, s.id, '1M');
      for (const level of ['mild', 'severe', 'extreme'] as const) {
        const p = defaultParams(bundle, s.id, s.id === 'replay' ? undefined : '1M');
        const r = runScenario(bundle, { ...p, values: { ...p.values, ...intensityValues(s.id, specs, level) } });
        expect(Number.isFinite(r.totals.india_mcap_change_inr_cr)).toBe(true);
      }
      for (const k of SHOCK_KEYS[s.id]) expect(specs.some((x) => x.key === k), `${s.id}.${k}`).toBe(true);
      for (const sp of specs) expect(PARAM_COPY[sp.key], `copy for ${sp.key}`).toBeDefined();
      for (const sp of specs) {
        const txt = PARAM_COPY[sp.key]?.sentence?.(sp.value, { bundle, preset: s.id, values: Object.fromEntries(specs.map((x) => [x.key, x.value])) });
        if (txt) expect(txt).not.toMatch(/NaN|undefined/);
      }
    }
  });
});
