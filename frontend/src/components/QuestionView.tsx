"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import type { AnswerOut, QuestionPublic } from "@/lib/types";
import { Widget } from "@/widgets/registry";
import { RichText } from "./RichText";
import { Button } from "./ui";

const KIND_LABEL: Record<string, string> = {
  recall: "Remember",
  explain: "Explain in your own words",
  solve: "Solve",
  counterexample: "Find what breaks it",
  predict: "Predict",
  apply: "Apply it",
};

type Props = {
  q: QuestionPublic;
  onAnswer: (answer: Record<string, unknown>) => Promise<AnswerOut>;
  onDone?: (result: AnswerOut) => void;
  /** a finished state restored from the server */
  initial?: { done: boolean; correct: boolean; reveal?: Record<string, unknown> | null };
};

export function QuestionView({ q, onAnswer, onDone, initial }: Props) {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>(q.items ?? []);
  const [selfCheck, setSelfCheck] = useState<number[]>([]);
  const [rubric, setRubric] = useState<string[] | null>(null);
  const [result, setResult] = useState<AnswerOut | null>(null);
  const [history, setHistory] = useState<AnswerOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = result?.done ?? initial?.done ?? false;
  const reveal = (result?.reveal ?? initial?.reveal ?? null) as Record<string, unknown> | null;

  const submit = async (answer: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await onAnswer(answer);
      if (!r.valid) {
        if (r.reveal && Array.isArray(r.reveal.rubric)) setRubric(r.reveal.rubric as string[]);
        setErr(r.message ?? "That answer could not be understood.");
      } else {
        setResult(r);
        setHistory([...history, r]);
        if (r.done) onDone?.(r);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const correctOptions = (reveal?.correct_options as string[] | undefined) ?? [];
  const last = history[history.length - 1];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{KIND_LABEL[q.kind] ?? q.kind}</p>
      <RichText text={q.prompt} />
      {q.visual ? (
        <div className={`rounded-lg border border-line bg-surface-2/40 p-3 ${q.visual.props?.editable ? "" : "max-w-sm"}`}>
          <Widget widget={q.visual.widget} props={q.visual.props} compact={!q.visual.props?.editable} />
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- inputs */}
      {q.type === "choice" && q.options ? (
        <fieldset className="space-y-2" disabled={done || busy}>
          <legend className="sr-only">Options</legend>
          {q.options.map((o) => {
            const isSel = selected.includes(o.id);
            const isRight = done && correctOptions.includes(o.id);
            return (
              <label key={o.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                  isRight ? "border-good bg-good-soft" : isSel ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"}`}>
                <input type={q.multi ? "checkbox" : "radio"} name={q.id} className="mt-1" checked={isSel}
                  onChange={() => setSelected(q.multi ? (isSel ? selected.filter((s) => s !== o.id) : [...selected, o.id]) : [o.id])} />
                <RichText text={o.text} inline />
              </label>
            );
          })}
          {!done ? (
            <Button variant="primary" disabled={!selected.length || busy} onClick={() => submit({ selected })}>Check</Button>
          ) : null}
        </fieldset>
      ) : null}

      {(q.type === "number" || q.type === "text") && !done ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) submit({ value }); }}>
          <input aria-label="Your answer" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
            inputMode={q.type === "number" ? "decimal" : "text"} autoComplete="off"
            className="w-48 rounded-lg border border-line bg-surface px-3 py-2 text-lg tabular-nums" placeholder={q.type === "number" ? "e.g. 7, -3, 3/4" : ""} />
          {q.unit ? <span className="text-ink-2">{q.unit}</span> : null}
          <Button variant="primary" type="submit" disabled={!value.trim() || busy}>Check</Button>
        </form>
      ) : null}

      {q.type === "truefalse" && !done ? (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => submit({ value: true })}>True</Button>
          <Button variant="secondary" disabled={busy} onClick={() => submit({ value: false })}>False</Button>
        </div>
      ) : null}

      {q.type === "order" && !done ? (
        <div>
          <p className="mb-2 text-sm text-ink-2">Arrange from {q.order_label ?? "first to last"} (top to bottom).</p>
          <ol className="space-y-1.5">
            {order.map((it, i) => (
              <li key={it} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
                <span className="w-6 text-sm text-ink-3">{i + 1}.</span>
                <span className="flex-1"><RichText text={it} inline link={false} /></span>
                <button type="button" aria-label={`move ${it} up`} disabled={i === 0}
                  onClick={() => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; setOrder(o); }}
                  className="rounded p-1 hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={15} /></button>
                <button type="button" aria-label={`move ${it} down`} disabled={i === order.length - 1}
                  onClick={() => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; setOrder(o); }}
                  className="rounded p-1 hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={15} /></button>
              </li>
            ))}
          </ol>
          <Button variant="primary" className="mt-2" disabled={busy} onClick={() => submit({ order })}>Check</Button>
        </div>
      ) : null}

      {q.type === "explain" && !done ? (
        <div className="space-y-2">
          <textarea aria-label="Your explanation" value={value} onChange={(e) => setValue(e.target.value)} rows={4} disabled={busy}
            className="w-full rounded-lg border border-line bg-surface p-3 font-serif" placeholder="Write it as if explaining to a friend…" />
          {rubric ? (
            <fieldset className="rounded-lg border border-line bg-surface-2/50 p-3">
              <legend className="px-1 text-sm font-semibold">Did your explanation include these key ideas?</legend>
              {rubric.map((r, i) => (
                <label key={i} className="mt-1.5 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={selfCheck.includes(i)}
                    onChange={() => setSelfCheck(selfCheck.includes(i) ? selfCheck.filter((x) => x !== i) : [...selfCheck, i])} />
                  <RichText text={r} inline />
                </label>
              ))}
              <p className="mt-2 text-xs text-ink-3">Be honest with yourself - this is for your learning, not a grade.</p>
            </fieldset>
          ) : null}
          <Button variant="primary" disabled={value.trim().length < 3 || busy}
            onClick={() => submit(rubric ? { text: value, self_check: selfCheck } : { text: value })}>
            {rubric ? "Submit my self-check" : busy ? "Checking…" : "Submit explanation"}
          </Button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- feedback */}
      {err ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="status">{err}</p> : null}
      {last && !last.correct && !done ? (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm" role="status">
          <p className="flex items-center gap-1.5 font-semibold text-warn"><X size={15} /> Not quite - you have another try.</p>
          {last.diagnosis ? <div className="mt-1"><RichText text={last.diagnosis} inline /></div> : null}
          {last.hint ? <p className="mt-1 flex items-start gap-1.5"><Lightbulb size={15} className="mt-0.5 shrink-0" /> <RichText text={last.hint} inline /></p> : null}
        </div>
      ) : null}
      {done ? (
        <div className={`rounded-lg border px-3 py-2.5 text-sm ${(result?.correct ?? initial?.correct) ? "border-good/40 bg-good-soft" : "border-line bg-surface-2"}`} role="status">
          {(result?.correct ?? initial?.correct) ? (
            <p className="flex items-center gap-1.5 font-semibold text-good"><Check size={15} />
              {result?.graded_by === "self" ? "Thank you for checking yourself honestly." : result && result.try_number > 1 ? "Correct on the second try." : "Correct!"}
            </p>
          ) : (
            <p className="font-semibold">Here is how to think about it:</p>
          )}
          {result && !result.correct && result.diagnosis ? <div className="mt-1"><RichText text={result.diagnosis} inline /></div> : null}
          {result?.feedback ? <div className="mt-1"><RichText text={result.feedback} inline /></div> : null}
          {reveal?.answer !== undefined && !(result?.correct ?? initial?.correct) ? (
            <p className="mt-1">Answer: <strong>{Array.isArray(reveal.answer) ? (reveal.answer as string[]).map((a) => a.replace(/\$/g, "")).join(", ") : String(reveal.answer)}</strong></p>
          ) : null}
          {typeof reveal?.explanation === "string" ? <div className="mt-1.5"><RichText text={reveal.explanation as string} /></div> : null}
          {Array.isArray(reveal?.rubric) ? (
            <div className="mt-2">
              <p className="font-semibold">Key ideas</p>
              <ul className="list-disc pl-5">{(reveal!.rubric as string[]).map((r, i) => (
                <li key={i} className={result?.rubric_met?.[i] ? "text-good" : ""}><RichText text={r} inline /></li>
              ))}</ul>
              {typeof reveal?.model_answer === "string" ? (
                <details className="mt-1"><summary className="cursor-pointer text-ink-2">One good answer</summary><RichText text={reveal.model_answer as string} /></details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {(result?.revisit) ? (
        <p className="text-sm">
          This kind of mistake often happens when an earlier idea feels shaky. A short look at{" "}
          <Link href={`/learn/${result.revisit.id}`} className="font-medium text-accent hover:underline">{result.revisit.title}</Link> may help.
        </p>
      ) : null}
    </div>
  );
}
