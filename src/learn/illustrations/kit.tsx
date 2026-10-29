// SVG primitives shared by every Learn illustration (viewBox units; colours = guided tokens).
import type { ReactNode } from 'react';
import { Icon } from '../../guided/icons';
import type { DataBundle } from '../../types/data';
import type { ScenarioResult } from '../../types/engine';
import type { Channel } from '../../types/engine';

export const W = 320;
export const H = 170;

export const C = {
  text: 'var(--g-text)',
  muted: 'var(--g-muted)',
  faint: 'var(--g-faint)',
  line: 'var(--g-line)',
  card: 'var(--g-card)',
  card2: 'var(--g-card-2)',
  accent: 'var(--g-accent)',
  accentSoft: 'var(--g-accent-soft)',
  up: 'var(--g-up)',
  down: 'var(--g-down)',
  downSoft: 'var(--g-down-soft)',
  upSoft: 'var(--g-up-soft)',
};

export interface IllProps {
  bundle: DataBundle | null;
  result: ScenarioResult | null;
  /** smaller labels, fewer annotations (popovers) */
  compact?: boolean;
  /** optional focus: a stock ticker or a channel to highlight */
  ticker?: string;
  focus?: Channel | 'premium';
  /** illustration-specific variant, e.g. a status, a ticker or 'market' | 'fundamental' | 'gap' */
  variant?: string;
}

export function Svg({ label, children, h = H }: { label: string; children: ReactNode; h?: number }) {
  return (
    <svg className="lv-ill" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <title>{label}</title>
      {children}
    </svg>
  );
}

export function Txt({
  x,
  y,
  children,
  size = 11,
  color = C.text,
  anchor = 'start',
  weight = 400,
  mono = false,
  opacity,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  color?: string;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
  mono?: boolean;
  opacity?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      textAnchor={anchor}
      style={{ fill: color, fontFamily: mono ? 'var(--g-mono)' : 'var(--g-font)', fontWeight: weight, opacity }}
    >
      {children}
    </text>
  );
}

/** Straight arrow with a filled head (no <marker>, so many SVGs can share a page). */
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  color = C.muted,
  width = 1.6,
  head = 6,
  dashed = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
  head?: number;
  dashed?: boolean;
}) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - head * Math.cos(a);
  const by = y2 - head * Math.sin(a);
  const p1 = `${x2},${y2}`;
  const p2 = `${bx + (head / 2) * Math.sin(a)},${by - (head / 2) * Math.cos(a)}`;
  const p3 = `${bx - (head / 2) * Math.sin(a)},${by + (head / 2) * Math.cos(a)}`;
  return (
    <g>
      <line x1={x1} y1={y1} x2={bx} y2={by} style={{ stroke: color, strokeWidth: width, strokeDasharray: dashed ? '4 3' : undefined }} />
      <polygon points={`${p1} ${p2} ${p3}`} style={{ fill: color }} />
    </g>
  );
}

export function IconAt({ name, x, y, size = 18, color = C.text }: { name: string; x: number; y: number; size?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <Icon name={name} size={size} color={color} />
    </g>
  );
}

export function Box({
  x,
  y,
  w,
  h,
  color = C.line,
  fill = C.card2,
  r = 8,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  fill?: string;
  r?: number;
  children?: ReactNode;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} style={{ fill, stroke: color, strokeWidth: 1.2 }} />
      {children}
    </g>
  );
}

export function scale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/** Small "illustration" tag so schematic drawings are never mistaken for data. */
export function SchematicTag({ x = W - 6, y = H - 6 }: { x?: number; y?: number }) {
  return (
    <Txt x={x} y={y} size={8.5} color={C.faint} anchor="end">
      schematic — not to scale
    </Txt>
  );
}

/** Deterministic pseudo-random numbers for schematic drawings (no data, no NaN). */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
