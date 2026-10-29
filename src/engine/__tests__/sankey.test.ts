import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultParams, runScenario } from '../index';
import { makeBundle } from '../__fixtures__/makeBundle';
import type { DataBundle } from '../../types/data';
import type { PresetId, ScenarioResult, SankeyGraph } from '../../types/engine';

/** Signed totals per channel node: inflow (origin→channel) and outflow (channel→stock). */
function channelBalance(g: SankeyGraph) {
  const channels = new Set(g.nodes.filter((n) => n.kind === 'channel').map((n) => n.id));
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of g.links) {
    if (channels.has(l.target)) inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.sign * l.value);
    if (channels.has(l.source)) outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.sign * l.value);
  }
  return { channels, inflow, outflow };
}

/** Σ over stocks of the engine's signed INR-crore channel contributions, keyed like the Sankey channel ids. */
function stockSums(r: ScenarioResult, mode: 'market' | 'fundamental'): Map<string, number> {
  const keys = mode === 'market' ? ['parent', 'sentiment', 'fx_fpi'] : ['revenue', 'capex', 'credit'];
  const out = new Map<string, number>();
  for (const t of r.india) for (const k of keys) out.set(`c:${k}`, (out.get(`c:${k}`) ?? 0) + (t.channel_inr_cr[k as keyof typeof t.channel_inr_cr] ?? 0));
  return out;
}

function expectBalanced(r: ScenarioResult) {
  for (const mode of ['market', 'fundamental'] as const) {
    const { channels, inflow, outflow } = channelBalance(r.sankey[mode]);
    const sums = stockSums(r, mode);
    for (const c of channels) {
      const scale = Math.max(1, Math.abs(outflow.get(c) ?? 0));
      // every channel passes on exactly what flows into it (links are net, signed)
      expect(Math.abs((inflow.get(c) ?? 0) - (outflow.get(c) ?? 0)) / scale).toBeLessThan(1e-6);
      // and that amount equals the per-stock contributions the F2 table shows
      if (sums.has(c)) expect(Math.abs((outflow.get(c) ?? 0) - (sums.get(c) ?? 0)) / scale).toBeLessThan(1e-6);
    }
    // at most one link per (source, target) pair: no double counting of mixed-sign parts
    const pairs = r.sankey[mode].links.map((l) => `${l.source}→${l.target}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  }
}

describe('sankey mass balance', () => {
  const presets: PresetId[] = ['capex', 'guidance', 'restatement', 'multiple', 'credit', 'fullpop'];
  it('balances every channel on the synthetic fixture', () => {
    const b = makeBundle();
    for (const p of presets) expectBalanced(runScenario(b, defaultParams(b, p)));
  });

  const real = new URL('../../../public/data.json', import.meta.url);
  it.skipIf(!existsSync(real))('balances every channel on the real bundle (fullpop 12M)', () => {
    const b = JSON.parse(readFileSync(real, 'utf8')) as DataBundle;
    expectBalanced(runScenario(b, defaultParams(b, 'fullpop', '12M')));
    expectBalanced(runScenario(b, defaultParams(b, 'capex', '1M')));
  });
});
