// ③ How it spreads: an animated flow picture. US company groups (left) → channels (middle) →
// the most affected Indian companies (right). Ribbon width ∝ rupees of market value, one scale for
// the whole picture. Hover / tap / focus a bar to highlight its ribbons and read a plain sentence.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { isNum } from '../../lib/format';
import { Term } from '../../learn/Term';
import { Icon } from '../icons';
import { CHANNEL_VIS } from '../visual';
import { CHANNEL_SHORT, ChannelKey, EmptyState, StepNum } from '../ui';
import type { GuidedProps } from '../types';
import { buildFlow, OTHERS_ID, ribbonPath, type FlowLayout, type FlowMode, type FlowNode } from '../lib/flow';
import { pctAbs, rupeesCr } from '../lib/format';

function useWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(el.clientWidth);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Split a label into at most two lines of about `max` characters. */
function wrap(label: string, max: number): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(' ');
  return [lines[0], second.length > max ? `${second.slice(0, max - 1).trimEnd()}…` : second];
}

interface Label {
  id: string;
  lines: string[];
  value: string;
  y: number; // top of the label block
  h: number;
}

/** Centre labels on their nodes, then push apart so none overlap (and keep them inside the box). */
function placeLabels(nodes: FlowNode[], lines: (n: FlowNode) => string[], value: (n: FlowNode) => string, height: number): Map<string, Label> {
  const LINE = 15;
  const items = nodes
    .map((n) => {
      const ls = lines(n);
      const h = ls.length * LINE + 14;
      return { id: n.id, lines: ls, value: value(n), h, y: n.y + n.h / 2 - h / 2 };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + items[i - 1].h + 2);
  const over = items.length ? items[items.length - 1].y + items[items.length - 1].h - height : 0;
  if (over > 0) {
    items[items.length - 1].y -= over;
    for (let i = items.length - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - items[i].h - 2);
  }
  for (const it of items) it.y = Math.max(-6, it.y);
  return new Map(items.map((it) => [it.id, it]));
}

function netOf(layout: FlowLayout, id: string): { inNet: number; outNet: number } {
  let inNet = 0;
  let outNet = 0;
  for (const l of layout.links) {
    if (l.target === id) inNet += l.sign * l.value;
    if (l.source === id) outNet += l.sign * l.value;
  }
  return { inNet, outNet };
}

/** Net ₹ through a node: what leaves a source or a channel, what arrives at a company. */
function nodeValue(layout: FlowLayout, n: FlowNode): number {
  const { inNet, outNet } = netOf(layout, n.id);
  return n.kind === 'company' ? inNet : outNet;
}

function describe(layout: FlowLayout, n: FlowNode, mode: FlowMode): { title: string; text: string } {
  const byId = new Map(layout.nodes.map((x) => [x.id, x]));
  const out = layout.links.filter((l) => l.source === n.id).sort((a, b) => b.value - a.value);
  const inn = layout.links.filter((l) => l.target === n.id).sort((a, b) => b.value - a.value);
  const net = nodeValue(layout, n);
  const verb = mode === 'market' ? 'market value' : 'fair value';
  if (n.kind === 'source') {
    const tot = out.reduce((a, l) => a + l.value, 0) || 1;
    const top = out[0] ? byId.get(out[0].target) : null;
    return {
      title: n.label,
      text: `${rupeesCr(net, { sign: true })} of Indian ${verb} traces back to here${top ? `, mostly through “${top.label}” (${pctAbs(out[0].value / tot)})` : ''}.`,
    };
  }
  if (n.kind === 'channel') {
    const blurb = n.channel ? CHANNEL_VIS[n.channel].blurb : '';
    const tops = inn.length ? layout.links.filter((l) => l.source === n.id).sort((a, b) => b.value - a.value).slice(0, 3) : [];
    const names = tops.map((l) => byId.get(l.target)?.label).filter(Boolean);
    return {
      title: n.label,
      text: `${rupeesCr(net, { sign: true })} in total. ${blurb}${names.length ? ` Biggest effects: ${names.join(', ')}.` : ''}`,
    };
  }
  const tot = inn.reduce((a, l) => a + l.value, 0) || 1;
  const top = inn[0] ? byId.get(inn[0].source) : null;
  return {
    title: n.label,
    text: `${rupeesCr(net, { sign: true })} in total${top ? `, mostly through “${top.label}” (${pctAbs(inn[0].value / tot)})` : ''}.${n.ticker ? ' Select it to open its story.' : ''}`,
  };
}

export default function FlowView({ state, actions }: GuidedProps) {
  const { bundle, result } = state;
  const [mode, setMode] = useState<FlowMode>('market');
  const [focus, setFocus] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const w = useWidth(box);
  const width = Math.max(300, w || 900);
  const narrow = width < 640;
  const nodeW = 12;
  // The market view has one plain starting point per channel, so its picture is channels →
  // companies with the starting points listed beside it; the business view shows the US groups too.
  const withSources = mode === 'fundamental' && !narrow;
  const layout = useMemo(() => {
    const left = narrow ? 120 : withSources ? 200 : 250;
    const right = narrow ? 108 : 176;
    const xs = withSources ? [left, (left + width - right - nodeW) / 2, width - right - nodeW] : [left, width - right - nodeW];
    const opts = { mode, topN: narrow ? 8 : 12, width, nodeW, xs, sources: withSources, pad: 12 };
    const base = narrow ? 520 : 560;
    const first = buildFlow(result.sankey[mode], bundle, { ...opts, height: base });
    // grow the picture when a column's labels need more room than its nodes
    const cols = new Map<number, number>();
    for (const n of first.nodes) cols.set(n.col, (cols.get(n.col) ?? 0) + (n.kind === 'company' ? 33 : 50));
    const need = Math.max(0, ...cols.values());
    return need > base ? buildFlow(result.sankey[mode], bundle, { ...opts, height: need + 16 }) : first;
  }, [result, bundle, mode, narrow, width, withSources]);

  // starting points (merged per channel in the market view), listed when the picture leaves them out
  const full = useMemo(() => (withSources ? null : buildFlow(result.sankey[mode], bundle, { mode, topN: 1 })), [withSources, result, bundle, mode]);
  const starts = full ? full.nodes.filter((n) => n.kind === 'source').map((n) => ({ n, v: nodeValue(full, n) })) : [];

  const active = focus ?? pinned;
  const related = useMemo(() => {
    if (!active) return null;
    const links = new Set<string>();
    const nodes = new Set<string>([active]);
    for (const l of layout.links)
      if (l.source === active || l.target === active) {
        links.add(l.id);
        nodes.add(l.source);
        nodes.add(l.target);
      }
    return { links, nodes };
  }, [active, layout]);

  const byCol = useMemo(() => {
    const m = new Map<number, FlowNode[]>();
    for (const n of layout.nodes) m.set(n.col, [...(m.get(n.col) ?? []), n]);
    return m;
  }, [layout]);
  const lastCol = withSources ? 2 : 1;
  const labels = useMemo(() => {
    const out = new Map<string, Label & { anchor: 'start' | 'end'; x: number }>();
    for (const [col, ns] of byCol) {
      const isFirst = col === 0;
      const isLast = col === lastCol;
      const max = isLast ? (narrow ? 13 : 22) : narrow ? 15 : 22;
      const placed = placeLabels(
        ns,
        (n) =>
          n.kind === 'company'
            ? [n.id === OTHERS_ID && narrow ? `+${layout.others} others` : n.label]
            : wrap(narrow && n.channel ? CHANNEL_SHORT[n.channel] : n.label, max),
        (n) => rupeesCr(nodeValue(layout, n), { sign: true }),
        layout.height,
      );
      for (const n of ns) {
        const p = placed.get(n.id)!;
        out.set(n.id, { ...p, anchor: isFirst ? 'end' : 'start', x: isFirst ? n.x - 8 : n.x + nodeW + 8 });
      }
    }
    return out;
  }, [byCol, layout, lastCol, narrow]);

  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const info = active && byId.get(active) ? describe(layout, byId.get(active)!, mode) : null;
  const channels = layout.nodes.filter((n) => n.kind === 'channel');
  const tot = result.totals.india_mcap_change_inr_cr;

  const onKey = (e: KeyboardEvent, n: FlowNode) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (n.ticker) actions.setView('stock', n.ticker);
      else setPinned((p) => (p === n.id ? null : n.id));
    }
  };

  const empty = layout.links.length === 0;
  return (
    <div className="g-flow">
      <div className="g-section-head">
        <StepNum n={3} />
        <div>
          <h1 className="g-h1 is-page" tabIndex={-1} data-autofocus>
            How it spreads
          </h1>
          <p className="g-lead">
            Follow the shock from US AI companies, through the <Term id="channel">channels</Term> that carry it, into Indian shares. The wider a
            ribbon, the more rupees of value it carries.
            {mode === 'market' && isNum(tot) && Math.abs(tot) >= 1 && <> In total the {result.india.length} companies {tot < 0 ? 'lose' : 'gain'} {rupeesCr(Math.abs(tot))}.</>}
          </p>
        </div>
      </div>

      <div className="g-filters">
        <div className="g-seg" role="radiogroup" aria-label="What the picture shows">
          <button type="button" role="radio" aria-checked={mode === 'market'} className={mode === 'market' ? 'is-on' : ''} onClick={() => setMode('market')}>
            <Icon name="pulse" size={15} /> What prices would do
          </button>
          <button type="button" role="radio" aria-checked={mode === 'fundamental'} className={mode === 'fundamental' ? 'is-on' : ''} onClick={() => setMode('fundamental')}>
            <Icon name="factory" size={15} /> What the business numbers say
          </button>
        </div>
        <p className="g-muted g-small g-flow-modehelp">
          {mode === 'market' ? (
            <>
              <Term id="market_implied">Market-implied</Term>: how these shares have moved on similar days.
            </>
          ) : (
            <>
              <Term id="fundamental">Fundamental</Term>: lost earnings, a fading AI premium and the rupee.
            </>
          )}
        </p>
      </div>

      {starts.length > 0 && (
        <section className="g-flow-starts" aria-labelledby="flow-starts">
          <h2 id="flow-starts" className="g-h3">
            Where it starts
          </h2>
          <ul>
            {starts.map(({ n, v }) => (
              <li key={n.id}>
                <Icon name={n.icon} size={18} color={n.color} />
                <span>{n.label}</span>
                <b>{rupeesCr(v, { sign: true })}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={`g-flow-cols${withSources ? '' : ' is-narrow'}`} aria-hidden="true">
        {withSources && <span>Where it starts</span>}
        <span>How it travels</span>
        <span>Who feels it</span>
      </div>
      <div className="g-flow-box" ref={box}>
        {empty ? (
          <EmptyState icon="flow" title="Nothing flows in this view">
            <p className="g-muted">
              {result.params.preset === 'replay' && mode === 'fundamental'
                ? 'A replay copies past price moves only; the business damage behind them is not modelled.'
                : 'This scenario barely moves anything at these settings.'}
            </p>
          </EmptyState>
        ) : (
          <svg
            className="g-flow-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Flow of the shock from US companies through channels to Indian companies; details in the table below"
            onMouseLeave={() => setFocus(null)}
          >
            <g className="g-flow-links">
              {layout.links.map((l) => {
                const s = byId.get(l.source)!;
                const t = byId.get(l.target)!;
                const cls = related ? (related.links.has(l.id) ? 'is-on' : 'is-dim') : '';
                return <path key={l.id} d={ribbonPath(s.x + nodeW, l.sy, t.x, l.ty)} stroke={l.color} strokeWidth={l.w} className={`g-ribbon ${cls}`} />;
              })}
            </g>
            <g className="g-flow-anim" aria-hidden="true">
              {layout.links
                .filter((l) => l.w >= 6)
                .map((l) => {
                  const s = byId.get(l.source)!;
                  const t = byId.get(l.target)!;
                  return (
                    <path
                      key={l.id}
                      d={ribbonPath(s.x + nodeW, l.sy, t.x, l.ty)}
                      strokeWidth={Math.min(2.5, l.w * 0.3)}
                      className={`g-flow-dash${related && !related.links.has(l.id) ? ' is-dim' : ''}`}
                    />
                  );
                })}
            </g>
            <g className="g-flow-nodes">
              {layout.nodes.map((n) => {
                const lab = labels.get(n.id)!;
                const on = active === n.id;
                return (
                  <g
                    key={n.id}
                    className={`g-fnode${on ? ' is-on' : ''}${related && !related.nodes.has(n.id) ? ' is-dim' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.label}: ${lab.value}${n.ticker ? '. Opens its story.' : ''}`}
                    onMouseEnter={() => setFocus(n.id)}
                    onFocus={() => setFocus(n.id)}
                    onBlur={() => setFocus(null)}
                    onClick={() => (n.ticker ? actions.setView('stock', n.ticker) : setPinned((p) => (p === n.id ? null : n.id)))}
                    onKeyDown={(e) => onKey(e, n)}
                  >
                    <rect x={n.x - 4} y={n.y - 2} width={nodeW + 8} height={n.h + 4} className="g-fnode-hit" />
                    <rect x={n.x} y={n.y} width={nodeW} height={n.h} rx={2} style={{ fill: n.color }} />
                    <text x={lab.x} y={lab.y + 12} textAnchor={lab.anchor} className={`g-flab${n.kind === 'company' ? ' is-co' : ''}`}>
                      {lab.lines.map((ln, i) => (
                        <tspan key={i} x={lab.x} dy={i ? 15 : 0}>
                          {ln}
                        </tspan>
                      ))}
                      <tspan x={lab.x} dy={14} className="g-flab-val">
                        {lab.value}
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="g-flow-info" aria-live="polite">
        {info ? (
          <>
            <p className="g-flow-info-title">{info.title}</p>
            <p>{info.text}</p>
          </>
        ) : (
          <p className="g-muted">
            <Icon name="help" size={15} /> Hover, tap or tab to any bar to see what flows through it. Orange-red ribbons push prices down; green
            ribbons cushion them.
          </p>
        )}
      </div>

      {!empty && (
        <section className="g-card" aria-labelledby="flow-legend">
          <h2 id="flow-legend" className="g-h2">
            The channels, in words
          </h2>
          <ul className="g-flow-legend">
            {channels.map((n) => (
              <li key={n.id}>
                <div className="g-reason-head">
                  {n.channel ? <ChannelKey channel={n.channel} /> : <span>{n.label}</span>}
                  <b className="g-reason-val">{rupeesCr(nodeValue(layout, n), { sign: true })}</b>
                </div>
                <p className="g-reason-text">{n.channel ? CHANNEL_VIS[n.channel].blurb : ''}</p>
              </li>
            ))}
          </ul>
          <details className="g-notes">
            <summary>Numbers behind the picture</summary>
            <table className="g-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="is-num">
                    ₹ crore
                  </th>
                </tr>
              </thead>
              <tbody>
                {layout.links.map((l) => (
                  <tr key={l.id}>
                    <td>{byId.get(l.source)?.label}</td>
                    <td>{byId.get(l.target)?.label}</td>
                    <td className="is-num">{rupeesCr(l.sign * l.value, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}
    </div>
  );
}
