# Architecture

Three parts, kept separate on purpose:

1. **The course** (`content/`): plain YAML that a person can read and review. It holds the curriculum graph,
   the lessons, the dictionary and the registry of visuals. No code.
2. **The backend** (`backend/`): Python / FastAPI. It loads and validates the course, stores the learner model
   in SQLite, grades answers, decides what to teach next, and talks to the AI provider.
3. **The frontend** (`frontend/`): Next.js / React / TypeScript / Tailwind, with KaTeX for mathematics. It
   renders lessons, runs the interactive widgets and shows progress.

```
browser ──/api/*──▶ Next.js rewrite ──▶ FastAPI ──▶ SQLite (learner model)
                                          │
                                          ├──▶ content/ (validated at startup, read-only)
                                          └──▶ Anthropic API (optional; key stays on the server)
```

The frontend's `/api/*` requests are proxied by a Next.js rewrite to `BACKEND_URL` (default
`http://127.0.0.1:8000`), so the browser only ever talks to one origin.

## The course as data

`content/curriculum.yaml` lists every stage (Levels 0-12, Path A, Path B), its modules, and every lesson node
with its `pre` (prerequisite) list. The graph has 379 nodes. Written lessons live in
`content/lessons/level-N/<lesson-id>.yaml`; a node without a lesson file is *planned*.

`backend/app/content/schema.py` defines strict Pydantic models with `extra="forbid"`, so a typo in a field
name is an error rather than a silently ignored field. `loader.py` loads everything and checks:

- every prerequisite, link (`[[term]]`, `[[lesson:id|…]]`), connection, widget, widget prop and goal exists;
- the graph is acyclic, and its topological order (Kahn's algorithm, ties broken by file order) is the
  teaching order;
- dictionary entries are introduced where they say, and every term a lesson introduces has an entry;
- diagnoses only send the learner back to *earlier* lessons this one builds on;
- `$` delimiters are balanced and practice generators exist.

If anything fails, the backend refuses to start and prints every problem. The same checks run in the tests,
along with stricter content rules (`backend/tests/test_content.py`) and a frontend test that renders every
formula in the course with KaTeX in strict mode (`frontend/src/lib/content.test.ts`).

## Learner model

Tables (`backend/app/models.py`, migrations in `backend/alembic/`):

| Table | Holds |
|---|---|
| `concept_states` | per lesson: `introduced` / `understood` / `needs_revision` / `mastered`, best score, review schedule, revision reason |
| `learning_events` | append-only history: lesson opened, section viewed, experiment completed, assessment passed, ... |
| `assessment_attempts`, `question_responses` | each attempt with its concrete questions, every answer, try number, credit and diagnosis |
| `term_states` | each dictionary word: first seen where, viewed, learned |
| `exercise_completions`, `practice_items` | practice questions generated and answered |
| `chat_threads`, `chat_messages` | tutor conversations; each reply keeps its structured part (classified statements, strategy, check question) and the lesson context it was asked in |
| `generated_terms` | AI-drafted dictionary entries for words outside the course dictionary |
| `wonderings` | the learner's own research questions and ideas |

SQLite is the default (`MATH_DATABASE_URL`). The schema uses only portable SQLAlchemy types, so PostgreSQL works
by changing the URL. All learner data can be exported to JSON, re-imported or reset from Settings.

### Mastery rules (`backend/app/learning/mastery.py`)

- Opening a lesson marks it **introduced**.
- Passing its check (score ≥ `pass_score`, normally 70%) marks it **understood** and schedules a review.
- Passing a review with ≥ 90% at least 20 hours after first understanding it marks it **mastered**.
- Failing a check on something understood or mastered marks it **needs revision**.
- Reviews follow a spaced schedule: 1, 3, 7, 16, then 35 days.
- When a failed attempt contains a diagnosed mistake that points to an understood prerequisite, that
  prerequisite is flagged **needs revision**, with the reason shown to the learner.

### What to teach next (`backend/app/learning/recommend.py`)

A lesson is *ready* when all its prerequisites are understood (or mastered). The recommendations are the
earliest ready lessons in teaching order; anything flagged for revision or due for review is listed alongside. A lesson whose prerequisites are not met can still be opened. It shows
a gentle "before you begin" panel listing what it builds on, and a **test out** option for learners who already
know it.

## Assessment and grading (`backend/app/learning/grading.py`)

Question types: multiple choice (single or multi), number, short text, true/false, ordering, explain, and
*generated*, where a practice generator writes a fresh question for each attempt. Grading is exact: numbers are
parsed as `Fraction`s, so `0.5`, `1/2` and `2/4` are all accepted where they should be. Correct answers never
leave the server until a question is finished. Each question allows two tries, except where a second try would
be a guess (true/false, two-option choice, explain). A second-try success earns half credit.

Each wrong answer that was anticipated carries a **diagnosis** (why someone would think that) and optionally a
**revisit** target (the prerequisite behind the mistake). Explain questions are graded by the AI against a rubric
when it is configured. Otherwise the learner compares their answer with the rubric and checks off the ideas
they included.

The 27 practice generators (`practice.py`) cover counting, comparing, place value, fractions, decimals,
percentages, ratios, primes, factors, multiples, GCD and LCM. Each one writes its explanation and anticipated
wrong answers from the actual numbers it chose.

## The AI layer (`backend/app/ai/`)

- `provider.py`: one interface, `structured(system, messages, schema, use_calculator)`, returning JSON that
  matches a schema. `AnthropicProvider` uses the official `anthropic` SDK with structured outputs
  (`output_config.format`), a configurable effort level and optional server-side refusal fallback. It runs a
  manual tool loop for the calculator and converts every failure into a message the learner can act on (bad
  key, rate limit, overload, refusal). `FakeProvider` returns scripted responses for tests. Adding another
  provider means implementing the same method.
- `calculator.py`: the only tool the model can call. It is a safe evaluator over a small whitelist of SymPy
  functions (gcd, lcm, isprime, factorint, divisors, …), with limits on size. The prompts require the tutor to
  use it for every computation instead of doing arithmetic in its head.
- `prompts/teaching.md` and `prompts/research.md`: separate system prompts for teaching and research. The
  teaching prompt encodes the new-language principle, adaptation, translation and integrity rules. The research
  prompt encodes statement classification and an honest proposal workflow.
- `tutor.py`: builds the context in two blocks. The first is the prompt plus indexes of the dictionary and
  lessons, which is stable and cached. The second is the learner's state: the current lesson and section, known
  terms, recent mistakes and what is ready next. It also defines the JSON schemas (reply, strategy used, check
  question, missing prerequisites, new terms, classified statements) and post-processes replies so that links
  point only at real terms and lessons.

Tutor messages are saved only after a successful reply, so a failed call never leaves half a conversation. When
the AI is off, every AI endpoint answers with a clear "not configured" status, and the frontend shows how to
turn it on rather than a broken control.

### Keeping the API key safe

The key is read from the environment or `backend/.env` (which git ignores) by `backend/app/config.py`, and used
only by the backend. No endpoint returns it. `/api/ai/status` reports only the provider, the model and whether AI is
available (and, if not, why).

## Frontend

- `src/lib/api.ts`: a typed client and SWR hooks. Types are generated from the backend's OpenAPI schema
  (`npm run gen:api`).
- `src/lib/richtext.ts` + `components/RichText.tsx`: the course's small markup (`$…$`, `$$…$$`, `[[term]]`,
  `[[lesson:id|…]]`, bold, italics, lists). Dictionary words are also linked automatically, the first time each one
  appears in a passage, from each term's `link_forms`. Clicking any linked word opens the dictionary drawer without leaving the page.
- `components/lesson/LessonPlayer.tsx`: the 15-part lesson, section navigation, "before you begin" readiness
  panel, test-out, the floating **I don't understand** button, the tutor side panel and the assessment.
- `src/widgets/`: the 25 interactive visuals. Each is registered in `registry.tsx` with a title and an
  explanation of what the learner is seeing. A test checks that the list matches `content/widgets.yaml`.
- Pages: home, learn (curriculum + lesson), map, dictionary, playground, practice, tutor, progress, research,
  settings.
