"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export type WidgetProps = {
  props: Record<string, unknown>;
  goal?: Record<string, unknown> | null;
  onComplete?: (data?: Record<string, unknown>) => void;
  compact?: boolean;
};

export const num = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
export const bool = (p: Record<string, unknown>, k: string, d = false) => (typeof p[k] === "boolean" ? (p[k] as boolean) : d);
export const str = (p: Record<string, unknown>, k: string, d: string) => (typeof p[k] === "string" ? (p[k] as string) : d);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Calls onComplete once, the first time `met` becomes true. */
export function useGoal(met: boolean, onComplete?: (data?: Record<string, unknown>) => void, data?: Record<string, unknown>) {
  const done = useRef(false);
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });
  useEffect(() => {
    if (met && !done.current) {
      done.current = true;
      onComplete?.(latest.current);
    }
  }, [met, onComplete]);
}

export function Stepper({ label, value, min, max, step = 1, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 text-sm" role="group" aria-label={label}>
      <span className="text-ink-2">{label}</span>
      <button type="button" aria-label={`decrease ${label}`} disabled={value <= min}
        onClick={() => onChange(clamp(round(value - step), min, max))}
        className="rounded-md border border-line bg-surface p-1 hover:border-accent disabled:opacity-40">
        <Minus size={14} />
      </button>
      <output className="min-w-[2.5ch] text-center font-semibold tabular-nums" aria-live="polite">{format ? format(value) : value}</output>
      <button type="button" aria-label={`increase ${label}`} disabled={value >= max}
        onClick={() => onChange(clamp(round(value + step), min, max))}
        className="rounded-md border border-line bg-surface p-1 hover:border-accent disabled:opacity-40">
        <Plus size={14} />
      </button>
    </div>
  );
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function Controls({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>;
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const t = { neutral: "bg-surface-2 text-ink-2", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn" }[tone];
  return <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${t}`} aria-live="polite">{children}</p>;
}

export function SmallButton({ children, onClick, disabled, active }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface hover:border-accent"}`}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ object glyphs

export const OBJECT_NAMES = ["apple", "star", "cookie", "ball", "flower", "fish", "sheep", "dot"] as const;

/** A small drawing of an everyday object, centred at (x, y). */
export function Glyph({ kind, x, y, r = 12, muted = false }: { kind: string; x: number; y: number; r?: number; muted?: boolean }) {
  const o = muted ? 0.35 : 1;
  switch (kind) {
    case "apple":
      return (
        <g opacity={o}>
          <circle cx={x} cy={y + r * 0.1} r={r * 0.85} fill="#dc2626" />
          <rect x={x - r * 0.07} y={y - r} width={r * 0.14} height={r * 0.4} fill="#78350f" />
          <ellipse cx={x + r * 0.3} cy={y - r * 0.75} rx={r * 0.3} ry={r * 0.15} fill="#16a34a" />
        </g>
      );
    case "star": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 ? r * 0.42 : r;
        return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
      }).join(" ");
      return <polygon points={pts} fill="#f59e0b" opacity={o} />;
    }
    case "cookie":
      return (
        <g opacity={o}>
          <circle cx={x} cy={y} r={r * 0.9} fill="#d4a373" />
          <circle cx={x - r * 0.3} cy={y - r * 0.2} r={r * 0.12} fill="#5b3a29" />
          <circle cx={x + r * 0.3} cy={y + r * 0.1} r={r * 0.12} fill="#5b3a29" />
          <circle cx={x} cy={y + r * 0.4} r={r * 0.1} fill="#5b3a29" />
        </g>
      );
    case "ball":
      return (
        <g opacity={o}>
          <circle cx={x} cy={y} r={r * 0.85} fill="#2563eb" />
          <path d={`M${x - r * 0.85},${y} Q${x},${y - r * 0.5} ${x + r * 0.85},${y}`} stroke="#fff" strokeWidth={1.5} fill="none" />
        </g>
      );
    case "flower":
      return (
        <g opacity={o}>
          {[0, 72, 144, 216, 288].map((deg) => (
            <circle key={deg} cx={x + r * 0.5 * Math.cos((deg * Math.PI) / 180)} cy={y + r * 0.5 * Math.sin((deg * Math.PI) / 180)}
              r={r * 0.42} fill="#ec4899" />
          ))}
          <circle cx={x} cy={y} r={r * 0.3} fill="#facc15" />
        </g>
      );
    case "fish":
      return (
        <g opacity={o}>
          <ellipse cx={x - r * 0.1} cy={y} rx={r * 0.7} ry={r * 0.45} fill="#0891b2" />
          <polygon points={`${x + r * 0.5},${y} ${x + r},${y - r * 0.45} ${x + r},${y + r * 0.45}`} fill="#0891b2" />
          <circle cx={x - r * 0.45} cy={y - r * 0.1} r={r * 0.08} fill="#fff" />
        </g>
      );
    case "sheep":
      return (
        <g opacity={o}>
          {[-0.4, 0, 0.4].map((dx) => (
            <circle key={dx} cx={x + r * dx} cy={y - r * 0.1} r={r * 0.42} fill="#f5f5f4" stroke="#a8a29e" />
          ))}
          <circle cx={x + r * 0.75} cy={y - r * 0.15} r={r * 0.28} fill="#44403c" />
          <rect x={x - r * 0.4} y={y + r * 0.2} width={r * 0.12} height={r * 0.45} fill="#44403c" />
          <rect x={x + r * 0.25} y={y + r * 0.2} width={r * 0.12} height={r * 0.45} fill="#44403c" />
        </g>
      );
    default:
      return <circle cx={x} cy={y} r={r * 0.6} fill="var(--accent)" opacity={o} />;
  }
}

/** Deterministic pseudo-random numbers so layouts are stable between renders. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
