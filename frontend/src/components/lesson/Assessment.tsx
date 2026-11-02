"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, refreshProgress } from "@/lib/api";
import type { AnswerOut, AttemptOut, AttemptSummary } from "@/lib/types";
import { QuestionView } from "../QuestionView";
import { Button, ProgressBar, StateBadge } from "../ui";
import { useTerms } from "../TermContext";

export function Assessment({ lessonId, passScore, count, mode: initialMode = "lesson", onFailed, autoStart = false }: {
  lessonId: string; passScore: number; count: number; mode?: "lesson" | "test_out" | "review"; onFailed?: () => void; autoStart?: boolean;
}) {
  const [attempt, setAttempt] = useState<AttemptOut | null>(null);
  const [index, setIndex] = useState(0);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<AttemptSummary | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const { terms } = useTerms();

  const start = async (m = mode) => {
    setBusy(true);
    setErr(null);
    try {
      const a = await api.startAttempt(lessonId, m);
      setAttempt(a);
      setMode(m);
      setIndex(0);
      setDoneIds(new Set());
      setSummary(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true;
      void start(initialMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const finish = async () => {
    if (!attempt) return;
    setBusy(true);
    try {
      const s = await api.finish(attempt.id);
      setSummary(s);
      await refreshProgress();
      if (!s.passed) onFailed?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!attempt) {
    return (
      <div className="space-y-3">
        <p className="text-ink-2">
          {count} short questions. Each one tests understanding in a different way - explaining, solving, predicting, finding counterexamples.
          You get a second try on most questions, with a hint. To pass you need {Math.round(passScore * 100)}%.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => start("lesson")} disabled={busy}>Start the check</Button>
          <Button onClick={() => start("test_out")} disabled={busy}>I already know this - test me</Button>
        </div>
        {err ? <p className="text-sm text-bad">{err}</p> : null}
      </div>
    );
  }

  if (summary) {
    const pct = Math.round(summary.score * 100);
    return (
      <div className="space-y-4" aria-live="polite">
        <div className={`rounded-xl border p-4 ${summary.passed ? "border-good/40 bg-good-soft" : "border-warn/40 bg-warn-soft"}`}>
          <p className="text-lg font-semibold">{summary.passed ? `Well done - ${pct}%.` : `${pct}% this time - and that is useful information.`}</p>
          <p className="mt-1 text-sm">
            {summary.passed
              ? summary.state_after === "mastered"
                ? "You showed this again on a later day with a high score, so it is now marked as mastered."
                : "This idea is now marked as understood. Coming back to it on a later day will turn it into mastery."
              : "Not passing yet usually means one earlier idea needs another look, or this explanation did not fit. Try a different explanation, then have another go - the numbers will be new."}
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <StateBadge state={summary.state_before as never} /> → <StateBadge state={summary.state_after as never} />
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          {summary.results.map((r, i) => (
            <li key={r.question_id} className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${r.correct ? "bg-good" : "bg-warn"}`} />
              Question {i + 1}: {r.correct ? (r.credit < 1 ? `correct on try ${r.tries}` : "correct") : "not yet"}
            </li>
          ))}
        </ul>
        {summary.learned_terms.length ? (
          <p className="text-sm">Words now learned in your dictionary: {summary.learned_terms.map((t) => terms.get(t)?.word ?? t).join(", ")}.</p>
        ) : null}
        {summary.revisit.length ? (
          <div className="text-sm">
            <p className="font-semibold">Worth a quick revisit:</p>
            <ul className="mt-1 list-disc pl-5">
              {summary.revisit.map((n) => <li key={n.id}><Link href={`/learn/${n.id}`} className="text-accent hover:underline">{n.title}</Link></li>)}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start("lesson")}>Try again with new questions</Button>
          {!summary.passed && onFailed ? <Button onClick={onFailed}>Explain it a different way</Button> : null}
          {summary.next.length ? (
            <Link href={`/learn/${summary.next[0].id}`} className="inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
              Next: {summary.next[0].title} →
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const q = attempt.questions[index];
  const restored = attempt.progress.find((p) => p.question_id === q.id);
  const allDone = attempt.questions.every((x) => doneIds.has(x.id) || attempt.progress.find((p) => p.question_id === x.id)?.done);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-ink-3">
        <span>{mode === "test_out" ? "Testing out" : "Question"} {index + 1} of {attempt.questions.length}</span>
        <div className="flex-1"><ProgressBar value={doneIds.size} max={attempt.questions.length} label="questions answered" /></div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <QuestionView key={`${attempt.id}-${q.id}`} q={q}
          initial={restored?.done ? { done: true, correct: restored.correct, reveal: restored.reveal } : undefined}
          onAnswer={(answer) => api.answer(attempt.id, q.id, answer)}
          onDone={(r: AnswerOut) => { void r; setDoneIds(new Set([...doneIds, q.id])); }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {index > 0 ? <Button variant="ghost" onClick={() => setIndex(index - 1)}>← Previous</Button> : null}
        {index < attempt.questions.length - 1 ? (
          <Button variant={doneIds.has(q.id) ? "primary" : "secondary"} onClick={() => setIndex(index + 1)}>
            {doneIds.has(q.id) ? "Next question →" : "Skip for now →"}
          </Button>
        ) : null}
        {allDone || index === attempt.questions.length - 1 ? (
          <Button variant="primary" onClick={finish} disabled={busy || !allDone} title={allDone ? "" : "Answer every question first (unanswered ones count as zero)"}>
            See my result
          </Button>
        ) : null}
        {index === attempt.questions.length - 1 && !allDone ? (
          <Button variant="ghost" onClick={finish} disabled={busy}>Finish anyway</Button>
        ) : null}
      </div>
      {err ? <p className="text-sm text-bad">{err}</p> : null}
    </div>
  );
}
