# Standalone build: the backend, ported to the browser

Goal: the whole app runs as ONE self-contained HTML page (a claude.ai Artifact) with no Python
server. The React frontend stays as it is. Every `/api/...` call is answered in the browser by
`src/local/server.ts`, which re-implements the FastAPI routes on top of TypeScript ports of the
backend's learning logic.

The Python backend is the **specification**. Port it faithfully: same behaviour, same JSON response
shapes (field names, nulls, ordering), same learner-facing wording. When in doubt, read the Python and
the backend tests. Response shapes are defined by `backend/app/api/schemas.py` and typed for the
frontend in `src/lib/api-schema.ts` (generated from OpenAPI) - the frontend code in `src/app`,
`src/components` and `src/lib/api.ts` shows exactly what it reads.

Runtime facts (the artifact page):
- No network. No server. Everything runs in the page.
- Persistence: the artifact `db` capability (per-viewer private documents) with a localStorage
  fallback - see `persistence.ts` below.
- AI: the artifact `sample` capability (calls Claude on the viewer's own account; consent prompt on
  first call; may be absent). See `ai.ts` below. Type definitions for the capabilities:
  `/tmp/claude-0/bundled-skills/2.1.316/2e74a115ea97bd6548cec23f8a0ce9f1/artifact-capabilities/0.2.96/{claude,db,sample,user}.d.ts`

## Shared modules (already written - do not change their APIs)

| File | What |
|---|---|
| `src/local/types.ts` | `ContentJson` (shape of `frontend/standalone/content.json`), `ContentBundle` interface, `Q`, `Lesson`, `Term`, `LearnerData`, `Persistence` |
| `src/local/rng.ts` | `Random` - seedable, Python-like (`random()`, `randint(a,b)` inclusive, `choice`, `shuffle` in place, `sample`), plus `range()` |
| `src/local/fraction.ts` | `Fraction` - exact BigInt rationals like Python's (`Fraction.parse(str)` returns null on bad input, `add/sub/mul/div/cmp/eq/lt/...`, `toString()` = Python `str()`) |
| `frontend/standalone/content.json` | the validated course, exported by `backend/scripts/export_content.py` (rerun it after content changes) |

Tests: Vitest (`npm test` runs `src/**/*.test.ts`). Put each module's tests next to it as
`src/local/<module>.test.ts`. Import content in tests with
`import content from "../../standalone/content.json"` (resolveJsonModule is on) and cast to `ContentJson`.

## Modules and owners

### practice.ts + calculator.ts (agent: practice)
Port `backend/app/learning/practice.py` and `backend/app/ai/calculator.py`.

```ts
// practice.ts
export type Generator = { id: string; title: string; lesson: string; fn: (rng: Random, params: Record<string, any>) => Q };
export const GENERATORS: Record<string, Generator>;          // all 27, same ids, titles, lessons
export function generate(gid: string, rng?: Random, params?: Record<string, any>): Q; // sets hint/visual default null, generated_from
export function divisors(n: number): number[];
export function isPrime(n: number): boolean;
export function gcd(a: number, b: number): number;
export function lcm(a: number, b: number): number;
// plus any other helpers practice.py exports (frac_tex -> fracTex, number_q -> numberQ, ...)

// calculator.ts  - exact arithmetic for the AI tutor's `calculate` tool
export function calculate(expression: string): { expression: string; result: string } ; // throws CalcError(message) on bad/unsafe input
export class CalcError extends Error {}
export const CALCULATOR_TOOL_DESCRIPTION: string; // what the tool does, for the AI
```
Generated questions must have exactly the same keys and value types as the Python ones (answers as
strings, `common_wrong` entries, `diagnosis`, `revisit`, `explanation`, LaTeX). Use BigInt / Fraction
where Python relies on big integers or exact fractions.

### grading.ts + mastery.ts + recommend.ts (agent: learning)
Port `backend/app/learning/grading.py`, `mastery.py`, `recommend.py`.

```ts
// grading.ts
export function materialise(assessment: Assessment, rng: Random): Q[];   // uses generate() from practice.ts
export function prepare(q: Q, rng: Random): void;                       // python _prepare
export function maxTries(q: Q): number;
export function publicView(q: Q): Q;
export function reveal(q: Q): Q;
export function parseNumber(raw: string): Fraction | null;
export function normaliseText(s: string, mode?: "words" | "math"): string;
export type Grade = { valid: boolean; correct: boolean; message: string | null; diagnosis: string | null; revisit: string | null; /* ...every field of the Python dataclass */ };
export function grade(q: Q, answer: Record<string, unknown>): Grade;
export function gradeExplainSelf(q: Q, answer: Record<string, unknown>): Grade;
export function creditFor(tryNumber: number, correct: boolean): number;
export const PRIVATE_FIELDS: readonly string[];

// mastery.ts  (dates are JS Date objects; constants identical)
export type StateView = { state: string; firstUnderstoodAt: Date | null; /* mirror the Python dataclass fields */ };
export function onOpen(s: StateView): string;
export function onAssessment(s: StateView, score: number, passScore: number, now: Date): [string, string | null];
export function onDiagnosedGap(s: StateView, reason: string): [string, string | null];
export function reviewDue(s: StateView, now: Date): boolean;
// + the exported constants (pass score, mastery score, review intervals, ...)

// recommend.ts  (bundle: ContentBundle from types.ts; states: lessonId -> state string)
export function readiness(bundle, lessonId, states): Readiness;   // same fields as the Python dataclass
export function nextLessons(bundle, states, limit = 3): string[];
export function frontierPlanned(bundle, states, limit = 5): string[];
export function pathProgress(bundle, target, states): Record<string, number>;
export const KNOWN: ReadonlySet<string>;
```
Python field names inside returned objects stay snake_case where they reach JSON responses.

### content.ts + store.ts + service.ts + server.ts (agent: server)
Port `backend/app/content/loader.py` (the bundle helpers only - content is already validated),
`backend/app/learning/service.py`, `backend/app/models.py` (as plain JSON tables) and every router in
`backend/app/api/` (+ `deps.py`, `schemas.py` shapes).

```ts
// content.ts
export function loadBundle(json: ContentJson): ContentBundle;
export function linkForms(term: Term): string[];      // already precomputed as term.link_forms; keep for parity

// store.ts - the learner model as plain JSON tables, mirroring models.py
export function emptyLearnerData(): LearnerData;      // { schema: 1, concept_states: {}, events: [], attempts: {}, ... }
export class Store { constructor(data: LearnerData, onChange: (d: LearnerData) => void); ... }

// server.ts
export class LocalHttpError extends Error { constructor(public status: number, public detail: string) }
export interface LocalServer { handle(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> }
export async function createServer(opts: {
  content: ContentJson;
  persistence: Persistence;          // from persistence.ts (tests: an in-memory fake)
  ai: typeof import("./ai");         // the ai.ts module (tests: a fake with the same exports)
  now?: () => Date;
  seed?: number | string;            // for deterministic tests
}): Promise<LocalServer>;
```
`path` includes the query string, exactly as `src/lib/api.ts` passes it (e.g. `/lessons/l0-counting`,
`/history?limit=50`). Return the JSON body the FastAPI route would return (`undefined` for 204).
Errors: throw `LocalHttpError(status, detail)` with the same status codes and detail text as FastAPI.
Every route in `backend/app/api/*.py` must exist, including `/health`, `/ai/status`, export/import/reset.
Each state change calls `persistence.save(data)`. Port the backend API tests (`backend/tests/test_api.py`,
and the AI-route parts of `test_ai.py` with a fake ai module) to `server.test.ts`.

### persistence.ts + ai.ts (agent: platform)
```ts
// persistence.ts
export async function createPersistence(opts?: { key?: string }): Promise<Persistence>;  // see Persistence in types.ts
export function memoryPersistence(initial?: LearnerData | null): Persistence;               // for tests and as last resort
```
- Mode `account`: `claude.use("db")` + `claude.use("user")` both non-null and `user.id()` non-null.
  Data lives under the viewer's private collection `data/users/<id>` (documents in that collection).
  Each top-level key of LearnerData is stored separately; a key whose JSON exceeds ~200 KB is split
  into numbered chunk documents (documents max 256 KiB). Only changed documents are written, at most
  one write in flight per document, debounced (~800 ms), awaited in order. A write rejected with
  `invalid_argument` (e.g. a view-only member) switches to `browser` mode and reports it in status.
- Mode `browser`: localStorage under a fixed key (wrap every access in try/catch).
- Mode `memory`: nothing saved (status explains that progress will be lost on reload).
- `window.claude` may be missing entirely (opened outside claude.ai) and `use()` may take up to 10 s
  to resolve null - load must not hang longer than that; prefer racing a ~4 s timer for the first
  paint and upgrading after if needed is NOT required: simply await use() with a timeout of 10 s.

```ts
// ai.ts - mirrors backend/app/ai/tutor.py and provider.py, backed by claude.use("sample")
export class AIError extends Error {}          // message is shown to the learner
export class AIUnavailable extends AIError {}  // AI cannot be used in this view (no sample / not granted)
export class AIRefusal extends AIError {}
export function aiStatus(): Promise<{ configured: boolean; provider: string; model: string | null; reason: string | null }>;
export function learnerContext(bundle, states: Record<string, string>, opts?: { lessonId?: string | null; section?: string | null; knownTerms?: string[]; mistakes?: string[] }): string;
export function stableContext(bundle): string;
export function sanitizeLinks(text: string, bundle): string;
export function cleanReply(data: Record<string, unknown>, bundle): Record<string, unknown>;
export function chat(bundle, opts: { mode: string; learner: string; history: { role: string; content: string }[]; userText: string }): Promise<[Record<string, unknown>, { model: string | null; tool_calls: unknown[] }]>;
export function explainDifferently(bundle, opts: { learner: string; lessonId: string; section: string | null; tried: string[] }): Promise<Record<string, unknown>>;
export function gradeExplanation(bundle, opts: { question: Q; answerText: string }): Promise<Record<string, unknown>>;
export function draftTerm(bundle, opts: { word: string; context: string | null }): Promise<Record<string, unknown>>;
```
- Prompts come from `content.prompts.teaching` / `.research` (pass `ContentJson` via the bundle: `bundle.json.prompts`).
- Use `sample.json(...)` with the instruction + context in a leading user turn and the output shape
  described in words with an example (the JSON schemas in tutor.py: CHAT_SCHEMA, EXPLAIN_SCHEMA,
  GRADE_SCHEMA, TERM_SCHEMA). Validate/coerce every field you rely on.
- The `calculate` tool: pass `tools: [{ name: "calculate", description, inputSchema, execute }]` using
  `calculator.ts` when `(await sample.limits()).tools` is present; otherwise no tools. Calls with tools
  must not pass `cache`; chat passes `cache: false`.
- Map sample error codes to AIError/AIUnavailable/AIRefusal with plain learner-facing messages
  (`not_granted`/`sampling_disabled`/... -> AIUnavailable, `refused` -> AIRefusal, `rate_limited` ->
  "Claude is busy - try again in a minute.", etc.). Never retry automatically.
- `aiStatus()`: configured iff `claude.use("sample")` resolved non-null; provider "claude";
  model null (the platform chooses); reason in plain words when not configured.

### Standalone build + integration (agent: build)
`frontend/standalone/` - esbuild bundle of the existing pages into one HTML file, shims for
`next/link` and `next/navigation`, an in-page router, Tailwind + KaTeX CSS inlined, `content.json`
inlined, and the transport switch in `src/lib/api.ts` (when `globalThis.__MU_LOCAL__` is set, call
`server.handle()` instead of `fetch`). See that agent's brief.

## Rules for every agent
- Only create or edit the files you own (listed above). If you need a change in someone else's file,
  say so in your final report instead of editing it.
- Do not commit, push, or run `npm install` for new packages unless your brief allows it.
- `npx tsc --noEmit` and `npx eslint <your files>` must pass for your files; your tests must pass.
- Plain, learner-facing wording must match the Python backend's wording.
