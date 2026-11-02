# Roadmap

The first milestone is built: the app, the full knowledge map, the dictionary, Levels 0 and 1, the
playground, the teaching AI, progress tracking, assessment and learning history. This page lists what comes
next, roughly in order. Each step follows the same rule as the course: build on what exists, and never show a
control that does nothing.

## 1. Write the next levels

The map already holds all 379 lesson nodes with their prerequisites. Writing a lesson file brings it to life
([CONTENT_GUIDE.md](CONTENT_GUIDE.md)).

- **Level 2: Basic operations** (22 lessons). Needs new widgets: an array/area model for multiplication, a
  sharing and grouping view for division, and power towers. Needs new practice generators for each operation,
  order of operations, powers, roots and modular arithmetic.
- **Level 3: The language of mathematics** (20 lessons). This is where the **mathematical translator** becomes
  a page of its own: paste an expression and see it read aloud, symbol by symbol, with every symbol linked to
  the lesson that teaches it. Today the pieces exist separately: the symbol-by-symbol notation section in
  every lesson, the words-and-symbols playground tool, and free-form translation through the AI tutor, which
  needs a key.
- **Levels 4-6** (algebra, geometry and graphs, functions): the "coming with later levels" tools listed in the
  playground, such as the algebra balance with unknowns, the graph plotter and the function machine.
- **Level 7: Logic and proof** (30 lessons). The turning point. Every proof in a lesson can be shown as a
  structured argument and, where feasible, alongside a Lean 4 version.
- **Levels 8-12** (discrete mathematics, calculus and analysis, number theory, complex numbers, and the
  advanced subjects behind both research paths).

## 2. Lean 4 integration

Planned once Level 7 is written, so the learner knows what a proof is before seeing a formal one.

- A backend service that runs `lake env lean` on a snippet, with Mathlib, in an isolated, time-limited
  sandbox, and reports *checked* / *error* / *uses `sorry`*.
- A statement may be labelled `formally-verified-proof` only if a stored Lean proof checks without `sorry`.
  The label will be computed by the checker, not written by hand.
- Lessons can show a short Lean proof next to the written one, explained line by line in the same
  new-language style.

## 3. Research labs (Paths A and B)

Opened only after the learner has the prerequisites, which the map already tracks. Each lab explains what it
needs and links to the lessons.

- **Path B (Riemann Hypothesis):** a prime-counting explorer comparing π(x) with x/ln x and Li(x); a zeta
  function explorer (mpmath) showing |ζ(s)| on the complex plane and zeros on the critical line, with explicit
  notes that checking zeros numerically is evidence, not proof.
- **Path A (P vs NP):** algorithm and complexity-growth visualisers; a small SAT solver with step tracing;
  reductions between problems drawn as graphs; an honest overview of the known barriers (relativisation,
  natural proofs, algebrisation).
- **Research notebook:** the learner's "wonderings" (already stored) grow into proposals. The research prompt
  (`backend/app/ai/prompts/research.md`) already defines the workflow: restate and formalise the idea, relate it to
  known mathematics, test small cases and hunt for counterexamples, expose hidden assumptions, sketch what a
  rigorous argument would need, and record the gaps that remain, classifying every claim along the way. The
  notebook will keep that context across sessions.

## 4. Teaching engine improvements

- AI-generated variant questions for written lessons, checked by the calculator before they are shown.
- Using mistake history to choose which alternative explanation to offer first.
- A daily review queue mixing due reviews with practice drawn from the learner's mistakes.
- Accounts and a PostgreSQL deployment for use beyond one machine. The schema is already portable.

## Not planned

- Claiming, or implying, that the app will solve a Millennium Prize problem.
- Presenting numerical evidence as proof, or citing sources that have not been checked.
