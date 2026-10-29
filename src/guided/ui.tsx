// Small visual building blocks shared by the guided views: channel / tier / confidence chips,
// move bars with Monte Carlo whiskers, gauges, diverging stacked bars, provenance badges.
// Colours come from guided-tokens.css; text always uses text tokens, colour sits on the mark.
import { Component, type ReactNode } from 'react';
import type { DataBundle, Status, Tier } from '../types/data';
import { isNum } from '../lib/format';
import { Icon, type IconName } from './icons';
import { CHANNEL_VIS, CONFIDENCE_VIS, TIER_VIS } from './visual';
import type { PartChannel } from './lib/explain';
import { clamp, pct, pctAbs } from './lib/format';

/** Short chip labels for tight spaces (the full label + explanation stay in the tooltip). */
export const CHANNEL_SHORT: Record<PartChannel, string> = {
  parent: 'Parent company falls',
  sentiment: 'Investor mood',
  fx_fpi: 'Foreign money leaves',
  revenue: 'IT budgets cut',
  capex: 'Fewer data-centre orders',
  credit: 'AI borrowers squeezed',
  fx: 'Weaker rupee',
  own: 'Own accounting shock',
  premium: 'AI premium fades',
};

export function ChannelChip({ channel, share, title, short }: { channel: PartChannel; share?: number; title?: string; short?: boolean }) {
  const v = CHANNEL_VIS[channel];
  return (
    <span className="g-chip g-chip-ch" title={title ?? `${v.label}: ${v.blurb}`}>
      <Icon name={v.icon} size={14} color={v.color} />
      <span className="g-chip-text">{short ? CHANNEL_SHORT[channel] : v.label}</span>
      {isNum(share) && <span className="g-chip-num">{pctAbs(share)}</span>}
    </span>
  );
}

/** Legend key: colour swatch + icon + plain label (optionally a more specific label). */
export function ChannelKey({ channel, label }: { channel: PartChannel; label?: string }) {
  const v = CHANNEL_VIS[channel];
  return (
    <span className="g-key">
      <span className="g-swatch" style={{ background: v.color }} aria-hidden="true" />
      <Icon name={v.icon} size={15} color={v.color} />
      <span>{label ?? v.label}</span>
    </span>
  );
}

export function TierBadge({ tier, short }: { tier: Tier; short?: boolean }) {
  const v = TIER_VIS[tier];
  return (
    <span className="g-tier" title={`${v.tech}: ${v.blurb}`}>
      <Icon name={v.icon} size={14} color={v.color} />
      <span>{short ? v.label.split(' ').slice(0, 3).join(' ') : v.label}</span>
    </span>
  );
}

export function ConfidenceDots({ grade, label = true }: { grade: 'HIGH' | 'MED' | 'LOW'; label?: boolean }) {
  const c = CONFIDENCE_VIS[grade];
  return (
    <span className="g-conf" title={`${c.label}: ${c.blurb}`}>
      <span className="g-conf-dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="g-conf-dot" style={i < c.dots ? { background: c.color, borderColor: c.color } : undefined} />
        ))}
      </span>
      {label ? <span>{c.label}</span> : <span className="g-sr">{c.label}</span>}
    </span>
  );
}

export interface Range {
  p5: number;
  p95: number;
}

/**
 * The likely move as a bar from zero, plus the 90% Monte Carlo range as a thin whisker.
 * Whisker ends that fall outside the shared scale become arrowheads.
 */
export function MoveBar({
  move,
  range,
  domain,
  stale,
  big,
  label,
}: {
  move: number;
  range?: Range | null;
  domain: [number, number];
  stale?: boolean;
  big?: boolean;
  label?: string;
}) {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const pos = (x: number) => ((clamp(x, lo, hi) - lo) / span) * 100;
  const z = pos(0);
  const m = pos(move);
  const r = range && isNum(range.p5) && isNum(range.p95) ? range : null;
  const aria = label ?? `${pct(move)} likely move${r ? `; 9 in 10 outcomes between ${pct(r.p5, 0)} and ${pct(r.p95, 0)}` : ''}`;
  return (
    <div className={`g-move${big ? ' g-move-big' : ''}${stale ? ' is-stale' : ''}`} role="img" aria-label={aria}>
      <div className="g-move-track" />
      {r && (
        <div className="g-move-whisker" style={{ left: `${pos(r.p5)}%`, width: `${Math.max(0, pos(r.p95) - pos(r.p5))}%` }}>
          <span className={`g-cap g-cap-l${r.p5 < lo ? ' is-over' : ''}`} />
          <span className={`g-cap g-cap-r${r.p95 > hi ? ' is-over' : ''}`} />
        </div>
      )}
      <div
        className={`g-move-bar ${move < 0 ? 'is-neg' : 'is-pos'}`}
        style={{ left: `${Math.min(z, m)}%`, width: `${Math.abs(m - z)}%` }}
      />
      <div className="g-move-zero" style={{ left: `${z}%` }} />
      {big && <div className="g-move-dot" style={{ left: `${m}%` }} />}
    </div>
  );
}

/** Share-of-whole bar: how much of something is lost (fill = |x|, capped at 100%). */
export function ShareBar({ x, label }: { x: number | null; label: string }) {
  const w = isNum(x) ? clamp(Math.abs(x), 0, 1) * 100 : 0;
  return (
    <div className="g-sharebar" role="img" aria-label={label}>
      <div className={`g-sharebar-fill ${isNum(x) && x > 0 ? 'is-pos' : 'is-neg'}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function polar(cx: number, cy: number, r: number, t: number): [number, number] {
  const a = Math.PI * (1 - t);
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const [x0, y0] = polar(cx, cy, r, t0);
  const [x1, y1] = polar(cx, cy, r, t1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Semicircle gauge. Zones colour the track; the needle points at the value. */
export function Gauge({
  value,
  min,
  max,
  zones,
  fillFromZero,
  label,
}: {
  value: number;
  min: number;
  max: number;
  zones?: { to: number; color: string }[];
  fillFromZero?: boolean;
  label: string;
}) {
  const t = (x: number) => clamp((x - min) / (max - min || 1), 0, 1);
  const tv = t(value);
  const t0 = t(0);
  const [nx, ny] = polar(60, 60, 40, tv);
  let prev = 0;
  return (
    <svg className="g-gauge" viewBox="0 0 120 66" role="img" aria-label={label}>
      <path d={arc(60, 60, 48, 0, 1)} className="g-gauge-track" />
      {zones?.map((z, i) => {
        const a = prev;
        prev = t(z.to);
        return <path key={i} d={arc(60, 60, 48, a + (i ? 0.006 : 0), prev)} stroke={z.color} className="g-gauge-zone" />;
      })}
      {fillFromZero && Math.abs(tv - t0) > 0.002 && (
        <path d={arc(60, 60, 48, Math.min(t0, tv), Math.max(t0, tv))} stroke={value < 0 ? 'var(--g-down)' : 'var(--g-up)'} className="g-gauge-fill" />
      )}
      {fillFromZero && <line x1={polar(60, 60, 41, t0)[0]} y1={polar(60, 60, 41, t0)[1]} x2={polar(60, 60, 55, t0)[0]} y2={polar(60, 60, 55, t0)[1]} className="g-gauge-tick" />}
      <line x1={60} y1={60} x2={nx} y2={ny} className="g-gauge-needle" />
      <circle cx={60} cy={60} r={4.5} className="g-gauge-hub" />
    </svg>
  );
}

export interface StackPart {
  channel: PartChannel;
  frac: number;
}

/**
 * Diverging stacked bar: everything pushing the price down stacks left of zero, everything
 * cushioning it stacks right. Segment width ∝ size; a 2px surface gap separates segments.
 */
export function DivergingStack({ parts, label }: { parts: StackPart[]; label: string }) {
  const neg = parts.filter((p) => p.frac < 0).sort((a, b) => a.frac - b.frac);
  const pos = parts.filter((p) => p.frac > 0).sort((a, b) => b.frac - a.frac);
  const nTot = neg.reduce((a, p) => a - p.frac, 0);
  const pTot = pos.reduce((a, p) => a + p.frac, 0);
  const tot = nTot + pTot || 1;
  // flex-grow values must sum to ≥ 1 or the segments leave part of their side empty
  const seg = (p: StackPart) => (
    <span
      key={p.channel}
      className="g-dstack-seg"
      style={{ flexGrow: (Math.abs(p.frac) / tot) * 1000, background: CHANNEL_VIS[p.channel].color }}
      title={`${CHANNEL_VIS[p.channel].label}: ${pct(p.frac)} of the price`}
    />
  );
  return (
    <div className="g-dstack" role="img" aria-label={label}>
      <div className="g-dstack-side is-neg" style={{ width: `${(nTot / tot) * 100}%` }}>
        {neg.map(seg)}
      </div>
      <div className="g-dstack-zero" aria-hidden="true" />
      <div className="g-dstack-side is-pos" style={{ width: `${(pTot / tot) * 100}%` }}>
        {pos.map(seg)}
      </div>
    </div>
  );
}

const STATUS_WORDS: Record<Status, { label: string; icon: IconName; tip: string }> = {
  SOURCED: { label: 'Sourced', icon: 'check', tip: 'Taken from a cited document — hover the source link for the exact quote.' },
  UNVERIFIED: { label: 'Unverified', icon: 'warning', tip: 'From a source that could not be fully confirmed.' },
  USER_ASSUMPTION: { label: 'Assumption', icon: 'sliders', tip: 'A judgement call, not a sourced fact. You can change it.' },
  COMPUTED: { label: 'Calculated', icon: 'layers', tip: 'Calculated by this model from market data.' },
  DERIVED: { label: 'Derived', icon: 'layers', tip: 'Combined from several inputs; it carries the weakest input’s tag.' },
};

/** Plain-words provenance tag. */
export function GBadge({ status }: { status: Status }) {
  const w = STATUS_WORDS[status] ?? STATUS_WORDS.DERIVED;
  return (
    <span className={`g-badge g-badge-${status.toLowerCase()}`} title={w.tip}>
      <Icon name={w.icon} size={12} />
      {w.label}
    </span>
  );
}

/** Source links with the title and verbatim quote in the tooltip. */
export function Sources({ ids, bundle, max = 2 }: { ids: string[] | null | undefined; bundle: DataBundle; max?: number }) {
  if (!ids?.length) return null;
  const byId = new Map(bundle.sources.map((s) => [s.id, s]));
  const shown = ids.slice(0, max);
  return (
    <span className="g-srcs">
      {shown.map((id) => {
        const s = byId.get(id);
        if (!s)
          return (
            <span key={id} className="g-src is-missing" title={`Source id “${id}” is not in the data bundle`}>
              source missing
            </span>
          );
        const pub = (s.publisher ?? s.title).split(' (')[0].slice(0, 30);
        const tip = `${s.title}${s.publisher ? ' — ' + s.publisher : ''}${s.date ? ' (' + s.date + ')' : ''}${s.quote ? '\n“' + s.quote + '”' : ''}`;
        return (
          <a key={id} className="g-src" href={s.url} target="_blank" rel="noreferrer" title={tip}>
            <Icon name="book" size={12} />
            {pub}
          </a>
        );
      })}
      {ids.length > max && (
        <span className="g-src is-more" title={ids.slice(max).join(', ')}>
          +{ids.length - max} more
        </span>
      )}
    </span>
  );
}

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'error';
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`g-callout is-${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      <Icon name={icon ?? (tone === 'info' ? 'help' : 'warning')} size={20} />
      <div className="g-callout-body">
        {title && <p className="g-callout-title">{title}</p>}
        {children}
        {action && <div className="g-callout-action">{action}</div>}
      </div>
    </div>
  );
}

export function Calculating({ text = 'Calculating…' }: { text?: string }) {
  return (
    <span className="g-calc" role="status">
      <span className="g-calc-spin" aria-hidden="true" />
      {text}
    </span>
  );
}

export function StepNum({ n }: { n: number }) {
  return (
    <span className="g-stepnum" aria-hidden="true">
      {n}
    </span>
  );
}

export function EmptyState({ icon = 'layers', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="g-empty">
      <Icon name={icon} size={36} />
      <p className="g-empty-title">{title}</p>
      {children}
    </div>
  );
}

/** Keeps one broken view from blanking the whole guided app. */
export class GuidedBoundary extends Component<{ children: ReactNode; onHome(): void; onTerminal(): void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error)
      return (
        <EmptyState icon="warning" title="This page hit a problem">
          <p className="g-muted">{this.state.error}</p>
          <p className="g-muted">The rest of the app still works.</p>
          <div className="g-row">
            <button type="button" className="g-btn" onClick={this.props.onHome}>
              Back to the start
            </button>
            <button type="button" className="g-btn g-btn-ghost" onClick={this.props.onTerminal}>
              Open the terminal view
            </button>
          </div>
        </EmptyState>
      );
    return this.props.children;
  }
}
