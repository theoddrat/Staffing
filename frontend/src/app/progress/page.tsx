"use client";

import Link from "next/link";
import { useCurriculum, useHistory, useMistakes, useProgress } from "@/lib/api";
import type { EventOut } from "@/lib/types";
import { Card, ErrorNote, Loading, ProgressBar, STATE_INFO, StateBadge } from "@/components/ui";
import { useTerms } from "@/components/TermContext";

function describe(e: EventOut, title: (id: string | null) => string, word: (id: string | null) => string): string | null {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case "lesson_opened": return `Opened "${title(e.lesson_id)}"`;
    case "assessment_finished": return `${d.passed ? "Passed" : "Tried"} the check for "${title(e.lesson_id)}" (${Math.round(Number(d.score) * 100)}%)`;
    case "state_changed": return `"${title(e.lesson_id)}" is now ${STATE_INFO[d.to as keyof typeof STATE_INFO]?.label.toLowerCase() ?? d.to}`;
    case "experiment_completed": return `Completed the experiment in "${title(e.lesson_id)}"`;
    case "dont_understand": return `Asked for a different explanation in "${title(e.lesson_id)}"${d.strategy ? ` (${String(d.strategy).replace(/-/g, " ")})` : ""}`;
    case "terms_added": return `Added ${(d.terms as string[]).length} words to the dictionary`;
    case "term_viewed": return `Looked up "${word(e.term_id)}"`;
    case "tutor_message": return `Talked with the tutor${e.lesson_id ? ` about "${title(e.lesson_id)}"` : ""}`;
    case "practice_answered": return `Practised (${d.correct ? "correct" : "not yet"})`;
    case "wondering_added": return `Wondered: "${String(d.text)}"`;
    default: return null; // section views and single answers are too fine-grained for the timeline
  }
}

export default function ProgressPage() {
  const { data: prog, error } = useProgress();
  const { data: cur } = useCurriculum();
  const { data: hist } = useHistory(300);
  const { data: mistakes } = useMistakes();
  const { terms } = useTerms();
  if (error) return <ErrorNote error={error} />;
  if (!prog || !cur) return <Loading />;
  const title = (id: string | null) => (id ? cur.lessons.find((l) => l.id === id)?.title ?? id : "");
  const word = (id: string | null) => (id ? terms.get(id)?.word ?? id : "");
  const timeline = (hist ?? []).map((e) => ({ e, text: describe(e, title, word) })).filter((x) => x.text);
  const days = new Map<string, typeof timeline>();
  for (const t of timeline) {
    const k = new Date(t.e.created_at).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    days.set(k, [...(days.get(k) ?? []), t]);
  }
  const started = Object.values(prog.states).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">My progress</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Everything here is stored on your own computer and kept between sessions. An idea becomes <em>understood</em> when you pass its check,
          and <em>mastered</em> when you pass again, with a high score, on a later day.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        {(["introduced", "understood", "mastered", "needs_revision"] as const).map((s) => (
          <Card key={s}><StateBadge state={s} /><p className="mt-2 text-3xl font-semibold">{prog.counts[s] ?? 0}</p></Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">By level</h2>
        <ul className="space-y-2">
          {prog.stages.map((s) => {
            const st = cur.stages.find((x) => x.id === s.id)!;
            return (
              <li key={s.id} className="grid grid-cols-[1fr_2fr_auto] items-center gap-3 text-sm">
                <span>{st.kind === "path" ? st.title.replace("Research path ", "") : `Level ${st.number}: ${st.title}`}</span>
                <ProgressBar value={s.understood} max={s.total} label={st.title} />
                <span className="text-ink-3 tabular-nums">{s.understood}/{s.total}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Concepts</h2>
          {started.length ? (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
              {started.map((s) => (
                <li key={s.lesson_id} className="flex items-center gap-2">
                  <StateBadge state={s.state} />
                  <Link href={`/learn/${s.lesson_id}`} className="flex-1 hover:underline">{title(s.lesson_id)}</Link>
                  {s.best_score !== null && s.best_score !== undefined ? <span className="text-ink-3 tabular-nums">best {Math.round(s.best_score * 100)}%</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">No lessons started yet.</p>}
          {prog.revision.length ? (
            <div className="mt-3 border-t border-line pt-3 text-sm">
              <p className="font-semibold">Needs revision</p>
              {prog.revision.map((r) => <p key={r.lesson_id}><Link href={`/learn/${r.lesson_id}`} className="text-accent hover:underline">{title(r.lesson_id)}</Link> - {r.reason}</p>)}
            </div>
          ) : null}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Mistakes that teach</h2>
          <p className="mb-2 text-xs text-ink-3">Patterns in your wrong answers point to the earlier ideas worth strengthening.</p>
          {mistakes?.length ? (
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {mistakes.map((m, i) => (
                <li key={i} className="rounded-lg bg-surface-2/60 p-2">
                  <p>{m.diagnosis}</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    in {title(m.lesson_id)} · {m.count}×
                    {m.revisit ? <> · revisit <Link href={`/learn/${m.revisit}`} className="text-accent hover:underline">{title(m.revisit)}</Link></> : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">No diagnosed mistakes yet.</p>}
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 font-semibold">Vocabulary</h2>
        <p className="text-sm text-ink-2">{prog.vocabulary.seen} words met, {prog.vocabulary.learned} learned, of {prog.vocabulary.total} in the course so far. <Link href="/dictionary" className="text-accent hover:underline">Open my dictionary →</Link></p>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Learning history</h2>
        {days.size ? (
          <div className="space-y-4">
            {[...days.entries()].map(([day, items]) => (
              <div key={day}>
                <p className="mb-1 text-sm font-semibold text-ink-2">{day}</p>
                <ul className="space-y-1 border-l-2 border-line pl-4 text-sm">
                  {items.map(({ e, text }) => (
                    <li key={e.id}><span className="mr-2 text-xs text-ink-3 tabular-nums">{new Date(e.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>{text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-ink-3">Your history will appear here as you learn.</p>}
      </Card>
    </div>
  );
}
