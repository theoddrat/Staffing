// Pure Sankey preparation for F3: keep the top-N Indian targets by inflow, collapse the rest into
// one OTHER INDIA node (flows stay balanced), drop tiny links, colour nodes by kind / tier.
import type { SankeyGraph, SankeyLink } from '../types/engine';
import { isNum } from '../lib/format';

export const OTHER_ID = '__other_india__';

export const NODE_COLORS = {
  origin: '#33c7ff',
  macro: '#7a7a7a',
  channel: '#ffb000',
  other: '#7a7a7a',
  fallback: '#e6e6e6',
  tiers: { A: '#33c7ff', B: '#ffb000', C: '#ff5fd2', D: '#00d26a' } as Record<string, string>,
};

export interface Prepared {
  nodes: { id: string; label: string; kind: string; color: string }[];
  links: SankeyLink[];
  channelTotals: { id: string; label: string; loss: number; benefit: number }[];
  collapsed: number;
}

export function prepareGraph(
  g: SankeyGraph,
  topN: number | 'ALL',
  tierOf: (id: string) => string | null,
  minValue = 0.5,
): Prepared {
  const targets = g.nodes.filter((n) => n.kind === 'target');
  const inflow = new Map<string, number>();
  for (const l of g.links) inflow.set(l.target, (inflow.get(l.target) ?? 0) + Math.abs(l.value));
  const ranked = [...targets].sort((a, b) => (inflow.get(b.id) ?? 0) - (inflow.get(a.id) ?? 0));
  const keep = new Set((topN === 'ALL' ? ranked : ranked.slice(0, topN)).map((n) => n.id));
  const collapsedIds = new Set(ranked.filter((n) => !keep.has(n.id)).map((n) => n.id));

  const agg = new Map<string, SankeyLink>();
  for (const l of g.links) {
    if (!isNum(l.value) || l.value <= 0) continue;
    const target = collapsedIds.has(l.target) ? OTHER_ID : l.target;
    const k = `${l.source}→${target}|${l.sign}`;
    const prev = agg.get(k);
    if (prev) prev.value += l.value;
    else agg.set(k, { source: l.source, target, value: l.value, sign: l.sign });
  }
  const links = Array.from(agg.values()).filter((l) => l.value >= minValue);
  const used = new Set<string>();
  for (const l of links) {
    used.add(l.source);
    used.add(l.target);
  }
  const colorFor = (id: string, kind: string) => {
    if (kind === 'origin') return NODE_COLORS.origin;
    if (kind === 'macro') return NODE_COLORS.macro;
    if (kind === 'channel') return NODE_COLORS.channel;
    const t = tierOf(id);
    return t ? NODE_COLORS.tiers[t] ?? NODE_COLORS.fallback : NODE_COLORS.fallback;
  };
  const nodes = g.nodes
    .filter((n) => used.has(n.id) && !collapsedIds.has(n.id))
    .map((n) => ({ id: n.id, label: n.label, kind: n.kind, color: colorFor(n.id, n.kind) }));
  if (used.has(OTHER_ID)) nodes.push({ id: OTHER_ID, label: `OTHER INDIA (${collapsedIds.size})`, kind: 'target', color: NODE_COLORS.other });

  const channelTotals = g.nodes
    .filter((n) => n.kind === 'channel')
    .map((n) => {
      let loss = 0;
      let benefit = 0;
      for (const l of g.links) {
        if (l.target !== n.id) continue;
        if (l.sign < 0) loss += l.value;
        else benefit += l.value;
      }
      return { id: n.id, label: n.label, loss, benefit };
    });
  return { nodes, links, channelTotals, collapsed: collapsedIds.size };
}

