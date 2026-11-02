"use client";

import type { StatementKind } from "@/lib/types";
import { RichText } from "./RichText";

export const KIND_INFO: Record<string, { label: string; tone: string; meaning: string }> = {
  "definition": { label: "Definition", tone: "bg-surface-2 text-ink-2", meaning: "States exactly what a word means. Definitions are agreed, not proved." },
  "established-fact": { label: "Established fact", tone: "bg-info-soft text-info", meaning: "A fact about history or the world that is well documented." },
  "proven-theorem": { label: "Proven theorem", tone: "bg-good-soft text-good", meaning: "A statement that has been proved - true in every case, forever." },
  "conjecture": { label: "Conjecture", tone: "bg-warn-soft text-warn", meaning: "Believed true but not yet proved." },
  "computational-observation": { label: "Computational observation", tone: "bg-accent-soft text-accent", meaning: "Checked by calculation for particular cases. Evidence, not proof." },
  "hypothesis": { label: "Hypothesis", tone: "bg-warn-soft text-warn", meaning: "A proposed explanation that has not been established." },
  "speculation": { label: "Speculation", tone: "bg-surface-2 text-ink-3", meaning: "An idea worth considering, with little evidence so far." },
  "disproved-claim": { label: "Disproved claim", tone: "bg-bad-soft text-bad", meaning: "Shown to be false, usually by a counterexample." },
  "unverified-proof": { label: "Unverified proof", tone: "bg-warn-soft text-warn", meaning: "An argument that has not yet been checked step by step." },
  "formally-verified-proof": { label: "Formally verified proof", tone: "bg-good-soft text-good", meaning: "A proof checked line by line by a computer proof assistant." },
  "convention": { label: "Convention", tone: "bg-surface-2 text-ink-2", meaning: "An agreed choice of notation or naming - it could have been made differently." },
};

export function KindBadge({ kind }: { kind: StatementKind | string }) {
  const k = KIND_INFO[kind] ?? { label: kind, tone: "bg-surface-2 text-ink-2", meaning: "" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${k.tone}`} title={k.meaning}>
      {k.label}
    </span>
  );
}

export function StatementList({ items }: { items: { kind: string; text: string; note?: string | null }[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-3">
      {items.map((s, i) => (
        <li key={i} className="rounded-lg border border-line bg-surface p-3">
          <KindBadge kind={s.kind} />
          <div className="mt-1.5">
            <RichText text={s.text} />
          </div>
          {s.note ? (
            <p className="mt-1 text-sm text-ink-3">
              <RichText text={s.note} inline />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function KindLegend() {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-ink-3">What do these labels mean?</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.entries(KIND_INFO).map(([k, v]) => (
          <div key={k}>
            <dt><KindBadge kind={k} /></dt>
            <dd className="mt-0.5 text-ink-2">{v.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
