// F3 TRANSMISSION MAP — Sankey: shock origin → channel → Indian stock (₹ crore), market or fundamental mode.
import { useMemo, useState } from 'react';
import type { PanelProps } from './types';
import Chart, { CHART_COLORS } from '../components/Chart';
import { prepareGraph } from './TransmissionPanel.graph';
import { crore, isNum } from '../lib/format';
import { HelpChip } from '../learn/Term';

type Mode = 'market' | 'fundamental';
const TOPN: (number | 'ALL')[] = [10, 15, 25, 'ALL'];

export default function TransmissionPanel({ state, actions }: PanelProps) {
  const [mode, setMode] = useState<Mode>('market');
  const [topN, setTopN] = useState<number | 'ALL'>(15);
  const g = state.result.sankey[mode];
  const tierById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of state.bundle.india) {
      m.set(t.ticker, t.tier);
      m.set(t.display, t.tier);
    }
    return m;
  }, [state.bundle]);
  const prep = useMemo(() => prepareGraph(g, topN, (id) => tierById.get(id) ?? null), [g, topN, tierById]);
  const labelById = useMemo(() => new Map(prep.nodes.map((n) => [n.id, n.label])), [prep]);
  const nTargets = prep.nodes.filter((n) => n.kind === 'target').length;
  const nSources = prep.nodes.filter((n) => n.kind === 'origin' || n.kind === 'macro').length;
  // Hide labels of slivers (< 0.6% of the largest node) so tiny nodes don't overprint each other.
  const tiny = useMemo(() => {
    const inV = new Map<string, number>();
    const outV = new Map<string, number>();
    for (const l of prep.links) {
      outV.set(l.source, (outV.get(l.source) ?? 0) + l.value);
      inV.set(l.target, (inV.get(l.target) ?? 0) + l.value);
    }
    const val = (id: string) => Math.max(inV.get(id) ?? 0, outV.get(id) ?? 0);
    const max = Math.max(1e-9, ...prep.nodes.map((n) => val(n.id)));
    return new Set(prep.nodes.filter((n) => n.kind !== 'channel' && val(n.id) < max * 0.006).map((n) => n.id));
  }, [prep]);

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          if (p.dataType === 'edge') {
            const s = labelById.get(p.data.source) ?? p.data.source;
            const t = labelById.get(p.data.target) ?? p.data.target;
            return `${s} → ${t}<br/>${crore(p.data.value)} ${p.data.sign < 0 ? '(loss)' : '(offset / benefit)'}`;
          }
          return `${labelById.get(p.name) ?? p.name}<br/>${crore(p.value)}`;
        },
      },
      series: [
        {
          type: 'sankey',
          left: 8,
          right: 150,
          top: 12,
          bottom: 12,
          nodeWidth: 12,
          nodeGap: 6,
          layoutIterations: 64,
          emphasis: { focus: 'adjacency' },
          draggable: true,
          label: {
            color: CHART_COLORS.white,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            formatter: (p: any) => (tiny.has(p.name) ? '' : labelById.get(p.name) ?? p.name),
          },
          data: prep.nodes.map((n) => ({ name: n.id, itemStyle: { color: n.color, borderColor: n.color } })),
          links: prep.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: +l.value.toFixed(2),
            sign: l.sign,
            lineStyle: { color: l.sign < 0 ? CHART_COLORS.red : CHART_COLORS.green, opacity: 0.35, curveness: 0.5 },
          })),
        },
      ],
    }),
    [prep, labelById, tiny],
  );

  const totalLoss = prep.channelTotals.reduce((a, c) => a + c.loss, 0);
  const totalBen = prep.channelTotals.reduce((a, c) => a + c.benefit, 0);

  return (
    <div className="transmission-panel">
      <div className="panel">
        <div className="panel-header">
          F3 TRANSMISSION MAP — ORIGIN → CHANNEL → INDIAN STOCK (₹ CRORE) <HelpChip id="channel" /> <HelpChip id="crore" />
          <span className="spacer" />
          <button className={`btn btn-xs ${mode === 'market' ? 'active' : ''}`} onClick={() => setMode('market')}>
            MARKET (LAYER 2)
          </button>
          <button className={`btn btn-xs ${mode === 'fundamental' ? 'active' : ''}`} onClick={() => setMode('fundamental')}>
            FUNDAMENTAL (LAYER 3+4)
          </button>
          <span className="muted"> TOP</span>
          {TOPN.map((n) => (
            <button key={String(n)} className={`btn btn-xs ${topN === n ? 'active' : ''}`} onClick={() => setTopN(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="sankey-wrap">
          <div className="sankey-chart">
            {prep.links.length ? (
              <Chart
                option={option}
                height={Math.max(480, Math.max(nTargets, nSources) * 26 + 70)}
                onClick={(p: any) => {
                  if (p?.dataType === 'node') {
                    const id = String(p.name);
                    const t = state.bundle.india.find((x) => x.ticker === id || x.display === id);
                    if (t) actions.select(t.ticker);
                    else if (state.bundle.securities[id]) actions.select(id);
                  }
                }}
              />
            ) : (
              <div className="panel-body muted">NO TRANSMISSION FLOWS UNDER THIS SCENARIO ({mode.toUpperCase()} MODE).</div>
            )}
          </div>
          <div className="sankey-side">
            <table className="tbl">
              <thead>
                <tr>
                  <th>CHANNEL</th>
                  <th className="num">LOSS ₹ CR</th>
                  <th className="num">OFFSET ₹ CR</th>
                </tr>
              </thead>
              <tbody>
                {prep.channelTotals.map((c) => (
                  <tr key={c.id}>
                    <td className="lbl">{c.label}</td>
                    <td className="num down">{c.loss ? crore(-c.loss) : '—'}</td>
                    <td className="num up">{c.benefit ? crore(c.benefit) : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td className="lbl">TOTAL</td>
                  <td className="num down">{crore(-totalLoss)}</td>
                  <td className="num up">{crore(totalBen)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              {mode === 'market'
                ? 'Market mode decomposes the regression-implied move: Parent link = b_P·x_P, Sentiment = b_SOX·x_SOX + b_NDX·x_NDX, FX/FPI = b_N·x_Nifty.'
                : 'Fundamental mode: Revenue (IT budgets) and Capex orders = earnings at risk; FX = EPS offset from a weaker INR (green).'}
              {prep.collapsed > 0 && ` ${prep.collapsed} smaller names are grouped as OTHER INDIA.`} Flows are attributed to origins in
              proportion to their weighted contribution (DESIGN §4.7). Click a stock node to select it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
