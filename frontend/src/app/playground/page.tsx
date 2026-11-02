"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Widget, WIDGETS } from "@/widgets/registry";

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Counting and comparing", ids: ["counting-objects", "shepherd", "compare-groups", "balance", "measure"] },
  { title: "Numbers and how we write them", ids: ["numeral-systems", "place-value", "number-line", "number-sets"] },
  { title: "Parts of a whole", ids: ["fraction", "hundred-grid", "ratio-mixer"] },
  { title: "Primes, factors and multiples", ids: ["sieve", "rectangle-arranger", "pairs", "sharing", "multiples-jumps", "common-factors"] },
  { title: "Patterns, rules and reasoning", ids: ["math-lenses", "pattern", "rule-machine", "weighing-puzzle", "pair-proof", "symbol-translator", "model"] },
];

// Honest roadmap: these tools belong to later levels and do not exist yet.
const LATER = [
  ["Algebra balance with unknowns", "Level 4"], ["Equation solver (step by step)", "Level 4"], ["Function machine", "Level 4"],
  ["Graph plotter", "Level 5"], ["Geometry explorer", "Level 5"], ["Sequence explorer", "Level 6"], ["Truth tables and proof builder", "Level 7"],
  ["Graph theory explorer", "Level 8"], ["Probability simulator", "Level 8"], ["Infinite series visualiser", "Level 9"],
  ["Complex number plane", "Level 11"], ["Zeta function explorer", "Path B"], ["Algorithm visualiser", "Path A"], ["Complexity growth visualiser", "Path A"],
  ["SAT solver", "Path A"],
];

export default function Playground() {
  const [active, setActive] = useState("counting-objects");
  const info = WIDGETS[active];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">The playground</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Experiment freely - you do not need to know the formal words first. Every tool says what you are seeing. Each one also appears inside
          a lesson, where its idea is explained step by step.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Tools" className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">{g.title}</p>
              <ul>
                {g.ids.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => setActive(id)}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${active === id ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2"}`}>
                      {WIDGETS[id].title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <Card>
            <h2 className="text-xl font-semibold">{info.title}</h2>
            <p className="mt-1 text-sm text-ink-2"><strong>What you are seeing: </strong>{info.explain}</p>
            <div className="mt-4">
              <Widget key={active} widget={active} props={info.playground} />
            </div>
            <p className="mt-4 text-sm">
              Learn the idea properly in <Link href={`/learn/${info.lesson}`} className="text-accent hover:underline">its lesson</Link>.
            </p>
          </Card>
          <Card>
            <h2 className="font-semibold">Coming with later levels</h2>
            <p className="mt-1 text-sm text-ink-2">These tools are planned. They will arrive with the lessons that need them, so they are not shown as buttons yet.</p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {LATER.map(([t, l]) => <li key={t} className="text-ink-2">{t} <span className="text-ink-3">· {l}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
