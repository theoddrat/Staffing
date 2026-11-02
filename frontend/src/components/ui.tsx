"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { KnowledgeState } from "@/lib/types";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "border border-line bg-surface text-ink hover:border-accent",
    ghost: "text-ink-2 hover:bg-surface-2",
    danger: "border border-bad text-bad hover:bg-bad-soft",
  };
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-5 shadow-card ${className}`}>{children}</div>;
}

export const STATE_INFO: Record<KnowledgeState, { label: string; tone: string; dot: string }> = {
  not_started: { label: "Not started", tone: "bg-surface-2 text-ink-3", dot: "var(--line)" },
  introduced: { label: "In progress", tone: "bg-info-soft text-info", dot: "var(--info)" },
  understood: { label: "Understood", tone: "bg-good-soft text-good", dot: "var(--good)" },
  mastered: { label: "Mastered", tone: "bg-accent-soft text-accent", dot: "var(--accent)" },
  needs_revision: { label: "Needs revision", tone: "bg-warn-soft text-warn", dot: "var(--warn)" },
};

export function StateBadge({ state }: { state: KnowledgeState }) {
  const s = STATE_INFO[state];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>;
}

export function ProgressBar({ value, max, tone = "bg-accent", label }: { value: number; max: number; tone?: string; label?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0}
        aria-valuemax={max} aria-label={label}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: { message: string } | undefined | null }) {
  if (!error) return null;
  return <p className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm text-bad">{error.message}</p>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="animate-pulse text-ink-3">{what}…</p>;
}

export function SectionTitle({ eyebrow, title, id }: { eyebrow?: string; title: string; id?: string }) {
  return (
    <header className="mb-3" id={id}>
      {eyebrow ? <p className="text-xs font-semibold tracking-wide text-accent uppercase">{eyebrow}</p> : null}
      <h2 className="text-xl font-semibold">{title}</h2>
    </header>
  );
}
