"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurriculum, useProgress } from "@/lib/api";
import type { NodeOut } from "@/lib/types";
import { Card, ErrorNote, Loading, ProgressBar, STATE_INFO } from "@/components/ui";

function LessonRow({ n, state, index }: { n: NodeOut; state: string; index: number }) {
  const s = STATE_INFO[state as keyof typeof STATE_INFO];
  return (
    <li>
      <Link href={`/learn/${n.id}`}
        className={`flex items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-2 ${n.available ? "" : "opacity-60"}`}>
        <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.dot }} title={s.label} />
        <span className="w-6 shrink-0 text-sm text-ink-3 tabular-nums">{index}.</span>
        <span className="flex-1">
          <span className="font-medium">{n.title}</span>
          {!n.available ? <span className="ml-2 text-xs text-ink-3">planned</span> : null}
          <span className="block text-sm text-ink-3">{n.summary}</span>
        </span>
      </Link>
    </li>
  );
}

export default function Curriculum() {
  const { data: cur, error } = useCurriculum();
  const { data: prog } = useProgress();
  const [open, setOpen] = useState<Set<string>>(new Set(["L0", "L1"]));
  if (error) return <ErrorNote error={error} />;
  if (!cur) return <Loading />;
  const stateOf = (id: string) => prog?.states[id]?.state ?? "not_started";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">The curriculum</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          {cur.lessons.length} lessons, from what mathematics is to the research frontier. Levels 0 and 1 are fully written; the rest of the ladder is
          mapped with its prerequisites and is being written level by level. Planned lessons are shown faded - you can open them to see where
          they fit.
        </p>
      </header>
      {cur.stages.map((s) => {
        const lessons = cur.lessons.filter((l) => l.stage === s.id);
        const stp = prog?.stages.find((x) => x.id === s.id);
        const isOpen = open.has(s.id);
        return (
          <Card key={s.id} className="p-0">
            <button type="button" onClick={() => setOpen(new Set(isOpen ? [...open].filter((x) => x !== s.id) : [...open, s.id]))}
              className="flex w-full items-start gap-4 p-5 text-left" aria-expanded={isOpen}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                s.kind === "path" ? (s.id === "PA" ? "bg-info-soft text-pnp" : "bg-warn-soft text-rh") : "bg-accent-soft text-accent"}`}>
                {s.kind === "path" ? s.id : `L${s.number}`}
              </span>
              <span className="flex-1">
                <span className="block text-lg font-semibold">{s.title}</span>
                <span className="block text-sm text-ink-2">{s.summary}</span>
                <span className="mt-2 block max-w-md"><ProgressBar value={stp?.understood ?? 0} max={lessons.length} label={`${s.title} progress`} /></span>
                <span className="mt-1 block text-xs text-ink-3">
                  {stp?.understood ?? 0} of {lessons.length} understood · {stp?.available ?? 0} written
                </span>
              </span>
            </button>
            {isOpen ? (
              <div className="border-t border-line px-2 pb-3">
                <p className="px-3 pt-3 text-sm text-ink-2"><strong>Why this matters: </strong>{s.why}</p>
                {s.modules.length ? (
                  s.modules.map((m) => (
                    <div key={m.id} className="mt-3">
                      <p className="px-3 text-sm font-semibold">{m.title}</p>
                      <p className="px-3 text-xs text-ink-3">{m.why}</p>
                      <ol className="mt-1">
                        {lessons.filter((l) => l.module === m.id).map((l, i) => <LessonRow key={l.id} n={l} state={stateOf(l.id)} index={i + 1} />)}
                      </ol>
                    </div>
                  ))
                ) : (
                  <ol className="mt-2">{lessons.map((l, i) => <LessonRow key={l.id} n={l} state={stateOf(l.id)} index={i + 1} />)}</ol>
                )}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
