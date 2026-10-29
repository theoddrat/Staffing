// Layout for the guided "How it spreads" diagram. Groups the engine's Sankey graph into plain
// nodes (25 US tickers → 4 groups, macro sources kept, top-N Indian companies + "others"), then
// computes a column layout with one value→pixel scale so every ribbon width is comparable.
// Aggregation only sums links, so ₹ totals are preserved exactly.
import type { DataBundle, OriginGroup } from '../../types/data';
import type { SankeyGraph } from '../../types/engine';
import { CHANNEL_VIS, GROUP_VIS } from '../visual';
import type { IconName } from '../icons';
import type { PartChannel } from './explain';

export type FlowMode = 'market' | 'fundamental';

export interface FlowNode {
  id: string;
  label: string;
  col: number;
  kind: 'source' | 'channel' | 'company';
  icon: IconName | string;
  color: string;
  value: number; // Σ |₹ crore| through the node (max of in / out)
  channel?: PartChannel;
  ticker?: string;
  x: number;
  y: number;
  h: number;
}

export interface FlowLink {
  id: string;
  source: string;
  target: string;
  value: number; // |₹ crore|
  sign: 1 | -1; // −1 = pushes prices down, +1 = cushions
  color: string;
  w: number;
  sy: number; // ribbon centre at the source node
  ty: number; // ribbon centre at the target node
}

export interface FlowLayout {
  nodes: FlowNode[];
  links: FlowLink[];
  width: number;
  height: number;
  nodeW: number;
  total: number; // Σ |₹ crore| arriving at companies
  others: number; // how many companies are folded into "others"
}

export interface FlowOptions {
  mode?: FlowMode;
  topN?: number;
  width?: number;
  height?: number;
  pad?: number;
  nodeW?: number;
  xs?: number[]; // left edge of each column
  sources?: boolean; // false = channels → companies only (narrow screens)
}

const MACRO: Record<string, { label: string; icon: IconName; color: string }> = {
  'm:riskoff': { label: 'US sell-off scares foreign investors', icon: 'globe', color: 'var(--ch-fpi)' },
  'm:multiple': { label: 'AI stocks get cheaper', icon: 'tag', color: 'var(--ch-premium)' },
  'm:inr': { label: 'Weaker rupee', icon: 'rupee', color: 'var(--ch-fx)' },
  'm:replay': { label: 'Replayed past crash', icon: 'clock', color: 'var(--g-accent)' },
  'm:us_ai': { label: 'US AI stocks', icon: 'pulse', color: 'var(--g-accent)' },
  'm:other': { label: 'Other US companies', icon: 'layers', color: 'var(--g-muted)' },
};

function sourceNode(nodeId: string, label: string, bundle: DataBundle): { id: string; label: string; icon: string; color: string } {
  if (nodeId.startsWith('o:')) {
    const o = bundle.origins.find((x) => x.ticker === nodeId.slice(2));
    if (o) {
      const g = GROUP_VIS[o.group as OriginGroup] ?? GROUP_VIS.chips;
      return { id: `g:${o.group}`, label: g.label, icon: g.icon, color: g.color };
    }
    return { id: nodeId, label, icon: 'warning', color: 'var(--ch-own)' };
  }
  if (nodeId.startsWith('p:')) return { id: 'g:parents', label: 'Global parent companies', icon: 'building', color: 'var(--ch-parent)' };
  const m = MACRO[nodeId];
  if (m) return { id: nodeId, label: m.label, icon: m.icon, color: m.color };
  return { id: nodeId, label, icon: 'layers', color: 'var(--g-muted)' };
}

/** Engine channel node id → the guided channel (fundamental graph routes the rupee offset via c:fx_fpi). */
export function channelOf(nodeId: string, mode: FlowMode): PartChannel {
  const k = nodeId.replace(/^c:/, '');
  if (mode === 'fundamental' && k === 'fx_fpi') return 'fx';
  return (k in CHANNEL_VIS ? k : 'sentiment') as PartChannel;
}

export const OTHERS_ID = 't:__others';

export function buildFlow(graph: SankeyGraph, bundle: DataBundle, opts: FlowOptions = {}): FlowLayout {
  const mode = opts.mode ?? 'market';
  const topN = Math.max(1, opts.topN ?? 12);
  const width = opts.width ?? 960;
  const height = opts.height ?? 560;
  const pad = opts.pad ?? 10;
  const nodeW = opts.nodeW ?? 14;
  const withSources = opts.sources !== false;
  const nCols = withSources ? 3 : 2;
  const xs = opts.xs && opts.xs.length === nCols ? opts.xs : withSources ? [0, (width - nodeW) / 2, width - nodeW] : [0, width - nodeW];
  const chanCol = withSources ? 1 : 0;
  const compCol = withSources ? 2 : 1;

  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));

  // company totals (channel → target links) pick the top N
  const compTot = new Map<string, number>();
  for (const l of graph.links) if (kind.get(l.target) === 'target' && l.value > 0) compTot.set(l.target, (compTot.get(l.target) ?? 0) + l.value);
  const ranked = [...compTot.entries()].sort((a, b) => b[1] - a[1]);
  const top = new Set(ranked.slice(0, topN).map(([id]) => id));
  const others = Math.max(0, ranked.length - top.size);

  type Raw = Omit<FlowNode, 'x' | 'y' | 'h' | 'value'> & { inV: number; outV: number };
  const nodes = new Map<string, Raw>();
  const ensure = (n: Omit<Raw, 'inV' | 'outV'>) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, inV: 0, outV: 0 });
  };
  const agg = new Map<string, { source: string; target: string; value: number; sign: 1 | -1; color: string }>();
  const add = (source: string, target: string, value: number, sign: 1 | -1, color: string) => {
    const key = `${source}|${target}|${sign}`;
    const cur = agg.get(key) ?? { source, target, value: 0, sign, color };
    cur.value += value;
    agg.set(key, cur);
  };
  const chanNode = (id: string) => {
    const ch = channelOf(id, mode);
    const v = CHANNEL_VIS[ch];
    ensure({ id, label: v.label, col: chanCol, kind: 'channel', icon: v.icon, color: v.color, channel: ch });
    return v;
  };

  for (const l of graph.links) {
    if (!(l.value > 0)) continue;
    const sk = kind.get(l.source);
    const tk = kind.get(l.target);
    if (tk === 'channel') {
      if (!withSources) continue;
      const s = sourceNode(l.source, label.get(l.source) ?? l.source, bundle);
      ensure({ id: s.id, label: s.label, col: 0, kind: 'source', icon: s.icon, color: s.color });
      const v = chanNode(l.target);
      add(s.id, l.target, l.value, l.sign, v.color);
    } else if (sk === 'channel' && tk === 'target') {
      const v = chanNode(l.source);
      const isTop = top.has(l.target);
      const tid = isTop ? l.target : OTHERS_ID;
      ensure({
        id: tid,
        label: isTop ? label.get(l.target) ?? l.target : `${others} other ${others === 1 ? 'company' : 'companies'}`,
        col: compCol,
        kind: 'company',
        icon: isTop ? 'building' : 'layers',
        color: 'var(--g-muted)',
        ticker: isTop ? l.target.replace(/^t:/, '') : undefined,
      });
      add(l.source, tid, l.value, l.sign, v.color);
    }
  }
  for (const a of agg.values()) {
    nodes.get(a.source)!.outV += a.value;
    nodes.get(a.target)!.inV += a.value;
  }

  // columns: biggest first; "others" always last
  const cols: string[][] = Array.from({ length: nCols }, () => []);
  for (const n of nodes.values()) cols[n.col].push(n.id);
  const val = (id: string) => Math.max(nodes.get(id)!.inV, nodes.get(id)!.outV);
  for (const c of cols)
    c.sort((a, b) => (a === OTHERS_ID ? 1 : b === OTHERS_ID ? -1 : val(b) - val(a)));
  const colTotals = cols.map((c) => c.reduce((s, id) => s + val(id), 0));
  const fit = cols.map((c, i) => (c.length && colTotals[i] > 0 ? (height - pad * (c.length - 1)) / colTotals[i] : Infinity));
  const scale = Math.min(...fit);
  const k = Number.isFinite(scale) && scale > 0 ? scale : 0;

  const placed = new Map<string, FlowNode>();
  cols.forEach((c, i) => {
    const used = c.reduce((s, id) => s + Math.max(2, val(id) * k), 0) + pad * Math.max(0, c.length - 1);
    let y = Math.max(0, (height - used) / 2);
    for (const id of c) {
      const n = nodes.get(id)!;
      const h = Math.max(2, val(id) * k);
      const { inV: _i, outV: _o, ...rest } = n;
      placed.set(id, { ...rest, value: val(id), x: xs[i], y, h });
      y += h + pad;
    }
  });

  // stack ribbons inside each node in the order of the far end, so they do not cross needlessly
  const raw = [...agg.values()];
  const sy = new Map<(typeof raw)[number], number>();
  const ty = new Map<(typeof raw)[number], number>();
  const outCur = new Map<string, number>();
  const inCur = new Map<string, number>();
  const wOf = (v: number) => Math.max(1, v * k);
  for (const l of [...raw].sort((a, b) => placed.get(a.target)!.y - placed.get(b.target)!.y)) {
    const c = outCur.get(l.source) ?? placed.get(l.source)!.y;
    sy.set(l, c + wOf(l.value) / 2);
    outCur.set(l.source, c + wOf(l.value));
  }
  for (const l of [...raw].sort((a, b) => placed.get(a.source)!.y - placed.get(b.source)!.y)) {
    const c = inCur.get(l.target) ?? placed.get(l.target)!.y;
    ty.set(l, c + wOf(l.value) / 2);
    inCur.set(l.target, c + wOf(l.value));
  }
  const links: FlowLink[] = raw
    .sort((a, b) => b.value - a.value)
    .map((l, i) => ({
      id: `l${i}`,
      source: l.source,
      target: l.target,
      value: l.value,
      sign: l.sign,
      color: l.sign > 0 ? 'var(--g-up)' : l.color,
      w: wOf(l.value),
      sy: sy.get(l)!,
      ty: ty.get(l)!,
    }));
  return { nodes: [...placed.values()], links, width, height, nodeW, total: colTotals[compCol] ?? 0, others };
}

/** Cubic ribbon path between two node edges. */
export function ribbonPath(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}
