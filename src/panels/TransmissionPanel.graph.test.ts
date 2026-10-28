import { describe, expect, it } from 'vitest';
import type { SankeyGraph } from '../types/engine';
import { OTHER_ID, prepareGraph } from './TransmissionPanel.graph';

const g: SankeyGraph = {
  nodes: [
    { id: 'NVDA', label: 'NVDA', kind: 'origin' },
    { id: 'ORCL', label: 'ORCL', kind: 'origin' },
    { id: 'ch_sent', label: 'Sentiment (US AI factor)', kind: 'channel' },
    { id: 'ch_parent', label: 'Parent link', kind: 'channel' },
    { id: 'T1', label: 'T1', kind: 'target' },
    { id: 'T2', label: 'T2', kind: 'target' },
    { id: 'T3', label: 'T3', kind: 'target' },
  ],
  links: [
    { source: 'NVDA', target: 'ch_sent', value: 60, sign: -1 },
    { source: 'ORCL', target: 'ch_parent', value: 40, sign: -1 },
    { source: 'ch_sent', target: 'T1', value: 30, sign: -1 },
    { source: 'ch_sent', target: 'T2', value: 20, sign: -1 },
    { source: 'ch_sent', target: 'T3', value: 10, sign: -1 },
    { source: 'ch_parent', target: 'T1', value: 40, sign: -1 },
  ],
};
const tierOf = (id: string) => ({ T1: 'A', T2: 'B', T3: 'C' } as Record<string, string>)[id] ?? null;

describe('prepareGraph', () => {
  it('keeps all targets for ALL and preserves flow totals', () => {
    const p = prepareGraph(g, 'ALL', tierOf);
    expect(p.collapsed).toBe(0);
    expect(p.nodes.find((n) => n.id === OTHER_ID)).toBeUndefined();
    const into = (id: string) => p.links.filter((l) => l.target === id).reduce((a, l) => a + l.value, 0);
    expect(into('T1')).toBe(70);
  });

  it('collapses the smallest targets into OTHER INDIA with balanced flows', () => {
    const p = prepareGraph(g, 1, tierOf);
    expect(p.collapsed).toBe(2);
    const other = p.links.filter((l) => l.target === OTHER_ID).reduce((a, l) => a + l.value, 0);
    expect(other).toBe(30); // T2 20 + T3 10 via sentiment
    const outOfSent = p.links.filter((l) => l.source === 'ch_sent').reduce((a, l) => a + l.value, 0);
    expect(outOfSent).toBe(60); // equals inflow into the sentiment channel
    expect(p.nodes.some((n) => n.id === 'T2')).toBe(false);
  });

  it('reports channel totals by sign and drops tiny links', () => {
    const p = prepareGraph({ ...g, links: [...g.links, { source: 'NVDA', target: 'ch_sent', value: 0.1, sign: 1 }] }, 'ALL', tierOf, 0.5);
    const sent = p.channelTotals.find((c) => c.id === 'ch_sent')!;
    expect(sent.loss).toBe(60);
    expect(sent.benefit).toBeCloseTo(0.1);
    expect(p.links.some((l) => l.value < 0.5)).toBe(false);
  });
});
