/**
 * The in-browser API, end to end: a port of backend/tests/test_api.py and of the API parts of
 * backend/tests/test_ai.py (with a scripted fake in place of the AI module), plus persistence,
 * backup round trips and HTTP behaviour (routing, validation, errors).
 */
import { describe, expect, it } from "vitest";
import content from "../../standalone/content.json";
import { Fraction } from "./fraction";
import { LocalHttpError, createServer, pyRound, type LocalServer, type ServerOptions } from "./server";
import { Store, emptyLearnerData, normaliseLearnerData, parseDateTime, uuidHex, type AttemptRow, type LearnerRecord, type WonderingRow } from "./store";
import { Random } from "./rng";
import type { ContentBundle, ContentJson, LearnerData, Persistence, PersistenceStatus, Q } from "./types";

const CONTENT = content as unknown as ContentJson;
type Json = Record<string, unknown>;
// Response bodies are read field by field, like the Python tests read r.json().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------------------------------------------------------------- fakes

/** Persistence that keeps the record in memory (serialised, as real storage would). */
class MemoryPersistence implements Persistence {
  readonly mode = "memory" as const;
  saved: LearnerData | null;
  saves = 0;
  constructor(initial: LearnerData | null = null) {
    this.saved = initial && clone(initial);
  }
  async load(): Promise<LearnerData | null> {
    return this.saved && clone(this.saved);
  }
  save(data: LearnerData): void {
    this.saves += 1;
    this.saved = clone(data);
  }
  async flush(): Promise<void> {}
  async clear(): Promise<void> {
    this.saved = null;
  }
  status(): PersistenceStatus {
    return { mode: "memory", saving: false, error: null };
  }
  onStatus(): () => void {
    return () => undefined;
  }
}

class AIError extends Error {}
class AIUnavailable extends AIError {}
class AIRefusal extends AIError {}

const KINDS = [
  "definition", "established-fact", "proven-theorem", "conjecture", "computational-observation", "hypothesis", "speculation",
  "disproved-claim", "unverified-proof", "formally-verified-proof", "convention",
];

/** tutor.py sanitize_links */
function sanitizeLinks(text: string, bundle: ContentBundle): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m: string, target: string, label?: string) => {
    const t = target.trim();
    const ok = t.startsWith("lesson:") ? t.slice("lesson:".length) in bundle.nodes : t in bundle.terms;
    return ok ? m : label ? label : t.replace(/^lesson:/, "");
  });
}

/** tutor.py clean_reply */
function cleanReply(data: Json, bundle: ContentBundle): Json {
  const out: Json = { ...data };
  for (const key of ["reply", "explanation", "check_question", "feedback", "title"]) {
    if (typeof out[key] === "string") out[key] = sanitizeLinks(out[key] as string, bundle);
  }
  if ("missing_prerequisites" in out) out.missing_prerequisites = (out.missing_prerequisites as string[]).filter((p) => p in bundle.nodes).slice(0, 6);
  if ("statements" in out) out.statements = (out.statements as Json[]).filter((s) => KINDS.includes(s.kind as string)).slice(0, 10);
  return out;
}

type Call = { fn: string; args: Body };

/**
 * A stand-in for src/local/ai.ts with the same exports. Replies come from `script` in order (an
 * Error in the script is thrown instead); like the real module, replies are cleaned and carry the
 * model name. Every call is recorded.
 */
function fakeAi(opts: { script?: unknown[]; configured?: boolean; reason?: string } = {}) {
  const calls: Call[] = [];
  const queue = [...(opts.script ?? [])];
  const configured = opts.configured ?? true;
  const next = (): Json => {
    if (!configured) throw new AIUnavailable("The AI tutor is not available here.");
    const item = queue.shift();
    if (item === undefined) throw new Error("fake AI: no scripted reply left");
    if (item instanceof Error) throw item;
    return clone(item) as Json;
  };
  const fake = {
    AIError,
    AIUnavailable,
    AIRefusal,
    async aiStatus() {
      return configured
        ? { configured: true, provider: "fake", model: "fake-model", reason: null }
        : { configured: false, provider: "claude", model: null, reason: opts.reason ?? "AI disabled for this session." };
    },
    learnerContext(_bundle: ContentBundle, states: Record<string, string>, o: Json = {}) {
      calls.push({ fn: "learnerContext", args: { states: { ...states }, ...o } });
      return `learner context for ${String(o.lessonId ?? "-")} / ${String(o.section ?? "-")}`;
    },
    stableContext: () => "stable context",
    sanitizeLinks,
    cleanReply,
    async chat(bundle: ContentBundle, o: Json) {
      calls.push({ fn: "chat", args: clone(o) });
      return [cleanReply(next(), bundle), { model: "fake-model", tool_calls: [{ name: "calculate", input: { expression: "1+1" }, output: "2", error: false }] }];
    },
    async explainDifferently(bundle: ContentBundle, o: Json) {
      calls.push({ fn: "explainDifferently", args: clone(o) });
      return { ...cleanReply(next(), bundle), model: "fake-model" };
    },
    async gradeExplanation(bundle: ContentBundle, o: { question: Q; answerText: string }) {
      calls.push({ fn: "gradeExplanation", args: clone(o) });
      const data = cleanReply(next(), bundle);
      const n = o.question.rubric.length;
      const met = ((data.rubric_met as unknown[]) ?? []).map(Boolean).slice(0, n);
      while (met.length < n) met.push(false);
      return { ...data, rubric_met: met, model: "fake-model" };
    },
    async draftTerm(bundle: ContentBundle, o: Json) {
      calls.push({ fn: "draftTerm", args: clone(o) });
      return { ...cleanReply(next(), bundle), model: "fake-model" };
    },
  };
  return { module: fake as unknown as ServerOptions["ai"], calls, count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}
type FakeAi = ReturnType<typeof fakeAi>;

// ---------------------------------------------------------------- a test client (FastAPI's TestClient)

type Res = { status: number; body: Body };

class Client {
  constructor(
    readonly server: LocalServer,
    readonly persistence: MemoryPersistence,
    readonly ai: FakeAi,
  ) {}
  async call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Res> {
    try {
      const out = await this.server.handle(method, path, body);
      return { status: out === undefined ? 204 : 200, body: out };
    } catch (e) {
      if (e instanceof LocalHttpError) return { status: e.status, body: { detail: e.detail } };
      throw e;
    }
  }
  get = (path: string) => this.call("GET", path);
  post = (path: string, body?: unknown) => this.call("POST", path, body);
  patch = (path: string, body: unknown) => this.call("PATCH", path, body);
  del = (path: string) => this.call("DELETE", path);
  /** The learner record as last saved through persistence. */
  data(): LearnerRecord {
    return (this.persistence.saved ?? {}) as LearnerRecord;
  }
}

const T0 = Date.parse("2026-11-02T09:00:00.000Z");
/** A clock that moves one second every time it is read. */
function ticking(start = T0, stepMs = 1000): () => Date {
  let t = start;
  return () => new Date((t += stepMs));
}

async function makeClient(o: { ai?: FakeAi; persistence?: MemoryPersistence; seed?: number | string; now?: () => Date } = {}) {
  const persistence = o.persistence ?? new MemoryPersistence();
  const ai = o.ai ?? fakeAi({ configured: false });
  const server = await createServer({ content: CONTENT, persistence, ai: ai.module, now: o.now ?? ticking(), seed: o.seed ?? 1 });
  return new Client(server, persistence, ai);
}

/** The attempt's questions with their answers (test_api.py `_private_questions`). */
function privateQuestions(c: Client, attemptId: string): Q[] {
  const a = c.data().assessment_attempts.find((x: AttemptRow) => x.id === attemptId);
  if (!a) throw new Error(`attempt ${attemptId} was not saved`);
  return a.questions;
}

/** conftest.py correct_answer */
function correctAnswer(q: Q): Json {
  switch (q.type) {
    case "choice":
      return { selected: q.options.filter((o: Json) => o.correct).map((o: Json) => o.id) };
    case "number":
      return { value: Fraction.parse(q.answer)!.toString() };
    case "text":
      return { value: q.accept[0] };
    case "truefalse":
      return { value: q.answer };
    case "order":
      return { order: q.items };
    case "explain":
      return { text: "My explanation in my own words.", self_check: q.rubric.map((_: string, i: number) => i) };
  }
  throw new Error(q.type);
}

/** conftest.py wrong_answer */
function wrongAnswer(q: Q): Json {
  switch (q.type) {
    case "choice": {
      const wrong = q.options.filter((o: Json) => !o.correct).map((o: Json) => o.id);
      if (wrong.length) return { selected: wrong.slice(0, 1) };
      // Every option is correct (e.g. "which families does 7 belong to?"): missing one is wrong.
      const right = q.options.filter((o: Json) => o.correct).map((o: Json) => o.id);
      expect(q.multi && right.length > 1).toBe(true);
      return { selected: right.slice(0, 1) };
    }
    case "number":
      return q.common_wrong?.length ? { value: q.common_wrong[0].answer } : { value: Fraction.parse(q.answer)!.add(1000).toString() };
    case "text":
      return { value: "definitely not the answer" };
    case "truefalse":
      return { value: !q.answer };
    case "order":
      return { order: [...q.items].reverse() };
    case "explain":
      return { text: "I am not sure.", self_check: [] };
  }
  throw new Error(q.type);
}

/** test_api.py `_complete` */
async function complete(c: Client, lessonId: string, { correctly = true, mode = "lesson" } = {}): Promise<Body> {
  const a = (await c.post(`/lessons/${lessonId}/assessment`, { mode })).body;
  for (const q of privateQuestions(c, a.id)) {
    const payload = correctly ? correctAnswer(q) : wrongAnswer(q);
    const r = await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: payload });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.valid, JSON.stringify(r.body)).toBe(true);
    expect(r.body.correct, JSON.stringify([q, r.body])).toBe(correctly);
    if (!correctly && !r.body.done) {
      // second (also wrong) try
      const r2 = await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: payload });
      expect(r2.body.done).toBe(true);
    }
  }
  return (await c.post(`/attempts/${a.id}/finish`)).body;
}

/** Every key anywhere inside a JSON value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ================================================================ backend/tests/test_api.py

describe("the API (test_api.py)", () => {
  it("reports health and the curriculum", async () => {
    const c = await makeClient();
    const h = (await c.get("/health")).body;
    expect(h.ok).toBe(true);
    expect(h.lessons_available).toBeGreaterThanOrEqual(41);
    expect(h).toEqual({ ok: true, lessons_available: 41, lessons_planned: 338, terms: 60, version: "0.1.0" });
    const cur = (await c.get("/curriculum")).body;
    const stageIds = new Set(cur.stages.map((s: Body) => s.id));
    for (const s of ["L0", "L1", "L12", "PA", "PB"]) expect(stageIds.has(s)).toBe(true);
    const first = cur.lessons.find((l: Body) => l.id === "l0-what-is-mathematics");
    expect(first.available).toBe(true);
    expect(new Set(first.feeds)).toEqual(new Set(["pnp", "rh"]));
  });

  it("hides the answers in the lesson payload", async () => {
    const c = await makeClient();
    const r = await c.get("/lessons/l1-fractions");
    expect(r.status).toBe(200);
    expect(r.body.lesson.assessment).toEqual({ pass_score: 0.7, question_count: 5 });
    expect("questions" in r.body.lesson.assessment).toBe(false);
    expect(r.body.readiness.ready).toBe(false);
  });

  it("reports a planned lesson honestly", async () => {
    const c = await makeClient();
    const r = await c.get("/lessons/pb-critical-line");
    expect(r.status).toBe(404);
    expect(r.body.detail).toContain("planned");
  });

  it("introduces a lesson when it is opened and adds its words", async () => {
    const c = await makeClient();
    const r = (await c.post("/lessons/l0-what-is-mathematics/open")).body;
    expect(r.state.state).toBe("introduced");
    expect(r.new_terms).toContain("mathematics");
    const terms = Object.fromEntries((await c.get("/dictionary")).body.map((t: Body) => [t.id, t]));
    expect(terms.mathematics.seen).toBe(true);
    expect(terms.mathematics.learned).toBe(false);
  });

  it("runs a full assessment, updating mastery and history", async () => {
    const c = await makeClient();
    await c.post("/lessons/l0-what-is-mathematics/open");
    const summary = await complete(c, "l0-what-is-mathematics");
    expect(summary.passed).toBe(true);
    expect(summary.score).toBe(1.0);
    expect(summary.state_after).toBe("understood");
    expect(summary.next[0].id).toBe("l0-why-mathematics");
    expect(summary.learned_terms).toContain("mathematics");

    const prog = (await c.get("/progress")).body;
    expect(prog.states["l0-what-is-mathematics"].state).toBe("understood");
    expect(prog.next[0]).toBe("l0-why-mathematics");
    expect(prog.vocabulary.learned).toBeGreaterThanOrEqual(1);
    expect(prog.assessments_passed).toBe(1);

    const types = (await c.get("/history")).body.map((e: Body) => e.type);
    for (const t of ["lesson_opened", "assessment_started", "question_answered", "assessment_finished", "state_changed"]) {
      expect(types).toContain(t);
    }
  });

  it("records mistakes and offers revisits when an assessment is failed", async () => {
    const c = await makeClient();
    const summary = await complete(c, "l1-fractions", { correctly: false });
    expect(summary.passed).toBe(false);
    expect(summary.state_after).toBe("introduced");
    const mistakes = (await c.get("/progress/mistakes")).body;
    expect(mistakes.length).toBeGreaterThan(0);
    expect(mistakes.every((m: Body) => m.diagnosis)).toBe(true);
  });

  it("flags previously understood prerequisites when a later assessment is failed", async () => {
    for (const seed of [1, 2, 3]) {
      const c = await makeClient({ seed });
      // The learner has understood numerators and denominators...
      expect((await complete(c, "l1-numerators-denominators")).state_after).toBe("understood");
      // ...then, in the fractions assessment, writes a fraction upside down (a diagnosed mistake that
      // points back to numerators and denominators) and fails overall.
      const summary = await complete(c, "l1-fractions", { correctly: false });
      expect(summary.passed).toBe(false);
      expect(summary.revisit.map((n: Body) => n.id)).toContain("l1-numerators-denominators");
      const prog = (await c.get("/progress")).body;
      const st = prog.states["l1-numerators-denominators"];
      expect(st.state).toBe("needs_revision");
      expect(st.revision_reason).toContain("Fractions");
      expect(prog.revision.some((r: Body) => r.lesson_id === "l1-numerators-denominators")).toBe(true);
    }
  });

  it("refuses an answer to a question that is already finished", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l0-counting/assessment", {})).body;
    const q = privateQuestions(c, a.id)[0];
    await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: correctAnswer(q) });
    const r = await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: correctAnswer(q) });
    expect(r.status).toBe(409);
    expect(r.body.detail).toBe("This question is already finished.");
  });

  it("does not use up a try on an answer it cannot read", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l1-fractions/assessment", {})).body;
    const q = privateQuestions(c, a.id).find((x) => x.type === "number")!;
    let r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { value: "banana" } })).body;
    expect(r.valid).toBe(false);
    expect(r.message).toBeTruthy();
    r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: correctAnswer(q) })).body;
    expect(r.correct).toBe(true);
    expect(r.credit).toBe(1.0);
  });

  it("gives half credit and a hint on the second try", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l0-patterns/assessment", {})).body;
    const q = privateQuestions(c, a.id).find((x) => x.id === "triangle-next")!;
    const r1 = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { value: "20" } })).body;
    expect(r1.correct).toBe(false);
    expect(r1.diagnosis).toBeTruthy();
    expect(r1.hint).toBeTruthy();
    expect(r1.tries_left).toBe(1);
    expect(r1.reveal).toBeNull(); // nothing is revealed while the question is open
    const r2 = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { value: "21" } })).body;
    expect(r2.correct).toBe(true);
    expect(r2.credit).toBe(0.5);
    expect(r2.reveal.answer).toBe("21");
  });

  it("lets the learner assess their own explanation when there is no AI", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l0-counting/assessment", {})).body;
    const q = privateQuestions(c, a.id).find((x) => x.type === "explain")!;
    let r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { text: "One word per thing." } })).body;
    expect(r.valid).toBe(false);
    expect(r.reveal.rubric).toEqual(q.rubric);
    r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { text: "One word per thing.", self_check: [0, 1] } })).body;
    expect(r.valid).toBe(true);
    expect(r.graded_by).toBe("self");
    expect(r.correct).toBe(true);
  });

  it("marks a concept understood when the learner tests out", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l0-quantity/assessment", { mode: "test_out" })).body;
    for (const q of privateQuestions(c, a.id)) await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: correctAnswer(q) });
    const s = (await c.post(`/attempts/${a.id}/finish`)).body;
    expect(s.passed).toBe(true);
    const st = (await c.get("/progress")).body.states["l0-quantity"];
    expect(st.state).toBe("understood");
    expect(st.tested_out).toBe(true);
  });

  it("cycles through the authored explanations, then stops", async () => {
    const c = await makeClient();
    const seen: string[] = [];
    const lesson = (await c.get("/lessons/l0-counting")).body.lesson;
    const expected = lesson.alternatives.map((a: Body) => a.strategy).filter((s: string) => s !== lesson.analogy.strategy);
    for (const strat of expected) {
      const r = (await c.post("/lessons/l0-counting/explain-differently", { section: "plain", seen })).body;
      expect(r.source).toBe("authored");
      expect(r.strategy).toBe(strat);
      expect(seen).not.toContain(r.strategy);
      seen.push(r.strategy);
    }
    const r = (await c.post("/lessons/l0-counting/explain-differently", { section: "plain", seen })).body;
    expect(r.source).toBe("none");
    expect(r.message).toBeTruthy();
  });

  it("runs endless practice", async () => {
    const c = await makeClient();
    const gens = (await c.get("/practice/generators")).body;
    expect(gens.some((g: Body) => g.id === "gcd")).toBe(true);
    const p = (await c.post("/practice/gcd", {})).body;
    expect(p.question.type).toBe("number");
    const r = (await c.post(`/practice/items/${p.id}/answer`, { answer: { value: "999999" } })).body;
    expect(r.valid).toBe(true);
    expect(r.correct).toBe(false);
  });

  it("keeps wonderings", async () => {
    const c = await makeClient();
    let w = (await c.post("/wonderings", { text: "Why are there infinitely many primes?", lesson_id: "l1-prime-numbers" })).body;
    expect(w.status).toBe("open");
    w = (await c.patch(`/wonderings/${w.id}`, { status: "exploring" })).body;
    expect(w.status).toBe("exploring");
    expect((await c.get("/wonderings")).body).toHaveLength(1);
  });

  it("exports, resets and imports", async () => {
    const c = await makeClient();
    await complete(c, "l0-what-is-mathematics");
    const backup = (await c.get("/progress/export")).body;
    expect(backup.format).toBe("mathematical-universe-backup");
    expect((await c.post("/progress/reset", { confirm: "nope" })).status).toBe(400);
    expect((await c.post("/progress/reset", { confirm: "RESET" })).status).toBe(204);
    expect((await c.get("/progress")).body.states).toEqual({});
    expect((await c.post("/progress/import", backup)).status).toBe(204);
    expect((await c.get("/progress")).body.states["l0-what-is-mathematics"].state).toBe("understood");
  });

  it("keeps progress across restarts", async () => {
    const persistence = new MemoryPersistence();
    const c1 = await makeClient({ persistence });
    await c1.post("/lessons/l0-counting/open");
    const c2 = await makeClient({ persistence });
    expect((await c2.get("/progress")).body.states["l0-counting"].state).toBe("introduced");
  });

  it("shows dictionary entries and counts lookups", async () => {
    const c = await makeClient();
    const t = (await c.get("/dictionary/prime-number")).body;
    expect(t.term.non_example).toBeTruthy();
    expect(t.introduced_in.id).toBe("l1-prime-numbers");
    const r = (await c.post("/dictionary/prime-number/viewed")).body;
    expect(r.lookups).toBe(1);
    expect(r.seen).toBe(true);
    expect((await c.get("/dictionary/no-such-word")).status).toBe(404);
  });

  it("reports the tutor unavailable without AI", async () => {
    const c = await makeClient({ ai: fakeAi({ configured: false, reason: "Claude is not available in this view." }) });
    const status = (await c.get("/ai/status")).body;
    expect(status.configured).toBe(false);
    const th = (await c.post("/tutor/threads", { lesson_id: "l1-fractions" })).body;
    const r = await c.post(`/tutor/threads/${th.id}/messages`, { content: "What is a fraction?" });
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe("Claude is not available in this view.");
    expect((await c.post("/dictionary/draft", { word: "bijection" })).status).toBe(503);
    expect(c.ai.calls.filter((x) => x.fn !== "learnerContext")).toEqual([]);
  });
});

// ================================================================ backend/tests/test_ai.py (the API parts)

const CHAT_REPLY = {
  reply: "A [[fraction|fraction]] is part of a whole. See [[no-such-term|this]] and [[lesson:l1-fractions|the lesson]].",
  strategy: "everyday-analogy",
  check_question: "What does the bottom number tell you?",
  missing_prerequisites: ["l1-equal-quantities", "not-a-lesson"],
  new_terms: [],
  statements: [
    { kind: "definition", text: "A fraction is a/b with b not zero." },
    { kind: "bogus", text: "x" },
  ],
};

async function attemptWithExplain(c: Client, lessonId = "l0-counting") {
  const a = (await c.post(`/lessons/${lessonId}/assessment`, {})).body;
  return { a, q: privateQuestions(c, a.id).find((x) => x.type === "explain")! };
}

describe("the AI routes (test_ai.py)", () => {
  it("stores the conversation and sanitises the tutor's output", async () => {
    const ai = fakeAi({ script: [CHAT_REPLY] });
    const c = await makeClient({ ai });
    await c.post("/lessons/l0-what-is-mathematics/open");
    const th = (await c.post("/tutor/threads", { lesson_id: "l1-fractions" })).body;
    const r = await c.post(`/tutor/threads/${th.id}/messages`, { content: "What is a fraction?", section: "plain" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const m = r.body;
    expect(m.content).toContain("[[fraction|fraction]]");
    expect(m.content).not.toContain("no-such-term");
    expect(m.content).toContain("this");
    expect(m.missing_prerequisites.map((p: Body) => p.id)).toEqual(["l1-equal-quantities"]);
    expect(m.statements.map((s: Body) => s.kind)).toEqual(["definition"]);
    expect(m).toMatchObject({ role: "assistant", strategy: "everyday-analogy", check_question: "What does the bottom number tell you?", new_terms: [], error: null });
    expect(m.tool_calls).toEqual([{ name: "calculate", input: { expression: "1+1" }, output: "2", error: false }]);

    // What the tutor was given: the learner's state, the current lesson and section, the words they know.
    const ctx = ai.calls.find((x) => x.fn === "learnerContext")!.args;
    expect(ctx).toMatchObject({ lessonId: "l1-fractions", section: "plain", states: { "l0-what-is-mathematics": "introduced" } });
    expect(ctx.knownTerms).toContain("mathematics");
    expect(ctx.mistakes).toEqual([]);
    const chat = ai.calls.find((x) => x.fn === "chat")!.args;
    expect(chat).toEqual({ mode: "teaching", learner: "learner context for l1-fractions / plain", history: [], userText: "What is a fraction?" });

    const thread = (await c.get(`/tutor/threads/${th.id}`)).body;
    expect(thread.messages.map((x: Body) => x.role)).toEqual(["user", "assistant"]);
    expect(thread.title).toBe("About: Fractions");
    expect(thread.message_count).toBe(2);
    expect(thread.messages[0]).toMatchObject({ content: "What is a fraction?", strategy: null, missing_prerequisites: [], statements: [], tool_calls: [] });
    const events = (await c.get("/history")).body;
    expect(events[0]).toMatchObject({ type: "tutor_message", lesson_id: "l1-fractions", data: { thread: th.id, strategy: "everyday-analogy", mode: "teaching" } });
  });

  it("replays the history as plain text", async () => {
    const ai = fakeAi({ script: [CHAT_REPLY, CHAT_REPLY] });
    const c = await makeClient({ ai });
    const th = (await c.post("/tutor/threads", {})).body;
    expect(th.title).toBe("New conversation");
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "first" });
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "second" });
    const second = ai.calls.filter((x) => x.fn === "chat")[1].args;
    expect(second.history.map((m: Body) => m.role)).toEqual(["user", "assistant"]);
    expect(second.history.every((m: Body) => typeof m.content === "string")).toBe(true);
    expect(second.userText).toBe("second");
    expect((await c.get(`/tutor/threads/${th.id}`)).body.title).toBe("first");
  });

  it("uses research mode for research threads", async () => {
    const ai = fakeAi({ script: [CHAT_REPLY] });
    const c = await makeClient({ ai });
    const th = (await c.post("/tutor/threads", { mode: "research" })).body;
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "Is there a pattern in prime gaps?" });
    expect(ai.calls.find((x) => x.fn === "chat")!.args.mode).toBe("research");
    expect(CONTENT.prompts.research).toContain("research collaborator");
  });

  it("falls back to the AI after the authored explanations", async () => {
    const ai = fakeAi({ script: [{ strategy: "story", title: "A new story", explanation: "Once upon a time...", check_question: "Why?" }] });
    const c = await makeClient({ ai });
    const lesson = (await c.get("/lessons/l0-counting")).body.lesson;
    const seen = lesson.alternatives.map((a: Body) => a.strategy);
    const r = (await c.post("/lessons/l0-counting/explain-differently", { seen })).body;
    expect(r).toEqual({
      source: "ai", strategy: "story", title: "A new story", text: "Once upon a time...", visual: null, check_question: "Why?",
      remaining_authored: 0, ai_available: true, message: null,
    });
    const asked = ai.calls.find((x) => x.fn === "explainDifferently")!.args;
    for (const s of seen) expect(asked.tried).toContain(s); // the AI is told which strategies already failed
    expect(asked.tried).toEqual([...new Set([...seen, lesson.analogy.strategy])].sort());
    expect(asked).toMatchObject({ lessonId: "l0-counting", section: null });
    expect((await c.get("/history")).body[0]).toMatchObject({ type: "dont_understand", data: { section: null, strategy: "story", source: "ai" } });
  });

  it("offers authored explanations first even when the AI is available", async () => {
    const ai = fakeAi({ script: [] });
    const c = await makeClient({ ai });
    const r = (await c.post("/lessons/l0-counting/explain-differently", { section: "plain", seen: [] })).body;
    expect(r.source).toBe("authored");
    expect(r.ai_available).toBe(true);
    expect(ai.count("explainDifferently")).toBe(0);
    // use_ai skips straight to the AI
    const failing = fakeAi({ script: [new AIError("Claude is busy - try again in a minute.")] });
    const c2 = await makeClient({ ai: failing });
    const r2 = await c2.post("/lessons/l0-counting/explain-differently", { use_ai: true });
    expect(r2).toEqual({ status: 502, body: { detail: "Claude is busy - try again in a minute." } });
    expect((await c2.get("/history")).body).toEqual([]); // nothing recorded for a failed AI call
  });

  it("grades explanations with the AI", async () => {
    const ai = fakeAi({ script: [{ rubric_met: [true, true, false], feedback: "Good start.", misconception: "" }] });
    const c = await makeClient({ ai });
    const { a, q } = await attemptWithExplain(c);
    const r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { text: "Each thing gets one word." } })).body;
    expect(r.graded_by).toBe("ai");
    expect(r.rubric_met).toEqual([true, true, false]);
    expect(r.feedback).toBe("Good start.");
    expect(r.correct).toBe(true);
    expect(Math.abs(r.credit - 0.667)).toBeLessThan(0.01);
    expect(r.credit).toBe(0.667);
    expect(r.diagnosis).toBeNull();
    expect(r.done).toBe(true);
    expect(r.reveal.rubric).toEqual(q.rubric);
    expect(ai.calls.find((x) => x.fn === "gradeExplanation")!.args).toEqual({ question: q, answerText: "Each thing gets one word." });
  });

  it("falls back to self-assessment when AI grading fails", async () => {
    const ai = fakeAi({ script: [new AIRefusal("The model declined to answer this request.")] });
    const c = await makeClient({ ai });
    const { a, q } = await attemptWithExplain(c);
    const r = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { text: "Each thing gets one word." } })).body;
    expect(r).toEqual({
      valid: false, correct: false, credit: 0, try_number: 1, tries_left: 1, done: false,
      message: "AI grading is unavailable (The model declined to answer this request.). Compare your answer with the key ideas and tick the ones you included.",
      diagnosis: null, revisit: null, hint: null, reveal: { rubric: q.rubric }, graded_by: "rule", feedback: null, rubric_met: null,
    });
    const ok = (await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { text: "Each thing gets one word.", self_check: [0, 1, 2] } })).body;
    expect(ok).toMatchObject({ valid: true, correct: true, credit: 1, graded_by: "self", try_number: 1, done: true });
  });

  it("drafts dictionary entries, once per word", async () => {
    const entry = {
      word: "bijection", pronunciation: "by-JEK-shun", plain: "a perfect pairing", analogy: "dance partners", visual_description: "lines pairing dots",
      formal: "a function that is one-to-one and onto", example: "x maps to x+1 on integers", non_example: "squaring on integers", related: ["function"],
      used_later: "counting arguments", is_mathematical_term: true,
    };
    const ai = fakeAi({ script: [entry] });
    const c = await makeClient({ ai });
    const r = (await c.post("/dictionary/draft", { word: "Bijection" })).body;
    expect(r.id).toBe("ai-bijection");
    expect(r.entry.formal.startsWith("a function")).toBe(true);
    expect(r.word).toBe("bijection");
    expect(r.model).toBe("fake-model");
    expect("model" in r.entry).toBe(false);
    // cached: no second model call needed
    expect((await c.post("/dictionary/draft", { word: "bijection" })).body.id).toBe("ai-bijection");
    expect(ai.count("draftTerm")).toBe(1);
    expect((await c.get("/dictionary/drafts")).body).toHaveLength(1);
    expect((await c.get("/history")).body[0]).toMatchObject({ type: "term_drafted", term_id: "ai-bijection", data: { word: "bijection" } });
  });

  it("turns AI errors into 502 and saves nothing", async () => {
    const ai = fakeAi({ script: [new AIError("Claude is busy - try again in a minute."), new AIError("Too long."), CHAT_REPLY] });
    const c = await makeClient({ ai });
    const th = (await c.post("/tutor/threads", {})).body;
    const saves = c.persistence.saves;
    const r = await c.post(`/tutor/threads/${th.id}/messages`, { content: "Hello?" });
    expect(r).toEqual({ status: 502, body: { detail: "Claude is busy - try again in a minute." } });
    expect((await c.post("/dictionary/draft", { word: "monoid" })).status).toBe(502);
    expect(c.persistence.saves).toBe(saves);
    const thread = (await c.get(`/tutor/threads/${th.id}`)).body;
    expect(thread.messages).toEqual([]);
    expect(thread.title).toBe("New conversation");
    expect((await c.get("/dictionary/drafts")).body).toEqual([]);
    // the next message works
    expect((await c.post(`/tutor/threads/${th.id}/messages`, { content: "Hello?" })).status).toBe(200);
    expect((await c.get(`/tutor/threads/${th.id}`)).body.title).toBe("Hello?");
  });

  it("reports a bug in the AI module as a 500, not as the tutor's words", async () => {
    const ai = fakeAi({ script: [new TypeError("x is undefined")] });
    const c = await makeClient({ ai });
    const th = (await c.post("/tutor/threads", {})).body;
    const r = await c.post(`/tutor/threads/${th.id}/messages`, { content: "Hello?" });
    expect(r).toEqual({ status: 500, body: { detail: "Internal Server Error" } });
  });

  it("uses the lesson the learner is on, ignoring unknown lessons", async () => {
    const ai = fakeAi({ script: [CHAT_REPLY, CHAT_REPLY] });
    const c = await makeClient({ ai });
    const th = (await c.post("/tutor/threads", { lesson_id: "l1-fractions" })).body;
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "a", lesson_id: "l0-counting", section: "word" });
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "b", lesson_id: "no-such-lesson" });
    const ctx = ai.calls.filter((x) => x.fn === "learnerContext").map((x) => [x.args.lessonId, x.args.section]);
    expect(ctx).toEqual([["l0-counting", "word"], [null, null]]);
    const user = c.data().chat_messages.filter((m) => m.role === "user").map((m) => m.context);
    expect(user).toEqual([{ lesson_id: "l0-counting", section: "word" }, { lesson_id: null, section: null }]);
  });
});

// ================================================================ persistence and backups

describe("persistence and backups", () => {
  it("saves after every change, and never for a read", async () => {
    const c = await makeClient();
    expect(c.persistence.saves).toBe(0);
    for (const p of ["/health", "/curriculum", "/progress", "/lessons/l0-counting", "/dictionary", "/history", "/progress/export", "/wonderings"]) {
      expect((await c.get(p)).status).toBe(200);
    }
    expect(c.persistence.saves).toBe(0);
    await c.post("/lessons/l0-counting/open");
    expect(c.persistence.saves).toBe(1); // one save per request
    await c.post("/dictionary/fraction/viewed");
    await c.post("/wonderings", { text: "Is zero even?" });
    expect(c.persistence.saves).toBe(3);
    await c.post("/lessons/l0-counting/open"); // still an event
    expect(c.persistence.saves).toBe(4);
    await c.post("/progress/reset", { confirm: "nope" });
    expect(c.persistence.saves).toBe(4);
  });

  it("starts empty for a new learner", async () => {
    const c = await makeClient();
    const prog = (await c.get("/progress")).body;
    expect(prog.states).toEqual({});
    expect(prog.counts).toEqual({ introduced: 0, understood: 0, mastered: 0, needs_revision: 0, not_started: 379, available: 41, total: 379 });
    expect(prog.last_lesson).toBeNull();
    expect((await c.get("/progress/export")).body).toEqual({
      format: "mathematical-universe-backup", version: 1,
      tables: {
        concept_states: [], learning_events: [], assessment_attempts: [], question_responses: [], term_states: [], exercise_completions: [],
        practice_items: [], chat_threads: [], chat_messages: [], generated_terms: [], wonderings: [],
      },
    });
  });

  it("keeps the record in plain JSON tables mirroring models.py", async () => {
    const c = await makeClient();
    await complete(c, "l0-counting", { correctly: false });
    await c.post("/practice/gcd", {});
    await c.post("/wonderings", { text: "Why?" });
    const data = c.data();
    expect(Object.keys(data)).toEqual([
      "schema", "concept_states", "learning_events", "assessment_attempts", "question_responses", "term_states", "exercise_completions",
      "practice_items", "chat_threads", "chat_messages", "generated_terms", "wonderings",
    ]);
    expect(data.schema).toBe(1);
    for (const [k, v] of Object.entries(data)) if (k !== "schema") expect(Array.isArray(v), k).toBe(true);
    expect(Object.keys(data.concept_states[0])).toEqual([
      "lesson_id", "state", "first_seen_at", "updated_at", "last_passed_at", "pass_count", "attempt_count", "best_score", "last_score",
      "revision_reason", "tested_out",
    ]);
    expect(data.assessment_attempts[0].id).toMatch(/^[0-9a-f]{32}$/);
    expect(data.practice_items[0].id).toMatch(/^[0-9a-f]{32}$/);
    expect(data.learning_events.map((e) => e.id)).toEqual(data.learning_events.map((_, i) => i + 1));
    expect(data.question_responses[0].id).toBe(1);
    expect(data.learning_events[0].created_at).toMatch(ISO_UTC);
  });

  it("gives the same answers after reloading what it saved", async () => {
    const persistence = new MemoryPersistence();
    const c1 = await makeClient({ persistence });
    await c1.post("/lessons/l0-what-is-mathematics/open");
    await complete(c1, "l0-what-is-mathematics");
    await complete(c1, "l1-numerators-denominators");
    await complete(c1, "l1-fractions", { correctly: false });
    await c1.post("/dictionary/prime-number/viewed");
    await c1.post("/wonderings", { text: "Is 1 prime?" });
    await c1.post("/lessons/l0-counting/events", { type: "experiment_completed", data: { n: 3 } });
    const before = await Promise.all(["/progress", "/history?limit=1000", "/progress/mistakes", "/dictionary", "/wonderings", "/progress/export", "/lessons/l1-fractions"].map((p) => c1.get(p)));
    const c2 = await makeClient({ persistence, now: ticking(T0 + 3600_000) });
    const after = await Promise.all(["/progress", "/history?limit=1000", "/progress/mistakes", "/dictionary", "/wonderings", "/progress/export", "/lessons/l1-fractions"].map((p) => c2.get(p)));
    expect(after).toEqual(before);
    expect(before[0].body.exercises_completed).toBe(1);
    // ...and carries on from there: new ids follow the old ones
    await c2.post("/wonderings", { text: "And 2?" });
    expect((await c2.get("/wonderings")).body.map((w: Body) => w.id)).toEqual([2, 1]);
  });

  it("round-trips export -> reset -> import exactly", async () => {
    const ai = fakeAi({ script: [CHAT_REPLY, { word: "monoid", plain: "a set with a way to combine" }] });
    const c = await makeClient({ ai });
    await complete(c, "l0-what-is-mathematics");
    await complete(c, "l0-counting", { correctly: false });
    await c.post("/lessons/l0-counting/events", { type: "experiment_completed", data: { found: 7 } });
    expect((await c.post("/dictionary/draft", { word: "Monoid", context: "in a book" })).status).toBe(200);
    const p = (await c.post("/practice/gcd", {})).body;
    await c.post(`/practice/items/${p.id}/answer`, { answer: { value: "1" } });
    const th = (await c.post("/tutor/threads", { lesson_id: "l1-fractions" })).body;
    await c.post(`/tutor/threads/${th.id}/messages`, { content: "What is a fraction?" });
    await c.post("/wonderings", { text: "Why?" });
    await c.post("/dictionary/fraction/viewed");
    const backup = (await c.get("/progress/export")).body;
    const progress = (await c.get("/progress")).body;
    for (const rows of Object.values(backup.tables) as Json[][]) expect(rows.length).toBeGreaterThan(0);
    expect((await c.post("/progress/reset", { confirm: "RESET" })).status).toBe(204);
    expect((await c.get("/history")).body).toEqual([]);
    expect((await c.get("/tutor/threads")).body).toEqual([]);
    expect((await c.post("/progress/import", clone(backup))).status).toBe(204);
    expect((await c.get("/progress/export")).body).toEqual(backup);
    expect((await c.get("/progress")).body).toEqual(progress);
    expect((await c.get(`/tutor/threads/${th.id}`)).body.messages).toHaveLength(2);
    // and the imported record is what gets saved
    expect(c.data().learning_events).toEqual(backup.tables.learning_events);
  });

  it("imports a backup written by the Python backend (naive datetimes, missing columns)", async () => {
    const c = await makeClient();
    const backup = {
      format: "mathematical-universe-backup",
      version: 1,
      tables: {
        concept_states: [{ lesson_id: "l0-counting", state: "understood", first_seen_at: "2026-11-01T10:07:47.298803", updated_at: "2026-11-01T10:07:47.298946+00:00", pass_count: 1, last_passed_at: "2026-11-01 10:08:00", best_score: 1.0, last_score: 1.0, extra: "ignored" }],
        learning_events: [
          { id: 7, created_at: "2026-11-01T10:07:47.307821", type: "lesson_opened", lesson_id: "l0-counting", term_id: null, data: {} },
          { created_at: "2026-11-01T10:07:48", type: "state_changed", lesson_id: "l0-counting", data: { from: "introduced", to: "understood" } },
        ],
        wonderings: [{ id: 3, text: "Why?", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" }],
        unknown_table: [{ a: 1 }],
      },
    };
    expect((await c.post("/progress/import", backup)).status).toBe(204);
    const st = (await c.get("/progress")).body.states["l0-counting"];
    expect(st).toEqual({
      lesson_id: "l0-counting", state: "understood", first_seen_at: "2026-11-01T10:07:47.298Z", updated_at: "2026-11-01T10:07:47.298Z",
      last_passed_at: "2026-11-01T10:08:00.000Z", pass_count: 1, attempt_count: 0, best_score: 1, last_score: 1, revision_reason: null, tested_out: false,
    });
    expect((await c.get("/history")).body.map((e: Body) => [e.id, e.type])).toEqual([[8, "state_changed"], [7, "lesson_opened"]]);
    expect((await c.get("/wonderings")).body[0]).toMatchObject({ id: 3, status: "open", note: null, lesson_id: null });
    expect((await c.get("/progress")).body.last_lesson).toBe("l0-counting");
  });

  it("refuses files that are not backups, and leaves the record alone when a backup is broken", async () => {
    const c = await makeClient();
    await c.post("/lessons/l0-counting/open");
    const before = (await c.get("/progress/export")).body;
    const saves = c.persistence.saves;
    expect(await c.post("/progress/import", { format: "something-else" })).toEqual({ status: 400, body: { detail: "This is not a Mathematical Universe backup file." } });
    expect(await c.post("/progress/import", [1])).toEqual({ status: 422, body: { detail: "Input should be a valid dictionary" } });
    const broken = [
      { format: "mathematical-universe-backup", tables: [] },
      { format: "mathematical-universe-backup", tables: { learning_events: {} } },
      { format: "mathematical-universe-backup", tables: { learning_events: [{ id: 1, data: {} }] } }, // no type
      { format: "mathematical-universe-backup", tables: { concept_states: [{ lesson_id: "x", updated_at: "yesterday" }] } },
      { format: "mathematical-universe-backup", tables: { concept_states: [{ lesson_id: "x" }, { lesson_id: "x" }] } },
      { format: "mathematical-universe-backup", tables: { chat_messages: [{ thread_id: "gone", role: "user", content: "hi" }] } },
    ];
    for (const b of broken) expect(await c.post("/progress/import", b), JSON.stringify(b)).toEqual({ status: 500, body: { detail: "Internal Server Error" } });
    expect((await c.get("/progress/export")).body).toEqual(before);
    expect(c.persistence.saves).toBe(saves);
    // an empty backup is fine: it erases everything
    expect((await c.post("/progress/import", { format: "mathematical-universe-backup" })).status).toBe(204);
    expect((await c.get("/progress")).body.states).toEqual({});
  });

  it("resets only when asked properly", async () => {
    const c = await makeClient();
    await c.post("/lessons/l0-counting/open");
    expect(await c.post("/progress/reset", { confirm: "nope" })).toEqual({ status: 400, body: { detail: 'Send {"confirm": "RESET"} to erase all progress.' } });
    expect(await c.post("/progress/reset", {})).toEqual({ status: 422, body: { detail: "Field required" } });
    expect((await c.get("/progress")).body.states["l0-counting"].state).toBe("introduced");
    expect(await c.post("/progress/reset", { confirm: "RESET" })).toEqual({ status: 204, body: undefined });
    expect(c.data().concept_states).toEqual([]);
    expect(c.data().schema).toBe(1);
  });

  it("is deterministic for a given seed and clock", async () => {
    const run = async () => {
      const c = await makeClient({ seed: "same" });
      const a = (await c.post("/lessons/l1-fractions/assessment", {})).body;
      const p = (await c.post("/practice/compare-fractions", {})).body;
      return [a, p, privateQuestions(c, a.id)];
    };
    expect(await run()).toEqual(await run());
  });
});

// ================================================================ HTTP behaviour

describe("HTTP behaviour", () => {
  it("answers unknown routes and methods like FastAPI", async () => {
    const c = await makeClient();
    expect(await c.get("/nope")).toEqual({ status: 404, body: { detail: "Not Found" } });
    expect(await c.del("/progress")).toEqual({ status: 405, body: { detail: "Method Not Allowed" } });
    expect(await c.get("/dictionary/draft")).toEqual({ status: 404, body: { detail: "Unknown term 'draft'" } });
    expect((await c.get("/progress/")).status).toBe(200); // Starlette redirects to /progress
    expect((await c.get("/api/health")).body.ok).toBe(true);
    expect(await c.server.handle(undefined as unknown as "GET", "health")).toMatchObject({ ok: true }); // fetch's defaults
    expect((await c.get("/lessons/l0%2Dcounting")).body.node.id).toBe("l0-counting");
  });

  it("answers 404 for unknown things, with the backend's wording", async () => {
    const c = await makeClient();
    const cases: [string, string, unknown, string][] = [
      ["GET", "/lessons/nope", undefined, "Unknown lesson 'nope'"],
      ["GET", "/lessons/constructor", undefined, "Unknown lesson 'constructor'"],
      ["GET", "/lessons/pb-critical-line", undefined, "The lesson 'The critical line' is planned but not yet written."],
      ["POST", "/lessons/nope/open", undefined, "Unknown lesson 'nope'"],
      ["GET", "/lessons/nope/readiness", undefined, "Unknown lesson 'nope'"],
      ["POST", "/lessons/nope/events", { type: "section_viewed" }, "Unknown lesson 'nope'"],
      ["POST", "/lessons/pb-critical-line/assessment", {}, "Lesson not available"],
      ["POST", "/lessons/pb-critical-line/explain-differently", {}, "Lesson not available"],
      ["GET", "/dictionary/__proto__", undefined, "Unknown term '__proto__'"],
      ["POST", "/dictionary/nope/viewed", undefined, "Unknown term 'nope'"],
      ["GET", "/attempts/nope", undefined, "Unknown attempt"],
      ["POST", "/attempts/nope/finish", undefined, "Unknown attempt"],
      ["POST", "/attempts/nope/answer", { question_id: "a", answer: {} }, "Unknown attempt"],
      ["POST", "/practice/nope", {}, "Unknown generator"],
      ["POST", "/practice/constructor", {}, "Unknown generator"],
      ["POST", "/practice/items/nope/answer", { answer: {} }, "Unknown practice item"],
      ["GET", "/tutor/threads/nope", undefined, "Unknown conversation"],
      ["DELETE", "/tutor/threads/nope", undefined, "Unknown conversation"],
      ["POST", "/tutor/threads/nope/messages", { content: "hi" }, "Unknown conversation"],
      ["POST", "/tutor/threads", { lesson_id: "nope" }, "Unknown lesson"],
      ["PATCH", "/wonderings/9", { status: "open" }, "Unknown wondering"],
      ["DELETE", "/wonderings/9", undefined, "Unknown wondering"],
    ];
    for (const [method, path, body, detail] of cases) {
      expect(await c.call(method as "GET", path, body), `${method} ${path}`).toEqual({ status: 404, body: { detail } });
    }
  });

  it("validates requests with pydantic's messages", async () => {
    const c = await makeClient();
    const th = (await c.post("/tutor/threads", {})).body;
    const cases: [string, string, unknown, string][] = [
      ["POST", `/tutor/threads/${th.id}/messages`, { content: "" }, "String should have at least 1 character"],
      ["POST", `/tutor/threads/${th.id}/messages`, { content: "x".repeat(8001) }, "String should have at most 8000 characters"],
      ["POST", `/tutor/threads/${th.id}/messages`, { content: 5 }, "Input should be a valid string"],
      ["POST", `/tutor/threads/${th.id}/messages`, {}, "Field required"],
      ["POST", `/tutor/threads/${th.id}/messages`, undefined, "Field required"],
      ["POST", `/tutor/threads/${th.id}/messages`, [1, 2], "Input should be a valid dictionary or object to extract fields from"],
      ["POST", "/lessons/l0-counting/assessment", { mode: "bad" }, "Input should be 'lesson', 'test_out' or 'review'"],
      ["POST", "/lessons/l0-counting/assessment", undefined, "Field required"],
      ["POST", "/lessons/l0-counting/events", { type: "nope" }, "Input should be 'section_viewed', 'experiment_completed', 'example_viewed', 'dont_understand' or 'lesson_completed'"],
      ["POST", "/lessons/l0-counting/events", { type: "section_viewed", data: [1] }, "Input should be a valid dictionary"],
      ["PATCH", "/wonderings/abc", { status: "open" }, "Input should be a valid integer, unable to parse string as an integer"],
      ["PATCH", "/wonderings/1", { status: "weird" }, "Input should be 'open', 'exploring' or 'answered'"],
      ["PATCH", "/wonderings/1", { note: 5 }, "Input should be a valid string"],
      ["GET", "/history?limit=0", undefined, "Input should be greater than or equal to 1"],
      ["GET", "/history?limit=1001", undefined, "Input should be less than or equal to 1000"],
      ["GET", "/history?limit=abc", undefined, "Input should be a valid integer, unable to parse string as an integer"],
      ["GET", "/history?before=x", undefined, "Input should be a valid integer, unable to parse string as an integer"],
      ["POST", "/attempts/x/answer", { question_id: "a", answer: "x" }, "Input should be a valid dictionary"],
      ["POST", "/attempts/x/answer", { question_id: 1, answer: {} }, "Input should be a valid string"],
      ["POST", "/dictionary/draft", { word: "" }, "String should have at least 1 character"],
      ["POST", "/dictionary/draft", { word: "x", context: "y".repeat(1001) }, "String should have at most 1000 characters"],
      ["POST", "/wonderings", { text: "" }, "String should have at least 1 character"],
      ["POST", "/lessons/l0-counting/explain-differently", { seen: "abc" }, "Input should be a valid list"],
      ["POST", "/lessons/l0-counting/explain-differently", { seen: ["a", 3] }, "Input should be a valid string"],
      ["POST", "/lessons/l0-counting/explain-differently", { use_ai: "maybe" }, "Input should be a valid boolean, unable to interpret input"],
      ["POST", "/lessons/l0-counting/explain-differently", { section: 3 }, "Input should be a valid string"],
      ["POST", "/practice/gcd", { params: [1] }, "Input should be a valid dictionary"],
      ["POST", "/practice/gcd", { lesson_id: 3 }, "Input should be a valid string"],
      ["POST", "/tutor/threads", { mode: "x", title: 3 }, "Input should be a valid string; Input should be 'teaching' or 'research'"],
      ["POST", "/progress/reset", { confirm: 1 }, "Input should be a valid string"],
      ["POST", "/progress/reset", "not json", "JSON decode error"],
    ];
    for (const [method, path, body, detail] of cases) {
      expect(await c.call(method as "GET", path, body), `${method} ${path} ${JSON.stringify(body)?.slice(0, 40)}`).toEqual({ status: 422, body: { detail } });
    }
    // lax booleans and whitespace-only text are accepted, as pydantic accepts them
    expect((await c.post("/lessons/l0-counting/explain-differently", { use_ai: "yes" })).body.source).toBe("none");
    const w = (await c.post("/wonderings", { text: "   " })).body;
    expect(w.text).toBe("");
    // a JSON string body is read as JSON
    expect((await c.post("/progress/reset", '{"confirm": "nope"}')).status).toBe(400);
  });

  it("never sends answers before a question is finished", async () => {
    const PUBLIC = ["id", "type", "kind", "prompt", "hint", "visual", "options", "multi", "unit", "items", "order_label", "rubric_count", "mode", "max_tries", "generated_from"];
    const HIDDEN = ["answer", "accept", "common_wrong", "rubric", "model_answer", "explanation", "diagnosis", "revisit", "shuffled", "correct", "tolerance"];
    const c = await makeClient();
    for (const lid of Object.keys(CONTENT.lessons)) {
      const a = (await c.post(`/lessons/${lid}/assessment`, {})).body;
      expect(a.questions).toHaveLength(CONTENT.lessons[lid].assessment.questions.length);
      for (const q of a.questions) {
        expect(Object.keys(q)).toEqual(PUBLIC);
        for (const o of q.options ?? []) expect(Object.keys(o)).toEqual(["id", "text"]);
        if (q.visual) expect(Object.keys(q.visual)).toEqual(["widget", "props", "caption", "prompt"]);
      }
      for (const k of HIDDEN) expect(keysDeep(a.questions).has(k), `${lid}: ${k}`).toBe(false);
      expect(a.progress.every((p: Body) => !p.done && p.reveal === null && p.tries === 0)).toBe(true);
      const lesson = (await c.get(`/lessons/${lid}`)).body.lesson;
      expect(Object.keys(lesson.assessment)).toEqual(["pass_score", "question_count"]);
    }
    for (const g of (await c.get("/practice/generators")).body) {
      const p = (await c.post(`/practice/${g.id}`, {})).body;
      expect(Object.keys(p)).toEqual(["id", "generator", "question"]);
      expect(Object.keys(p.question)).toEqual(PUBLIC);
      for (const k of HIDDEN) expect(keysDeep(p.question).has(k), `${g.id}: ${k}`).toBe(false);
    }
  });

  it("shows an attempt's progress, and reveals a question once it is done", async () => {
    const c = await makeClient();
    const a = (await c.post("/lessons/l0-patterns/assessment", {})).body;
    const qs = privateQuestions(c, a.id);
    const q = qs.find((x) => x.id === "triangle-next")!;
    await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { value: "20" } });
    let got = (await c.get(`/attempts/${a.id}`)).body;
    expect(got.progress.find((p: Body) => p.question_id === q.id)).toEqual({ question_id: q.id, tries: 1, done: false, correct: false, credit: 0, reveal: null });
    await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: { value: "21" } });
    got = (await c.get(`/attempts/${a.id}`)).body;
    expect(got.progress.find((p: Body) => p.question_id === q.id)).toMatchObject({ tries: 2, done: true, correct: true, credit: 0.5, reveal: { answer: "21" } });
    expect(got).toMatchObject({ lesson_id: "l0-patterns", mode: "lesson", pass_score: 0.7, finished_at: null, score: null, passed: null });
    expect(got.started_at).toMatch(ISO_UTC);
    expect((await c.post(`/attempts/${a.id}/answer`, { question_id: "nope", answer: {} })).body).toEqual({ detail: "Unknown question" });
    const s = (await c.post(`/attempts/${a.id}/finish`)).body;
    expect(s.results).toHaveLength(qs.length);
    expect(s.score).toBeCloseTo(0.5 / qs.length);
    expect(s.state_before).toBe("not_started");
    expect(s.state_after).toBe("introduced");
    expect(await c.post(`/attempts/${a.id}/finish`)).toEqual({ status: 409, body: { detail: "This attempt is already finished." } });
    expect(await c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer: {} })).toEqual({ status: 409, body: { detail: "This attempt is already finished." } });
    got = (await c.get(`/attempts/${a.id}`)).body;
    expect(got.finished_at).toMatch(ISO_UTC);
    expect(got.passed).toBe(false);
    const finished = (await c.get("/history")).body.find((e: Body) => e.type === "assessment_finished");
    expect(finished.data).toEqual({ score: pyRound(0.5 / qs.length, 3), passed: false, mode: "lesson", from: "not_started", to: "introduced" });
  });

  it("explains how an explanation question is answered without AI", async () => {
    const c = await makeClient();
    const { a, q } = await attemptWithExplain(c);
    const post = (answer: Json) => c.post(`/attempts/${a.id}/answer`, { question_id: q.id, answer });
    expect((await post({ text: "ab" })).body).toMatchObject({ valid: false, tries_left: 1, message: "Write your explanation in your own words first.", reveal: null });
    expect((await post({})).body.message).toBe("Write your explanation in your own words first.");
    expect((await post({ text: "One word per thing." })).body).toMatchObject({
      valid: false, message: "Now compare your explanation with these key ideas, and tick each one you included.", reveal: { rubric: q.rubric },
    });
    expect((await post({ text: "One word per thing.", self_check: "x" })).body).toMatchObject({ valid: false, message: "Tick the key ideas your explanation included.", tries_left: 1 });
    const r = (await post({ text: "One word per thing.", self_check: [0] })).body;
    expect(r).toMatchObject({ valid: true, correct: false, credit: 0.333, graded_by: "self", done: true, tries_left: 0, hint: null });
    expect(r.reveal).toEqual({ explanation: q.explanation, rubric: q.rubric, model_answer: q.model_answer });
    expect(c.data().question_responses.at(-1)).toMatchObject({ graded_by: "self", credit: 0.333, correct: false, try_number: 1 });
  });

  it("filters the history", async () => {
    const c = await makeClient();
    await c.post("/lessons/l0-counting/open");
    await c.post("/lessons/l0-quantity/open");
    await c.post("/dictionary/prime-number/viewed");
    const all = (await c.get("/history")).body;
    expect(all.map((e: Body) => e.id)).toEqual([...all.map((e: Body) => e.id)].sort((x: number, y: number) => y - x));
    expect(all[0]).toEqual({ id: all.length, created_at: all[0].created_at, type: "term_viewed", lesson_id: null, term_id: "prime-number", data: {} });
    expect((await c.get("/history?limit=2")).body.map((e: Body) => e.id)).toEqual([all.length, all.length - 1]);
    expect((await c.get("/history?before=3&limit=10")).body.map((e: Body) => e.id)).toEqual([2, 1]);
    const counting = (await c.get("/history?lesson_id=l0-counting")).body;
    expect(counting.length).toBeGreaterThan(0);
    expect(counting.every((e: Body) => e.lesson_id === "l0-counting")).toBe(true);
    expect(counting.map((e: Body) => e.type)).toEqual(["terms_added", "lesson_opened", "state_changed"]);
    expect((await c.get("/history?limit=2&limit=3")).body).toHaveLength(3); // the last value wins
  });

  it("records lesson events and completed experiments", async () => {
    const c = await makeClient();
    expect(await c.post("/lessons/l0-counting/events", { type: "section_viewed", data: { section: "plain" } })).toEqual({ status: 204, body: undefined });
    await c.post("/lessons/l0-counting/events", { type: "experiment_completed" });
    const events = (await c.get("/history")).body;
    expect(events.map((e: Body) => [e.type, e.data])).toEqual([["experiment_completed", {}], ["section_viewed", { section: "plain" }]]);
    expect((await c.get("/progress")).body.exercises_completed).toBe(1);
    expect(c.data().exercise_completions[0]).toMatchObject({ id: 1, lesson_id: "l0-counting", exercise: "experiment", data: {} });
  });

  it("aggregates mistakes", async () => {
    const c = await makeClient();
    await complete(c, "l1-fractions", { correctly: false });
    await complete(c, "l1-fractions", { correctly: false });
    const mistakes = (await c.get("/progress/mistakes")).body;
    expect(mistakes.length).toBeGreaterThan(0);
    for (const m of mistakes) {
      expect(Object.keys(m)).toEqual(["lesson_id", "question_id", "diagnosis", "revisit", "count", "last_at"]);
      expect(m.lesson_id).toBe("l1-fractions");
      expect(m.last_at).toMatch(ISO_UTC);
    }
    expect(mistakes[0].count).toBeGreaterThanOrEqual(2); // the same diagnosis, counted together
    const responses = c.data().question_responses.filter((r) => !r.correct && r.diagnosis !== null);
    expect(mistakes.reduce((n: number, m: Body) => n + m.count, 0)).toBe(responses.length);
    const counts = mistakes.map((m: Body) => m.count);
    expect(counts).toEqual([...counts].sort((x: number, y: number) => y - x));
  });

  it("finishes practice questions after the last try", async () => {
    const c = await makeClient();
    const p = (await c.post("/practice/gcd", { lesson_id: "l1-prime-numbers" })).body;
    const item = () => c.data().practice_items.find((x) => x.id === p.id)!;
    const q = item().question;
    expect((await c.post(`/practice/items/${p.id}/answer`, { answer: { value: "banana" } })).body).toMatchObject({ valid: false, try_number: 1, tries_left: q.max_tries });
    const r1 = (await c.post(`/practice/items/${p.id}/answer`, { answer: { value: "999999" } })).body;
    expect(r1).toMatchObject({ valid: true, correct: false, try_number: 1, tries_left: q.max_tries - 1, done: q.max_tries === 1, reveal: null });
    const r2 = (await c.post(`/practice/items/${p.id}/answer`, { answer: correctAnswer(q) })).body;
    expect(r2).toMatchObject({ valid: true, correct: true, credit: 0.5, try_number: 2, tries_left: 0, done: true, hint: null });
    expect(r2.reveal.answer).toBe(q.answer);
    expect(item()).toMatchObject({ answered_correctly: true, lesson_id: "l1-prime-numbers", question: { _tries: 2 } });
    expect(await c.post(`/practice/items/${p.id}/answer`, { answer: correctAnswer(q) })).toEqual({ status: 409, body: { detail: "This question is already finished." } });
    expect((await c.get("/progress")).body.exercises_completed).toBe(1);
    const ev = (await c.get("/history")).body[0];
    expect(ev).toMatchObject({ type: "practice_answered", lesson_id: "l1-prime-numbers", data: { generator: "gcd", correct: true, tries: 2 } });
  });

  it("lists, opens and deletes conversations", async () => {
    const c = await makeClient();
    const t1 = (await c.post("/tutor/threads", { lesson_id: "l1-fractions" })).body;
    const t2 = (await c.post("/tutor/threads", { title: "x".repeat(250), mode: "research" })).body;
    expect(t1).toMatchObject({ title: "About: Fractions", mode: "teaching", lesson_id: "l1-fractions", message_count: 0, messages: [] });
    expect(t2.title).toHaveLength(200);
    expect((await c.get("/tutor/threads")).body.map((t: Body) => t.id)).toEqual([t2.id, t1.id]);
    expect(await c.del(`/tutor/threads/${t1.id}`)).toEqual({ status: 204, body: undefined });
    expect((await c.get(`/tutor/threads/${t1.id}`)).status).toBe(404);
    expect((await c.get("/tutor/threads")).body.map((t: Body) => t.id)).toEqual([t2.id]);
  });

  it("edits and removes wonderings", async () => {
    const c = await makeClient();
    const w1 = (await c.post("/wonderings", { text: "  first  ", lesson_id: "l0-counting" })).body;
    const w2 = (await c.post("/wonderings", { text: "x".repeat(300) })).body;
    expect(w1).toMatchObject({ id: 1, text: "first", lesson_id: "l0-counting", status: "open", note: null });
    expect((await c.get("/history")).body[1].data).toEqual({ text: "  first  " });
    expect((await c.get("/history")).body[0].data.text).toHaveLength(200);
    const patched = (await c.patch(`/wonderings/${w2.id}`, { note: "a note" })).body;
    expect(patched).toMatchObject({ status: "open", note: "a note" });
    expect(patched.updated_at > w2.updated_at).toBe(true);
    expect((await c.get("/wonderings")).body.map((w: Body) => w.id)).toEqual([2, 1]);
    expect(await c.del("/wonderings/2")).toEqual({ status: 204, body: undefined });
    expect((await c.get("/wonderings")).body.map((w: Body) => w.id)).toEqual([1]);
  });

  it("returns copies, never the server's own objects", async () => {
    const c = await makeClient();
    const a = (await c.get("/lessons/l0-counting")).body;
    a.lesson.goal = "changed";
    a.terms.length = 0;
    const b = (await c.get("/lessons/l0-counting")).body;
    expect(b.lesson.goal).not.toBe("changed");
    expect(b.terms.length).toBeGreaterThan(0);
    const body = { text: "mutable" };
    await c.post("/wonderings", body);
    body.text = "changed";
    expect((await c.get("/wonderings")).body[0].text).toBe("mutable");
  });

  it("writes UTC timestamps from the clock", async () => {
    const c = await makeClient({ now: () => new Date("2026-11-02T12:34:56.789Z") });
    const r = (await c.post("/lessons/l0-counting/open")).body;
    expect(r.state).toMatchObject({ first_seen_at: "2026-11-02T12:34:56.789Z", updated_at: "2026-11-02T12:34:56.789Z" });
    expect((await c.get("/history")).body.every((e: Body) => e.created_at === "2026-11-02T12:34:56.789Z")).toBe(true);
  });
});

describe("mastery over time", () => {
  it("masters a concept passed again on a later day, schedules reviews, and flags slips", async () => {
    let now = T0;
    const c = await makeClient({ now: () => new Date(now) });
    const first = await complete(c, "l0-counting");
    expect([first.state_before, first.state_after]).toEqual(["not_started", "understood"]);
    let st = (await c.get("/progress")).body.states["l0-counting"];
    expect(st).toMatchObject({ first_seen_at: new Date(T0).toISOString(), last_passed_at: new Date(T0).toISOString(), pass_count: 1, attempt_count: 1 });
    expect((await c.get("/progress")).body.review_due).toEqual([]);
    now += 21 * 3600_000;
    expect((await c.get("/progress")).body.review_due).toEqual([]); // the first review is due after a day
    now += 4 * 3600_000;
    expect((await c.get("/progress")).body.review_due).toEqual(["l0-counting"]);
    const second = await complete(c, "l0-counting", { mode: "review" });
    expect([second.state_before, second.state_after]).toEqual(["understood", "mastered"]);
    st = (await c.get("/progress")).body.states["l0-counting"];
    expect(st).toMatchObject({ state: "mastered", pass_count: 2, attempt_count: 2, best_score: 1, last_score: 1, revision_reason: null });
    expect((await c.get("/history")).body.find((e: Body) => e.type === "state_changed").data).toEqual({
      from: "understood", to: "mastered", reason: "Passed again with a high score on a later day.", cause: "assessment:review",
    });
    expect((await c.get("/progress")).body.review_due).toEqual([]);
    // a later failure sends it back for revision, with the reason in words
    const slip = await complete(c, "l0-counting", { correctly: false });
    expect([slip.state_before, slip.state_after, slip.score]).toEqual(["mastered", "needs_revision", 0]);
    const prog = (await c.get("/progress")).body;
    expect(prog.states["l0-counting"]).toMatchObject({ state: "needs_revision", revision_reason: "A later assessment scored 0%.", best_score: 1, last_score: 0 });
    expect(prog.revision).toEqual([{ lesson_id: "l0-counting", reason: "A later assessment scored 0%." }]);
    expect(prog.counts).toMatchObject({ needs_revision: 1, understood: 0, mastered: 0, not_started: 378 });
    // passing again clears the reason
    expect((await complete(c, "l0-counting")).state_after).toBe("understood");
    expect((await c.get("/progress")).body.states["l0-counting"].revision_reason).toBeNull();
  });
});

describe("Store (store.ts)", () => {
  const wondering = (text: string) => ({ text, lesson_id: null, status: "open", note: null, created_at: "2026-11-02T09:00:00.000Z", updated_at: "2026-11-02T09:00:00.000Z" });

  it("commits each transaction once and rolls failed ones back", () => {
    const saves: LearnerData[] = [];
    const store = new Store(emptyLearnerData(), (d) => saves.push(d));
    store.transaction(() => {
      store.insert("wonderings", wondering("a"));
      store.insert("wonderings", wondering("b"));
    });
    expect(saves).toHaveLength(1);
    const saved = saves[0];
    expect(() =>
      store.transaction(() => {
        store.update("wonderings", 1, { status: "answered" });
        store.delete("wonderings", (w) => w.id === 2);
        store.insert("learning_events", { created_at: "x", type: "t", lesson_id: null, term_id: null, data: {} });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(saves).toHaveLength(1);
    expect(store.rows("wonderings").map((w) => [w.id, w.status])).toEqual([[1, "open"], [2, "open"]]);
    expect(store.rows("learning_events")).toEqual([]);
    // what was handed to persistence is never changed afterwards
    store.transaction(() => store.update("wonderings", 1, { status: "exploring" }));
    expect((saved.wonderings as WonderingRow[])[0].status).toBe("open");
    expect(saves).toHaveLength(2);
    // a single write outside a transaction commits by itself
    store.insert("wonderings", wondering("c"));
    expect(saves).toHaveLength(3);
    // a transaction that changes nothing saves nothing
    store.transaction(() => store.delete("wonderings", () => false));
    expect(saves).toHaveLength(3);
  });

  it("numbers rows like SQLite and finds rows by primary key", () => {
    const store = new Store(emptyLearnerData(), () => undefined);
    for (const t of ["a", "b", "c"]) store.insert("wonderings", wondering(t));
    store.delete("wonderings", (w) => w.id === 3);
    expect(store.insert("wonderings", wondering("d")).id).toBe(3); // largest + 1
    store.delete("wonderings", (w) => w.id === 1);
    expect(store.insert("wonderings", wondering("e")).id).toBe(4);
    expect(store.get("wonderings", 2)?.text).toBe("b");
    expect(store.get("wonderings", 1)).toBeUndefined();
    expect(() => store.update("wonderings", 99, { note: "x" })).toThrow();
  });

  it("repairs a loaded record", () => {
    const d = normaliseLearnerData({ schema: 1, wonderings: [{ id: 2 }, { id: 1 }, "junk"], concept_states: "junk", extra: [1] } as unknown as LearnerData);
    expect(d.wonderings.map((w) => w.id)).toEqual([1, 2]);
    expect(d.concept_states).toEqual([]);
    expect(d.learning_events).toEqual([]);
    expect((d as Json).extra).toEqual([1]);
    expect(normaliseLearnerData(null)).toEqual(emptyLearnerData());
  });

  it("makes uuid4-style ids, reproducibly from a seed", () => {
    expect(uuidHex()).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    expect(uuidHex(new Random(5))).toBe(uuidHex(new Random(5)));
    expect(uuidHex()).not.toBe(uuidHex());
  });

  it("reads the datetimes Python writes", () => {
    expect(parseDateTime("2026-11-02T10:07:47.362106")).toBe("2026-11-02T10:07:47.362Z");
    expect(parseDateTime("2026-11-02T10:07:47.362106+00:00")).toBe("2026-11-02T10:07:47.362Z");
    expect(parseDateTime("2026-11-02T12:07:47+02:00")).toBe("2026-11-02T10:07:47.000Z");
    expect(parseDateTime("2026-11-02 10:07")).toBe("2026-11-02T10:07:00.000Z");
    expect(parseDateTime("2026-11-02")).toBe("2026-11-02T00:00:00.000Z");
    expect(parseDateTime("2026-11-02T10:07:47.123Z")).toBe("2026-11-02T10:07:47.123Z");
    for (const bad of ["yesterday", "", "2026-13-45T99:00:00", 12, null]) expect(parseDateTime(bad)).toBeNull();
  });
});

describe("pyRound", () => {
  it("rounds like Python's round()", () => {
    expect(pyRound(2 / 3, 3)).toBe(0.667);
    expect(pyRound(1 / 3, 3)).toBe(0.333);
    expect(pyRound(0.0625, 3)).toBe(0.062); // a true tie: to even
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is really 2.67499999...
    expect(pyRound(1, 3)).toBe(1);
    expect(pyRound(0, 3)).toBe(0);
    expect(pyRound(-0.5555, 3)).toBe(-0.555); // -0.55549999...
  });
});
