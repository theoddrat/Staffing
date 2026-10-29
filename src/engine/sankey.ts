// Transmission map: origin → channel → India stock (DESIGN §4.7). Values are |INR crore|.
import type { SankeyGraph, SankeyLink, SankeyNode } from '../types/engine';
import type { CoreOut } from './core';
import type { Prep } from './prepare';
import type { ResolvedParams } from './types-extra';

export interface SankeyRow {
  idx: number; // India target index
  /** Signed INR-crore contributions by channel part. */
  market: { parent: number; sox: number; ndx: number; contagion: number; fx_fpi: number; own: number };
  fundamental: { revenue: number; capex: number; credit: number; own: number; premium: number; fx: number };
}

interface Src {
  id: string;
  label: string;
  kind: SankeyNode['kind'];
  w: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  parent: 'Parent link',
  revenue: 'Revenue (IT budgets)',
  capex: 'Capex orders',
  sentiment: 'Sentiment (US AI factor)',
  fx_fpi: 'FX / FPI',
  credit: 'Credit (AI debt)',
  own: 'Own shock (restatement)',
  premium: 'AI premium unwind',
};

class Builder {
  nodes = new Map<string, SankeyNode>();
  // key "src|chan" -> signed sum of everything that source contributes to the channel
  inflow = new Map<string, { abs: number; signed: number }>();
  // key "chan|target" -> signed sum (several channel parts, e.g. SOX and NDX, net into one link)
  outflow = new Map<string, number>();

  node(id: string, label: string, kind: SankeyNode['kind']) {
    if (!this.nodes.has(id)) this.nodes.set(id, { id, label, kind });
  }

  /** Attribute one stock's signed channel value to sources (weights by |w|) and record links. */
  flow(channel: string, targetId: string, targetLabel: string, value: number, sources: Src[]) {
    if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return;
    const chanId = `c:${channel}`;
    this.node(chanId, CHANNEL_LABEL[channel] ?? channel, 'channel');
    this.node(targetId, targetLabel, 'target');
    const okey = `${chanId}|${targetId}`;
    this.outflow.set(okey, (this.outflow.get(okey) ?? 0) + value);
    const tot = sources.reduce((a, s) => a + Math.abs(s.w), 0);
    const list = tot > 0 ? sources : [{ id: 'm:us_ai', label: 'US AI factor', kind: 'macro' as const, w: 1 }];
    const denom = tot > 0 ? tot : 1;
    for (const s of list) {
      const share = Math.abs(s.w) / denom;
      if (share <= 0) continue;
      this.node(s.id, s.label, s.kind);
      const key = `${s.id}|${chanId}`;
      const cur = this.inflow.get(key) ?? { abs: 0, signed: 0 };
      cur.abs += Math.abs(value) * share;
      cur.signed += value * share;
      this.inflow.set(key, cur);
    }
  }

  build(): SankeyGraph {
    // Links carry NET signed amounts: a source whose contributions differ in sign across stocks
    // (e.g. chips lifting Indian IT through a negative b_SOX while hurting everyone else) shows its
    // net effect, so for every channel the signed inflow equals the signed outflow (= Σ stock channel values).
    // Merge sources that contribute < 2% of a channel's (net) inflow into "Other origins".
    const chanTotals = new Map<string, number>();
    for (const [key, f] of this.inflow) {
      const chan = key.split('|')[1];
      chanTotals.set(chan, (chanTotals.get(chan) ?? 0) + Math.abs(f.signed));
    }
    const merged = new Map<string, { abs: number; signed: number }>();
    for (const [key, f] of this.inflow) {
      const [src, chan] = key.split('|');
      const small = Math.abs(f.signed) < 0.02 * (chanTotals.get(chan) ?? 0);
      const k = small ? `m:other|${chan}` : key;
      const cur = merged.get(k) ?? { abs: 0, signed: 0 };
      cur.abs += f.abs;
      cur.signed += f.signed;
      merged.set(k, cur);
    }
    const links: SankeyLink[] = [];
    const used = new Set<string>();
    for (const [key, f] of merged) {
      const [src, chan] = key.split('|');
      if (src === 'm:other') this.node('m:other', 'Other origins', 'macro');
      if (Math.abs(f.signed) <= 1e-9) continue;
      links.push({ source: src, target: chan, value: Math.abs(f.signed), sign: f.signed < 0 ? -1 : 1 });
      used.add(src);
      used.add(chan);
    }
    for (const [key, v] of this.outflow) {
      if (Math.abs(v) <= 1e-9) continue;
      const [chan, target] = key.split('|');
      links.push({ source: chan, target, value: Math.abs(v), sign: v < 0 ? -1 : 1 });
      used.add(chan);
      used.add(target);
    }
    const nodes = Array.from(this.nodes.values()).filter((n) => used.has(n.id));
    return { nodes, links: links.filter((l) => l.value > 1e-9) };
  }
}

export function buildSankey(prep: Prep, core: CoreOut, rp: ResolvedParams, rows: SankeyRow[], mode: 'market' | 'fundamental'): SankeyGraph {
  const b = new Builder();
  const replayLabel = rp.windowId ? prep.windows.get(rp.windowId)?.label ?? rp.windowId : 'Replay window';
  const chipSrc: Src[] = rp.comp.replay
    ? [{ id: 'm:replay', label: `Replay: ${replayLabel}`, kind: 'macro', w: 1 }]
    : prep.origins.filter((o) => o.wChip > 0).map((o) => ({ id: `o:${o.ticker}`, label: o.ticker, kind: 'origin' as const, w: o.wChip * core.o[o.idx].move }));
  const aiSrc: Src[] = rp.comp.replay
    ? [{ id: 'm:replay', label: `Replay: ${replayLabel}`, kind: 'macro', w: 1 }]
    : prep.origins.map((o) => ({ id: `o:${o.ticker}`, label: o.ticker, kind: 'origin' as const, w: o.wAi * core.o[o.idx].move }));
  const revSrc: Src[] = prep.origins.map((o) => ({ id: `o:${o.ticker}`, label: o.ticker, kind: 'origin' as const, w: o.wAi * core.o[o.idx].rh }));
  const hyperSrc: Src[] = prep.origins
    .filter((o) => o.group === 'hyperscalers')
    .map((o) => ({ id: `o:${o.ticker}`, label: o.ticker, kind: 'origin' as const, w: o.capexUsd ?? o.mcapUsd ?? 0 }));
  const stressedSrc: Src[] = prep.origins
    .filter((o) => o.stressed)
    .map((o) => ({ id: `o:${o.ticker}`, label: o.ticker, kind: 'origin' as const, w: o.mcapUsd ?? 1 }));
  const guidSrc: Src[] =
    rp.guidanceTarget >= 0 ? [{ id: `o:${prep.origins[rp.guidanceTarget].ticker}`, label: prep.origins[rp.guidanceTarget].ticker, kind: 'origin', w: 1 }] : [];
  const restSrc: Src[] = rp.restTarget
    ? rp.restTarget.kind === 'origin'
      ? [{ id: `o:${prep.origins[rp.restTarget.idx].ticker}`, label: `${prep.origins[rp.restTarget.idx].ticker} (restated)`, kind: 'origin', w: 1 }]
      : [{ id: `o:${prep.india[rp.restTarget.idx].ticker}`, label: `${prep.india[rp.restTarget.idx].display} (restated)`, kind: 'origin', w: 1 }]
    : [];
  const cp = core.f.cEffParts;
  const capexMix = cp.capex + cp.guidance + cp.credit;

  for (const r of rows) {
    const t = prep.india[r.idx];
    const tid = `t:${t.ticker}`;
    const tl = t.display;
    if (mode === 'market') {
      const m = r.market;
      if (t.parent) {
        const isOrigin = t.parentOriginIdx >= 0;
        const ps: Src[] = [{ id: isOrigin ? `o:${t.parent}` : `p:${t.parent}`, label: isOrigin ? t.parent : `${t.parent} (parent)`, kind: 'origin', w: 1 }];
        b.flow('parent', tid, tl, m.parent, ps);
      }
      b.flow('sentiment', tid, tl, m.sox, chipSrc);
      b.flow('sentiment', tid, tl, m.ndx, aiSrc);
      b.flow('sentiment', tid, tl, m.contagion, restSrc);
      b.flow('fx_fpi', tid, tl, m.fx_fpi, [{ id: 'm:riskoff', label: 'US risk-off → FPI flows', kind: 'macro', w: 1 }]);
      b.flow('own', tid, tl, m.own, restSrc);
    } else {
      const fd = r.fundamental;
      b.flow('revenue', tid, tl, fd.revenue, revSrc);
      if (capexMix > 0) {
        b.flow('capex', tid, tl, (fd.capex * cp.capex) / capexMix, hyperSrc);
        b.flow('capex', tid, tl, (fd.capex * cp.guidance) / capexMix, guidSrc);
        b.flow('capex', tid, tl, (fd.capex * cp.credit) / capexMix, stressedSrc);
      } else b.flow('capex', tid, tl, fd.capex, hyperSrc);
      b.flow('credit', tid, tl, fd.credit, stressedSrc);
      b.flow('own', tid, tl, fd.own, restSrc);
      b.flow('premium', tid, tl, fd.premium, [{ id: 'm:multiple', label: 'AI multiple reset', kind: 'macro', w: 1 }]);
      b.flow('fx_fpi', tid, tl, fd.fx, [{ id: 'm:inr', label: 'INR depreciation (FX offset)', kind: 'macro', w: 1 }]);
    }
  }
  return b.build();
}
