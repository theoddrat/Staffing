"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, RotateCcw } from "lucide-react";
import { useCurriculum, useProgress } from "@/lib/api";
import { Card, ErrorNote, Loading, ProgressBar } from "@/components/ui";

export default function Home() {
  const { data: prog, error } = useProgress();
  const { data: cur } = useCurriculum();
  if (error) return <ErrorNote error={error} />;
  if (!prog || !cur) return <Loading />;
  const byId = new Map(cur.lessons.map((l) => [l.id, l]));
  const fresh = Object.keys(prog.states).length === 0;
  const continueId = prog.last_lesson && !["understood", "mastered"].includes(prog.states[prog.last_lesson]?.state ?? "") ? prog.last_lesson : prog.next[0];
  const cont = continueId ? byId.get(continueId) : undefined;
  const understood = (prog.counts.understood ?? 0) + (prog.counts.mastered ?? 0);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">The Mathematical Universe</p>
        <h1 className="mt-1 font-serif text-4xl font-semibold leading-tight">
          {fresh ? "Let’s begin with the very first question." : "Welcome back."}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-2">
          A journey from <em>“What is a number?”</em> to the open questions of mathematics - P versus NP and the Riemann Hypothesis - one
          rung of the ladder at a time. Every word is explained before it is used.
        </p>
      </header>

      {cont ? (
        <Card className="border-accent/40">
          <p className="text-sm text-ink-3">{fresh ? "Start here" : "Continue"}</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold">{cont.title}</h2>
          <p className="mt-1 text-ink-2">{cont.summary}</p>
          <Link href={`/learn/${cont.id}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-ink">
            {fresh ? "Start the first lesson" : "Continue learning"} <ArrowRight size={17} />
          </Link>
        </Card>
      ) : null}

      {prog.revision.length || prog.review_due.length ? (
        <Card>
          <h2 className="flex items-center gap-2 font-semibold"><RotateCcw size={17} /> Worth revisiting</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {prog.revision.map((r) => (
              <li key={r.lesson_id}><Link href={`/learn/${r.lesson_id}`} className="font-medium text-accent hover:underline">{byId.get(r.lesson_id)?.title}</Link>
                <span className="text-ink-3"> - {r.reason}</span></li>
            ))}
            {prog.review_due.filter((r) => !prog.revision.some((x) => x.lesson_id === r)).map((r) => (
              <li key={r}><Link href={`/learn/${r}#assessment`} className="font-medium text-accent hover:underline">{byId.get(r)?.title}</Link>
                <span className="text-ink-3"> - a quick review now will help it stick (spaced practice).</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-ink-3">Ideas understood</p><p className="mt-1 text-3xl font-semibold">{understood}</p><p className="text-xs text-ink-3">{prog.counts.mastered ?? 0} mastered</p></Card>
        <Card><p className="text-sm text-ink-3">Words in my dictionary</p><p className="mt-1 text-3xl font-semibold">{prog.vocabulary.seen}</p><p className="text-xs text-ink-3">{prog.vocabulary.learned} learned · {prog.vocabulary.total} so far in the course</p></Card>
        <Card><p className="text-sm text-ink-3">Exercises completed</p><p className="mt-1 text-3xl font-semibold">{prog.exercises_completed}</p><p className="text-xs text-ink-3">{prog.assessments_passed} checks passed</p></Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">The two destinations</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {prog.paths.map((p) => {
            return (
              <Card key={p.id}>
                <h3 className={`font-semibold ${p.id === "PA" ? "text-pnp" : "text-rh"}`}>{p.id === "PA" ? "P versus NP" : "The Riemann Hypothesis"}</h3>
                <p className="mt-1 text-sm text-ink-2">
                  {p.id === "PA"
                    ? "Is every puzzle whose answer is quick to check also quick to solve? Nobody knows."
                    : "Are the prime numbers spread out as evenly as they possibly could be? Nobody knows."}{" "}
                  <Link href="/research" className="text-accent hover:underline">What does that mean?</Link>
                </p>
                <div className="mt-3"><ProgressBar value={p.known} max={p.total} tone={p.id === "PA" ? "bg-pnp" : "bg-rh"} label={`${p.title} progress`} /></div>
                <p className="mt-1 text-xs text-ink-3">{p.known} of the {p.total} ideas on this path understood. It is a long road - every rung counts.</p>
                <Link href={`/map?target=${p.target}`} className="mt-2 inline-block text-sm text-accent hover:underline">See the path on the map →</Link>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/dictionary" className="rounded-xl border border-line bg-surface p-5 hover:border-accent">
          <BookOpen className="text-accent" size={20} />
          <p className="mt-2 font-semibold">Your mathematical dictionary</p>
          <p className="text-sm text-ink-2">Every word you meet, with plain meaning, picture, definition, examples and non-examples. Click any underlined word anywhere to open it.</p>
        </Link>
        <Link href="/playground" className="rounded-xl border border-line bg-surface p-5 hover:border-accent">
          <p className="text-2xl">🧮</p>
          <p className="mt-2 font-semibold">The playground</p>
          <p className="text-sm text-ink-2">Experiment with numbers before learning the formal words: counting, number lines, fractions, primes and more.</p>
        </Link>
      </section>
    </div>
  );
}
