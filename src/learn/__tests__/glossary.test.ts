// Glossary completeness and live-example safety against the real bundle.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultParams, runMonteCarlo, runScenario, withRanges } from '../../engine/index';
import type { DataBundle } from '../../types/data';
import type { Horizon, PresetId } from '../../types/engine';
import { exampleFor, GLOSSARY, searchText, TOPICS } from '../glossary';
import { GLOSSARY_IDS } from '../ids';
import { ILL_IDS } from '../illustrations';

const PATH = fileURLToPath(new URL('../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);

describe('glossary', () => {
  it('has an entry, a topic and an existing illustration for every id', () => {
    const topics = new Set(TOPICS.map((t) => t.id));
    for (const id of GLOSSARY_IDS) {
      const e = GLOSSARY[id];
      expect(e, id).toBeDefined();
      expect(e.id).toBe(id);
      expect(e.term.length, id).toBeGreaterThan(2);
      expect(e.tech.length, id).toBeGreaterThan(1);
      expect(e.oneLiner.length, id).toBeGreaterThan(20);
      expect(e.body.length, id).toBeGreaterThan(0);
      expect(topics.has(e.topic), `${id} topic ${e.topic}`).toBe(true);
      expect(ILL_IDS, `${id} illustration ${e.ill}`).toContain(e.ill);
    }
    expect(Object.keys(GLOSSARY).length).toBe(GLOSSARY_IDS.length);
  });

  it('related links point at real entries, never at themselves', () => {
    for (const id of GLOSSARY_IDS)
      for (const r of GLOSSARY[id].related) {
        expect(GLOSSARY_IDS as readonly string[], `${id} → ${r}`).toContain(r);
        expect(r).not.toBe(id);
      }
  });

  it('every topic has entries; search text includes the plain and technical names', () => {
    for (const t of TOPICS) expect(GLOSSARY_IDS.some((id) => GLOSSARY[id].topic === t.id), t.id).toBe(true);
    expect(searchText(GLOSSARY.beta)).toContain('beta');
    expect(searchText(GLOSSARY.beta)).toContain('follows us chips');
  });

  it('examples degrade to null without data', () => {
    for (const id of GLOSSARY_IDS) {
      const s = exampleFor(id, { bundle: null, result: null });
      if (s !== null) expect(/NaN|undefined|Infinity/.test(s), id).toBe(false);
    }
  });

  describe.skipIf(!HAS)('real data.json', () => {
    const bundle = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle;
    const cases: [PresetId, Horizon][] = [
      ['fullpop', '1M'],
      ['capex', '1D'],
      ['guidance', '12M'],
      ['restatement', '1D'],
      ['multiple', '1M'],
      ['credit', '1M'],
      ['replay', '1M'],
    ];

    it('examples never leak NaN / undefined for any preset, with and without simulated ranges', () => {
      for (const [preset, h] of cases) {
        const params = defaultParams(bundle, preset, h);
        const base = runScenario(bundle, params);
        const ranged = withRanges(base, runMonteCarlo(bundle, params, { runs: 200, seed: 7 }));
        for (const result of [base, ranged])
          for (const id of GLOSSARY_IDS) {
            const raw = GLOSSARY[id].example({ bundle, result });
            if (raw !== null) expect(/NaN|undefined|Infinity/.test(raw), `${preset} ${id}: ${raw}`).toBe(false);
          }
      }
    });

    it('data-driven entries produce a real example on the real bundle', () => {
      const result = runScenario(bundle, defaultParams(bundle, 'fullpop', '1M'));
      const needs = ['scenario', 'capex', 'hyperscaler', 'beta', 'beta_total', 'downside_beta', 'pe', 'eps', 'ai_premium', 'crore', 'mcap', 'tier', 'channel', 'drawdown', 'car', 'contagion', 'sourced', 'r2', 'lag', 'inr_depr', 'full_pop', 'gap', 'ear'] as const;
      for (const id of needs) expect(exampleFor(id, { bundle, result }), id).not.toBeNull();
      // the beta example quotes the showcase stock's real total beta
      const nw = bundle.india.find((t) => t.ticker === 'NETWEB.NS');
      if (nw?.beta_total != null) expect(exampleFor('beta', { bundle, result })).toContain(nw.beta_total.toFixed(2));
    });
  });
});
