import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../../types/data';
import type { SankeyGraph } from '../../types/engine';
import { buildFlow, channelOf, OTHERS_ID } from '../lib/flow';

const bundle = {
  origins: [
    { ticker: 'NVDA', group: 'chips' },
    { ticker: 'AMD', group: 'chips' },
    { ticker: 'MSFT', group: 'hyperscalers' },
  ],
} as unknown as DataBundle;

const graph: SankeyGraph = {
  nodes: [
    { id: 'o:NVDA', label: 'NVDA', kind: 'origin' },
    { id: 'o:AMD', label: 'AMD', kind: 'origin' },
    { id: 'o:MSFT', label: 'MSFT', kind: 'origin' },
    { id: 'm:riskoff', label: 'risk-off', kind: 'macro' },
    { id: 'c:sentiment', label: 'Sentiment', kind: 'channel' },
    { id: 'c:fx_fpi', label: 'FX / FPI', kind: 'channel' },
    ...['A', 'B', 'C', 'D'].map((t) => ({ id: `t:${t}.NS`, label: t, kind: 'target' as const })),
  ],
  links: [
    { source: 'o:NVDA', target: 'c:sentiment', value: 60, sign: -1 },
    { source: 'o:AMD', target: 'c:sentiment', value: 20, sign: -1 },
    { source: 'o:MSFT', target: 'c:sentiment', value: 10, sign: -1 },
    { source: 'm:riskoff', target: 'c:fx_fpi', value: 30, sign: -1 },
    { source: 'c:sentiment', target: 't:A.NS', value: 50, sign: -1 },
    { source: 'c:sentiment', target: 't:B.NS', value: 25, sign: -1 },
    { source: 'c:sentiment', target: 't:C.NS', value: 10, sign: -1 },
    { source: 'c:sentiment', target: 't:D.NS', value: 5, sign: 1 },
    { source: 'c:fx_fpi', target: 't:A.NS', value: 10, sign: -1 },
    { source: 'c:fx_fpi', target: 't:C.NS', value: 20, sign: -1 },
  ],
};

describe('flow diagram layout', () => {
  it('groups US tickers by group and keeps ₹ totals exact', () => {
    const f = buildFlow(graph, bundle, { topN: 2, width: 900, height: 400, mergeSources: false });
    const chips = f.links.filter((l) => l.source === 'g:chips');
    expect(chips).toHaveLength(1);
    expect(chips[0].value).toBe(80);
    const sumIn = f.links.filter((l) => l.target.startsWith('t:')).reduce((a, l) => a + l.value, 0);
    expect(sumIn).toBe(120);
    expect(f.total).toBe(120);
  });

  it('folds companies beyond the top N into one "others" node', () => {
    const f = buildFlow(graph, bundle, { topN: 2 });
    const companies = f.nodes.filter((n) => n.kind === 'company').map((n) => n.id);
    expect(companies).toEqual(['t:A.NS', 't:C.NS', OTHERS_ID]);
    expect(f.others).toBe(2);
    expect(f.nodes.find((n) => n.id === OTHERS_ID)?.label).toBe('2 other companies');
    // B (25, −) and D (5, +) fold in, signs kept apart
    const o = f.links.filter((l) => l.target === OTHERS_ID);
    expect(o.map((l) => [l.sign, l.value]).sort()).toEqual([[-1, 25], [1, 5]]);
  });

  it('layout is finite and inside the box; widths share one scale', () => {
    const f = buildFlow(graph, bundle, { topN: 3, width: 700, height: 300, mergeSources: false });
    for (const n of f.nodes) {
      for (const v of [n.x, n.y, n.h]) expect(Number.isFinite(v)).toBe(true);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(300 + 1e-6);
    }
    const a = f.links.find((l) => l.source === 'g:chips')!;
    const b = f.links.find((l) => l.source === 'm:riskoff')!;
    expect(a.w / b.w).toBeCloseTo(80 / 30, 6);
  });

  it('market view merges the investor-mood sources into one starting point (sum kept)', () => {
    const f = buildFlow(graph, bundle, { topN: 2 });
    const src = f.nodes.filter((n) => n.kind === 'source').map((n) => n.id).sort();
    expect(src).toEqual(['g:us_ai', 'm:riskoff']);
    expect(f.links.find((l) => l.source === 'g:us_ai')?.value).toBe(90);
    expect(buildFlow(graph, bundle, { mode: 'fundamental' }).nodes.some((n) => n.id === 'g:chips')).toBe(true);
    // opposite-signed groups net into one ribbon instead of a red and a green one
    const mixed: SankeyGraph = {
      nodes: graph.nodes,
      links: [
        { source: 'o:NVDA', target: 'c:sentiment', value: 40, sign: 1 },
        { source: 'o:MSFT', target: 'c:sentiment', value: 100, sign: -1 },
        { source: 'c:sentiment', target: 't:A.NS', value: 60, sign: -1 },
      ],
    };
    const m = buildFlow(mixed, bundle).links.filter((l) => l.source === 'g:us_ai');
    expect(m.map((l) => [l.sign, l.value])).toEqual([[-1, 60]]);
  });

  it('narrow mode drops the source column', () => {
    const f = buildFlow(graph, bundle, { sources: false, width: 360, height: 300 });
    expect(f.nodes.some((n) => n.kind === 'source')).toBe(false);
    expect(new Set(f.nodes.map((n) => n.col))).toEqual(new Set([0, 1]));
  });

  it('the fundamental graph routes the rupee offset through c:fx_fpi', () => {
    expect(channelOf('c:fx_fpi', 'market')).toBe('fx_fpi');
    expect(channelOf('c:fx_fpi', 'fundamental')).toBe('fx');
    expect(channelOf('c:premium', 'fundamental')).toBe('premium');
  });

  it('an empty graph lays out to nothing (no NaN)', () => {
    const f = buildFlow({ nodes: [], links: [] }, bundle);
    expect(f.nodes).toEqual([]);
    expect(f.total).toBe(0);
  });
});
