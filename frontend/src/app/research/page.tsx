"use client";

import Link from "next/link";
import { useState } from "react";
import { mutate } from "swr";
import { api, useCurriculum, useProgress, useWonderings } from "@/lib/api";
import { Button, Card, ErrorNote, Loading, ProgressBar } from "@/components/ui";
import { KindLegend } from "@/components/Statements";

const DESTINATIONS = {
  PA: {
    name: "P versus NP",
    plain:
      "Some puzzles are quick to check once someone shows you an answer - like checking a filled-in sudoku. The question is whether every puzzle that is quick to check is also quick to solve. Almost everyone believes the answer is no, but nobody has proved it.",
    needs: "algorithms and how to count their steps, logic and proof, discrete mathematics, and the theory of computation.",
  },
  PB: {
    name: "The Riemann Hypothesis",
    plain:
      "The prime numbers (2, 3, 5, 7, 11, ...) look scattered at random, yet they thin out in a remarkably regular way. In 1859 Bernhard Riemann linked their distribution to a function now called the zeta function, and conjectured exactly where that function equals zero. If he was right, the primes are as regularly spread as they possibly could be. Nobody has proved it.",
    needs: "number theory, infinite series and calculus, complex numbers, and complex analysis.",
  },
};

const LAB_FEATURES = [
  "Research notebooks and a history of every idea explored",
  "Hypothesis creation with automatic formalisation",
  "Experiment engines (zeta zeros, prime counts, SAT instances, circuit sizes) with exact or interval arithmetic",
  "Counterexample search",
  "Literature discovery with verified references only",
  "Proof construction, independent checking, and Lean 4 / Mathlib formal verification",
];

export default function Research() {
  const { data: prog, error } = useProgress();
  const { data: cur } = useCurriculum();
  const { data: wonder } = useWonderings();
  const [text, setText] = useState("");
  if (error) return <ErrorNote error={error} />;
  if (!prog || !cur) return <Loading />;
  const byId = new Map(cur.lessons.map((l) => [l.id, l]));
  const add = async () => {
    if (!text.trim()) return;
    await api.addWondering(text.trim());
    setText("");
    await mutate("/wonderings");
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">The research destinations</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          These are two of the hardest open problems in mathematics - each is a Millennium Prize Problem. Nobody can promise they will be solved,
          by you or anyone. What this course can do is build, honestly and carefully, the knowledge and tools needed to investigate them for
          real. The laboratories stay open to you at every stage; they will explain what you would need to learn first.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        {prog.paths.map((p) => {
          const d = DESTINATIONS[p.id as keyof typeof DESTINATIONS];
          const next = prog.next.find((n) => byId.get(n)?.feeds.includes(p.id === "PA" ? "pnp" : "rh")) ?? null;
          return (
            <Card key={p.id}>
              <h2 className={`text-xl font-semibold ${p.id === "PA" ? "text-pnp" : "text-rh"}`}>{d.name}</h2>
              <p className="mt-2 text-sm leading-relaxed">{d.plain}</p>
              <p className="mt-2 text-sm text-ink-2"><strong>What it takes: </strong>{d.needs}</p>
              <div className="mt-4"><ProgressBar value={p.known} max={p.total} tone={p.id === "PA" ? "bg-pnp" : "bg-rh"} label={d.name} /></div>
              <p className="mt-1 text-xs text-ink-3">{p.known} of {p.total} ideas on the path understood{next ? ` · your next rung: ${byId.get(next)?.title}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/map?target=${p.target}`} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">See the full path</Link>
                <Link href="/tutor" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">Discuss an idea (research mode)</Link>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <h2 className="font-semibold">My wonderings</h2>
        <p className="mt-1 text-sm text-ink-2">
          Research starts with a question. Whenever something makes you curious - &ldquo;why are there so many primes?&rdquo;, &ldquo;could this
          always work?&rdquo; - write it down. These become the starting points of your investigations.
        </p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="I wonder…" aria-label="New wondering"
            className="flex-1 rounded-lg border border-line bg-surface px-3 py-2" />
          <Button variant="primary" type="submit" disabled={!text.trim()}>Save</Button>
        </form>
        <ul className="mt-3 space-y-2">
          {(wonder ?? []).map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
              <span className="flex-1">{w.text}</span>
              <select value={w.status} aria-label="status" className="rounded border border-line bg-surface px-2 py-1 text-xs"
                onChange={async (e) => { await api.updateWondering(w.id, { status: e.target.value }); await mutate("/wonderings"); }}>
                <option value="open">open</option><option value="exploring">exploring</option><option value="answered">answered</option>
              </select>
              <button type="button" className="text-xs text-ink-3 hover:text-bad" onClick={async () => { await api.deleteWondering(w.id); await mutate("/wonderings"); }}>remove</button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold">The research laboratories</h2>
        <p className="mt-1 text-sm text-ink-2">
          The laboratories are planned for after the foundations are in place. They will follow strict research integrity: every statement is
          labelled, numerical evidence is never presented as proof, and references are never invented.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2">{LAB_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
        <KindLegend />
      </Card>
    </div>
  );
}
