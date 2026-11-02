/**
 * The backend's HTTP API, answered in the browser.
 *
 * `createServer()` returns an object whose `handle(method, path, body)` behaves like the FastAPI app
 * in backend/app (routers in backend/app/api/*.py): the same routes, the same JSON response shapes
 * (every field, nulls included, in the same order), the same status codes and error details, and
 * the same learner-facing wording. Errors are thrown as `LocalHttpError(status, detail)`; request
 * validation errors (FastAPI's 422) carry pydantic's messages joined with "; " - exactly what
 * src/lib/api.ts shows for a 422 from the real backend.
 *
 * Deliberate differences from the Python backend:
 * - datetimes are always UTC with a "Z" suffix (the SQLite backend returns zone-less times for
 *   rows it has re-read, which browsers would misread as local time);
 * - after an AI call returns, the route re-checks what it read before the call (the conversation
 *   still exists, the question is still open, the draft is still new) instead of failing on a
 *   database constraint;
 * - unexpected failures (Python's 500 "Internal Server Error") roll the whole request back.
 */
import type { components } from "@/lib/api-schema";
import type * as AiModule from "./ai";
import { loadBundle } from "./content";
import * as grading from "./grading";
import { KNOWN } from "./mastery";
import { GENERATORS, generate } from "./practice";
import { frontierPlanned, nextLessons, pathProgress, readiness } from "./recommend";
import { Random } from "./rng";
import * as service from "./service";
import {
  SCHEMA,
  Store,
  TABLES,
  emptyLearnerData,
  emptyTables,
  parseDateTime,
  type AttemptRow,
  type ChatMessageRow,
  type ChatThreadRow,
  type Column,
  type ConceptStateRow,
  type GeneratedTermRow,
  type QuestionResponseRow,
  type TableName,
  type Tables,
  type TermStateRow,
  type WonderingRow,
} from "./store";
import type { ContentBundle, ContentJson, Persistence, Q } from "./types";

type S = components["schemas"];
type Json = Record<string, unknown>;
type AI = typeof AiModule;

/** backend/app/main.py VERSION */
export const VERSION = "0.1.0";

export class LocalHttpError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "LocalHttpError";
  }
}

export interface LocalServer {
  handle(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>;
}

export type ServerOptions = {
  content: ContentJson;
  persistence: Persistence;
  ai: AI;
  now?: () => Date;
  seed?: number | string;
};

export async function createServer(opts: ServerOptions): Promise<LocalServer> {
  const bundle = loadBundle(opts.content);
  const seeded = opts.seed === undefined ? undefined : new Random(opts.seed);
  const loaded = await opts.persistence.load();
  const store = new Store(loaded ?? emptyLearnerData(), (d) => opts.persistence.save(d), { now: opts.now, random: seeded });
  return new Server(bundle, store, opts.ai, seeded);
}

// ====================================================================== Python-compatible helpers

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const isDict = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
/** `len(s)` (code points). */
const pyLen = (s: string) => [...s].length;
/** `s[:n]` (code points). */
const pySlice = (s: string, n: number) => [...s].slice(0, n).join("");
/** `str.strip()` with Python's whitespace set. */
const PY_SPACE = "[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const STRIP_RE = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, "g");
const pyStrip = (s: string) => s.replace(STRIP_RE, "");
/** `str(v)` for JSON values. */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}
/** Python's `round(x, nd)`: correctly rounded, ties to even. */
export function pyRound(x: number, nd = 0): number {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 1e21) return x;
  const [ip, fp = ""] = Math.abs(x).toFixed(100).split(".");
  const keep = ip + fp.slice(0, nd);
  const rest = fp.slice(nd);
  let n = BigInt(keep);
  if (rest[0] > "5" || (rest[0] === "5" && (/[1-9]/.test(rest.slice(1)) || n % 2n === 1n))) n += 1n;
  const r = Number(n) / 10 ** nd;
  return x < 0 ? -r : r;
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

// ====================================================================== request validation (pydantic)

type Loc = (string | number)[];
type Issue = { loc: Loc; msg: string };
type Validator<T> = (v: unknown, loc: Loc, issues: Issue[]) => T;
type Field<T> = { v: Validator<T>; default?: () => T };

const BAD = Symbol("invalid");
/** A request body that is not valid JSON. */
const INVALID_JSON = Symbol("invalid JSON");

function fail(issues: Issue[], loc: Loc, msg: string): never {
  issues.push({ loc, msg });
  throw BAD;
}

/** Run a validator, recording problems instead of stopping at the first one. */
function check<T>(v: Validator<T>, value: unknown, loc: Loc, issues: Issue[]): T | undefined {
  try {
    return v(value, loc, issues);
  } catch (e) {
    if (e === BAD) return undefined;
    throw e;
  }
}

const V = {
  str:
    (o: { min?: number; max?: number } = {}): Validator<string> =>
    (v, loc, issues) => {
      if (typeof v !== "string") fail(issues, loc, "Input should be a valid string");
      const n = pyLen(v);
      const s = (k: number) => `${k} character${k === 1 ? "" : "s"}`;
      if (o.min !== undefined && n < o.min) fail(issues, loc, `String should have at least ${s(o.min)}`);
      if (o.max !== undefined && n > o.max) fail(issues, loc, `String should have at most ${s(o.max)}`);
      return v;
    },
  bool: (): Validator<boolean> => (v, loc, issues) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number" || typeof v === "string") {
      const s = String(v).toLowerCase();
      if (["1", "on", "t", "true", "y", "yes"].includes(s)) return true;
      if (["0", "off", "f", "false", "n", "no"].includes(s)) return false;
      fail(issues, loc, "Input should be a valid boolean, unable to interpret input");
    }
    return fail(issues, loc, "Input should be a valid boolean");
  },
  dict: (): Validator<Json> => (v, loc, issues) => (isDict(v) ? v : fail(issues, loc, "Input should be a valid dictionary")),
  list:
    <T>(item: Validator<T>): Validator<T[]> =>
    (v, loc, issues) => {
      if (!Array.isArray(v)) fail(issues, loc, "Input should be a valid list");
      const n = issues.length;
      const out = v.map((x, i) => check(item, x, [...loc, i], issues) as T);
      if (issues.length > n) throw BAD;
      return out;
    },
  literal:
    <T extends string>(...values: T[]): Validator<T> =>
    (v, loc, issues) => {
      if (values.includes(v as T)) return v as T;
      const q = values.map((x) => `'${x}'`);
      return fail(issues, loc, `Input should be ${q.length > 1 ? `${q.slice(0, -1).join(", ")} or ${q[q.length - 1]}` : q[0]}`);
    },
  nullable:
    <T>(inner: Validator<T>): Validator<T | null> =>
    (v, loc, issues) => (v === null ? null : inner(v, loc, issues)),
};

function field<T>(v: Validator<T>, ...dflt: [] | [T]): Field<T> {
  return dflt.length ? { v, default: () => structuredClone(dflt[0]) as T } : { v };
}

type Model<T> = { [K in keyof T]: Field<T[K]> };

/** A request body model (FastAPI: a body parameter that is a pydantic model). */
function body<T>(fields: Model<T>): Validator<T> {
  return (raw, loc, issues) => {
    if (raw === INVALID_JSON) fail(issues, loc, "JSON decode error");
    if (raw === undefined || raw === null) fail(issues, loc, "Field required");
    if (!isDict(raw)) fail(issues, loc, "Input should be a valid dictionary or object to extract fields from");
    const out = {} as T;
    const n = issues.length;
    for (const k of Object.keys(fields) as (keyof T & string)[]) {
      const f = fields[k];
      if (!has(raw, k)) {
        if (f.default) out[k] = f.default();
        else issues.push({ loc: [...loc, k], msg: "Field required" });
        continue;
      }
      out[k] = check(f.v, raw[k], [...loc, k], issues) as T[typeof k];
    }
    if (issues.length > n) throw BAD;
    return out;
  };
}

/** An int path or query parameter. */
function intParam(o: { ge?: number; le?: number } = {}): Validator<number> {
  return (v, loc, issues) => {
    const s = String(v).trim();
    if (!/^[+-]?\d+$/.test(s)) fail(issues, loc, "Input should be a valid integer, unable to parse string as an integer");
    const n = Number(s);
    if (o.ge !== undefined && n < o.ge) fail(issues, loc, `Input should be greater than or equal to ${o.ge}`);
    if (o.le !== undefined && n > o.le) fail(issues, loc, `Input should be less than or equal to ${o.le}`);
    return n;
  };
}

/** Validate several request parts together; one 422 for every problem found, like FastAPI. */
function validate<T extends unknown[]>(...parts: { [K in keyof T]: [Validator<T[K]>, unknown, Loc] }): T {
  const issues: Issue[] = [];
  const out = parts.map(([v, value, loc]) => check(v, value, loc, issues)) as T;
  if (issues.length) throw new LocalHttpError(422, issues.map((i) => i.msg).join("; "));
  return out;
}

// -- request models (backend/app/api/schemas.py)

const LessonEventIn = body<{ type: string; data: Json }>({
  type: field(V.literal("section_viewed", "experiment_completed", "example_viewed", "dont_understand", "lesson_completed")),
  data: field(V.dict(), {}),
});
const ExplainDifferentlyIn = body<{ section: string | null; seen: string[]; use_ai: boolean }>({
  section: field(V.nullable(V.str()), null),
  seen: field(V.list(V.str()), []),
  use_ai: field(V.bool(), false),
});
const StartAttemptIn = body<{ mode: string }>({ mode: field(V.literal("lesson", "test_out", "review"), "lesson") });
const AnswerIn = body<{ question_id: string; answer: Json }>({ question_id: field(V.str()), answer: field(V.dict()) });
const PracticeIn = body<{ lesson_id: string | null; params: Json }>({
  lesson_id: field(V.nullable(V.str()), null),
  params: field(V.dict(), {}),
});
const PracticeAnswerIn = body<{ answer: Json }>({ answer: field(V.dict()) });
const ThreadIn = body<{ title: string | null; mode: string; lesson_id: string | null }>({
  title: field(V.nullable(V.str()), null),
  mode: field(V.literal("teaching", "research"), "teaching"),
  lesson_id: field(V.nullable(V.str()), null),
});
const ChatIn = body<{ content: string; lesson_id: string | null; section: string | null }>({
  content: field(V.str({ min: 1, max: 8000 })),
  lesson_id: field(V.nullable(V.str()), null),
  section: field(V.nullable(V.str()), null),
});
const DraftTermIn = body<{ word: string; context: string | null }>({
  word: field(V.str({ min: 1, max: 100 })),
  context: field(V.nullable(V.str({ max: 1000 })), null),
});
const WonderingIn = body<{ text: string; lesson_id: string | null }>({
  text: field(V.str({ min: 1, max: 4000 })),
  lesson_id: field(V.nullable(V.str()), null),
});
const WonderingPatch = body<{ status: string | null; note: string | null }>({
  status: field(V.nullable(V.literal("open", "exploring", "answered")), null),
  note: field(V.nullable(V.str()), null),
});
const ResetIn = body<{ confirm: string }>({ confirm: field(V.str()) });
/** A `dict[str, Any]` body (the import payload). */
const DictBody: Validator<Json> = (v, loc, issues) => {
  if (v === INVALID_JSON) fail(issues, loc, "JSON decode error");
  if (v === undefined || v === null) fail(issues, loc, "Field required");
  return V.dict()(v, loc, issues);
};

// ====================================================================== routing

type Query = Map<string, string>;
type Ctx = { params: Record<string, string>; query: Query; body: unknown };
type Route = { method: string; parts: string[]; run: (ctx: Ctx) => unknown };

function matchParts(parts: string[], segs: string[]): Record<string, string> | null {
  if (parts.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("{")) {
      if (!segs[i]) return null;
      params[p.slice(1, -1)] = segs[i];
    } else if (p !== segs[i]) {
      return null;
    }
  }
  return params;
}

function parseQuery(qs: string): Query {
  const out: Query = new Map();
  // Starlette keeps the last value of a repeated parameter.
  for (const [k, v] of new URLSearchParams(qs)) out.set(k, v);
  return out;
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

const MESSAGES = {
  noMoreAuthored:
    "You have seen every prepared explanation for this lesson. Revisiting an earlier lesson often helps - check the " +
    "prerequisites below - or enable the AI tutor for a personalised explanation.",
  noAiDraft: "The AI tutor is not configured, so new dictionary entries cannot be drafted.",
  noAiChat: "The AI tutor is not configured.",
  attemptFinished: "This attempt is already finished.",
  questionFinished: "This question is already finished.",
  writeFirst: "Write your explanation in your own words first.",
  compareRubric: "Now compare your explanation with these key ideas, and tick each one you included.",
  notBackup: "This is not a Mathematical Universe backup file.",
  resetConfirm: 'Send {"confirm": "RESET"} to erase all progress.',
};

const STARTED_STATES = ["introduced", "understood", "mastered", "needs_revision"];

// ====================================================================== the server

class Server implements LocalServer {
  private readonly routes: Route[];
  private readonly orderIndex: Map<string, number>;
  private readonly termCache = new Map<string, string[]>();

  constructor(
    private readonly bundle: ContentBundle,
    private readonly store: Store,
    private readonly ai: AI,
    private readonly seeded: Random | undefined,
  ) {
    this.orderIndex = new Map(bundle.order.map((id, i) => [id, i]));
    const r = (method: string, pattern: string, run: (ctx: Ctx) => unknown): Route => ({ method, parts: pattern.split("/").slice(1), run });
    // Same order as FastAPI registers them (main.py: health, then the routers in this order).
    this.routes = [
      r("GET", "/health", () => this.health()),
      // content.py
      r("GET", "/curriculum", () => this.curriculum()),
      r("GET", "/lessons/{lesson_id}", (c) => this.getLesson(c)),
      r("POST", "/lessons/{lesson_id}/open", (c) => this.openLesson(c)),
      r("POST", "/lessons/{lesson_id}/events", (c) => this.lessonEvent(c)),
      r("GET", "/lessons/{lesson_id}/readiness", (c) => this.lessonReadiness(c)),
      r("POST", "/lessons/{lesson_id}/explain-differently", (c) => this.explainDifferently(c)),
      r("GET", "/dictionary", () => this.dictionary()),
      r("GET", "/dictionary/drafts", () => this.drafts()),
      r("POST", "/dictionary/draft", (c) => this.draftTerm(c)),
      r("GET", "/dictionary/{term_id}", (c) => this.getTerm(c)),
      r("POST", "/dictionary/{term_id}/viewed", (c) => this.termViewed(c)),
      // assessment.py
      r("POST", "/lessons/{lesson_id}/assessment", (c) => this.startAttempt(c)),
      r("GET", "/attempts/{attempt_id}", (c) => this.getAttempt(c)),
      r("POST", "/attempts/{attempt_id}/answer", (c) => this.answer(c)),
      r("POST", "/attempts/{attempt_id}/finish", (c) => this.finish(c)),
      // progress.py
      r("GET", "/progress", () => this.progress()),
      r("GET", "/history", (c) => this.history(c)),
      r("GET", "/progress/mistakes", () => this.mistakes()),
      r("GET", "/progress/export", () => this.exportData()),
      r("POST", "/progress/import", (c) => this.importData(c)),
      r("POST", "/progress/reset", (c) => this.reset(c)),
      // practice.py
      r("GET", "/practice/generators", () => this.generators()),
      r("POST", "/practice/{generator_id}", (c) => this.newQuestion(c)),
      r("POST", "/practice/items/{item_id}/answer", (c) => this.practiceAnswer(c)),
      // tutor.py
      r("GET", "/ai/status", () => this.aiStatus()),
      r("GET", "/tutor/threads", () => this.listThreads()),
      r("POST", "/tutor/threads", (c) => this.createThread(c)),
      r("GET", "/tutor/threads/{thread_id}", (c) => this.getThread(c)),
      r("DELETE", "/tutor/threads/{thread_id}", (c) => this.deleteThread(c)),
      r("POST", "/tutor/threads/{thread_id}/messages", (c) => this.sendMessage(c)),
      // wonderings.py
      r("GET", "/wonderings", () => this.listWonderings()),
      r("POST", "/wonderings", (c) => this.addWondering(c)),
      r("PATCH", "/wonderings/{wid}", (c) => this.updateWondering(c)),
      r("DELETE", "/wonderings/{wid}", (c) => this.deleteWondering(c)),
    ];
  }

  async handle(method: string, path: string, reqBody?: unknown): Promise<unknown> {
    try {
      const out = await this.dispatch((method || "GET").toUpperCase(), path, reqBody);
      // What crosses the "wire" is JSON: never hand out references to the server's own objects.
      return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
    } catch (e) {
      if (e instanceof LocalHttpError) throw e;
      const err = new LocalHttpError(500, "Internal Server Error");
      (err as { cause?: unknown }).cause = e;
      throw err;
    }
  }

  private async dispatch(method: string, rawPath: string, reqBody: unknown): Promise<unknown> {
    const qi = rawPath.indexOf("?");
    let path = decodePath(qi < 0 ? rawPath : rawPath.slice(0, qi)).replace(/^\/?/, "/").replace(/^\/api(?=\/|$)/, "") || "/";
    const query = parseQuery(qi < 0 ? "" : rawPath.slice(qi + 1));
    let found = this.find(method, path);
    if (!found.route && !found.partial && path !== "/") {
      // Starlette redirects "/x/" to "/x" (and the browser follows the redirect).
      path = path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
      found = this.find(method, path);
    }
    if (found.partial && !found.route) throw new LocalHttpError(405, "Method Not Allowed");
    if (!found.route) throw new LocalHttpError(404, "Not Found");
    // The body as FastAPI would read it from the wire (a string is taken to be the JSON text).
    let parsedBody: unknown = reqBody;
    if (typeof reqBody === "string") {
      try {
        parsedBody = reqBody.trim() ? JSON.parse(reqBody) : undefined;
      } catch {
        parsedBody = INVALID_JSON; // reported only by routes that read a body, like FastAPI
      }
    } else if (reqBody !== undefined) {
      parsedBody = JSON.parse(JSON.stringify(reqBody));
    }
    return found.route.run({ params: found.params, query, body: parsedBody === null ? undefined : parsedBody });
  }

  private find(method: string, path: string): { route?: Route; params: Record<string, string>; partial: boolean } {
    const segs = path.split("/").slice(1);
    let partial = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, segs);
      if (!params) continue;
      if (route.method === method) return { route, params, partial };
      partial = true;
    }
    return { params: {}, partial };
  }

  // ------------------------------------------------------------------ shared pieces (deps.py)

  private rng(): Random {
    return this.seeded ?? new Random();
  }

  private statesMap(): Record<string, string> {
    return service.statesMap(this.store);
  }

  private async aiConfigured(): Promise<boolean> {
    try {
      return (await this.ai.aiStatus()).configured === true;
    } catch {
      return false;
    }
  }

  private aiFailure(e: unknown): LocalHttpError | null {
    return e instanceof this.ai.AIError ? new LocalHttpError(502, e.message) : null;
  }

  private nodeOut(lessonId: string): S["NodeOut"] {
    const n = this.bundle.nodes[lessonId];
    return {
      id: n.id, stage: n.stage, module: n.module ?? null, title: n.title, summary: n.summary, pre: [...n.pre],
      goals: [...n.goals], feeds: [...(this.bundle.feeds[n.id] ?? [])], available: n.id in this.bundle.lessons,
      order: this.orderIndex.get(n.id) ?? 0,
    };
  }

  private stateOut(lessonId: string, st: ConceptStateRow | undefined): S["ConceptStateOut"] {
    if (!st) {
      return {
        lesson_id: lessonId, state: "not_started", first_seen_at: null, updated_at: null, last_passed_at: null, pass_count: 0,
        attempt_count: 0, best_score: null, last_score: null, revision_reason: null, tested_out: false,
      };
    }
    return {
      lesson_id: st.lesson_id, state: st.state as S["ConceptStateOut"]["state"], first_seen_at: st.first_seen_at ?? null,
      updated_at: st.updated_at ?? null, last_passed_at: st.last_passed_at ?? null, pass_count: st.pass_count,
      attempt_count: st.attempt_count, best_score: st.best_score ?? null, last_score: st.last_score ?? null,
      revision_reason: st.revision_reason ?? null, tested_out: st.tested_out,
    };
  }

  private readinessOut(lessonId: string, states: Record<string, string>): S["ReadinessOut"] {
    const r = readiness(this.bundle, lessonId, states);
    return { ready: r.ready, missing: r.missing.map((m: string) => this.nodeOut(m)), direct_missing: [...r.direct_missing] };
  }

  private termSummary(termId: string, ts: TermStateRow | undefined): S["TermSummary"] {
    const t = this.bundle.terms[termId];
    return {
      id: t.id, word: t.word, plain: t.plain, symbol: t.symbol ?? null, introduced_in: t.introduced_in, aliases: [...t.aliases],
      link_forms: [...t.link_forms], seen: ts !== undefined, learned: Boolean(ts && ts.learned), lookups: ts ? ts.lookups : 0,
      ai_generated: false,
    };
  }

  private lessonOr404(lessonId: string): void {
    if (!(lessonId in this.bundle.nodes)) throw new LocalHttpError(404, `Unknown lesson '${lessonId}'`);
  }

  private lessonTerms(lessonId: string): string[] {
    let terms = this.termCache.get(lessonId);
    if (!terms) {
      terms = service.lessonTerms(this.bundle, lessonId);
      this.termCache.set(lessonId, terms);
    }
    return [...terms];
  }

  // ------------------------------------------------------------------ main.py

  private health(): S["HealthOut"] {
    const b = this.bundle;
    const lessons = Object.keys(b.lessons).length;
    return { ok: true, lessons_available: lessons, lessons_planned: Object.keys(b.nodes).length - lessons, terms: Object.keys(b.terms).length, version: VERSION };
  }

  // ------------------------------------------------------------------ content.py

  private curriculum(): S["CurriculumOut"] {
    const cur = this.bundle.json.curriculum;
    return {
      stages: cur.stages.map((s) => ({
        id: s.id, kind: s.kind, number: s.number ?? null, title: s.title, summary: s.summary, why: s.why, goals: [...s.goals],
        modules: s.modules.map((m) => ({ id: m.id, title: m.title, why: m.why, goals: [...m.goals] })), target: s.target ?? null,
      })),
      lessons: cur.lessons.map((n) => this.nodeOut(n.id)),
    };
  }

  private getLesson(c: Ctx): S["LessonOut"] {
    const id = c.params.lesson_id;
    this.lessonOr404(id);
    const lesson = this.bundle.lessons[id];
    if (!lesson) throw new LocalHttpError(404, `The lesson '${this.bundle.nodes[id].title}' is planned but not yet written.`);
    const pub: Json = {};
    for (const [k, v] of Object.entries(lesson)) {
      pub[k] = k === "assessment" ? { pass_score: lesson.assessment.pass_score, question_count: lesson.assessment.questions.length } : v;
    }
    const states = this.statesMap();
    const termIds = this.lessonTerms(id);
    const tstates = new Map(this.store.rows("term_states").filter((t) => termIds.includes(t.term_id)).map((t) => [t.term_id, t]));
    const node = this.bundle.nodes[id];
    return {
      node: this.nodeOut(id),
      lesson: pub as S["LessonPublic"],
      state: this.stateOut(id, this.store.get("concept_states", id)),
      readiness: this.readinessOut(id, states),
      terms: termIds.map((t) => this.termSummary(t, tstates.get(t))),
      prerequisites: node.pre.map((p) => this.nodeOut(p)),
      unlocks: (this.bundle.children[id] ?? []).map((ch) => this.nodeOut(ch)),
    };
  }

  private openLesson(c: Ctx): S["OpenLessonOut"] {
    const id = c.params.lesson_id;
    this.lessonOr404(id);
    const [st, newTerms] = this.store.transaction(() => service.openLesson(this.store, this.bundle, id));
    return { state: this.stateOut(id, st), new_terms: newTerms, readiness: this.readinessOut(id, this.statesMap()) };
  }

  private lessonEvent(c: Ctx): undefined {
    const [b] = validate([LessonEventIn, c.body, ["body"]]);
    const id = c.params.lesson_id;
    this.lessonOr404(id);
    this.store.transaction(() => {
      service.recordEvent(this.store, b.type, { lessonId: id, data: b.data });
      if (b.type === "experiment_completed") {
        this.store.insert("exercise_completions", { lesson_id: id, exercise: "experiment", completed_at: this.store.isoNow(), data: b.data });
      }
    });
    return undefined;
  }

  private lessonReadiness(c: Ctx): S["ReadinessOut"] {
    const id = c.params.lesson_id;
    this.lessonOr404(id);
    return this.readinessOut(id, this.statesMap());
  }

  private alternativeOut(a: Partial<S["AlternativeOut"]> & Pick<S["AlternativeOut"], "source">): S["AlternativeOut"] {
    return {
      source: a.source, strategy: a.strategy ?? null, title: a.title ?? null, text: a.text ?? null, visual: visualOut(a.visual),
      check_question: a.check_question ?? null, remaining_authored: a.remaining_authored ?? 0, ai_available: a.ai_available ?? false,
      message: a.message ?? null,
    };
  }

  /** The "I don't understand" button: a different teaching strategy each time. */
  private async explainDifferently(c: Ctx): Promise<S["AlternativeOut"]> {
    const [b] = validate([ExplainDifferentlyIn, c.body, ["body"]]);
    const id = c.params.lesson_id;
    const lesson = this.bundle.lessons[id];
    if (!lesson) throw new LocalHttpError(404, "Lesson not available");
    const seen = new Set([...b.seen, lesson.analogy.strategy]);
    const unseen = lesson.alternatives.filter((a) => !seen.has(a.strategy));
    if (unseen.length && !b.use_ai) {
      const alt = unseen[0];
      const aiAvailable = await this.aiConfigured();
      this.store.transaction(() =>
        service.recordEvent(this.store, "dont_understand", { lessonId: id, data: { section: b.section, strategy: alt.strategy, source: "authored" } }),
      );
      return this.alternativeOut({
        source: "authored", strategy: alt.strategy, title: alt.title, text: alt.text, visual: alt.visual,
        remaining_authored: unseen.length - 1, ai_available: aiAvailable,
      });
    }
    if (!(await this.aiConfigured())) {
      this.store.transaction(() => service.recordEvent(this.store, "dont_understand", { lessonId: id, data: { section: b.section, source: "none" } }));
      return this.alternativeOut({ source: "none", ai_available: false, message: MESSAGES.noMoreAuthored });
    }
    const learner = this.ai.learnerContext(this.bundle, this.statesMap(), {
      lessonId: id, section: b.section, knownTerms: service.knownTerms(this.store, this.bundle), mistakes: service.recentMistakes(this.store),
    });
    const tried = [...seen].sort(cmp);
    let data: Json;
    try {
      data = await this.ai.explainDifferently(this.bundle, { learner, lessonId: id, section: b.section, tried });
    } catch (e) {
      throw this.aiFailure(e) ?? e;
    }
    this.store.transaction(() =>
      service.recordEvent(this.store, "dont_understand", { lessonId: id, data: { section: b.section, strategy: data.strategy ?? null, source: "ai" } }),
    );
    return this.alternativeOut({
      source: "ai", strategy: strOrNull(data.strategy), title: strOrNull(data.title), text: strOrNull(data.explanation),
      check_question: strOrNull(data.check_question) || null, remaining_authored: 0, ai_available: true,
    });
  }

  private dictionary(): S["TermSummary"][] {
    const tstates = new Map(this.store.rows("term_states").map((t) => [t.term_id, t]));
    const out = Object.keys(this.bundle.terms).map((tid) => this.termSummary(tid, tstates.get(tid)));
    return out.sort((a, b) => cmp(a.word.toLowerCase(), b.word.toLowerCase()));
  }

  private generatedTermOut(g: GeneratedTermRow): S["GeneratedTermOut"] {
    return { id: g.id, word: g.word, entry: g.entry, model: g.model ?? null, created_at: g.created_at };
  }

  private drafts(): S["GeneratedTermOut"][] {
    return byNewest(this.store.rows("generated_terms"), "created_at").map((g) => this.generatedTermOut(g));
  }

  /** Ask the AI to draft an entry for a word not yet in the curated dictionary. */
  private async draftTerm(c: Ctx): Promise<S["GeneratedTermOut"]> {
    const [b] = validate([DraftTermIn, c.body, ["body"]]);
    if (!(await this.aiConfigured())) throw new LocalHttpError(503, MESSAGES.noAiDraft);
    const slug = "ai-" + b.word.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const existing = this.store.get("generated_terms", slug);
    if (existing) return this.generatedTermOut(existing);
    let data: Json;
    try {
      data = await this.ai.draftTerm(this.bundle, { word: b.word, context: b.context });
    } catch (e) {
      throw this.aiFailure(e) ?? e;
    }
    const entry: Json = { ...data };
    const model = strOrNull(entry.model);
    delete entry.model;
    const g = this.store.transaction(() => {
      const drafted = this.store.get("generated_terms", slug); // drafted meanwhile by another request
      if (drafted) return drafted;
      const word = (typeof entry.word === "string" && entry.word) || b.word;
      const row = this.store.insert("generated_terms", { id: slug, word, entry, created_at: this.store.isoNow(), model });
      service.recordEvent(this.store, "term_drafted", { termId: slug, data: { word } });
      return row;
    });
    return this.generatedTermOut(g);
  }

  private getTerm(c: Ctx): S["TermOut"] {
    const id = c.params.term_id;
    const term = this.bundle.terms[id];
    if (!term) throw new LocalHttpError(404, `Unknown term '${id}'`);
    const out: Json = {};
    for (const [k, v] of Object.entries(term)) if (k !== "link_forms") out[k] = v;
    return {
      term: out as S["Term"],
      state: this.termSummary(id, this.store.get("term_states", id)),
      introduced_in: this.nodeOut(term.introduced_in),
    };
  }

  private termViewed(c: Ctx): S["TermSummary"] {
    const id = c.params.term_id;
    if (!(id in this.bundle.terms)) throw new LocalHttpError(404, `Unknown term '${id}'`);
    const ts = this.store.transaction(() => {
      const now = this.store.isoNow();
      const cur = this.store.get("term_states", id);
      const row = cur
        ? this.store.update("term_states", id, { lookups: cur.lookups + 1, last_lookup_at: now })
        : this.store.insert("term_states", { term_id: id, first_seen_at: now, first_seen_lesson: null, lookups: 1, last_lookup_at: now, learned: false });
      service.recordEvent(this.store, "term_viewed", { termId: id });
      return row;
    });
    return this.termSummary(id, ts);
  }

  // ------------------------------------------------------------------ assessment.py

  private responses(attemptId: string): QuestionResponseRow[] {
    return this.store.rows("question_responses").filter((r) => r.attempt_id === attemptId);
  }

  private progressOf(a: AttemptRow): S["QuestionProgress"][] {
    const all = this.responses(a.id);
    return a.questions.map((q) => {
      const rs = all.filter((r) => r.question_id === q.id);
      const correct = rs.some((r) => r.correct);
      const done = correct || rs.length >= q.max_tries;
      return {
        question_id: q.id, tries: rs.length, done, correct, credit: rs.reduce((m, r) => Math.max(m, r.credit), 0),
        reveal: done ? grading.reveal(q) : null,
      };
    });
  }

  private attemptOut(a: AttemptRow, passScore: number): S["AttemptOut"] {
    return {
      id: a.id, lesson_id: a.lesson_id, mode: a.mode, pass_score: passScore, started_at: a.started_at, finished_at: a.finished_at ?? null,
      score: a.score ?? null, passed: a.passed ?? null, questions: a.questions.map((q) => questionPublic(grading.publicView(q))),
      progress: this.progressOf(a),
    };
  }

  private attemptOr404(attemptId: string): AttemptRow {
    const a = this.store.get("assessment_attempts", attemptId);
    if (!a) throw new LocalHttpError(404, "Unknown attempt");
    return a;
  }

  private lessonOf(a: AttemptRow) {
    const lesson = this.bundle.lessons[a.lesson_id];
    if (!lesson) throw new Error(`attempt ${a.id} belongs to a lesson that is not available: ${a.lesson_id}`);
    return lesson;
  }

  private startAttempt(c: Ctx): S["AttemptOut"] {
    const [b] = validate([StartAttemptIn, c.body, ["body"]]);
    const id = c.params.lesson_id;
    const lesson = this.bundle.lessons[id];
    if (!lesson) throw new LocalHttpError(404, "Lesson not available");
    const questions = grading.materialise(structuredClone(lesson.assessment), this.rng());
    const attempt = this.store.transaction(() => {
      const a = this.store.insert("assessment_attempts", {
        id: this.store.newId(), lesson_id: id, mode: b.mode, started_at: this.store.isoNow(), finished_at: null, questions, score: null, passed: null,
      });
      service.getState(this.store, id);
      service.recordEvent(this.store, "assessment_started", { lessonId: id, data: { mode: b.mode } });
      return a;
    });
    return this.attemptOut(attempt, lesson.assessment.pass_score);
  }

  private getAttempt(c: Ctx): S["AttemptOut"] {
    const a = this.attemptOr404(c.params.attempt_id);
    return this.attemptOut(a, this.lessonOf(a).assessment.pass_score);
  }

  /** The attempt and question an answer is for, checked to be still open. */
  private openQuestion(attemptId: string, questionId: string): { a: AttemptRow; q: Q; previous: QuestionResponseRow[] } {
    const a = this.attemptOr404(attemptId);
    if (a.finished_at !== null && a.finished_at !== undefined) throw new LocalHttpError(409, MESSAGES.attemptFinished);
    const q = a.questions.find((x) => x.id === questionId);
    if (!q) throw new LocalHttpError(404, "Unknown question");
    const previous = this.responses(a.id).filter((r) => r.question_id === q.id);
    if (previous.some((r) => r.correct) || previous.length >= q.max_tries) throw new LocalHttpError(409, MESSAGES.questionFinished);
    return { a, q, previous };
  }

  private async answer(c: Ctx): Promise<S["AnswerOut"]> {
    const [b] = validate([AnswerIn, c.body, ["body"]]);
    let { a, q, previous } = this.openQuestion(c.params.attempt_id, b.question_id);
    let tryNumber = previous.length + 1;

    let gradedBy = "rule";
    let feedback: string | null = null;
    let rubricMet: boolean[] | null = null;
    let g: grading.Grade;
    if (q.type === "explain") {
      const text = pyStrip(pyStr(has(b.answer, "text") ? b.answer.text : ""));
      if (has(b.answer, "self_check")) {
        g = grading.gradeExplainSelf(q, b.answer);
        gradedBy = "self";
      } else if (pyLen(text) >= 3 && (await this.aiConfigured())) {
        let res: Json;
        try {
          res = await this.ai.gradeExplanation(this.bundle, { question: q, answerText: text });
        } catch (e) {
          if (!(e instanceof this.ai.AIError)) throw e;
          return answerOut({
            valid: false, correct: false, credit: 0, try_number: tryNumber, tries_left: q.max_tries - previous.length, done: false,
            message: `AI grading is unavailable (${e.message}). Compare your answer with the key ideas and tick the ones you included.`,
            reveal: { rubric: q.rubric },
          });
        }
        // The question may have been answered (or the attempt finished) while the AI was grading.
        ({ a, q, previous } = this.openQuestion(c.params.attempt_id, b.question_id));
        tryNumber = previous.length + 1;
        rubricMet = (Array.isArray(res.rubric_met) ? res.rubric_met : []).map(Boolean);
        const score = rubricMet.filter(Boolean).length / rubricMet.length;
        g = grading.makeGrade(score >= 0.6, { score, diagnosis: strOrNull(res.misconception) || null });
        gradedBy = "ai";
        feedback = strOrNull(res.feedback);
      } else {
        if (pyLen(text) < 3) {
          return answerOut({ valid: false, correct: false, credit: 0, try_number: tryNumber, tries_left: 1, done: false, message: MESSAGES.writeFirst });
        }
        return answerOut({
          valid: false, correct: false, credit: 0, try_number: tryNumber, tries_left: 1, done: false, message: MESSAGES.compareRubric,
          reveal: { rubric: q.rubric },
        });
      }
    } else {
      g = grading.grade(q, b.answer);
    }

    if (!g.valid) {
      return answerOut({
        valid: false, correct: false, credit: 0, try_number: tryNumber, tries_left: q.max_tries - previous.length, done: false,
        message: g.message ?? null,
      });
    }

    let credit = g.score !== null && g.score !== undefined ? g.score : grading.creditFor(tryNumber, g.correct);
    if (q.type === "explain") credit = pyRound(g.score || 0, 3);
    const attempt = a;
    const question = q;
    const number = tryNumber;
    const grade = g;
    this.store.transaction(() => {
      this.store.insert("question_responses", {
        attempt_id: attempt.id, lesson_id: attempt.lesson_id, question_id: question.id, try_number: number, answer: b.answer,
        correct: grade.correct, credit, diagnosis: grade.diagnosis ?? null, revisit: grade.revisit ?? null, graded_by: gradedBy,
        created_at: this.store.isoNow(),
      });
      service.recordEvent(this.store, "question_answered", {
        lessonId: attempt.lesson_id, data: { question: question.id, correct: grade.correct, try: number },
      });
    });

    const triesLeft = q.max_tries - tryNumber;
    const done = g.correct || triesLeft <= 0;
    const revisit = g.revisit && g.revisit in this.bundle.nodes && g.revisit !== a.lesson_id ? this.nodeOut(g.revisit) : null;
    return answerOut({
      valid: true, correct: g.correct, credit, try_number: tryNumber, tries_left: Math.max(triesLeft, 0), done,
      diagnosis: g.diagnosis ?? null, revisit, hint: !g.correct && !done ? (q.hint ?? null) : null, reveal: done ? grading.reveal(q) : null,
      graded_by: gradedBy, feedback, rubric_met: rubricMet,
    });
  }

  private finish(c: Ctx): S["AttemptSummary"] {
    const a = this.attemptOr404(c.params.attempt_id);
    if (a.finished_at !== null && a.finished_at !== undefined) throw new LocalHttpError(409, MESSAGES.attemptFinished);
    const lesson = this.lessonOf(a);
    const passScore = lesson.assessment.pass_score;
    const responses = this.responses(a.id);
    const results: S["QuestionResult"][] = [];
    let total = 0;
    for (const q of a.questions) {
      const rs = responses.filter((r) => r.question_id === q.id);
      const credit = rs.reduce((m, r) => Math.max(m, r.credit), 0);
      total += credit;
      results.push({ question_id: q.id, prompt: q.prompt, correct: rs.some((r) => r.correct), credit, tries: rs.length });
    }
    if (!a.questions.length) throw new Error("attempt without questions");
    const score = total / a.questions.length;
    const passed = score >= passScore;

    // Mistakes that point at earlier lessons: suggest them, and if the learner did not pass,
    // mark previously understood ones for revision.
    const targets: string[] = [];
    for (const r of responses) {
      if (!r.correct && r.revisit && r.revisit in this.bundle.nodes && r.revisit !== a.lesson_id && !targets.includes(r.revisit)) {
        targets.push(r.revisit);
      }
    }
    const [before, after] = this.store.transaction(() => {
      this.store.update("assessment_attempts", a.id, { score, passed, finished_at: this.store.isoNow() });
      const change = service.applyAssessment(this.store, this.bundle, a.lesson_id, score, passScore, a.mode);
      if (!passed) {
        const why = `Mistakes in '${this.bundle.nodes[a.lesson_id].title}' pointed back to this idea.`;
        for (const t of targets) service.applyDiagnosedGap(this.store, t, why);
      }
      service.recordEvent(this.store, "assessment_finished", {
        lessonId: a.lesson_id, data: { score: pyRound(score, 3), passed, mode: a.mode, from: change[0], to: change[1] },
      });
      return change;
    });
    const states = this.statesMap();
    return {
      attempt_id: a.id, lesson_id: a.lesson_id, score, passed, pass_score: passScore, state_before: before, state_after: after, results,
      revisit: targets.filter((t) => !KNOWN.has(states[t] ?? "") || !passed).map((t) => this.nodeOut(t)),
      next: nextLessons(this.bundle, states, 3).map((n: string) => this.nodeOut(n)),
      learned_terms: passed ? [...lesson.word.terms] : [],
    };
  }

  // ------------------------------------------------------------------ progress.py

  private progress(): S["ProgressOut"] {
    const b = this.bundle;
    const byId = new Map<string, ConceptStateRow>();
    for (const r of this.store.rows("concept_states")) if (r.lesson_id in b.nodes) byId.set(r.lesson_id, r);
    const states: Record<string, string> = {};
    for (const [k, v] of byId) states[k] = v.state;
    const counts: Record<string, number> = {};
    for (const s of Object.values(states)) counts[s] = (counts[s] ?? 0) + 1;
    // Python reads counts[k] from a defaultdict, which adds the missing keys (with 0) in this order.
    let started = 0;
    for (const k of STARTED_STATES) {
      if (!(k in counts)) counts[k] = 0;
      started += counts[k];
    }
    const nodeCount = Object.keys(b.nodes).length;
    counts.not_started = nodeCount - started;
    counts.available = Object.keys(b.lessons).length;
    counts.total = nodeCount;

    const curriculum = b.json.curriculum;
    const stages = curriculum.stages.map((s) => {
      const ids = curriculum.lessons.filter((n) => n.stage === s.id).map((n) => n.id);
      return {
        id: s.id, total: ids.length, available: ids.filter((i) => i in b.lessons).length,
        understood: ids.filter((i) => states[i] === "understood" || states[i] === "mastered").length,
        mastered: ids.filter((i) => states[i] === "mastered").length,
        introduced: ids.filter((i) => states[i] === "introduced" || states[i] === "needs_revision").length,
      };
    });
    const paths: S["PathProgress"][] = [];
    for (const s of curriculum.stages) {
      if (s.kind === "path" && s.target) {
        const pp = pathProgress(b, s.target, states);
        paths.push({ id: s.id, title: s.title, target: s.target, total: pp.total, known: pp.known, mastered: pp.mastered });
      }
    }
    const termRows = this.store.rows("term_states");
    const vocabulary = {
      total: Object.keys(b.terms).length,
      seen: termRows.filter((t) => t.term_id in b.terms).length,
      learned: termRows.filter((t) => t.learned && t.term_id in b.terms).length,
    };
    const events = this.store.rows("learning_events");
    let last: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "lesson_opened") {
        last = events[i].lesson_id ?? null;
        break;
      }
    }
    const statesOut: Record<string, S["ConceptStateOut"]> = {};
    for (const [k, v] of byId) statesOut[k] = this.stateOut(k, v);
    return {
      states: statesOut, counts, stages, paths, vocabulary,
      exercises_completed: this.store.rows("exercise_completions").length,
      assessments_passed: this.store.rows("assessment_attempts").filter((a) => a.passed === true).length,
      next: nextLessons(b, states, 5),
      revision: [...byId.values()].filter((r) => r.state === "needs_revision").map((r) => ({ lesson_id: r.lesson_id, reason: r.revision_reason || "Marked for revision." })),
      review_due: service.reviewDue(this.store).filter((i) => i in b.nodes),
      frontier_planned: frontierPlanned(b, states),
      last_lesson: last,
    };
  }

  private history(c: Ctx): S["EventOut"][] {
    const q = c.query;
    const [limit, before] = validate<[number, number | null]>(
      [intParam({ ge: 1, le: 1000 }), q.get("limit") ?? "100", ["query", "limit"]],
      [V.nullable(intParam()), q.get("before") ?? null, ["query", "before"]],
    );
    const lessonId = q.get("lesson_id") ?? null;
    const out: S["EventOut"][] = [];
    const events = this.store.rows("learning_events");
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i];
      if (before !== null && !(e.id < before)) continue;
      if (lessonId !== null && e.lesson_id !== lessonId) continue;
      out.push({
        id: e.id, created_at: e.created_at, type: e.type, lesson_id: e.lesson_id ?? null, term_id: e.term_id ?? null,
        data: isDict(e.data) && Object.keys(e.data).length ? e.data : {},
      });
    }
    return out;
  }

  private mistakes(): S["MistakeOut"][] {
    const agg = new Map<string, S["MistakeOut"]>();
    for (const r of this.store.rows("question_responses")) {
      if (r.correct !== false || r.diagnosis === null || r.diagnosis === undefined) continue;
      const key = JSON.stringify([r.lesson_id, r.diagnosis]);
      let e = agg.get(key);
      if (!e) {
        e = { lesson_id: r.lesson_id, question_id: r.question_id, diagnosis: r.diagnosis, revisit: r.revisit ?? null, count: 0, last_at: r.created_at };
        agg.set(key, e);
      }
      e.count += 1;
      if (r.created_at > e.last_at) e.last_at = r.created_at;
    }
    return [...agg.values()].sort((x, y) => y.count - x.count || cmp(x.lesson_id, y.lesson_id));
  }

  /** Everything the app knows about the learner, as JSON (a complete backup). */
  private exportData(): Json {
    const tables: Json = {};
    for (const t of TABLES) {
      const cols = SCHEMA[t].columns;
      tables[t] = (this.store.rows(t) as readonly Json[]).map((row) => {
        const out: Json = {};
        for (const col of cols) out[col.name] = row[col.name] === undefined ? null : row[col.name];
        return out;
      });
    }
    return { format: "mathematical-universe-backup", version: 1, tables };
  }

  private importData(c: Ctx): undefined {
    const [payload] = validate([DictBody, c.body, ["body"]]);
    if (payload.format !== "mathematical-universe-backup") throw new LocalHttpError(400, MESSAGES.notBackup);
    const tables = has(payload, "tables") ? payload.tables : {};
    if (!isDict(tables)) throw new Error("backup: 'tables' is not an object");
    this.store.replaceAll(importTables(tables, () => this.store.isoNow(), () => this.store.newId()));
    return undefined;
  }

  private reset(c: Ctx): undefined {
    const [b] = validate([ResetIn, c.body, ["body"]]);
    if (b.confirm !== "RESET") throw new LocalHttpError(400, MESSAGES.resetConfirm);
    this.store.replaceAll(emptyTables());
    return undefined;
  }

  // ------------------------------------------------------------------ practice.py

  private generators(): S["GeneratorOut"][] {
    return Object.values(GENERATORS).map((g) => ({ id: g.id, title: g.title, lesson: g.lesson }));
  }

  private newQuestion(c: Ctx): S["PracticeOut"] {
    const [b] = validate([PracticeIn, c.body, ["body"]]);
    const gid = c.params.generator_id;
    if (!has(GENERATORS, gid)) throw new LocalHttpError(404, "Unknown generator");
    const q = generate(gid, this.rng(), b.params);
    q.id = "practice";
    grading.prepare(q, this.rng());
    const item = this.store.transaction(() =>
      this.store.insert("practice_items", {
        id: this.store.newId(), generator: gid, lesson_id: b.lesson_id || GENERATORS[gid].lesson, question: q,
        created_at: this.store.isoNow(), answered_correctly: null,
      }),
    );
    return { id: item.id, generator: gid, question: questionPublic(grading.publicView(q)) };
  }

  private practiceAnswer(c: Ctx): S["AnswerOut"] {
    const [b] = validate([PracticeAnswerIn, c.body, ["body"]]);
    const id = c.params.item_id;
    const item = this.store.get("practice_items", id);
    if (!item) throw new LocalHttpError(404, "Unknown practice item");
    const q = item.question;
    let tries = typeof q._tries === "number" ? q._tries : 0;
    if (item.answered_correctly !== null && item.answered_correctly !== undefined) throw new LocalHttpError(409, MESSAGES.questionFinished);
    const g = grading.grade(q, b.answer);
    if (!g.valid) {
      return answerOut({ valid: false, correct: false, credit: 0, try_number: tries + 1, tries_left: q.max_tries - tries, done: false, message: g.message ?? null });
    }
    tries += 1;
    const done = g.correct || tries >= q.max_tries;
    this.store.transaction(() => {
      this.store.update("practice_items", id, { question: { ...q, _tries: tries }, ...(done ? { answered_correctly: g.correct } : {}) });
      if (done) {
        if (g.correct) {
          this.store.insert("exercise_completions", { lesson_id: item.lesson_id || "", exercise: item.generator, completed_at: this.store.isoNow(), data: { tries } });
        }
        service.recordEvent(this.store, "practice_answered", { lessonId: item.lesson_id, data: { generator: item.generator, correct: g.correct, tries } });
      }
    });
    const revisit = g.revisit && g.revisit in this.bundle.nodes ? this.nodeOut(g.revisit) : null;
    return answerOut({
      valid: true, correct: g.correct, credit: grading.creditFor(tries, g.correct), try_number: tries, tries_left: Math.max(q.max_tries - tries, 0),
      done, diagnosis: g.diagnosis ?? null, revisit, hint: !done ? (q.hint ?? null) : null, reveal: done ? grading.reveal(q) : null,
    });
  }

  // ------------------------------------------------------------------ tutor.py

  private async aiStatus(): Promise<S["AIStatus"]> {
    const s = await this.ai.aiStatus();
    return { configured: Boolean(s.configured), provider: s.provider, model: s.model ?? null, reason: s.reason ?? null };
  }

  private messageOut(m: ChatMessageRow): S["MessageOut"] {
    const s: Json = isDict(m.structured) ? m.structured : {};
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    return {
      id: m.id, role: m.role as S["MessageOut"]["role"], content: m.content, created_at: m.created_at, strategy: strOrNull(s.strategy),
      check_question: strOrNull(s.check_question) || null,
      missing_prerequisites: list(s.missing_prerequisites)
        .filter((p): p is string => typeof p === "string" && p in this.bundle.nodes)
        .map((p) => this.nodeOut(p)),
      new_terms: list(s.new_terms).filter((t): t is string => typeof t === "string"),
      statements: list(s.statements)
        .filter((x): x is Json => isDict(x) && typeof x.kind === "string" && typeof x.text === "string")
        .map((x) => ({ kind: x.kind as string, text: x.text as string })),
      tool_calls: list(s.tool_calls).filter(isDict),
      error: null,
    };
  }

  private messagesOf(threadId: string): ChatMessageRow[] {
    return this.store.rows("chat_messages").filter((m) => m.thread_id === threadId);
  }

  private summary(t: ChatThreadRow): S["ThreadSummary"] {
    return {
      id: t.id, title: t.title, mode: t.mode, lesson_id: t.lesson_id ?? null, created_at: t.created_at, updated_at: t.updated_at,
      message_count: this.messagesOf(t.id).length,
    };
  }

  private threadOr404(threadId: string): ChatThreadRow {
    const t = this.store.get("chat_threads", threadId);
    if (!t) throw new LocalHttpError(404, "Unknown conversation");
    return t;
  }

  private listThreads(): S["ThreadSummary"][] {
    return byNewest(this.store.rows("chat_threads"), "updated_at").map((t) => this.summary(t));
  }

  private createThread(c: Ctx): S["ThreadOut"] {
    const [b] = validate([ThreadIn, c.body, ["body"]]);
    if (b.lesson_id && !(b.lesson_id in this.bundle.nodes)) throw new LocalHttpError(404, "Unknown lesson");
    const title = b.title || (b.lesson_id ? `About: ${this.bundle.nodes[b.lesson_id].title}` : "New conversation");
    const t = this.store.transaction(() => {
      const now = this.store.isoNow();
      return this.store.insert("chat_threads", {
        id: this.store.newId(), title: pySlice(title, 200), mode: b.mode, lesson_id: b.lesson_id, created_at: now, updated_at: now,
      });
    });
    return { ...this.summary(t), messages: [] };
  }

  private getThread(c: Ctx): S["ThreadOut"] {
    const t = this.threadOr404(c.params.thread_id);
    return { ...this.summary(t), messages: this.messagesOf(t.id).map((m) => this.messageOut(m)) };
  }

  private deleteThread(c: Ctx): undefined {
    const t = this.threadOr404(c.params.thread_id);
    this.store.transaction(() => {
      this.store.delete("chat_messages", (m) => m.thread_id === t.id);
      this.store.delete("chat_threads", (x) => x.id === t.id);
    });
    return undefined;
  }

  private async sendMessage(c: Ctx): Promise<S["MessageOut"]> {
    const [b] = validate([ChatIn, c.body, ["body"]]);
    const t = this.threadOr404(c.params.thread_id);
    const status = await this.ai.aiStatus().catch(() => null);
    if (!status?.configured) throw new LocalHttpError(503, status?.reason || MESSAGES.noAiChat);
    const wanted = b.lesson_id || t.lesson_id;
    const lessonId = wanted && !(wanted in this.bundle.nodes) ? null : wanted;
    const history = this.messagesOf(t.id).map((m) => ({ role: m.role, content: m.content }));
    const learner = this.ai.learnerContext(this.bundle, this.statesMap(), {
      lessonId, section: b.section, knownTerms: service.knownTerms(this.store, this.bundle), mistakes: service.recentMistakes(this.store),
    });
    let data: Json;
    let meta: { model: string | null; tool_calls: unknown[] };
    try {
      [data, meta] = await this.ai.chat(this.bundle, { mode: t.mode, learner, history, userText: b.content });
    } catch (e) {
      throw this.aiFailure(e) ?? e;
    }
    const reply = this.store.transaction(() => {
      const thread = this.threadOr404(t.id); // deleted while the tutor was thinking?
      this.store.insert("chat_messages", {
        thread_id: thread.id, role: "user", content: b.content, structured: null, context: { lesson_id: lessonId, section: b.section },
        created_at: this.store.isoNow(),
      });
      const rest: Json = {};
      for (const [k, v] of Object.entries(data)) if (k !== "reply") rest[k] = v;
      const row = this.store.insert("chat_messages", {
        thread_id: thread.id, role: "assistant", content: typeof data.reply === "string" ? data.reply : pyStr(data.reply ?? ""),
        structured: { ...rest, tool_calls: meta.tool_calls, model: meta.model }, context: null, created_at: this.store.isoNow(),
      });
      const patch: Partial<ChatThreadRow> = { updated_at: this.store.isoNow() };
      if (thread.title === "New conversation") patch.title = pySlice(pyStrip(b.content).split("\n").join(" "), 60);
      this.store.update("chat_threads", thread.id, patch);
      service.recordEvent(this.store, "tutor_message", { lessonId, data: { thread: thread.id, strategy: data.strategy ?? null, mode: thread.mode } });
      return row;
    });
    return this.messageOut(reply);
  }

  // ------------------------------------------------------------------ wonderings.py

  private wonderingOut(w: WonderingRow): S["WonderingOut"] {
    return { id: w.id, text: w.text, lesson_id: w.lesson_id ?? null, status: w.status, note: w.note ?? null, created_at: w.created_at, updated_at: w.updated_at };
  }

  private wonderingOr404(raw: string): WonderingRow {
    const [wid] = validate([intParam(), raw, ["path", "wid"]]);
    const w = this.store.get("wonderings", wid);
    if (!w) throw new LocalHttpError(404, "Unknown wondering");
    return w;
  }

  private listWonderings(): S["WonderingOut"][] {
    return byNewest(this.store.rows("wonderings"), "created_at").map((w) => this.wonderingOut(w));
  }

  private addWondering(c: Ctx): S["WonderingOut"] {
    const [b] = validate([WonderingIn, c.body, ["body"]]);
    const w = this.store.transaction(() => {
      const now = this.store.isoNow();
      const row = this.store.insert("wonderings", { text: pyStrip(b.text), lesson_id: b.lesson_id, status: "open", note: null, created_at: now, updated_at: now });
      service.recordEvent(this.store, "wondering_added", { lessonId: b.lesson_id, data: { text: pySlice(b.text, 200) } });
      return row;
    });
    return this.wonderingOut(w);
  }

  private updateWondering(c: Ctx): S["WonderingOut"] {
    const [wid, b] = validate<[number, { status: string | null; note: string | null }]>(
      [intParam(), c.params.wid, ["path", "wid"]],
      [WonderingPatch, c.body, ["body"]],
    );
    const w = this.store.get("wonderings", wid);
    if (!w) throw new LocalHttpError(404, "Unknown wondering");
    const patch: Partial<WonderingRow> = {};
    if (b.status !== null) patch.status = b.status;
    if (b.note !== null) patch.note = b.note;
    patch.updated_at = this.store.isoNow();
    return this.wonderingOut(this.store.transaction(() => this.store.update("wonderings", w.id, patch)));
  }

  private deleteWondering(c: Ctx): undefined {
    const w = this.wonderingOr404(c.params.wid);
    this.store.transaction(() => this.store.delete("wonderings", (x) => x.id === w.id));
    return undefined;
  }
}

// ====================================================================== response helpers

/**
 * Newest first by a datetime column (Python: ORDER BY <col> DESC). Times here have millisecond
 * resolution (Python's have microseconds), so rows written in the same millisecond tie: the one
 * written later comes first, as it would in the backend.
 */
function byNewest<T extends Json>(rows: readonly T[], col: keyof T & string): T[] {
  return [...rows].reverse().sort((a, b) => cmp(String(b[col] ?? ""), String(a[col] ?? "")));
}

function visualOut(v: unknown): S["Visual"] | null {
  if (!isDict(v)) return null;
  return { widget: v.widget as string, props: isDict(v.props) ? v.props : {}, caption: v.caption as string, prompt: strOrNull(v.prompt) };
}

/** `QuestionPublic.model_validate(public_view(q))`: exactly the public fields, defaults filled in. */
function questionPublic(pub: Q): S["QuestionPublic"] {
  return {
    id: pub.id, type: pub.type as S["QuestionPublic"]["type"], kind: pub.kind, prompt: pub.prompt, hint: pub.hint ?? null,
    visual: visualOut(pub.visual),
    options: Array.isArray(pub.options) ? pub.options.map((o: Json) => ({ id: o.id as string, text: o.text as string })) : null,
    multi: pub.multi ?? null, unit: pub.unit ?? null, items: Array.isArray(pub.items) ? [...pub.items] : null,
    order_label: pub.order_label ?? null, rubric_count: pub.rubric_count ?? null, mode: pub.mode ?? null, max_tries: pub.max_tries,
    generated_from: pub.generated_from ?? null,
  };
}

type AnswerBase = Pick<S["AnswerOut"], "valid" | "correct" | "credit" | "try_number" | "tries_left" | "done">;

function answerOut(a: AnswerBase & Partial<S["AnswerOut"]>): S["AnswerOut"] {
  return {
    valid: a.valid, correct: a.correct, credit: a.credit, try_number: a.try_number, tries_left: a.tries_left, done: a.done,
    message: a.message ?? null, diagnosis: a.diagnosis ?? null, revisit: a.revisit ?? null, hint: a.hint ?? null, reveal: a.reveal ?? null,
    graded_by: a.graded_by ?? "rule", feedback: a.feedback ?? null, rubric_met: a.rubric_met ?? null,
  };
}

// ====================================================================== import (progress.py import_data)

class BadBackup extends Error {}

function importValue(table: TableName, col: Column, v: unknown): unknown {
  const bad = () => new BadBackup(`backup: ${table}.${col.name} has an unusable value`);
  switch (col.kind) {
    case "datetime": {
      const iso = parseDateTime(v);
      if (iso === null) throw bad();
      return iso;
    }
    case "str":
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "1" : "0";
      throw bad();
    case "int":
    case "float":
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
      throw bad();
    case "bool":
      if (typeof v === "boolean") return v;
      if (v === 0 || v === 1) return v === 1;
      throw bad();
    default:
      return v;
  }
}

/** Rebuild every table from a backup's `tables`, the way the backend re-inserts the rows. */
function importTables(tables: Json, now: () => string, newId: () => string): Tables {
  const out = emptyTables();
  const keys: Partial<Record<TableName, Set<unknown>>> = {};
  for (const t of TABLES) {
    const spec = SCHEMA[t];
    const raw = has(tables, t) ? tables[t] : [];
    if (!Array.isArray(raw)) throw new BadBackup(`backup: ${t} is not a list`);
    const seen = new Set<unknown>();
    let maxId = 0;
    const rows: Json[] = [];
    for (const row of raw) {
      if (!isDict(row)) throw new BadBackup(`backup: a ${t} row is not an object`);
      const r: Json = {};
      for (const col of spec.columns) {
        const given = has(row, col.name) ? row[col.name] : undefined;
        if (spec.autoincrement && col.name === "id" && (given === undefined || given === null)) {
          r.id = undefined;
        } else if (given === undefined) {
          const d = col.default;
          if (d === "now") r[col.name] = now();
          else if (d === "uuid") r[col.name] = newId();
          else if (d === "dict") r[col.name] = {};
          else if (d !== undefined) r[col.name] = d;
          else if (col.nullable) r[col.name] = null;
          else throw new BadBackup(`backup: ${t}.${col.name} is missing`);
        } else if (given === null) {
          if (!col.nullable && col.kind !== "json") throw new BadBackup(`backup: ${t}.${col.name} is null`);
          r[col.name] = null;
        } else {
          r[col.name] = importValue(t, col, given);
        }
      }
      if (spec.autoincrement) {
        if (r.id === undefined) r.id = maxId + 1;
        maxId = Math.max(maxId, Number(r.id));
      }
      const pk = r[spec.primaryKey];
      if (seen.has(pk)) throw new BadBackup(`backup: duplicate ${t} key ${String(pk)}`);
      seen.add(pk);
      rows.push(r);
    }
    if (spec.autoincrement) rows.sort((a, b) => Number(a.id) - Number(b.id));
    keys[t] = seen;
    (out as Record<string, unknown>)[t] = rows;
  }
  for (const t of TABLES) {
    for (const col of SCHEMA[t].columns) {
      if (!col.references) continue;
      const targets = keys[col.references]!;
      for (const r of (out as Record<string, Json[]>)[t]) {
        if (!targets.has(r[col.name])) throw new BadBackup(`backup: ${t}.${col.name} refers to a missing row`);
      }
    }
  }
  return out;
}

