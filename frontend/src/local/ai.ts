/**
 * The AI tutor of the standalone build: a port of backend/app/ai/tutor.py (and the error semantics of
 * provider.py) on top of the artifact `sample` capability, which asks Claude on the viewer's own account.
 *
 * `sample` has no system prompt and no schema-constrained output, so every call is a list of turns whose first
 * user turn holds the standing instructions - the tutor prompt (content.json `prompts`), the context, and the
 * JSON reply format described in words with an example - followed by the conversation, ending on the learner's
 * message. The parsed reply is checked and coerced to the shape of tutor.py's schemas before anything uses it.
 * The exact `calculate` tool (./calculator) is offered where the view can run page tools.
 */
import { CALCULATOR_TOOL_DESCRIPTION, CalcError, calculate } from "./calculator";
import type { ContentBundle, Q } from "./types";

// ------------------------------------------------------------------ errors (provider.py)

/** The tutor could not produce a usable answer. The message is shown to the learner. */
export class AIError extends Error {
  /** The `sample` error code behind it, when there was one. */
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "AIError";
    this.code = code;
  }
}

/** The AI cannot be used in this view (no `sample`, or Claude is not allowed here). */
export class AIUnavailable extends AIError {
  constructor(message: string, code: string | null = null) {
    super(message, code);
    this.name = "AIUnavailable";
  }
}

/** Claude declined the request. */
export class AIRefusal extends AIError {
  constructor(message: string, code: string | null = null) {
    super(message, code);
    this.name = "AIRefusal";
  }
}

// ------------------------------------------------------------------ constants (tutor.py)

const STRATEGIES: readonly string[] = [
  "plain-language", "everyday-analogy", "visual", "worked-example", "story", "eli5", "contrast",
  "smaller-steps", "question-led", "history", "physical-activity", "formal", "other",
];
/** content/schema.py StatementKind. */
const KINDS: readonly string[] = [
  "definition", "established-fact", "proven-theorem", "conjecture", "computational-observation", "hypothesis",
  "speculation", "disproved-claim", "unverified-proof", "formally-verified-proof", "convention",
];
/** loader.py LINK_RE: `[[target]]` or `[[target|shown words]]`. */
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

const OUTSIDE = "Open this page on claude.ai to use the AI tutor.";
const NO_SAMPLE = "Claude isn't available in this view.";
const UNREADABLE = "The tutor's answer could not be read. Please try again.";
/** `sample` does not say which model answered; this is what results report as their `model`. */
const MODEL = "Claude";
const FALLBACK_PROMPT = "You are a patient, careful mathematics tutor for one learner starting from the foundations.";
/** `use()` resolves null by itself about 10 s after load when the host never answers. */
const USE_TIMEOUT_MS = 12_000;
const DEFAULT_PROMPT_BYTES = 262_144;
/** Room left for the platform's own framing when trimming a long conversation. */
const PROMPT_MARGIN_BYTES = 8_192;

// ------------------------------------------------------------------ helpers

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Python's `str.strip()` (its whitespace set differs a little from JavaScript's `trim()`). */
const PY_SPACE = "[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const STRIP_RE = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, "g");
const pyStrip = (s: string): string => s.replace(STRIP_RE, "");

const encoder = new TextEncoder();
const utf8Bytes = (s: string): number => encoder.encode(s).length;

/** At most `max` UTF-8 bytes of `s`, cut at a character boundary. */
function cutBytes(s: string, max: number): string {
  if (utf8Bytes(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (utf8Bytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}

// ------------------------------------------------------------------ context (tutor.py)

/** Large, rarely changing context: dictionary and lesson indexes. */
export function stableContext(bundle: ContentBundle): string {
  const terms = Object.values(bundle.terms)
    .map((t) => `- ${t.id}: ${t.word}`)
    .join("\n");
  const lessons = bundle.order
    .map((lid) => `- ${lid}: ${bundle.nodes[lid]?.title ?? ""}${has(bundle.lessons, lid) ? "" : " (planned)"}`)
    .join("\n");
  return `## Dictionary index (term id: word)\n${terms}\n\n## Lesson index (lesson id: title)\n${lessons}\n`;
}

export function learnerContext(
  bundle: ContentBundle,
  states: Record<string, string>,
  opts: { lessonId?: string | null; section?: string | null; knownTerms?: string[] | null; mistakes?: string[] | null } = {},
): string {
  const { lessonId = null, section = null, knownTerms = null, mistakes = null } = opts;
  const stateOf = (id: string): string => (has(states, id) ? String(states[id]) : "not_started");
  const known = bundle.order.filter((i) => has(states, i) && (states[i] === "understood" || states[i] === "mastered"));
  const revision = bundle.order.filter((i) => has(states, i) && states[i] === "needs_revision");
  const parts = ["## The learner right now"];
  parts.push("Lessons understood or mastered: " + (known.length ? known.join(", ") : "none yet - treat the learner as a complete beginner"));
  if (revision.length) parts.push("Lessons needing revision: " + revision.join(", "));
  if (knownTerms !== null && knownTerms !== undefined) {
    parts.push("Dictionary words the learner has met: " + (knownTerms.length ? knownTerms.join(", ") : "none yet"));
  }
  if (mistakes && mistakes.length) parts.push("Recent mistakes (diagnoses):\n" + mistakes.slice(0, 8).map((m) => `- ${m}`).join("\n"));
  if (lessonId && has(bundle.nodes, lessonId)) {
    const node = bundle.nodes[lessonId];
    parts.push(`\n## Current lesson: ${node.title} (${lessonId})`);
    parts.push(`Learner's state for this lesson: ${stateOf(lessonId)}`);
    if (section) parts.push(`The learner is looking at the '${section}' section.`);
    const lesson = has(bundle.lessons, lessonId) ? bundle.lessons[lessonId] : undefined;
    if (lesson) {
      parts.push(`Goal: ${pyStrip(lesson.goal)}`);
      parts.push(`Plain explanation used in the lesson:\n${pyStrip(lesson.plain)}`);
      parts.push(`Formal statement: ${pyStrip(lesson.formal.statement)}`);
      parts.push("Strategies the lesson already uses: " + [lesson.analogy.strategy, ...lesson.alternatives.map((a) => a.strategy)].join(", "));
    } else {
      parts.push(`This lesson is planned but not yet written. Summary: ${node.summary}`);
    }
    if (node.pre.length) parts.push("Its prerequisites: " + node.pre.map((p) => `${p} (${stateOf(p)})`).join(", "));
  }
  return parts.join("\n");
}

// ------------------------------------------------------------------ sanitising (tutor.py)

/** Replace links to unknown terms or lessons with their plain words. */
export function sanitizeLinks(text: string, bundle: ContentBundle): string {
  return text.replace(LINK_RE, (whole: string, rawTarget: string, label: string | undefined) => {
    const target = pyStrip(rawTarget);
    const lesson = target.startsWith("lesson:");
    const ok = lesson ? has(bundle.nodes, target.slice("lesson:".length)) : has(bundle.terms, target);
    if (ok) return whole;
    return label ? label : lesson ? target.slice("lesson:".length) : target;
  });
}

export function cleanReply(data: Record<string, unknown>, bundle: ContentBundle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of ["reply", "explanation", "check_question", "feedback", "title"]) {
    const v = out[key];
    if (typeof v === "string") out[key] = sanitizeLinks(v, bundle);
  }
  if (has(out, "missing_prerequisites")) {
    const list = Array.isArray(out.missing_prerequisites) ? out.missing_prerequisites : [];
    out.missing_prerequisites = list.filter((p) => typeof p === "string" && has(bundle.nodes, p)).slice(0, 6);
  }
  if (has(out, "statements")) {
    const list = Array.isArray(out.statements) ? out.statements : [];
    out.statements = list.filter((s) => isRecord(s) && typeof s.kind === "string" && KINDS.includes(s.kind)).slice(0, 10);
  }
  return out;
}

// ------------------------------------------------------------------ the reply formats (tutor.py schemas)

const JSON_ONLY = "Reply with one JSON object and nothing else (no words before or after it, no code fence). It has exactly these fields:";
const STRATEGY_FIELD = `- "strategy" (string): the teaching strategy you used, exactly one of: ${STRATEGIES.join(", ")}.`;

/** Said when the calculator cannot be offered: the prompts ask Claude to use it. */
const NO_CALCULATOR =
  "The `calculate` tool is not available in this view, so work out any arithmetic carefully, step by step, and show the steps.";

const format = (lines: string[], example: Record<string, unknown>) =>
  ["## Your reply", JSON_ONLY, ...lines, "Example:", JSON.stringify(example)].join("\n");

/** CHAT_SCHEMA */
const CHAT_FORMAT = format(
  [
    `- "reply" (string): the answer to the learner, in the formatting described above.`,
    STRATEGY_FIELD,
    `- "check_question" (string): one short question checking understanding, or "" if there is none.`,
    `- "missing_prerequisites" (array of strings): ids from the lesson index of lessons the learner needs first, or [].`,
    `- "new_terms" (array of strings): mathematical words you used that are not in the dictionary index, or [].`,
    `- "statements" (array of objects): the notable mathematical statements you made, each {"kind": ..., "text": ...} with "kind" exactly one of: ${KINDS.join(", ")}; or [].`,
  ],
  {
    reply: "...", strategy: "worked-example", check_question: "...?", missing_prerequisites: [], new_terms: [],
    statements: [{ kind: "definition", text: "..." }],
  },
);

/** EXPLAIN_SCHEMA */
const EXPLAIN_FORMAT = format(
  [
    STRATEGY_FIELD,
    `- "title" (string): a short title for the explanation.`,
    `- "explanation" (string): the explanation itself, in the formatting described above.`,
    `- "check_question" (string): one short question checking understanding.`,
  ],
  { strategy: "story", title: "...", explanation: "...", check_question: "...?" },
);

/** GRADE_SCHEMA */
const gradeFormat = (items: number) =>
  format(
    [
      `- "rubric_met" (array of ${items} booleans): one per rubric item, in order - true if the learner's answer expresses that idea, otherwise false.`,
      `- "feedback" (string): kind, specific feedback in plain language.`,
      `- "misconception" (string): a misconception the answer reveals, or "" if there is none.`,
    ],
    { rubric_met: [true, false, true], feedback: "...", misconception: "" },
  ).replace("\nExample:\n", "\nExample (for a rubric of three items):\n");

/** TERM_SCHEMA */
const TERM_FORMAT = format(
  [
    `- "word" (string): the word.`,
    `- "pronunciation" (string): how to say it aloud.`,
    `- "plain" (string): what it means, in plain words with no technical terms.`,
    `- "analogy" (string): an everyday analogy.`,
    `- "visual_description" (string): what the learner would see if they drew or built it.`,
    `- "formal" (string): the precise, standard definition.`,
    `- "example" (string): an example.`,
    `- "non_example" (string): something that is not an example, and why.`,
    `- "related" (array of strings): related words.`,
    `- "used_later" (string): where the idea is used later in mathematics.`,
    `- "is_mathematical_term" (boolean): false if the word is not a mathematical term.`,
  ],
  {
    word: "...", pronunciation: "...", plain: "...", analogy: "...", visual_description: "...", formal: "...",
    example: "...", non_example: "...", related: ["..."], used_later: "...", is_mathematical_term: true,
  },
);

// ------------------------------------------------------------------ checking the reply

const unreadable = () => new AIError(UNREADABLE, "unreadable");

function asObject(raw: unknown): Record<string, unknown> {
  const v = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (!isRecord(v)) throw unreadable();
  return v;
}

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function textList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return items.map(text).filter((s): s is string => !!s);
}

const normalise = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_]+/g, "-") : "");

function choice(v: unknown, allowed: readonly string[], fallback: string): string {
  const s = normalise(v);
  return allowed.includes(s) ? s : fallback;
}

function flag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "yes", "y", "met", "1"].includes(v.trim().toLowerCase());
  return false;
}

function statements(v: unknown): { kind: string; text: string }[] {
  const items = Array.isArray(v) ? v : [];
  const out: { kind: string; text: string }[] = [];
  for (const s of items) {
    const body = isRecord(s) ? text(s.text) : null;
    if (isRecord(s) && body) out.push({ kind: normalise(s.kind), text: body }); // clean_reply drops unknown kinds
  }
  return out;
}

function chatData(raw: unknown): Record<string, unknown> {
  const o = asObject(raw);
  const reply = text(o.reply) || text(o.answer) || text(o.response) || text(o.message) || text(o.text);
  if (!reply) throw unreadable();
  return {
    reply,
    strategy: choice(o.strategy, STRATEGIES, "other"),
    check_question: text(o.check_question) ?? "",
    missing_prerequisites: textList(o.missing_prerequisites),
    new_terms: textList(o.new_terms),
    statements: statements(o.statements),
  };
}

function explainData(raw: unknown): Record<string, unknown> {
  const o = asObject(raw);
  const explanation = text(o.explanation) || text(o.text) || text(o.reply);
  if (!explanation) throw unreadable();
  return {
    strategy: choice(o.strategy, STRATEGIES, "other"),
    title: text(o.title) || "Another way to see it",
    explanation,
    check_question: text(o.check_question) ?? "",
  };
}

function gradeData(raw: unknown): Record<string, unknown> {
  const o = asObject(raw);
  if (!Array.isArray(o.rubric_met)) throw unreadable();
  return { rubric_met: o.rubric_met.map(flag), feedback: text(o.feedback) ?? "", misconception: text(o.misconception) ?? "" };
}

function termData(raw: unknown, word: string): Record<string, unknown> {
  const o = asObject(raw);
  const usedLater = Array.isArray(o.used_later) ? textList(o.used_later).join("; ") : (text(o.used_later) ?? "");
  const entry = {
    word: text(o.word) || word,
    pronunciation: text(o.pronunciation) ?? "",
    plain: text(o.plain) ?? "",
    analogy: text(o.analogy) ?? "",
    visual_description: text(o.visual_description) ?? "",
    formal: text(o.formal) ?? "",
    example: text(o.example) ?? "",
    non_example: text(o.non_example) ?? "",
    related: textList(o.related),
    used_later: usedLater,
    is_mathematical_term: o.is_mathematical_term === undefined || o.is_mathematical_term === null ? true : flag(o.is_mathematical_term),
  };
  if (!entry.plain && !entry.formal && entry.is_mathematical_term) throw unreadable();
  return entry;
}

// ------------------------------------------------------------------ the sample capability

type Turn = { role: "user" | "assistant"; content: string };
type ToolCall = { name: string; input: Record<string, unknown>; output: string; error: boolean };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): unknown;
};
type SampleOptions = { modelTier?: string; tools?: Tool[]; cache?: false };
type SampleLimits = { maxPromptBytes?: unknown; tools?: unknown; modelTiers?: unknown };
type Sample = { json(input: Turn[], options: SampleOptions): Promise<unknown>; limits?: () => Promise<SampleLimits> };
type ClaudeGlobal = { use(name: string): Promise<unknown> };

const samples = new WeakMap<object, Promise<Sample | null>>();
const limitsOf = new WeakMap<object, Promise<SampleLimits | null>>();
/** Views where Claude must not be asked again (a decline, Claude switched off): the learner-facing reason. */
const blocked = new WeakMap<object, string>();
/** Views that refused page tools: later calls go without the calculator. */
const toolless = new WeakSet<object>();

function claudeGlobal(): ClaudeGlobal | null {
  try {
    const c = (globalThis as { window?: { claude?: unknown } }).window?.claude;
    return c && typeof (c as ClaudeGlobal).use === "function" ? (c as ClaudeGlobal) : null;
  } catch {
    return null;
  }
}

const isSample = (x: unknown): x is Sample =>
  (typeof x === "function" || (typeof x === "object" && x !== null)) && typeof (x as { json?: unknown }).json === "function";

/** `claude.use("sample")`, asked once per page. */
function sampleOf(claude: ClaudeGlobal): Promise<Sample | null> {
  let p = samples.get(claude);
  if (!p) {
    p = new Promise<Sample | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), USE_TIMEOUT_MS);
      Promise.resolve()
        .then(() => claude.use("sample"))
        .then(
          (s) => {
            clearTimeout(timer);
            resolve(isSample(s) ? s : null);
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          },
        );
    });
    samples.set(claude, p);
  }
  return p;
}

function limitsFor(sample: Sample): Promise<SampleLimits | null> {
  let p = limitsOf.get(sample);
  if (!p) {
    p = Promise.resolve()
      .then(() => (typeof sample.limits === "function" ? sample.limits() : null))
      .then(
        (l) => (isRecord(l) ? l : null),
        () => null,
      );
    limitsOf.set(sample, p);
  }
  return p;
}

function tierFor(limits: SampleLimits | null, tier: string): string | undefined {
  const tiers = limits?.modelTiers;
  if (!Array.isArray(tiers) || tiers.includes(tier)) return tier;
  return tiers.includes("default") ? "default" : undefined;
}

/** The exact calculator as a page tool; each call is recorded like provider.py's `tool_calls`. */
function calculatorTool(calls: ToolCall[]): Tool {
  return {
    name: "calculate",
    description: cutBytes(CALCULATOR_TOOL_DESCRIPTION, 1000),
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The expression to evaluate, e.g. 'gcd(84, 120)' or '3/4 + 1/6'." },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    execute(input) {
      const given: Record<string, unknown> = isRecord(input) ? { ...input } : {};
      const expression = typeof given.expression === "string" ? given.expression : String(given.expression ?? "");
      try {
        const output = String(calculate(expression).result);
        calls.push({ name: "calculate", input: given, output, error: false });
        return output;
      } catch (e) {
        const message = e instanceof CalcError ? (e as Error).message : `could not evaluate (${e instanceof Error ? e.name : "error"})`;
        calls.push({ name: "calculate", input: given, output: `Error: ${message}`, error: true });
        throw new Error(message); // Claude reads "Error: <message>" and carries on
      }
    },
  };
}

function blockedError(sample: Sample, code: string, message: string): AIUnavailable {
  blocked.set(sample, message);
  return new AIUnavailable(message, code);
}

/** A rejected `sample` call as the error the learner sees (sample.d.ts SampleErrorCode). Never retried. */
function toAIError(e: unknown, sample: Sample): AIError {
  if (e instanceof AIError) return e;
  const code = isRecord(e) && typeof e.code === "string" ? e.code : "upstream_error";
  switch (code) {
    case "not_granted":
      return blockedError(sample, code, "Claude isn't allowed for this page yet. Allow it when asked, or check the artifact's permissions.");
    case "sampling_disabled":
      return blockedError(sample, code, "Claude isn't available for your account or organization right now, so the AI tutor is off.");
    case "not_declared":
      return blockedError(sample, code, "This page is no longer allowed to use Claude, so the AI tutor is off.");
    case "capability_disabled":
    case "capability_removed":
      return blockedError(sample, code, NO_SAMPLE);
    case "tools_unavailable":
      toolless.add(sample);
      return new AIError("Claude couldn't use its exact calculator in this view. Please try again.", code);
    case "rate_limited":
      return new AIError("Claude is busy right now - please try again in a minute.", code);
    case "session_expired":
      return new AIError("Your Claude session has expired. Sign in to claude.ai again, then try once more.", code);
    case "refused":
      return new AIRefusal("Claude declined to answer this request. Try asking in a different way.", code);
    case "prompt_too_large":
      return new AIError("This is too much for Claude to read at once. Start a new conversation or ask a shorter question.", code);
    case "invalid_json":
      return new AIError(UNREADABLE, code);
    case "empty_completion":
      return new AIError("Claude returned an empty answer. Please try again, perhaps asking for less at once.", code);
    case "cancelled":
      return new AIError("The request to Claude was stopped before it finished. Please try again.", code);
    case "invalid_request":
    case "transform_error":
    case "queue_overflow":
    case "images_unavailable":
    case "image_rejected":
      return new AIError("Something went wrong while asking Claude. Please try again.", code);
    default: // upstream_error, and codes this page does not know
      return new AIError("Claude ran into a problem answering. Please try again in a moment.", code);
  }
}

type Ask = {
  tier: "default" | "quick";
  /** Offer the calculator (provider.py `use_calculator`) where the view can run page tools. */
  calculator: boolean;
  /** A repeat must give a new answer (chat turns, "explain differently"): `cache: false` when there are no tools. */
  fresh: boolean;
  /** The turns to send, given whether the calculator is offered and how many bytes of text fit. */
  turns(calculator: boolean, budget: number): Turn[];
};

/** provider.structured(): one `sample.json` call; the parsed reply and the calculator calls made. */
async function ask(a: Ask): Promise<{ data: unknown; toolCalls: ToolCall[] }> {
  const claude = claudeGlobal();
  if (!claude) throw new AIUnavailable(OUTSIDE);
  const sample = await sampleOf(claude);
  if (!sample) throw new AIUnavailable(NO_SAMPLE);
  const reason = blocked.get(sample);
  if (reason) throw new AIUnavailable(reason);
  const limits = await limitsFor(sample);
  const toolCalls: ToolCall[] = [];
  const withTools = a.calculator && !!limits?.tools && !toolless.has(sample);
  const options: SampleOptions = {};
  const tier = tierFor(limits, a.tier);
  if (tier) options.modelTier = tier;
  if (withTools) options.tools = [calculatorTool(toolCalls)];
  else if (a.fresh) options.cache = false; // a call with tools must not pass `cache`
  const max = typeof limits?.maxPromptBytes === "number" && limits.maxPromptBytes > 0 ? limits.maxPromptBytes : DEFAULT_PROMPT_BYTES;
  const turns = a.turns(withTools, max - PROMPT_MARGIN_BYTES);
  let data: unknown;
  try {
    data = await sample.json(turns, options);
  } catch (e) {
    throw toAIError(e, sample);
  }
  return { data, toolCalls };
}

function promptOf(bundle: ContentBundle, mode: string): string {
  const prompts = bundle.json?.prompts;
  const prompt = mode === "research" ? prompts?.research : prompts?.teaching;
  return typeof prompt === "string" && prompt.trim() ? prompt : FALLBACK_PROMPT;
}

/** The standing instructions: the leading user turn of every call. */
function instructions(parts: (string | null)[]): Turn {
  return { role: "user", content: parts.filter((p): p is string => !!p).join("\n\n") };
}

/** Drop the oldest turns of a conversation until everything fits in `budget` bytes. */
function fit(head: Turn, past: Turn[], last: Turn, budget: number): Turn[] {
  const sizes = past.map((t) => utf8Bytes(t.content));
  let total = utf8Bytes(head.content) + utf8Bytes(last.content) + sizes.reduce((x, y) => x + y, 0);
  let start = 0;
  while (start < past.length && total > budget) total -= sizes[start++];
  return [head, ...past.slice(start), last];
}

// ------------------------------------------------------------------ operations (tutor.py)

/** Answer one learner message. Earlier turns are replayed as plain text only (the last 20). */
export async function chat(
  bundle: ContentBundle,
  opts: { mode: string; learner: string; history: { role: string; content: string }[]; userText: string },
): Promise<[Record<string, unknown>, { model: string | null; tool_calls: unknown[] }]> {
  const { mode, learner, history, userText } = opts;
  if (typeof userText !== "string" || !userText.trim()) throw new AIError("Write a message for the tutor first.");
  const past: Turn[] = history
    .slice(-20)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role as Turn["role"], content: m.content }));
  const result = await ask({
    tier: "default",
    calculator: true,
    fresh: true,
    turns: (calculator, budget) =>
      fit(
        instructions([promptOf(bundle, mode), stableContext(bundle), learner, CHAT_FORMAT, calculator ? null : NO_CALCULATOR]),
        past,
        { role: "user", content: userText },
        budget,
      ),
  });
  const data = cleanReply(chatData(result.data), bundle);
  return [data, { model: MODEL, tool_calls: result.toolCalls }];
}

/** The "I don't understand" button: the core idea again, with a strategy not yet tried. */
export async function explainDifferently(
  bundle: ContentBundle,
  opts: { learner: string; lessonId: string; section: string | null; tried: string[] },
): Promise<Record<string, unknown>> {
  const { learner, lessonId, section, tried } = opts;
  const lesson = has(bundle.lessons, lessonId) ? bundle.lessons[lessonId] : undefined;
  const title = has(bundle.nodes, lessonId) ? bundle.nodes[lessonId].title : lessonId;
  let request =
    `The learner pressed "I don't understand" while studying '${title}'` +
    (section ? `, in the '${section}' section` : "") +
    ". These teaching strategies have already been tried and did not work: " +
    (tried.length ? tried.join(", ") : "the lesson's main explanation") +
    ". Explain the core idea again using a genuinely different strategy, in very simple language, " +
    "following the new-language principle. Keep it under 250 words, and end with one short check question.";
  if (lesson) request += `\n\nThe idea being taught: ${pyStrip(lesson.goal)}`;
  const result = await ask({
    tier: "default",
    calculator: true,
    fresh: true,
    turns: (calculator) => [
      instructions([promptOf(bundle, "teaching"), stableContext(bundle), learner, EXPLAIN_FORMAT, calculator ? null : NO_CALCULATOR]),
      { role: "user", content: request },
    ],
  });
  return { ...cleanReply(explainData(result.data), bundle), model: MODEL };
}

/** Grade a free-text explanation against the question's rubric (one boolean per rubric item). */
export async function gradeExplanation(bundle: ContentBundle, opts: { question: Q; answerText: string }): Promise<Record<string, unknown>> {
  const { question, answerText } = opts;
  const items: unknown[] = Array.isArray(question.rubric) ? question.rubric : [];
  const rubric = items.map((r, i) => `${i + 1}. ${String(r)}`).join("\n");
  const request =
    "Grade a beginner's explanation against a rubric. Judge meaning, not wording: credit an idea if the learner " +
    "expresses it in their own words, even informally. Do not credit ideas that are absent or wrong.\n\n" +
    `Question: ${String(question.prompt)}\n\nRubric (key ideas):\n${rubric}\n\n` +
    `Model answer (for reference only): ${String(question.model_answer)}\n\n` +
    `Learner's answer:\n<<<\n${answerText}\n>>>\n\n` +
    "Return one boolean per rubric item in order, short encouraging feedback that names what was good and what " +
    "is missing, and any misconception revealed (or an empty string).";
  const result = await ask({
    tier: "quick",
    calculator: false,
    fresh: false,
    turns: () => [instructions([promptOf(bundle, "teaching"), gradeFormat(items.length)]), { role: "user", content: request }],
  });
  const data = cleanReply(gradeData(result.data), bundle);
  const met = (data.rubric_met as boolean[]).slice(0, items.length);
  while (met.length < items.length) met.push(false);
  data.rubric_met = met;
  return { ...data, model: MODEL };
}

/** Draft a dictionary entry for a word that is not in the curated dictionary. */
export async function draftTerm(bundle: ContentBundle, opts: { word: string; context: string | null }): Promise<Record<string, unknown>> {
  const { word, context } = opts;
  const request =
    `Write a dictionary entry for the mathematical word "${word}" for a learner starting from the foundations.` +
    (context ? ` The learner met it here: ${context}` : "") +
    " Give every field. The plain meaning must use no technical words. The formal definition must be correct " +
    "and standard. If the word is not a mathematical term, set is_mathematical_term to false. Do not invent " +
    "facts; if a field cannot be filled honestly, say so in that field.";
  const result = await ask({
    tier: "default",
    calculator: false,
    fresh: false,
    turns: () => [instructions([promptOf(bundle, "teaching"), stableContext(bundle), TERM_FORMAT]), { role: "user", content: request }],
  });
  return { ...cleanReply(termData(result.data, word), bundle), model: MODEL };
}

// ------------------------------------------------------------------ status

/** configured iff `claude.use("sample")` resolved (and Claude has not been refused for this view). */
export async function aiStatus(): Promise<{ configured: boolean; provider: string; model: string | null; reason: string | null }> {
  const claude = claudeGlobal();
  const sample = claude ? await sampleOf(claude) : null;
  const reason = !claude ? OUTSIDE : !sample ? NO_SAMPLE : (blocked.get(sample) ?? null);
  return { configured: reason === null, provider: "claude", model: null, reason };
}
