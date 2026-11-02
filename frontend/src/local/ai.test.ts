import { afterEach, describe, expect, it } from "vitest";
import contentJson from "../../standalone/content.json";
import {
  AIError,
  AIRefusal,
  AIUnavailable,
  aiStatus,
  chat,
  cleanReply,
  draftTerm,
  explainDifferently,
  gradeExplanation,
  learnerContext,
  sanitizeLinks,
  stableContext,
} from "./ai";
import { CALCULATOR_TOOL_DESCRIPTION } from "./calculator";
import type { ContentBundle, ContentJson, Lesson, LessonNode, Q, Stage, Term } from "./types";

const content = contentJson as unknown as ContentJson;

/** A ContentBundle with just what ai.ts reads (content.ts builds the real one). */
function makeBundle(json: ContentJson): ContentBundle {
  return {
    json,
    stages: Object.fromEntries(json.curriculum.stages.map((s): [string, Stage] => [s.id, s])),
    nodes: Object.fromEntries(json.curriculum.lessons.map((n): [string, LessonNode] => [n.id, n])),
    lessons: json.lessons,
    terms: json.terms,
    widgets: json.widgets,
    order: json.order,
    children: json.children,
    feeds: json.feeds,
    ancestors: () => [],
    descendants: () => [],
    isAvailable: (id) => id in json.lessons,
    termIndex: () => [],
    findTerms: () => [],
  };
}

const bundle = makeBundle(content);
const TEACHING = content.prompts.teaching;
const RESEARCH = content.prompts.research;

// ---------------------------------------------------------------- a fake `sample` capability

type Turn = { role: string; content: string };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: { signal: AbortSignal }): unknown;
};
type Options = { modelTier?: string; tools?: Tool[]; cache?: unknown };
type Step = unknown | ((input: Turn[], options: Options) => unknown);

/** A scripted rejection of `sample.json`. */
class Reject {
  constructor(readonly error: unknown) {}
}

function fakeSample(script: Step[], limits: Record<string, unknown> = { maxPromptBytes: 262_144 }) {
  const calls: { input: Turn[]; options: Options }[] = [];
  const sample = Object.assign(
    async () => {
      throw { code: "invalid_request", message: "this fake only answers json()" };
    },
    {
      json: async (input: Turn[], options: Options) => {
        calls.push({ input: JSON.parse(JSON.stringify(input)) as Turn[], options });
        if (!script.length) throw { code: "upstream_error", message: "nothing scripted" };
        const next = script.shift();
        if (next instanceof Reject) throw next.error;
        return typeof next === "function" ? await next(input, options) : next;
      },
      limits: async () => limits,
    },
  );
  return { sample: Object.freeze(sample), calls };
}

const g = globalThis as unknown as { window?: unknown };

function install(sample: unknown): void {
  g.window = { claude: Object.freeze({ use: async (name: string) => (name === "sample" ? sample : null) }) };
}

afterEach(() => {
  delete g.window;
});

/** Plays the platform's part in a tool round: runs the page's `calculate` tool on each expression. */
function usesCalculator(expressions: string[], answer: unknown) {
  return async (input: Turn[], options: Options) => {
    expect(input.length).toBeGreaterThan(1);
    const tool = options.tools?.find((t) => t.name === "calculate");
    if (!tool) throw new Error("the calculator was not offered");
    for (const expression of expressions) {
      try {
        await tool.execute({ expression }, { signal: new AbortController().signal });
      } catch {
        /* Claude would read "Error: <message>" and carry on */
      }
    }
    return answer;
  };
}

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

const UNREADABLE = "The tutor's answer could not be read. Please try again.";

async function failure(p: Promise<unknown>): Promise<AIError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AIError) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

const ask = (userText = "What is a fraction?", history: { role: string; content: string }[] = []) =>
  chat(bundle, { mode: "teaching", learner: "## The learner right now", history, userText });

// ---------------------------------------------------------------- context and sanitising (tutor.py)

/** A tiny bundle, and what backend/app/ai/tutor.py returns for it (generated with the Python code). */
const tiny = {
  nodes: {
    "a-one": { id: "a-one", title: "First idea", summary: "The first idea.", pre: [] },
    "a-two": { id: "a-two", title: "Second idea", summary: "Builds on the first.", pre: ["a-one"] },
    "a-three": { id: "a-three", title: "Third idea", summary: "Not written yet.", pre: ["a-one", "a-two"] },
  } as unknown as Record<string, LessonNode>,
  lessons: {
    "a-two": {
      goal: "  Understand the second idea.\n",
      plain: "\tIt is like the first, only twice.\n\n",
      formal: { statement: " 2 = 1 + 1 \n" },
      analogy: { strategy: "everyday-objects" },
      alternatives: [{ strategy: "story" }, { strategy: "visual" }],
    },
  } as unknown as Record<string, Lesson>,
  terms: { one: { id: "one", word: "one" }, "two-word": { id: "two-word", word: "two (number)" } } as unknown as Record<string, Term>,
  order: ["a-one", "a-two", "a-three"],
};
const tinyBundle = { ...makeBundle(content), ...tiny } as ContentBundle;

describe("context, as tutor.py builds it", () => {
  it("matches stable_context and learner_context exactly", () => {
    expect(stableContext(tinyBundle)).toBe(
      "## Dictionary index (term id: word)\n- one: one\n- two-word: two (number)\n\n## Lesson index (lesson id: title)\n" +
        "- a-one: First idea (planned)\n- a-two: Second idea\n- a-three: Third idea (planned)\n",
    );
    expect(learnerContext(tinyBundle, {})).toBe(
      "## The learner right now\nLessons understood or mastered: none yet - treat the learner as a complete beginner",
    );
    expect(learnerContext(tinyBundle, {}, { lessonId: "nope" })).toBe(learnerContext(tinyBundle, {}));
    expect(
      learnerContext(tinyBundle, { "a-one": "mastered", "a-three": "needs_revision" }, {
        lessonId: "a-two", section: "plain", knownTerms: ["one"], mistakes: Array.from({ length: 10 }, (_, i) => `m${i}`),
      }),
    ).toBe(
      "## The learner right now\nLessons understood or mastered: a-one\nLessons needing revision: a-three\n" +
        "Dictionary words the learner has met: one\nRecent mistakes (diagnoses):\n- m0\n- m1\n- m2\n- m3\n- m4\n- m5\n- m6\n- m7\n" +
        "\n## Current lesson: Second idea (a-two)\nLearner's state for this lesson: not_started\n" +
        "The learner is looking at the 'plain' section.\nGoal: Understand the second idea.\n" +
        "Plain explanation used in the lesson:\nIt is like the first, only twice.\nFormal statement: 2 = 1 + 1\n" +
        "Strategies the lesson already uses: everyday-objects, story, visual\nIts prerequisites: a-one (mastered)",
    );
    expect(learnerContext(tinyBundle, { "a-two": "understood" }, { lessonId: "a-three", knownTerms: [] })).toBe(
      "## The learner right now\nLessons understood or mastered: a-two\nDictionary words the learner has met: none yet\n" +
        "\n## Current lesson: Third idea (a-three)\nLearner's state for this lesson: not_started\n" +
        "This lesson is planned but not yet written. Summary: Not written yet.\n" +
        "Its prerequisites: a-one (not_started), a-two (understood)",
    );
  });

  it("reflects the learner's progress on the real course (test_learner_context_reflects_progress)", () => {
    expect(learnerContext(bundle, {}, { lessonId: "l1-fractions" })).toContain("complete beginner");
    const ctx = learnerContext(bundle, { "l0-counting": "mastered", "l0-quantity": "needs_revision" }, {
      lessonId: "l2-addition", mistakes: ["l1-fractions: upside down"],
    });
    expect(ctx).toContain("l0-counting");
    expect(ctx).toContain("needing revision: l0-quantity");
    expect(ctx).toContain("planned but not yet written");
    expect(ctx).toContain("upside down");
    expect(stableContext(bundle)).toContain("- l2-addition: Addition (planned)");
    expect(stableContext(bundle)).toContain("- l1-fractions: Fractions\n");
  });

  it("keeps links to real terms and lessons only (test_sanitize_links)", () => {
    expect(sanitizeLinks("[[prime-number|primes]] [[fake|x]] [[lesson:l1-zero|zero]] [[lesson:nope|y]]", bundle)).toBe(
      "[[prime-number|primes]] x [[lesson:l1-zero|zero]] y",
    );
    expect(sanitizeLinks("[[one|1]] [[ one ]] [[fake]] [[fake|]] [[lesson:a-two|2]] [[lesson:zz]] [[lesson: a-one |x]]", tinyBundle)).toBe(
      "[[one|1]] [[ one ]] fake fake [[lesson:a-two|2]] zz x",
    );
    expect(sanitizeLinks("[[constructor|c]] [[lesson:toString|t]] [[__proto__]]", bundle)).toBe("c t __proto__");
  });

  it("cleans a reply like clean_reply", () => {
    const out = cleanReply({ ...CHAT_REPLY, title: "[[nope|T]]", other: "[[nope|kept]]" }, bundle);
    expect(out.reply).toBe("A [[fraction|fraction]] is part of a whole. See this and [[lesson:l1-fractions|the lesson]].");
    expect(out.title).toBe("T");
    expect(out.other).toBe("[[nope|kept]]");
    expect(out.missing_prerequisites).toEqual(["l1-equal-quantities"]);
    expect(out.statements).toEqual([{ kind: "definition", text: "A fraction is a/b with b not zero." }]);
    const many = cleanReply({ missing_prerequisites: Array(9).fill("l0-counting"), statements: Array(12).fill({ kind: "conjecture", text: "c" }) }, bundle);
    expect((many.missing_prerequisites as string[]).length).toBe(6);
    expect((many.statements as unknown[]).length).toBe(10);
    expect(cleanReply({ feedback: "ok" }, bundle)).toEqual({ feedback: "ok" });
  });
});

// ---------------------------------------------------------------- status

describe("aiStatus", () => {
  it("is off outside claude.ai", async () => {
    expect(await aiStatus()).toEqual({
      configured: false, provider: "claude", model: null, reason: "Open this page on claude.ai to use the AI tutor.",
    });
    await expect(ask()).rejects.toBeInstanceOf(AIUnavailable);
  });

  it("is off when this view has no sample capability", async () => {
    install(null);
    expect(await aiStatus()).toEqual({ configured: false, provider: "claude", model: null, reason: "Claude isn't available in this view." });
    const e = await failure(ask());
    expect(e).toBeInstanceOf(AIUnavailable);
    expect(e.message).toBe("Claude isn't available in this view.");
  });

  it("is on when claude.use('sample') resolves", async () => {
    install(fakeSample([]).sample);
    expect(await aiStatus()).toEqual({ configured: true, provider: "claude", model: null, reason: null });
  });
});

// ---------------------------------------------------------------- chat

describe("chat", () => {
  it("puts the teaching prompt, the context and the reply format first, and the learner's message last", async () => {
    const { sample, calls } = fakeSample([CHAT_REPLY]);
    install(sample);
    const learner = learnerContext(bundle, { "l0-what-is-mathematics": "understood" }, { lessonId: "l1-fractions", section: "plain" });
    const [data, meta] = await chat(bundle, { mode: "teaching", learner, history: [], userText: "What is a fraction?" });

    expect(calls).toHaveLength(1);
    const { input, options } = calls[0];
    expect(input.map((t) => t.role)).toEqual(["user", "user"]);
    const head = input[0].content;
    expect(head.startsWith(TEACHING)).toBe(true);
    expect(head).toContain("new-language principle");
    expect(head).toContain(stableContext(bundle));
    expect(head).toContain(learner);
    expect(head).toContain("Current lesson: Fractions");
    expect(head).toContain("The learner is looking at the 'plain' section.");
    for (const field of ['"reply"', '"strategy"', '"check_question"', '"missing_prerequisites"', '"new_terms"', '"statements"']) {
      expect(head).toContain(field);
    }
    expect(head).toContain("everyday-analogy, visual, worked-example");
    expect(head).toContain("computational-observation");
    expect(head).toContain("Example:");
    expect(head).toContain("`calculate` tool is not available");
    expect(input[1]).toEqual({ role: "user", content: "What is a fraction?" });
    expect(options).toEqual({ modelTier: "default", cache: false });

    expect(data.reply).toContain("[[fraction|fraction]]");
    expect(data.reply).not.toContain("no-such-term");
    expect(data.reply).toContain("this");
    expect(data.missing_prerequisites).toEqual(["l1-equal-quantities"]);
    expect(data.statements).toEqual([{ kind: "definition", text: "A fraction is a/b with b not zero." }]);
    expect(data.strategy).toBe("everyday-analogy");
    expect(data.check_question).toBe("What does the bottom number tell you?");
    expect(meta).toEqual({ model: "Claude", tool_calls: [] });
  });

  it("uses the research prompt in research mode", async () => {
    const { sample, calls } = fakeSample([CHAT_REPLY]);
    install(sample);
    await chat(bundle, { mode: "research", learner: "## The learner right now", history: [], userText: "Is there a pattern in prime gaps?" });
    const head = calls[0].input[0].content;
    expect(head.startsWith(RESEARCH)).toBe(true);
    expect(head).toContain("research collaborator");
    expect(head).not.toContain(TEACHING.slice(0, 80));
  });

  it("replays the last 20 turns as plain text and ends on the new message", async () => {
    const { sample, calls } = fakeSample([CHAT_REPLY, CHAT_REPLY]);
    install(sample);
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }));
    await ask("and now?", history);
    const turns = calls[0].input;
    expect(turns).toHaveLength(22);
    expect(turns.slice(1, -1)).toEqual(history.slice(-20));
    expect(turns.at(-1)).toEqual({ role: "user", content: "and now?" });

    // a reply that failed earlier leaves two user turns in a row: still fine, still ending on the new message
    await ask("again", [{ role: "user", content: "first" }, { role: "assistant", content: "" }, { role: "user", content: "second" }]);
    expect(calls[1].input.map((t) => t.content).slice(1)).toEqual(["first", "second", "again"]);
    expect(calls[1].input.every((t) => typeof t.content === "string" && t.content.length > 0)).toBe(true);
  });

  it("drops the oldest turns when the conversation is too long to send", async () => {
    const { sample, calls } = fakeSample([CHAT_REPLY], { maxPromptBytes: 80_000 });
    install(sample);
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i} ${"x".repeat(5_000)}` }));
    await ask("short question", history);
    const turns = calls[0].input;
    const bytes = turns.reduce((n, t) => n + Buffer.byteLength(t.content), 0);
    expect(bytes).toBeLessThanOrEqual(80_000);
    expect(turns[0].content.startsWith(TEACHING)).toBe(true);
    expect(turns.at(-1)).toEqual({ role: "user", content: "short question" });
    expect(turns.at(-2)?.content).toBe(history[19].content);
    expect(turns.length).toBeLessThan(22);
  });

  it("offers the exact calculator where the view runs page tools, and records each call", async () => {
    const { sample, calls } = fakeSample([usesCalculator(["gcd(12, 18)", "x + 1"], CHAT_REPLY)], {
      maxPromptBytes: 262_144, tools: { maxCount: 8 },
    });
    install(sample);
    const [, meta] = await ask("What is gcd(12, 18)?");
    const { options, input } = calls[0];
    expect(options.cache).toBeUndefined(); // calls with tools must not pass `cache`
    expect(options.modelTier).toBe("default");
    expect(options.tools).toHaveLength(1);
    const tool = (options.tools as Tool[])[0];
    expect(tool.name).toBe("calculate");
    expect(tool.description).toBe(CALCULATOR_TOOL_DESCRIPTION.slice(0, tool.description.length));
    expect(tool.inputSchema).toMatchObject({ type: "object", required: ["expression"] });
    expect(input[0].content).not.toContain("`calculate` tool is not available");
    expect(meta.tool_calls).toEqual([
      { name: "calculate", input: { expression: "gcd(12, 18)" }, output: "6", error: false },
      { name: "calculate", input: { expression: "x + 1" }, output: expect.stringMatching(/^Error: /), error: true },
    ]);
    // a failed calculation reaches Claude as a thrown error, which the platform reports as "Error: <message>"
    expect(() => tool.execute({ expression: "1/0" }, { signal: new AbortController().signal })).toThrow();
  });

  it("checks and coerces the reply", async () => {
    const { sample } = fakeSample([
      {
        reply: "  Hello  ", strategy: "Everyday Analogy", missing_prerequisites: "l1-fractions", new_terms: ["  bijection ", 7, null],
        statements: [{ kind: "Proven Theorem", text: " t " }, "loose text", { kind: "definition" }], extra: true,
      },
      [{ answer: "wrapped", strategy: "made-up" }],
    ]);
    install(sample);
    const [first] = await ask();
    expect(first).toEqual({
      reply: "Hello", strategy: "everyday-analogy", check_question: "", missing_prerequisites: ["l1-fractions"],
      new_terms: ["bijection", "7"], statements: [{ kind: "proven-theorem", text: "t" }],
    });
    const [second] = await ask();
    expect(second.reply).toBe("wrapped");
    expect(second.strategy).toBe("other");
    expect(second.statements).toEqual([]);
  });

  it("refuses an answer it cannot use", async () => {
    const { sample } = fakeSample([{}, "just words", [1, 2], { reply: "   " }, { reply: { nested: true } }]);
    install(sample);
    for (let i = 0; i < 5; i++) {
      const e = await failure(ask());
      expect(e.constructor).toBe(AIError);
      expect(e.message).toBe(UNREADABLE);
    }
  });

  it("asks for a message before calling Claude", async () => {
    const { sample, calls } = fakeSample([CHAT_REPLY]);
    install(sample);
    expect((await failure(ask("   "))).constructor).toBe(AIError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- errors

describe("sample errors", () => {
  const cases: [string, typeof AIError, RegExp][] = [
    ["not_granted", AIUnavailable, /^Claude isn't allowed for this page yet\. Allow it when asked, or check the artifact's permissions\.$/],
    ["sampling_disabled", AIUnavailable, /account or organization/],
    ["not_declared", AIUnavailable, /no longer allowed/],
    ["capability_disabled", AIUnavailable, /isn't available in this view/],
    ["capability_removed", AIUnavailable, /isn't available in this view/],
    ["rate_limited", AIError, /^Claude is busy right now - please try again in a minute\.$/],
    ["session_expired", AIError, /[Ss]ign in/],
    ["refused", AIRefusal, /declined/],
    ["prompt_too_large", AIError, /too much/],
    ["invalid_json", AIError, /^The tutor's answer could not be read\. Please try again\.$/],
    ["empty_completion", AIError, /empty answer/],
    ["upstream_error", AIError, /try again/],
    ["cancelled", AIError, /stopped/],
    ["invalid_request", AIError, /went wrong/],
    ["queue_overflow", AIError, /went wrong/],
    ["tools_unavailable", AIError, /calculator/],
    ["a_code_from_the_future", AIError, /try again/],
  ];

  it.each(cases)("%s becomes %o with a plain message", async (code, cls, message) => {
    const { sample, calls } = fakeSample([new Reject({ code, message: "developer text", text: "partial" })]);
    install(sample);
    const e = await failure(ask());
    expect(e.constructor).toBe(cls);
    expect(e.message).toMatch(message);
    expect(e.message).not.toMatch(/API|key|developer text/);
    expect(calls).toHaveLength(1); // never retried
  });

  it("treats a rejection without a code as a passing problem", async () => {
    const { sample } = fakeSample([new Reject(new TypeError("boom"))]);
    install(sample);
    const e = await failure(ask());
    expect(e.constructor).toBe(AIError);
    expect(e.message).not.toContain("boom");
  });

  it("stops asking once Claude is not allowed in this view, and aiStatus says why", async () => {
    const { sample, calls } = fakeSample([new Reject({ code: "not_granted", message: "declined" }), CHAT_REPLY]);
    install(sample);
    const first = await failure(ask());
    expect(first).toBeInstanceOf(AIUnavailable);
    const status = await aiStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toBe(first.message);
    expect(await failure(explainDifferently(bundle, { learner: "", lessonId: "l0-counting", section: null, tried: [] }))).toBeInstanceOf(AIUnavailable);
    expect(calls).toHaveLength(1);
  });

  it("drops the calculator after the view refuses page tools", async () => {
    const { sample, calls } = fakeSample([new Reject({ code: "tools_unavailable", message: "no tools" }), CHAT_REPLY], {
      maxPromptBytes: 262_144, tools: { maxCount: 8 },
    });
    install(sample);
    await failure(ask());
    expect(calls[0].options.tools).toHaveLength(1);
    await ask();
    expect(calls[1].options).toEqual({ modelTier: "default", cache: false });
  });
});

// ---------------------------------------------------------------- the other operations

describe("explainDifferently", () => {
  it("asks for a strategy not yet tried (test_explain_differently_falls_back_to_ai_after_authored)", async () => {
    const { sample, calls } = fakeSample([{ strategy: "story", title: "A new story", explanation: "Once upon a time...", check_question: "Why?" }]);
    install(sample);
    const lesson = content.lessons["l0-counting"];
    const tried = [lesson.analogy.strategy, ...lesson.alternatives.map((a) => a.strategy)].sort();
    const learner = learnerContext(bundle, {}, { lessonId: "l0-counting", section: "plain" });
    const out = await explainDifferently(bundle, { learner, lessonId: "l0-counting", section: "plain", tried });
    expect(out).toEqual({ strategy: "story", title: "A new story", explanation: "Once upon a time...", check_question: "Why?", model: "Claude" });

    const [head, request] = calls[0].input;
    expect(head.content.startsWith(TEACHING)).toBe(true);
    expect(head.content).toContain(stableContext(bundle));
    expect(head.content).toContain(learner);
    expect(head.content).toContain('"explanation"');
    expect(request.role).toBe("user");
    expect(request.content).toContain(`The learner pressed "I don't understand" while studying 'What is counting?', in the 'plain' section.`);
    for (const s of tried) expect(request.content).toContain(s);
    expect(request.content).toContain(`The idea being taught: ${lesson.goal.trim()}`);
    expect(calls[0].options).toEqual({ modelTier: "default", cache: false });
  });

  it("fills in what the reply leaves out", async () => {
    const { sample, calls } = fakeSample([{ explanation: "Think of [[nope|apples]].", strategy: "jazz" }]);
    install(sample);
    const out = await explainDifferently(bundle, { learner: "", lessonId: "l2-addition", section: null, tried: [] });
    expect(out).toEqual({ strategy: "other", title: "Another way to see it", explanation: "Think of apples.", check_question: "", model: "Claude" });
    expect(calls[0].input[1].content).toContain("did not work: the lesson's main explanation.");
    expect(calls[0].input[1].content).not.toContain("The idea being taught");
  });
});

describe("gradeExplanation", () => {
  const question = content.lessons["l0-counting"].assessment.questions.find((q) => q.type === "explain") as Q;

  it("grades against the rubric on the quick tier (test_ai_grades_explanations)", async () => {
    const { sample, calls } = fakeSample([{ rubric_met: [true, true, false], feedback: "Good start.", misconception: "" }]);
    install(sample);
    const out = await gradeExplanation(bundle, { question, answerText: "Each thing gets one word." });
    expect(out).toEqual({ rubric_met: [true, true, false], feedback: "Good start.", misconception: "", model: "Claude" });
    const [head, request] = calls[0].input;
    expect(head.content.startsWith(TEACHING)).toBe(true);
    expect(head.content).not.toContain("## Dictionary index");
    expect(head.content).toContain("array of 3 booleans");
    expect(request.content).toContain(`Question: ${question.prompt}`);
    expect(request.content).toContain(`1. ${question.rubric[0]}\n2. ${question.rubric[1]}\n3. ${question.rubric[2]}`);
    expect(request.content).toContain(`Model answer (for reference only): ${question.model_answer}`);
    expect(request.content).toContain("Learner's answer:\n<<<\nEach thing gets one word.\n>>>");
    expect(calls[0].options).toEqual({ modelTier: "quick" });
  });

  it("returns exactly one boolean per rubric item", async () => {
    const { sample } = fakeSample([
      { rubric_met: [true], feedback: "[[nope|More]] please." },
      { rubric_met: ["yes", "no", 1, true, true] },
      { feedback: "no booleans" },
    ]);
    install(sample);
    expect(await gradeExplanation(bundle, { question, answerText: "x" })).toEqual({
      rubric_met: [true, false, false], feedback: "More please.", misconception: "", model: "Claude",
    });
    expect((await gradeExplanation(bundle, { question, answerText: "x" })).rubric_met).toEqual([true, false, true]);
    expect((await failure(gradeExplanation(bundle, { question, answerText: "x" }))).message).toBe(UNREADABLE);
  });
});

describe("draftTerm", () => {
  const entry = {
    word: "bijection", pronunciation: "by-JEK-shun", plain: "a perfect pairing", analogy: "dance partners",
    visual_description: "lines pairing dots", formal: "a function that is one-to-one and onto",
    example: "x maps to x+1 on integers", non_example: "squaring on integers", related: ["function"],
    used_later: "counting arguments", is_mathematical_term: true,
  };

  it("drafts a full dictionary entry (test_draft_term)", async () => {
    const { sample, calls } = fakeSample([entry]);
    install(sample);
    const out = await draftTerm(bundle, { word: "Bijection", context: "in a lesson on counting" });
    expect(out).toEqual({ ...entry, model: "Claude" });
    const [head, request] = calls[0].input;
    expect(head.content.startsWith(TEACHING)).toBe(true);
    expect(head.content).toContain(stableContext(bundle));
    expect(head.content).toContain('"is_mathematical_term" (boolean)');
    expect(request.content).toContain(`Write a dictionary entry for the mathematical word "Bijection"`);
    expect(request.content).toContain(" The learner met it here: in a lesson on counting");
    expect(calls[0].options).toEqual({ modelTier: "default" });
  });

  it("fills in missing fields", async () => {
    const { sample } = fakeSample([{ plain: " a pairing ", related: "function", is_mathematical_term: "false" }, { word: "zebra" }]);
    install(sample);
    const out = await draftTerm(bundle, { word: "bijection", context: null });
    expect(out).toMatchObject({ word: "bijection", plain: "a pairing", formal: "", related: ["function"], is_mathematical_term: false });
    expect(Object.keys(out)).toEqual([...Object.keys(entry), "model"]);
    expect((await failure(draftTerm(bundle, { word: "zebra", context: null }))).message).toBe(UNREADABLE);
  });
});
