# The Mathematical Universe

An AI-guided mathematics course for one learner. It starts at *"What is a number?"* and is mapped, rung by rung,
up to the point where the learner can investigate two open problems: **P versus NP** and the **Riemann
Hypothesis**. It does not promise to solve them; it builds the understanding needed to study them honestly.

Mathematics is taught as a new language. Every idea goes through the same steps: plain meaning → everyday
analogy → picture → small example → the word → the symbol (what it looks like, what it means, why it is used,
how to say it) → precise definition with every word explained → connections → an experiment → a check of
understanding. No term is used before it has been explained, and every term opens in a personal dictionary.

## What works today (first milestone)

| | Status |
|---|---|
| App shell: home, curriculum, lesson player, map, dictionary, playground, practice, tutor, progress, research, settings | Working |
| Knowledge map: all **379 lessons** of Levels 0-12, Path A (P vs NP) and Path B (RH) with prerequisites; highlights the path to either goal | Working |
| Mathematical dictionary: 60 entries with the ten required fields; words in lessons are linked automatically and added to *your* dictionary when you meet them | Working |
| **Level 0** (12 lessons) and **Level 1** (29 lessons), every lesson in the full 15-part format | Complete |
| Interactive number exploration: 25 playground tools (counting, number lines, fractions, place value, sieve, factor rectangles, ...), each explaining what you see | Working |
| Teaching AI that follows the new-language principle, adapts when you don't understand, flags missing prerequisites and classifies statements | Working with an API key. Tested here only against a scripted fake provider, because no key was available |
| Progress tracking: introduced / understood / needs revision / mastered, spaced review, revision flags from diagnosed mistakes | Working |
| Lesson assessment: recall, solve, predict, counterexample, apply and explain questions; two tries; each wrong answer diagnosed and linked to the prerequisite behind it | Working |
| Persistent learning history: every event, attempt, answer and mistake stored in SQLite; export, import and reset | Working |
| "I don't understand" in every lesson, which switches to a different teaching strategy | Working (two or more written alternatives per lesson, then the AI if it is configured) |

There are two ways to run it, with the same lessons and screens:

- **On claude.ai, with nothing to install** (the standalone build). The whole app is one HTML page published as
  a claude.ai Artifact. Progress is saved privately to your Claude account, and the AI tutor runs on your own
  Claude account, asking your permission the first time. See [Standalone build](#standalone-build-one-page-on-claudeai).
- **As a local web app** with a Python server and a Next.js frontend (below).

Lessons from Level 2 onward are **mapped but not written yet**. The app says so plainly when you open one.
[docs/ROADMAP.md](docs/ROADMAP.md) lists what comes next.

## Running it

You need Python 3.11+ and Node 20+.

```bash
# 1. Backend (FastAPI) on http://127.0.0.1:8000
cd backend
python -m venv .venv                      # or: uv venv .venv
.venv/bin/pip install -r requirements.txt # or: uv pip install -r requirements.txt
cp .env.example .env                      # optional: add your Anthropic API key here
.venv/bin/uvicorn app.main:app --port 8000

# 2. Frontend (Next.js) on http://localhost:3000, in a second terminal
cd frontend
npm install
npm run dev
```

The backend creates its SQLite database (`backend/data/universe.db`) and runs migrations on startup. It also
validates all course content and refuses to start if anything is inconsistent, listing every problem it found.

### The AI tutor and your API key

The AI features (tutor chat, AI-written alternative explanations, grading of "explain in your own words"
answers, and drafting dictionary entries for new words) use Claude through the Anthropic API. To turn them on,
put your key in `backend/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The key is read only by the backend and never reaches the browser; the Settings page shows only whether a key
is configured. Without a key the whole course still works. Explanations are self-checked against the key
ideas, and "I don't understand" uses the written alternatives. `MATH_AI_PROVIDER=none` switches AI off
explicitly. The other settings (model, effort, database URL) are in [backend/.env.example](backend/.env.example).

## Standalone build (one page on claude.ai)

`frontend/src/local/` re-implements the backend in TypeScript: grading, mastery, recommendations, the practice
generators, the calculator and every API route. `src/lib/api.ts` sends its requests there instead of over the
network when the page runs standalone. The course itself comes from `frontend/standalone/content.json`, which is
exported from `content/`:

```bash
backend/.venv/bin/python backend/scripts/export_content.py   # after any change to content/ or the tutor prompts
cd frontend && npm run build:standalone                       # -> frontend/standalone/dist/index.html (about 1.8 MB)
npx playwright test -c standalone/playwright.config.ts        # the page in a browser, with and without a fake claude.ai runtime
```

Publish `dist/index.html` as an Artifact with the capabilities `db` and `user` (saving progress), `sample` (the AI
tutor) and `downloads` (backups). Opened anywhere else, the page still works, but saves progress in that browser
only and has no tutor.

## Tests

```bash
cd backend && .venv/bin/python -m pytest       # content integrity, grading, mastery, API, AI pipeline, calculator
cd frontend && npm run typecheck && npm run lint && npm test   # types, lint, unit tests (incl. every formula renders in KaTeX)
cd frontend && npm run e2e                      # Playwright: real backend + browser, full lesson loop
cd frontend && npx playwright test -c standalone/playwright.config.ts   # the standalone page (build it first)
```

`npm test` also runs the standalone ports' tests. Several of them compare against tables recorded from the Python
backend, so the two versions cannot quietly drift apart.

The content tests matter as much as the code tests. They check, for example, that Levels 0 and 1 are complete,
that the prerequisite graph has no cycles and reaches both goals, that every word a lesson introduces has a
dictionary entry, that every wrong option has a diagnosis, and that diagnoses point back only to earlier lessons.

## Repository layout

```
content/              the course itself, as YAML: curriculum graph, lessons, dictionary, widget registry
backend/app/
  content/            strict schema + loader/validator for content/
  learning/           grading, mastery model, recommendations, practice generators
  ai/                 provider (Anthropic, or a fake for tests), tutor, safe calculator tool, prompts
  api/                FastAPI routers
backend/alembic/      database migrations
frontend/src/
  app/                pages (Next.js app router)
  components/         lesson player, assessment, dictionary drawer, tutor chat, ...
  widgets/            the interactive visuals used in lessons and the playground
  lib/                API client and generated types, rich-text renderer, number utilities
  local/              the backend re-implemented in TypeScript for the standalone build
frontend/standalone/  single-page build: entry point, in-page router, Next.js shims, content.json, browser tests
scripts/yaml_safe.py  keeps hand-written YAML safe to parse
docs/                 architecture, content guide, roadmap
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md) ·
[docs/ROADMAP.md](docs/ROADMAP.md)
