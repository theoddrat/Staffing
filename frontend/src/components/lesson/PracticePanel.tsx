"use client";

import { useState } from "react";
import { api, useGenerators } from "@/lib/api";
import type { PracticeOut } from "@/lib/types";
import { QuestionView } from "../QuestionView";
import { Button } from "../ui";

/** Endless fresh questions from the lesson's generators (answers computed by the backend). */
export function PracticePanel({ generators, lessonId }: { generators: string[]; lessonId?: string }) {
  const { data: all } = useGenerators();
  const [item, setItem] = useState<PracticeOut | null>(null);
  const [streak, setStreak] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const list = (all ?? []).filter((g) => generators.includes(g.id));
  if (!generators.length) return null;
  const next = async (gid: string) => {
    setErr(null);
    try {
      setItem(await api.practice(gid, lessonId));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {list.map((g) => (
          <Button key={g.id} onClick={() => next(g.id)}>{g.title}</Button>
        ))}
        {streak ? <span className="self-center text-sm text-good">Correct in a row: {streak}</span> : null}
      </div>
      {err ? <p className="text-sm text-bad">{err}</p> : null}
      {item ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <QuestionView key={item.id} q={item.question} onAnswer={(a) => api.practiceAnswer(item.id, a)}
            onDone={(r) => setStreak(r.correct ? streak + 1 : 0)} />
          <Button className="mt-3" variant="ghost" onClick={() => next(item.generator)}>Another one →</Button>
        </div>
      ) : (
        <p className="text-sm text-ink-3">Choose a kind of question. The numbers are new every time, and answers are checked exactly by the computer.</p>
      )}
    </div>
  );
}
