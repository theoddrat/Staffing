/**
 * Tests for grading.ts: ports of the grading tests in backend/tests/test_learning.py and the
 * grading/materialise assertions in backend/tests/test_content.py, checks over every lesson's
 * assessment, and parity tables recorded from the Python backend (bottom of this file).
 */
import { describe, expect, it } from "vitest";
import content from "../../standalone/content.json";
import { Fraction } from "./fraction";
import {
  creditFor,
  EXPLAIN_PASS_SCORE,
  grade,
  gradeExplainSelf,
  makeGrade,
  materialise,
  maxTries,
  normaliseText,
  parseNumber,
  prepare,
  PRIVATE_FIELDS,
  publicView,
  reveal,
  type Grade,
} from "./grading";
import { GENERATORS, generate } from "./practice";
import { Random, range } from "./rng";
import type { ContentJson, Lesson, Q } from "./types";

const course = content as unknown as ContentJson;
const lessons: Lesson[] = Object.values(course.lessons);

type Option = { id: string; text: string; correct: boolean; diagnosis: string | null; revisit: string | null };
type Wrong = { answer: string; diagnosis: string; revisit: string | null };
const options = (q: Q) => q.options as Option[];
const commonWrong = (q: Q) => (q.common_wrong ?? []) as Wrong[];

const RIGHT: Grade = { correct: true, valid: true, diagnosis: null, revisit: null, message: null, score: null };
const wrong = (diagnosis: string | null = null, revisit: string | null = null): Grade => ({
  ...RIGHT,
  correct: false,
  diagnosis,
  revisit,
});
const invalid = (message: string): Grade => ({ ...RIGHT, correct: false, valid: false, message });

/** A correct answer payload for a materialised question (backend/tests/conftest.py). */
function correctAnswer(q: Q): Record<string, unknown> {
  switch (q.type) {
    case "choice":
      return { selected: options(q).filter((o) => o.correct).map((o) => o.id) };
    case "number":
      return { value: (Fraction.parse(q.answer) as Fraction).toString() };
    case "text":
      return { value: q.accept[0] };
    case "truefalse":
      return { value: q.answer };
    case "order":
      return { order: q.items };
    case "explain":
      return { text: "My explanation in my own words.", self_check: range(q.rubric.length) };
  }
  throw new Error(q.type);
}

/** An anticipated wrong answer (backend/tests/conftest.py). */
function wrongAnswer(q: Q): Record<string, unknown> {
  switch (q.type) {
    case "choice": {
      const bad = options(q).filter((o) => !o.correct).map((o) => o.id);
      if (bad.length) return { selected: bad.slice(0, 1) };
      // Every option is correct (e.g. "which families does 7 belong to?"): missing one is wrong.
      const right = options(q).filter((o) => o.correct).map((o) => o.id);
      expect(q.multi && right.length > 1).toBe(true);
      return { selected: right.slice(0, 1) };
    }
    case "number":
      if (commonWrong(q).length) return { value: commonWrong(q)[0].answer };
      return { value: (Fraction.parse(q.answer) as Fraction).add(1000).toString() };
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

/** The Grade the backend gives for wrongAnswer(q). */
function expectedWrong(q: Q): Grade {
  switch (q.type) {
    case "choice": {
      const bad = options(q).find((o) => !o.correct);
      if (bad) return wrong(bad.diagnosis, bad.revisit);
      const missed = options(q).filter((o) => o.correct)[1];
      return wrong(
        "Everything you chose is right, but something is missing. Look again: more than one answer is correct.",
        missed.revisit,
      );
    }
    case "number": {
      const w = commonWrong(q)[0];
      return w ? wrong(w.diagnosis, w.revisit ?? null) : wrong();
    }
    case "truefalse":
      return wrong(q.diagnosis ?? null, q.revisit ?? null);
    case "order":
      return wrong(`Check each neighbouring pair: the list should go ${q.order_label}.`);
    case "explain":
      return { ...wrong(), score: 0 };
  }
  return wrong();
}

const fmt = (f: Fraction | null): string | null => {
  if (f === null) return null;
  const bits = (x: bigint) => (x < 0n ? -x : x).toString(2).length;
  return bits(f.n) > 300 || bits(f.d) > 300 ? `bits:${bits(f.n)}/${bits(f.d)}` : `${f.n}/${f.d}`;
};

// ------------------------------------------------------------------ parsing

describe("parseNumber", () => {
  it.each([
    ["7", new Fraction(7)],
    ["-3", new Fraction(-3)],
    ["−3", new Fraction(-3)],
    ["3/4", new Fraction(3, 4)],
    ["0.75", new Fraction(3, 4)],
    [".5", new Fraction(1, 2)],
    ["1 1/2", new Fraction(3, 2)],
    ["-1 1/2", new Fraction(-3, 2)],
    ["1,000", new Fraction(1000)],
    ["75%", new Fraction(75)],
    [" 3 / 4 ", new Fraction(3, 4)],
    ["2/4", new Fraction(1, 2)],
  ])("parses %j (test_parse_number)", (raw, expected) => {
    expect(parseNumber(raw)?.eq(expected)).toBe(true);
  });

  it.each(["", "abc", "1/0", "3//4", null])("rejects %j (test_parse_number_rejects)", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });

  it.each(GOLDEN_PARSE.map(([raw, out]) => [JSON.stringify(raw).slice(0, 40), raw, out]))(
    "reads %s exactly as Python does",
    (_, raw, out) => {
      expect(fmt(parseNumber(raw))).toBe(out);
    },
  );

  it("is exact for large and tiny exponents", () => {
    expect(parseNumber("1e-5000")?.eq(new Fraction(1n, 10n ** 5000n))).toBe(true);
    expect(parseNumber("2.5e1000")?.eq(new Fraction(25n * 10n ** 999n))).toBe(true);
    expect(parseNumber("1e1000000")?.eq(new Fraction(10n ** 1000000n))).toBe(true);
    // Beyond 10**6 the exponent is refused rather than computed (Python would take seconds to hours).
    expect(parseNumber("1e1000001")).toBeNull();
  });
});

describe("normaliseText", () => {
  it("math mode ignores spaces (test_text_math_mode_ignores_spaces)", () => {
    expect(normaliseText("3 : 2", "math")).toBe("3:2");
  });

  it.each(GOLDEN_NORMALISE)("normalises %j exactly as Python does", (text, words, math) => {
    expect(normaliseText(text)).toBe(words);
    expect(normaliseText(text, "words")).toBe(words);
    expect(normaliseText(text, "math")).toBe(math);
    expect(normaliseText(text, null)).toBe(words); // any mode but "math" is "words"
  });
});

// ------------------------------------------------------------------ grading

describe("grade (test_learning.py)", () => {
  it("number grading accepts equivalent fractions and diagnoses common errors", () => {
    const q: Q = { id: "q", type: "number", answer: "1/2", common_wrong: [{ answer: "2", diagnosis: "upside down", revisit: "l1-fractions" }] };
    expect(grade(q, { value: "2/4" }).correct).toBe(true);
    expect(grade(q, { value: "0.5" }).correct).toBe(true);
    expect(grade(q, { value: "0.33" }).correct).toBe(false);
    const g = grade(q, { value: "2" });
    expect(g.correct).toBe(false);
    expect(g.diagnosis).toBe("upside down");
    expect(g.revisit).toBe("l1-fractions");
    expect(grade(q, { value: "hello" }).valid).toBe(false);
  });

  it("choice grading multi", () => {
    const q: Q = {
      id: "q",
      type: "choice",
      multi: true,
      options: [
        { id: "a", text: "1", correct: true },
        { id: "b", text: "2", correct: true },
        { id: "c", text: "3", correct: false, diagnosis: "no", revisit: null },
      ],
    };
    expect(grade(q, { selected: ["a", "b"] }).correct).toBe(true);
    expect(grade(q, { selected: ["a"] }).correct).toBe(false);
    const g = grade(q, { selected: ["a", "c"] });
    expect(g.correct).toBe(false);
    expect(g.diagnosis).toBe("no");
    expect(grade(q, { selected: [] }).valid).toBe(false);
    expect(grade(q, { selected: ["zzz"] }).valid).toBe(false);
  });

  it("text math mode ignores spaces", () => {
    const q: Q = { id: "q", type: "text", mode: "math", accept: ["6+3=9"], common_wrong: [] };
    expect(grade(q, { value: "6 + 3 = 9" }).correct).toBe(true);
  });

  it("order and truefalse", () => {
    const q: Q = { id: "q", type: "order", items: ["1", "2", "3"] };
    expect(grade(q, { order: ["1", "2", "3"] }).correct).toBe(true);
    expect(grade(q, { order: ["2", "1", "3"] }).correct).toBe(false);
    expect(grade(q, { order: ["1", "2"] }).valid).toBe(false);
    const tf: Q = { id: "q", type: "truefalse", answer: false, diagnosis: "d" };
    expect(grade(tf, { value: false }).correct).toBe(true);
    expect(grade(tf, { value: true }).diagnosis).toBe("d");
  });

  it("explain self assessment", () => {
    const q: Q = { id: "q", type: "explain", rubric: ["a", "b", "c"] };
    expect(grade(q, { text: "my answer", self_check: [0, 1] }).correct).toBe(true);
    expect(grade(q, { text: "my answer", self_check: [0] }).correct).toBe(false);
    expect(grade(q, { text: "", self_check: [0] }).valid).toBe(false);
  });

  it("credit", () => {
    expect(creditFor(1, true)).toBe(1.0);
    expect(creditFor(2, true)).toBe(0.5);
    expect(creditFor(1, false)).toBe(0.0);
    expect(creditFor(2, false)).toBe(0.0);
  });
});

describe("grade", () => {
  const choiceQ: Q = { id: "q", type: "choice", options: [{ id: "a", text: "x", correct: true }, { id: "b", text: "y", correct: false }] };
  const multiQ: Q = { id: "q", type: "choice", multi: true, options: [{ id: "a", text: "x", correct: true }, { id: "b", text: "y", correct: true }] };
  const numberQ: Q = { id: "q", type: "number", answer: "3/4", common_wrong: [] };
  const textQ: Q = { id: "q", type: "text", accept: ["Denominator"], common_wrong: [] };
  const tfQ: Q = { id: "q", type: "truefalse", answer: true };
  const orderQ: Q = { id: "q", type: "order", items: ["$1$", "$2$"], order_label: "smallest to largest" };
  const explainQ: Q = { id: "q", type: "explain", rubric: ["a", "b"] };

  it("speaks to the learner in the backend's exact words", () => {
    expect(grade(choiceQ, {})).toEqual(invalid("Choose an answer."));
    expect(grade(choiceQ, { selected: ["zzz"] })).toEqual(invalid("Unknown option."));
    expect(grade(numberQ, { value: "x" })).toEqual(invalid("Type a number such as 7, -3, 3/4 or 0.25."));
    expect(grade(textQ, { value: " " })).toEqual(invalid("Type an answer."));
    expect(grade(tfQ, {})).toEqual(invalid("Choose true or false."));
    expect(grade(orderQ, { order: [] })).toEqual(invalid("Arrange all of the items."));
    expect(grade(explainQ, { text: "ab" })).toEqual(invalid("Write your explanation in your own words first."));
    expect(grade(explainQ, { text: "abc" })).toEqual(invalid("Tick the key ideas your explanation included."));
    expect(grade(orderQ, { order: ["$2$", "$1$"] })).toEqual(
      wrong("Check each neighbouring pair: the list should go smallest to largest."),
    );
    expect(grade({ id: "q", type: "order", items: ["1", "2"] }, { order: ["2", "1"] })).toEqual(
      wrong("Check each neighbouring pair: the list should go in order."),
    );
    expect(grade(multiQ, { selected: ["a"] })).toEqual(
      wrong("Everything you chose is right, but something is missing. Look again: more than one answer is correct."),
    );
  });

  it("returns every field of the Python Grade, in order", () => {
    expect(Object.keys(grade(numberQ, { value: "3/4" }))).toEqual(["correct", "valid", "diagnosis", "revisit", "message", "score"]);
    expect(makeGrade(true)).toEqual(RIGHT);
    expect(makeGrade(false, { score: 0, diagnosis: "d" })).toEqual({ ...wrong("d"), score: 0 });
  });

  it("accepts a single selected id as a string, and repeated ids", () => {
    expect(grade(choiceQ, { selected: "a" })).toEqual(RIGHT);
    expect(grade(choiceQ, { selected: ["a", "a"] })).toEqual(RIGHT);
  });

  it("compares numbers within the tolerance when one is set", () => {
    const q: Q = { id: "q", type: "number", answer: "3.14", tolerance: 0.01, common_wrong: [] };
    expect(grade(q, { value: "3.15" }).correct).toBe(true);
    expect(grade(q, { value: "3.13" }).correct).toBe(true);
    expect(grade(q, { value: "3.16" }).correct).toBe(false);
    expect(grade({ ...q, tolerance: 0 }, { value: "3.15" }).correct).toBe(false);
    expect(grade({ ...q, tolerance: null }, { value: "3.140" }).correct).toBe(true);
  });

  it("passes an explanation that meets at least 60% of its rubric", () => {
    const five: Q = { id: "q", type: "explain", rubric: ["a", "b", "c", "d", "e"] };
    expect(EXPLAIN_PASS_SCORE).toBe(0.6);
    expect(gradeExplainSelf(five, { text: "abc", self_check: [0, 1, 2] })).toEqual({ ...RIGHT, score: 0.6 });
    expect(gradeExplainSelf(five, { text: "abc", self_check: [0, 1] })).toEqual({ ...wrong(), score: 0.4 });
    // repeated and out-of-range ticks do not count
    expect(gradeExplainSelf(five, { text: "abc", self_check: [0, 0, 1, 1, 9, -1] }).score).toBe(0.4);
    expect(grade(five, { text: "abc", self_check: [4, 3, 2, 1, 0] })).toEqual({ ...RIGHT, score: 1 });
  });

  it("refuses an unknown question type", () => {
    expect(() => grade({ id: "q", type: "mystery" }, {})).toThrow("unknown question type mystery");
  });

  it.each(GOLDEN_GRADES.map(([qi, answer, g], i) => [i, GOLDEN_QUESTIONS[qi].type, JSON.stringify(answer), qi, answer, g]))(
    "case %i (%s, %s) grades exactly as Python does",
    (_i, _type, _json, qi, answer, [correct, valid, diagnosis, revisit, message, score]) => {
      expect(grade(GOLDEN_QUESTIONS[qi], answer)).toEqual({ correct, valid, diagnosis, revisit, message, score });
    },
  );
});

// ------------------------------------------------------------------ preparing and showing questions

const choiceOf = (texts: string[]): Q => ({
  id: "q",
  type: "choice",
  options: texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text, correct: i === 0 })),
});
const texts = (q: Q) => options(q).map((o) => o.text);

describe("prepare and maxTries", () => {
  it("keeps symbol and yes/no style options in their order, and shuffles the others", () => {
    for (const fixed of [["$<$", "$>$", "$=$"], ["<", "=", ">"], ["$$=$$", "<"], ["True", "False"], ["even", "odd"], ["Yes", "No"]]) {
      for (const seed of range(30)) {
        const q = choiceOf(fixed);
        prepare(q, new Random(seed));
        expect(texts(q)).toEqual(fixed);
      }
    }
    for (const shuffled of [["No", "Yes"], ["False", "True"], ["1", "2", "3", "4"], ["$<$", "$>$", "$\\le$"]]) {
      const orders = new Set<string>();
      for (const seed of range(30)) {
        const q = choiceOf(shuffled);
        prepare(q, new Random(seed));
        expect([...texts(q)].sort()).toEqual([...shuffled].sort());
        orders.add(texts(q).join("|"));
      }
      expect(orders.size).toBeGreaterThan(1);
    }
  });

  it("gives order questions a shuffled copy of the items, different from the answer when possible", () => {
    for (const seed of range(50)) {
      const items = ["$1$", "$2$", "$3$", "$4$"];
      const q: Q = { id: "q", type: "order", items: [...items] };
      prepare(q, new Random(seed));
      expect(q.items).toEqual(items);
      expect([...q.shuffled].sort()).toEqual(items);
      expect(q.shuffled).not.toEqual(items);
    }
    const same: Q = { id: "q", type: "order", items: ["a", "a"] };
    prepare(same, new Random(1));
    expect(same.shuffled).toEqual(["a", "a"]);
  });

  it("allows one try for true/false, explanations and two-option choices, otherwise two", () => {
    expect(maxTries({ id: "q", type: "truefalse" })).toBe(1);
    expect(maxTries({ id: "q", type: "explain" })).toBe(1);
    expect(maxTries(choiceOf(["a", "b"]))).toBe(1);
    expect(maxTries(choiceOf(["a", "b", "c"]))).toBe(2);
    for (const type of ["number", "text", "order"]) expect(maxTries({ id: "q", type })).toBe(2);
    const q = choiceOf(["a", "b", "c"]);
    prepare(q, new Random(0));
    expect(q.max_tries).toBe(2);
  });
});

describe("publicView and reveal", () => {
  it("hides exactly these fields", () => {
    expect([...PRIVATE_FIELDS].sort()).toEqual(
      ["answer", "accept", "common_wrong", "items", "rubric", "model_answer", "explanation", "diagnosis", "revisit"].sort(),
    );
  });

  it.each(GOLDEN_VIEWS.map(([q, pub, rev]) => [q.type, q, pub, rev]))(
    "shows a %s question exactly as Python does (fields and their order)",
    (_type, q, pub, rev) => {
      const before = JSON.stringify(q);
      expect(JSON.stringify(publicView(q))).toBe(JSON.stringify(JSON.parse(pub)));
      expect(JSON.stringify(reveal(q))).toBe(JSON.stringify(JSON.parse(rev)));
      expect(JSON.stringify(q)).toBe(before); // the stored question is untouched
    },
  );
});

// ------------------------------------------------------------------ the course's assessments

describe("assessments (test_content.py)", () => {
  it("authored number answers parse and common wrong answers are wrong", () => {
    for (const lesson of lessons) {
      for (const q of lesson.assessment.questions) {
        if (q.type !== "number") continue;
        const ans = parseNumber(q.answer);
        expect(ans, `${lesson.id}/${q.id}`).not.toBeNull();
        for (const w of commonWrong(q)) {
          const wv = parseNumber(w.answer);
          expect(wv, `${lesson.id}/${q.id} ${w.answer}`).not.toBeNull();
          expect((wv as Fraction).eq(ans as Fraction), `${lesson.id}/${q.id} ${w.answer}`).toBe(false);
        }
      }
    }
  });

  it("choice questions have diagnoses for wrong options", () => {
    for (const lesson of lessons) {
      for (const q of lesson.assessment.questions) {
        if (q.type !== "choice") continue;
        for (const o of q.options as Omit<Option, "id">[]) {
          if (!o.correct) expect(o.diagnosis, `${lesson.id}/${q.id}: wrong option '${o.text}' needs a diagnosis`).toBeTruthy();
        }
      }
    }
  });

  it("every assessment materialises", () => {
    const rng = new Random(0);
    for (const lesson of lessons) {
      for (const _ of range(5)) {
        const qs = materialise(lesson.assessment, rng);
        expect(qs.length).toBe(lesson.assessment.questions.length);
        for (const q of qs) {
          expect(q.max_tries).toBeGreaterThanOrEqual(1);
          if (q.type === "number") expect(Fraction.parse(q.answer), `${lesson.id}/${q.id}`).not.toBeNull();
        }
      }
    }
  });
});

describe("materialise", () => {
  it("copies authored questions with the same fields, lettered options and max_tries, never changing the course", () => {
    const before = JSON.stringify(course.lessons);
    const rng = new Random(3);
    for (const lesson of lessons) {
      const qs = materialise(lesson.assessment, rng);
      lesson.assessment.questions.forEach((authored, i) => {
        const m = qs[i];
        expect(m.id).toBe(authored.id);
        if (authored.type === "generated") {
          expect(m.generated_from).toBe(authored.generator);
          expect(Object.keys(m).slice(-1)).toEqual(["max_tries"]);
          return;
        }
        const extra = authored.type === "order" ? ["shuffled", "max_tries"] : ["max_tries"];
        expect(Object.keys(m)).toEqual([...Object.keys(authored), ...extra]);
        if (authored.type === "choice") {
          // letters follow the authored order, whatever order the options are shown in
          const byLetter = new Map(options(m).map((o) => [o.id, o]));
          (authored.options as Omit<Option, "id">[]).forEach((o, j) => {
            const lettered = byLetter.get(String.fromCharCode(97 + j)) as Option;
            expect(lettered).toEqual({ id: String.fromCharCode(97 + j), ...o });
            expect(Object.keys(lettered)).toEqual(["id", ...Object.keys(o)]);
          });
        } else {
          const { max_tries, ...rest } = m;
          expect(max_tries).toBe(maxTries(m));
          expect(rest).toEqual(authored);
        }
      });
    }
    expect(JSON.stringify(course.lessons)).toBe(before);
  });

  it("grades every lesson's right answers right and its anticipated wrong answers wrong, for every question type", () => {
    const seen = new Set<string>();
    for (const seed of range(6)) {
      const rng = new Random(seed);
      for (const lesson of lessons) {
        for (const q of materialise(lesson.assessment, rng)) {
          const label = `${lesson.id}/${q.id} (${q.type})`;
          seen.add(q.type);
          expect(grade(q, correctAnswer(q)), label).toEqual(q.type === "explain" ? { ...RIGHT, score: 1 } : RIGHT);
          expect(grade(q, wrongAnswer(q)), label).toEqual(expectedWrong(q));
          // every anticipated mistake is wrong, with its own diagnosis
          if (q.type === "number" || q.type === "text") {
            for (const w of commonWrong(q)) expect(grade(q, { value: w.answer }), label).toEqual(wrong(w.diagnosis, w.revisit ?? null));
          }
          if (q.type === "choice") {
            for (const o of options(q)) if (!o.correct) expect(grade(q, { selected: [o.id] }), label).toEqual(wrong(o.diagnosis, o.revisit));
          }
          if (q.type === "truefalse") {
            expect(grade(q, { value: !q.answer }), label).toEqual(wrong(q.diagnosis ?? null, q.revisit ?? null));
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(["choice", "explain", "number", "order", "text", "truefalse"]);
  });

  it("shows learners no answers before they answer, and reveals answers that grade as right", () => {
    const rng = new Random(11);
    for (const lesson of lessons) {
      for (const q of materialise(lesson.assessment, rng)) {
        const label = `${lesson.id}/${q.id}`;
        const pub = publicView(q);
        for (const k of PRIVATE_FIELDS) if (!(q.type === "order" && k === "items")) expect(pub, label).not.toHaveProperty(k);
        expect(pub).not.toHaveProperty("shuffled");
        expect(pub.max_tries).toBe(q.max_tries);
        const r = reveal(q);
        expect(r.explanation).toBe(q.explanation);
        if (q.type === "choice") {
          expect(pub.options).toEqual(options(q).map((o) => ({ id: o.id, text: o.text })));
          expect(grade(q, { selected: r.correct_options }).correct, label).toBe(true);
        } else if (q.type === "order") {
          expect(pub.items).toEqual(q.shuffled);
          expect(grade(q, { order: r.answer }).correct, label).toBe(true);
        } else if (q.type === "explain") {
          expect(pub.rubric_count).toBe(q.rubric.length);
          expect(r).toEqual({ explanation: q.explanation, rubric: q.rubric, model_answer: q.model_answer });
        } else {
          expect(grade(q, { value: r.answer }).correct, label).toBe(true);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ generated questions

describe("generated questions (test_learning.py)", () => {
  it.each(Object.keys(GENERATORS).sort())("%s produces gradeable questions", (gid) => {
    const rng = new Random(42);
    for (const _ of range(200)) {
      const q = generate(gid, rng, {});
      q.id = "x";
      prepare(q, rng);
      if (q.type === "number") {
        expect(grade(q, { value: q.answer }).correct).toBe(true);
        for (const w of commonWrong(q)) expect(grade(q, { value: w.answer }).correct).toBe(false);
      } else if (q.type === "choice") {
        const ids = options(q).filter((o) => o.correct).map((o) => o.id);
        expect(ids.length).toBeGreaterThan(0);
        expect(grade(q, { selected: ids }).correct).toBe(true);
      } else if (q.type === "truefalse") {
        expect(grade(q, { value: q.answer }).correct).toBe(true);
      } else if (q.type === "order") {
        expect(grade(q, { order: q.items }).correct).toBe(true);
      }
      expect(q.explanation).toBeTruthy();
    }
  });

  it("select-all family questions require every family", () => {
    // For 7 every family is correct; ticking only some of them is a (partial) mistake.
    const q = generate("classify-number", new Random(0), { pool: ["7"] });
    prepare(q, new Random(0));
    const ids = options(q).map((o) => o.id);
    expect(options(q).every((o) => o.correct) && q.multi).toBe(true);
    expect(grade(q, { selected: ids }).correct).toBe(true);
    expect(grade(q, { selected: ids.slice(0, 2) }).correct).toBe(false);
  });
});

// ------------------------------------------------------------------ parity tables
// Recorded from the Python backend (app.learning.grading.parse_number, normalise_text, grade,
// public_view and reveal) on 2026-11-02. Fractions are "numerator/denominator"; "bits:n/d" gives
// the bit lengths of numbers too long to write out.

// prettier-ignore
const GOLDEN_PARSE: [unknown, string | null][] = [
  ["7", "7/1"],
  ["-3", "-3/1"],
  ["\u22123", "-3/1"],
  ["\u20133", "-3/1"],
  ["3/4", "3/4"],
  ["0.75", "3/4"],
  [".5", "1/2"],
  ["1 1/2", "3/2"],
  ["-1 1/2", "-3/2"],
  ["1,000", "1000/1"],
  ["75%", "75/1"],
  [" 3 / 4 ", "3/4"],
  ["2/4", "1/2"],
  ["", null],
  ["abc", null],
  ["1/0", null],
  ["3//4", null],
  ["   ", null],
  ["+5", "5/1"],
  ["+-5", null],
  ["--5", null],
  ["5.", "5/1"],
  [".", null],
  ["-.5", "-1/2"],
  ["+.5", "1/2"],
  ["1e3", "1000/1"],
  ["1E3", "1000/1"],
  ["1e-3", "1/1000"],
  ["2.5E-2", "1/40"],
  ["1e+21", "1000000000000000000000/1"],
  ["e3", null],
  [".e3", null],
  ["5.e2", "500/1"],
  ["1_000", "1000/1"],
  ["1__000", null],
  ["_1", null],
  ["1_", null],
  ["1_0/2_0", "1/2"],
  ["0x10", null],
  ["1/2/3", "3/2"],
  ["1/2/0", null],
  ["1/0/2", null],
  ["0/0", null],
  ["0/5", "0/1"],
  ["1.5/2", "3/4"],
  ["1/2.5", "2/5"],
  ["1e3/2", "500/1"],
  ["-1/-2", "1/2"],
  ["1/-2", "-1/2"],
  ["-1/2", "-1/2"],
  ["- 1/2", null],
  ["-0 1/2", "-1/2"],
  ["+1 1/2", "3/2"],
  ["1 1/0", null],
  ["1 0/2", "1/1"],
  ["1  1 / 2", "3/2"],
  ["1 -1/2", null],
  ["-1 -1/2", null],
  ["1 1/2/3", null],
  ["1 1.5/2", null],
  ["3\u00f74", "3/4"],
  ["6 \u00f7 3", "2/1"],
  ["50 %", "50/1"],
  ["%", null],
  [",", null],
  ["1,5", "15/1"],
  ["1.000,5", "2001/2000"],
  ["\u00bd", null],
  ["1 \u00bd", null],
  ["\u00b2", "2/1"],
  ["2\u00b2", "22/1"],
  ["\u0663", "3/1"],
  ["\u0661/\u0662", "1/2"],
  ["\u06f1\u06f2", "12/1"],
  ["\u096d", "7/1"],
  ["\uff11\uff12", "12/1"],
  ["1\u00a02/3", "5/3"],
  ["\u00a07\u00a0", "7/1"],
  ["\ufeff7", null],
  ["7\u200b", null],
  ["\u20097", "7/1"],
  ["\u30007", "7/1"],
  ["\u001c7", "7/1"],
  ["\u00857", "7/1"],
  ["1\t1/2", "3/2"],
  ["1\n1/2", "3/2"],
  ["3 4", null],
  ["3/ 4", "3/4"],
  ["3 /4", "3/4"],
  ["3 / 4", "3/4"],
  ["\u221e", null],
  ["inf", null],
  ["nan", null],
  ["NaN", null],
  ["Infinity", null],
  ["1/3", "1/3"],
  ["0.333", "333/1000"],
  ["-0", "0/1"],
  ["+0", "0/1"],
  ["00.50", "1/2"],
  ["007", "7/1"],
  ["1e", null],
  ["1e+", null],
  ["1.2.3", null],
  ["1 2", null],
  ["1 2 3", null],
  ["12/16", "3/4"],
  ["-12/-16", "3/4"],
  ["1/ -2", "-1/2"],
  ["1/+2", "1/2"],
  ["+1/+2", "1/2"],
  ["3.0", "3/1"],
  ["3.14159", "314159/100000"],
  ["\u22120.5", "-1/2"],
  ["\u22121 1/2", "-3/2"],
  ["\u20131 1/2", "-3/2"],
  ["1 1/2%", "3/2"],
  ["1,1/2", "11/2"],
  ["(1/2)", null],
  ["1/2 ", "1/2"],
  ["x", null],
  ["7x", null],
  ["7 apples", null],
  ["seven", null],
  ["1.5e2/3", "50/1"],
  ["12e-1", "6/5"],
  ["1_000.000_1", "10000001/10000"],
  ["1_000e1_0", "10000000000000/1"],
  ["\u0663 \u0661/\u0662", "7/2"],
  ["-\u0661", "-1/1"],
  ["\ud835\udfd1", "3/1"],
  ["\ud835\udfce\ud835\udfcf", "1/1"],
  ["\ud801\udca3", "3/1"],
  ["1.", "1/1"],
  ["-1.", "-1/1"],
  ["1.e1", "10/1"],
  ["1e1.5", null],
  [" +3 ", "3/1"],
  ["\u2212 3", null],
  ["3\u2212", null],
  ["1/\u22122", "-1/2"],
  ["\u22121/\u22122", "1/2"],
  ["1\u20442", null],
  ["4 / 2 / 2", "4/1"],
  ["10%%", "10/1"],
  ["%5", "5/1"],
  ["1%2", "12/1"],
  ["1,000.5", "2001/2"],
  [",5", "5/1"],
  ["5,", "5/1"],
  ["2/04", "1/2"],
  ["1 01/2", "3/2"],
  ["01 1/2", "3/2"],
  ["1".repeat(4300), "bits:14282/1"],
  ["1".repeat(4301), null],
  ["0." + "3".repeat(4301), null],
  ["1_".repeat(2150) + "1", "bits:7143/1"],
  [7, "7/1"],
  [0, "0/1"],
  [-2, "-2/1"],
  [0.1, "1/10"],
  [-2.5, "-5/2"],
  [1e+21, "1000000000000000000000/1"],
  [1e-07, "1/10000000"],
  [123456.789, "123456789/1000"],
  [true, null],
  [false, null],
  [null, null],
  [[1], null],
  [["7"], null],
  [{"a": 1}, null],
  [1e+16, "10000000000000000/1"],
  [0.5, "1/2"],
];

// prettier-ignore
const GOLDEN_NORMALISE: [string, string, string][] = [  // [text, words mode, math mode]
  ["Hello, World!", "hello world", "hello,world!"],
  ["  The   Answer  ", "the answer", "theanswer"],
  ["6 + 3 = 9", "6 3 9", "6+3=9"],
  ["3 : 2", "3 2", "3:2"],
  ["3x4", "3x4", "3*4"],
  ["3 X 4", "3 x 4", "3*4"],
  ["3\u00d74", "34", "3*4"],
  ["\u22125", "5", "-5"],
  ["6\u00f73", "63", "6/3"],
  ["Caf\u00e9", "caf\u00e9", "caf\u00e9"],
  ["CAF\u00c9", "caf\u00e9", "caf\u00e9"],
  ["e\u0301", "\u00e9", "\u00e9"],
  ["na\u00efve", "na\u00efve", "na\u00efve"],
  ["\uff26\uff55\uff4c\uff4c", "full", "full"],
  ["\ufb01ne", "fine", "fine"],
  ["\u00df", "\u00df", "\u00df"],
  ["\u1e9e", "\u00df", "\u00df"],
  ["\u0130stanbul", "istanbul", "i\u0307stanbul"],
  ["\u0391\u03a3", "\u03b1\u03c2", "\u03b1\u03c2"],
  ["x_y", "x_y", "*_y"],
  ["a/b", "a/b", "a/b"],
  ["a.b", "a.b", "a.b"],
  ["a-b", "a-b", "a-b"],
  ["a\u2013b", "ab", "a\u2013b"],
  ["a\u2014b", "ab", "a\u2014b"],
  ["it's", "its", "it's"],
  ["don't", "dont", "don't"],
  ["50%", "50", "50%"],
  ["(x+1)", "x1", "(*+1)"],
  ["x\u00b2", "x2", "*2"],
  ["\u00bd", "12", "1\u20442"],
  ["\u0663", "\u0663", "\u0663"],
  ["a\u00a0b", "a b", "ab"],
  ["a\u200bb", "ab", "a\u200bb"],
  ["\ufeffa", "a", "\ufeffa"],
  ["a\u001cb", "a b", "ab"],
  ["a\u0085b", "a b", "ab"],
  ["Tab\tSep", "tab sep", "tabsep"],
  ["line\nbreak", "line break", "linebreak"],
  ["? 7", " 7", "?7"],
  ["7 ?", "7 ", "7?"],
  ["?", "", "?"],
  ["", "", ""],
  ["   ", "", ""],
  ["\u216b", "xii", "*ii"],
  ["\u2460", "1", "1"],
  ["\u00b0C", "c", "\u00b0c"],
  ["\u00b5", "\u03bc", "\u03bc"],
  ["\u2126", "\u03c9", "\u03c9"],
  ["\u212a", "k", "k"],
  ["3 : 2 ", "3 2", "3:2"],
  [" 2:3", "23", "2:3"],
  ["12 : 8", "12 8", "12:8"],
  ["9 = 6 + 3", "9 6 3", "9=6+3"],
  ["\u0915\u093f", "\u0915", "\u0915\u093f"],
  ["Stra\u00dfe", "stra\u00dfe", "stra\u00dfe"],
  ["\u00c5ngstr\u00f6m", "\u00e5ngstr\u00f6m", "\u00e5ngstr\u00f6m"],
  ["a  -  b", "a - b", "a-b"],
  ["\ud835\udc00BC", "abc", "abc"],
  ["x\u00d7y", "xy", "**y"],
  ["X\u00f7Y", "xy", "*/y"],
  ["\u2212x", "x", "-*"],
  ["a,b;c:d!e?f", "abcdef", "a,b;c:d!e?f"],
  ["[1, 2]", "1 2", "[1,2]"],
  ["\u00ab quote \u00bb", " quote ", "\u00abquote\u00bb"],
  ["\u3000wide\u3000", "wide", "wide"],
  ["tab\u000bvt", "tab vt", "tabvt"],
  ["\u2028sep\u2029", "sep", "sep"],
];

// prettier-ignore
const GOLDEN_QUESTIONS: Q[] = [
  {"id": "q", "type": "choice", "multi": false, "options": [{"id": "a", "text": "Right", "correct": true, "diagnosis": null, "revisit": null}, {"id": "b", "text": "Wrong", "correct": false, "diagnosis": "That is the wrong one.", "revisit": "l1-fractions"}, {"id": "c", "text": "Also wrong", "correct": false, "diagnosis": null, "revisit": null}]},
  {"id": "q", "type": "choice", "multi": true, "options": [{"id": "a", "text": "1", "correct": true, "diagnosis": null, "revisit": "l0-counting"}, {"id": "b", "text": "2", "correct": true}, {"id": "c", "text": "3", "correct": false, "diagnosis": "no", "revisit": null}, {"id": "d", "text": "4", "correct": false, "diagnosis": "nope", "revisit": "l1-integers"}]},
  {"id": "q", "type": "choice", "options": [{"id": "a", "text": "x", "correct": true, "revisit": "l1-x"}, {"id": "b", "text": "y", "correct": true}]},
  {"id": "q", "type": "number", "answer": "1/2", "common_wrong": [{"answer": "2", "diagnosis": "upside down", "revisit": "l1-fractions"}]},
  {"id": "q", "type": "number", "answer": "-3", "common_wrong": [{"answer": "3", "diagnosis": "sign", "revisit": null}, {"answer": "-3.0", "diagnosis": "never reached"}, {"answer": "nonsense", "diagnosis": "unparseable wrong answer"}, {"answer": "6/2", "diagnosis": "same as 3"}]},
  {"id": "q", "type": "number", "answer": "0.25", "tolerance": null, "unit": null, "common_wrong": []},
  {"id": "q", "type": "number", "answer": "7"},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": null, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": 0, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": 0.01, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": 0.5, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": 1, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "number", "answer": "3.14", "tolerance": 0.1, "common_wrong": [{"answer": "3", "diagnosis": "rounded too far", "revisit": "l1-decimals"}]},
  {"id": "q", "type": "text", "mode": "math", "accept": ["6+3=9", "9=6+3"], "common_wrong": []},
  {"id": "q", "type": "text", "mode": "math", "accept": ["3:2"], "common_wrong": [{"answer": "2:3", "diagnosis": "The order matters - red first, then blue.", "revisit": null}, {"answer": "12:8", "diagnosis": "That is correct but not in simplest form.", "revisit": "l1-ratios"}]},
  {"id": "q", "type": "text", "accept": ["Denominator", "the denominator"], "common_wrong": [{"answer": "numerator", "diagnosis": "That is the top number.", "revisit": "l1-numerators-denominators"}]},
  {"id": "q", "type": "text", "mode": null, "accept": ["x times y"]},
  {"id": "q", "type": "text", "mode": "math", "accept": ["2x"], "common_wrong": [{"answer": "x2", "diagnosis": "order"}]},
  {"id": "q", "type": "truefalse", "answer": false, "diagnosis": "d", "revisit": "l1-x"},
  {"id": "q", "type": "truefalse", "answer": true},
  {"id": "q", "type": "truefalse", "answer": true, "diagnosis": null, "revisit": null},
  {"id": "q", "type": "order", "items": ["1", "2", "3"]},
  {"id": "q", "type": "order", "items": ["$-3$", "$0$", "$5$"], "order_label": "smallest to largest"},
  {"id": "q", "type": "order", "items": ["a", "a", "b"], "order_label": "alphabetically"},
  {"id": "q", "type": "order", "items": ["x", "y"], "order_label": null},
  {"id": "q", "type": "explain", "rubric": ["a", "b", "c"]},
  {"id": "q", "type": "explain", "rubric": ["a", "b", "c", "d", "e"]},
  {"id": "q", "type": "explain", "rubric": ["only"]},
];

// [question index, answer, [correct, valid, diagnosis, revisit, message, score]]
// prettier-ignore
const GOLDEN_GRADES: [number, Record<string, unknown>, [boolean, boolean, string | null, string | null, string | null, number | null]][] = [
  [0, {"selected": ["a"]}, [true, true, null, null, null, null]],
  [0, {"selected": "a"}, [true, true, null, null, null, null]],
  [0, {"selected": ["b"]}, [false, true, "That is the wrong one.", "l1-fractions", null, null]],
  [0, {"selected": "b"}, [false, true, "That is the wrong one.", "l1-fractions", null, null]],
  [0, {"selected": ["c"]}, [false, true, null, null, null, null]],
  [0, {"selected": ["a", "b"]}, [false, true, "That is the wrong one.", "l1-fractions", null, null]],
  [0, {"selected": ["b", "a"]}, [false, true, "That is the wrong one.", "l1-fractions", null, null]],
  [0, {"selected": ["a", "a"]}, [true, true, null, null, null, null]],
  [0, {"selected": ["a", "c"]}, [false, true, null, null, null, null]],
  [0, {"selected": ["c", "d"]}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": ["d", "c"]}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": ["a", "b", "c"]}, [false, true, "That is the wrong one.", "l1-fractions", null, null]],
  [0, {"selected": []}, [false, false, null, null, "Choose an answer.", null]],
  [0, {"selected": ""}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": null}, [false, false, null, null, "Choose an answer.", null]],
  [0, {}, [false, false, null, null, "Choose an answer.", null]],
  [0, {"selected": ["zzz"]}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": ["a", "zzz"]}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": [1]}, [false, false, null, null, "Unknown option.", null]],
  [0, {"selected": 1}, [false, false, null, null, "Choose an answer.", null]],
  [0, {"selected": true}, [false, false, null, null, "Choose an answer.", null]],
  [0, {"selected": {"a": 1}}, [false, false, null, null, "Choose an answer.", null]],
  [0, {"value": "a"}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"selected": ["a"]}, [false, true, "Everything you chose is right, but something is missing. Look again: more than one answer is correct.", null, null, null]],
  [1, {"selected": "a"}, [false, true, "Everything you chose is right, but something is missing. Look again: more than one answer is correct.", null, null, null]],
  [1, {"selected": ["b"]}, [false, true, "Everything you chose is right, but something is missing. Look again: more than one answer is correct.", "l0-counting", null, null]],
  [1, {"selected": "b"}, [false, true, "Everything you chose is right, but something is missing. Look again: more than one answer is correct.", "l0-counting", null, null]],
  [1, {"selected": ["c"]}, [false, true, "no", null, null, null]],
  [1, {"selected": ["a", "b"]}, [true, true, null, null, null, null]],
  [1, {"selected": ["b", "a"]}, [true, true, null, null, null, null]],
  [1, {"selected": ["a", "a"]}, [false, true, "Everything you chose is right, but something is missing. Look again: more than one answer is correct.", null, null, null]],
  [1, {"selected": ["a", "c"]}, [false, true, "no", null, null, null]],
  [1, {"selected": ["c", "d"]}, [false, true, "no", null, null, null]],
  [1, {"selected": ["d", "c"]}, [false, true, "nope", "l1-integers", null, null]],
  [1, {"selected": ["a", "b", "c"]}, [false, true, "no", null, null, null]],
  [1, {"selected": []}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"selected": ""}, [false, false, null, null, "Unknown option.", null]],
  [1, {"selected": null}, [false, false, null, null, "Choose an answer.", null]],
  [1, {}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"selected": ["zzz"]}, [false, false, null, null, "Unknown option.", null]],
  [1, {"selected": ["a", "zzz"]}, [false, false, null, null, "Unknown option.", null]],
  [1, {"selected": [1]}, [false, false, null, null, "Unknown option.", null]],
  [1, {"selected": 1}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"selected": true}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"selected": {"a": 1}}, [false, false, null, null, "Choose an answer.", null]],
  [1, {"value": "a"}, [false, false, null, null, "Choose an answer.", null]],
  [2, {"selected": ["a"]}, [false, true, null, null, null, null]],
  [2, {"selected": "a"}, [false, true, null, null, null, null]],
  [2, {"selected": ["b"]}, [false, true, null, "l1-x", null, null]],
  [2, {"selected": "b"}, [false, true, null, "l1-x", null, null]],
  [2, {"selected": ["c"]}, [false, false, null, null, "Unknown option.", null]],
  [2, {"selected": ["a", "b"]}, [true, true, null, null, null, null]],
  [2, {"selected": ["b", "a"]}, [true, true, null, null, null, null]],
  [2, {"selected": ["a", "a"]}, [false, true, null, null, null, null]],
  [2, {"selected": ["a", "c"]}, [false, false, null, null, "Unknown option.", null]],
  [2, {"selected": ["c", "d"]}, [false, false, null, null, "Unknown option.", null]],
  [2, {"selected": ["d", "c"]}, [false, false, null, null, "Unknown option.", null]],
  [2, {"selected": ["a", "b", "c"]}, [false, false, null, null, "Unknown option.", null]],
  [3, {"value": ""}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": null}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": true}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": [7]}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": "hello"}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": "1/0"}, [false, false, null, null, "Type a number such as 7, -3, 3/4 or 0.25.", null]],
  [3, {"value": "1/2"}, [true, true, null, null, null, null]],
  [3, {"value": "2/4"}, [true, true, null, null, null, null]],
  [3, {"value": "0.5"}, [true, true, null, null, null, null]],
  [3, {"value": "50%"}, [false, true, null, null, null, null]],
  [3, {"value": ".5"}, [true, true, null, null, null, null]],
  [3, {"value": "0.33"}, [false, true, null, null, null, null]],
  [3, {"value": "2"}, [false, true, "upside down", "l1-fractions", null, null]],
  [3, {"value": "4/2"}, [false, true, "upside down", "l1-fractions", null, null]],
  [3, {"value": "1 1/2"}, [false, true, null, null, null, null]],
  [3, {"value": 0.5}, [true, true, null, null, null, null]],
  [3, {"value": 2}, [false, true, "upside down", "l1-fractions", null, null]],
  [4, {"value": "-3"}, [true, true, null, null, null, null]],
  [4, {"value": "\u22123"}, [true, true, null, null, null, null]],
  [4, {"value": "-6/2"}, [true, true, null, null, null, null]],
  [4, {"value": "3"}, [false, true, "sign", null, null, null]],
  [4, {"value": "6/2"}, [false, true, "sign", null, null, null]],
  [4, {"value": "3.0"}, [false, true, "sign", null, null, null]],
  [4, {"value": "+3"}, [false, true, "sign", null, null, null]],
  [4, {"value": "-3.0"}, [true, true, null, null, null, null]],
  [4, {"value": "4"}, [false, true, null, null, null, null]],
  [4, {"value": 3}, [false, true, "sign", null, null, null]],
  [4, {"value": -3}, [true, true, null, null, null, null]],
  [5, {"value": "1/4"}, [true, true, null, null, null, null]],
  [5, {"value": "0.25"}, [true, true, null, null, null, null]],
  [5, {"value": "25%"}, [false, true, null, null, null, null]],
  [5, {"value": "0.250"}, [true, true, null, null, null, null]],
  [5, {"value": "2/8"}, [true, true, null, null, null, null]],
  [5, {"value": "0.3"}, [false, true, null, null, null, null]],
  [6, {"value": "7"}, [true, true, null, null, null, null]],
  [6, {"value": "7.0"}, [true, true, null, null, null, null]],
  [6, {"value": "14/2"}, [true, true, null, null, null, null]],
  [6, {"value": "8"}, [false, true, null, null, null, null]],
  [6, {"value": 7}, [true, true, null, null, null, null]],
  [7, {"value": "3.14"}, [true, true, null, null, null, null]],
  [7, {"value": "3.140"}, [true, true, null, null, null, null]],
  [7, {"value": "3.15"}, [false, true, null, null, null, null]],
  [7, {"value": "3.13"}, [false, true, null, null, null, null]],
  [7, {"value": "3.2"}, [false, true, null, null, null, null]],
  [7, {"value": "3.24"}, [false, true, null, null, null, null]],
  [7, {"value": "3.64"}, [false, true, null, null, null, null]],
  [7, {"value": "3.65"}, [false, true, null, null, null, null]],
  [7, {"value": "2.64"}, [false, true, null, null, null, null]],
  [7, {"value": "4.14"}, [false, true, null, null, null, null]],
  [7, {"value": "4.15"}, [false, true, null, null, null, null]],
  [7, {"value": "3"}, [false, true, "rounded too far", "l1-decimals", null, null]],
  [7, {"value": "22/7"}, [false, true, null, null, null, null]],
  [8, {"value": "3.14"}, [true, true, null, null, null, null]],
  [8, {"value": "3.140"}, [true, true, null, null, null, null]],
  [8, {"value": "3.15"}, [false, true, null, null, null, null]],
  [8, {"value": "3.13"}, [false, true, null, null, null, null]],
  [8, {"value": "3.2"}, [false, true, null, null, null, null]],
  [8, {"value": "3.24"}, [false, true, null, null, null, null]],
  [8, {"value": "3.64"}, [false, true, null, null, null, null]],
  [8, {"value": "3.65"}, [false, true, null, null, null, null]],
  [8, {"value": "2.64"}, [false, true, null, null, null, null]],
  [8, {"value": "4.14"}, [false, true, null, null, null, null]],
  [8, {"value": "4.15"}, [false, true, null, null, null, null]],
  [8, {"value": "3"}, [false, true, "rounded too far", "l1-decimals", null, null]],
  [8, {"value": "22/7"}, [false, true, null, null, null, null]],
  [9, {"value": "3.14"}, [true, true, null, null, null, null]],
  [9, {"value": "3.140"}, [true, true, null, null, null, null]],
  [9, {"value": "3.15"}, [true, true, null, null, null, null]],
  [9, {"value": "3.13"}, [true, true, null, null, null, null]],
  [9, {"value": "3.2"}, [false, true, null, null, null, null]],
  [9, {"value": "3.24"}, [false, true, null, null, null, null]],
  [9, {"value": "3.64"}, [false, true, null, null, null, null]],
  [9, {"value": "3.65"}, [false, true, null, null, null, null]],
  [9, {"value": "2.64"}, [false, true, null, null, null, null]],
  [9, {"value": "4.14"}, [false, true, null, null, null, null]],
  [9, {"value": "4.15"}, [false, true, null, null, null, null]],
  [9, {"value": "3"}, [false, true, "rounded too far", "l1-decimals", null, null]],
  [9, {"value": "22/7"}, [true, true, null, null, null, null]],
  [10, {"value": "3.14"}, [true, true, null, null, null, null]],
  [10, {"value": "3.140"}, [true, true, null, null, null, null]],
  [10, {"value": "3.15"}, [true, true, null, null, null, null]],
  [10, {"value": "3.13"}, [true, true, null, null, null, null]],
  [10, {"value": "3.2"}, [true, true, null, null, null, null]],
  [10, {"value": "3.24"}, [true, true, null, null, null, null]],
  [10, {"value": "3.64"}, [true, true, null, null, null, null]],
  [10, {"value": "3.65"}, [false, true, null, null, null, null]],
  [10, {"value": "2.64"}, [true, true, null, null, null, null]],
  [10, {"value": "4.14"}, [false, true, null, null, null, null]],
  [10, {"value": "4.15"}, [false, true, null, null, null, null]],
  [10, {"value": "3"}, [true, true, null, null, null, null]],
  [10, {"value": "22/7"}, [true, true, null, null, null, null]],
  [11, {"value": "3.14"}, [true, true, null, null, null, null]],
  [11, {"value": "3.140"}, [true, true, null, null, null, null]],
  [11, {"value": "3.15"}, [true, true, null, null, null, null]],
  [11, {"value": "3.13"}, [true, true, null, null, null, null]],
  [11, {"value": "3.2"}, [true, true, null, null, null, null]],
  [11, {"value": "3.24"}, [true, true, null, null, null, null]],
  [11, {"value": "3.64"}, [true, true, null, null, null, null]],
  [11, {"value": "3.65"}, [true, true, null, null, null, null]],
  [11, {"value": "2.64"}, [true, true, null, null, null, null]],
  [11, {"value": "4.14"}, [true, true, null, null, null, null]],
  [11, {"value": "4.15"}, [false, true, null, null, null, null]],
  [11, {"value": "3"}, [true, true, null, null, null, null]],
  [11, {"value": "22/7"}, [true, true, null, null, null, null]],
  [12, {"value": "3.14"}, [true, true, null, null, null, null]],
  [12, {"value": "3.140"}, [true, true, null, null, null, null]],
  [12, {"value": "3.15"}, [true, true, null, null, null, null]],
  [12, {"value": "3.13"}, [true, true, null, null, null, null]],
  [12, {"value": "3.2"}, [true, true, null, null, null, null]],
  [12, {"value": "3.24"}, [true, true, null, null, null, null]],
  [12, {"value": "3.64"}, [false, true, null, null, null, null]],
  [12, {"value": "3.65"}, [false, true, null, null, null, null]],
  [12, {"value": "2.64"}, [false, true, null, null, null, null]],
  [12, {"value": "4.14"}, [false, true, null, null, null, null]],
  [12, {"value": "4.15"}, [false, true, null, null, null, null]],
  [12, {"value": "3"}, [false, true, "rounded too far", "l1-decimals", null, null]],
  [12, {"value": "22/7"}, [true, true, null, null, null, null]],
  [13, {"value": ""}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": "   "}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": "\u00a0"}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": "\ufeff"}, [false, true, null, null, null, null]],
  [13, {}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": null}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": 7}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": ["x"]}, [false, false, null, null, "Type an answer.", null]],
  [13, {"value": "?"}, [false, true, null, null, null, null]],
  [13, {"value": "6 + 3 = 9"}, [true, true, null, null, null, null]],
  [13, {"value": "9 = 6 + 3"}, [true, true, null, null, null, null]],
  [13, {"value": "6+3 = 9 "}, [true, true, null, null, null, null]],
  [13, {"value": "6 + 3 = 9."}, [false, true, null, null, null, null]],
  [13, {"value": "3+6=9"}, [false, true, null, null, null, null]],
  [14, {"value": "3:2"}, [true, true, null, null, null, null]],
  [14, {"value": "3 : 2"}, [true, true, null, null, null, null]],
  [14, {"value": " 3:2 "}, [true, true, null, null, null, null]],
  [14, {"value": "2:3"}, [false, true, "The order matters - red first, then blue.", null, null, null]],
  [14, {"value": "2 : 3"}, [false, true, "The order matters - red first, then blue.", null, null, null]],
  [14, {"value": "12 : 8"}, [false, true, "That is correct but not in simplest form.", "l1-ratios", null, null]],
  [14, {"value": "12:08"}, [false, true, null, null, null, null]],
  [14, {"value": "6:4"}, [false, true, null, null, null, null]],
  [14, {"value": "3/2"}, [false, true, null, null, null, null]],
  [15, {"value": ""}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": "   "}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": "\u00a0"}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": "\ufeff"}, [false, true, null, null, null, null]],
  [15, {}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": null}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": 7}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": ["x"]}, [false, false, null, null, "Type an answer.", null]],
  [15, {"value": "?"}, [false, true, null, null, null, null]],
  [15, {"value": "denominator"}, [true, true, null, null, null, null]],
  [15, {"value": "  The   Denominator! "}, [true, true, null, null, null, null]],
  [15, {"value": "Denominator."}, [false, true, null, null, null, null]],
  [15, {"value": "the-denominator"}, [false, true, null, null, null, null]],
  [15, {"value": "NUMERATOR"}, [false, true, "That is the top number.", "l1-numerators-denominators", null, null]],
  [15, {"value": "numerator?"}, [false, true, "That is the top number.", "l1-numerators-denominators", null, null]],
  [15, {"value": "numerators"}, [false, true, null, null, null, null]],
  [15, {"value": "DENOMINATOR\u3000"}, [true, true, null, null, null, null]],
  [16, {"value": "x times y"}, [true, true, null, null, null, null]],
  [16, {"value": "X  TIMES  Y"}, [true, true, null, null, null, null]],
  [16, {"value": "x*y"}, [false, true, null, null, null, null]],
  [17, {"value": "2x"}, [true, true, null, null, null, null]],
  [17, {"value": "2X"}, [true, true, null, null, null, null]],
  [17, {"value": "2 x"}, [true, true, null, null, null, null]],
  [17, {"value": "2\u00d7"}, [true, true, null, null, null, null]],
  [17, {"value": "2*"}, [true, true, null, null, null, null]],
  [17, {"value": "x2"}, [false, true, "order", null, null, null]],
  [17, {"value": "X 2"}, [false, true, "order", null, null, null]],
  [17, {"value": "2y"}, [false, true, null, null, null, null]],
  [18, {"value": false}, [true, true, null, null, null, null]],
  [18, {"value": true}, [false, true, "d", "l1-x", null, null]],
  [18, {"value": "true"}, [false, false, null, null, "Choose true or false.", null]],
  [18, {"value": 1}, [false, false, null, null, "Choose true or false.", null]],
  [18, {"value": 0}, [false, false, null, null, "Choose true or false.", null]],
  [18, {"value": null}, [false, false, null, null, "Choose true or false.", null]],
  [18, {}, [false, false, null, null, "Choose true or false.", null]],
  [18, {"value": [true]}, [false, false, null, null, "Choose true or false.", null]],
  [19, {"value": false}, [false, true, null, null, null, null]],
  [19, {"value": true}, [true, true, null, null, null, null]],
  [20, {"value": false}, [false, true, null, null, null, null]],
  [20, {"value": true}, [true, true, null, null, null, null]],
  [21, {"order": [1, 2, 3]}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": "123"}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": null}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": []}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": ["1", "2", "3"]}, [true, true, null, null, null, null]],
  [21, {"order": ["2", "1", "3"]}, [false, true, "Check each neighbouring pair: the list should go in order.", null, null, null]],
  [21, {"order": ["1", "2"]}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": ["1", "2", "3", "3"]}, [false, false, null, null, "Arrange all of the items.", null]],
  [21, {"order": ["3", "2", "1"]}, [false, true, "Check each neighbouring pair: the list should go in order.", null, null, null]],
  [21, {"order": ["1", "2", "4"]}, [false, false, null, null, "Arrange all of the items.", null]],
  [22, {"order": ["$-3$", "$0$", "$5$"]}, [true, true, null, null, null, null]],
  [22, {"order": ["$5$", "$0$", "$-3$"]}, [false, true, "Check each neighbouring pair: the list should go smallest to largest.", null, null, null]],
  [22, {"order": ["$0$", "$-3$", "$5$"]}, [false, true, "Check each neighbouring pair: the list should go smallest to largest.", null, null, null]],
  [23, {"order": ["a", "a", "b"]}, [true, true, null, null, null, null]],
  [23, {"order": ["a", "b", "a"]}, [false, true, "Check each neighbouring pair: the list should go alphabetically.", null, null, null]],
  [23, {"order": ["a", "b", "b"]}, [false, false, null, null, "Arrange all of the items.", null]],
  [23, {"order": ["a", "b"]}, [false, false, null, null, "Arrange all of the items.", null]],
  [24, {"order": ["x", "y"]}, [true, true, null, null, null, null]],
  [24, {"order": ["y", "x"]}, [false, true, "Check each neighbouring pair: the list should go None.", null, null, null]],
  [25, {"text": "my answer", "self_check": [0, 1]}, [true, true, null, null, null, 0.6666666666666666]],
  [25, {"text": "my answer", "self_check": [0]}, [false, true, null, null, null, 0.3333333333333333]],
  [25, {"text": "", "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "ab", "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "  abc  ", "self_check": [0]}, [false, true, null, null, null, 0.3333333333333333]],
  [25, {"text": "  ab  ", "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "\ud83d\ude00\ud83d\ude00", "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "\ud83d\ude00\ud83d\ude00\ud83d\ude00", "self_check": [0]}, [false, true, null, null, null, 0.3333333333333333]],
  [25, {"text": "\u00a0ab\u3000", "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "abc"}, [false, false, null, null, "Tick the key ideas your explanation included.", null]],
  [25, {"text": "abc", "self_check": null}, [false, false, null, null, "Tick the key ideas your explanation included.", null]],
  [25, {"text": "abc", "self_check": "0"}, [false, false, null, null, "Tick the key ideas your explanation included.", null]],
  [25, {"text": "abc", "self_check": []}, [false, true, null, null, null, 0.0]],
  [25, {"text": "abc", "self_check": [0, 0, 0]}, [false, true, null, null, null, 0.3333333333333333]],
  [25, {"text": "abc", "self_check": [0, 1, 2]}, [true, true, null, null, null, 1.0]],
  [25, {"text": "abc", "self_check": [0, 1, 2, 3, 4]}, [true, true, null, null, null, 1.0]],
  [25, {"text": "abc", "self_check": [2, 1, 99, -1]}, [true, true, null, null, null, 0.6666666666666666]],
  [25, {"text": "abc", "self_check": [true, false]}, [true, true, null, null, null, 0.6666666666666666]],
  [25, {"text": "abc", "self_check": ["0", "1"]}, [false, true, null, null, null, 0.0]],
  [25, {"text": "abc", "self_check": [1.5]}, [false, true, null, null, null, 0.0]],
  [25, {"text": null, "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": 123, "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [25, {"text": "abc", "self_check": [0, 2]}, [true, true, null, null, null, 0.6666666666666666]],
  [25, {"text": "abc", "self_check": [0, 1, 2, 3]}, [true, true, null, null, null, 1.0]],
  [26, {"text": "abc", "self_check": []}, [false, true, null, null, null, 0.0]],
  [26, {"text": "abc", "self_check": [0, 0, 0]}, [false, true, null, null, null, 0.2]],
  [26, {"text": "abc", "self_check": [0, 1, 2]}, [true, true, null, null, null, 0.6]],
  [26, {"text": "abc", "self_check": [0, 1, 2, 3, 4]}, [true, true, null, null, null, 1.0]],
  [26, {"text": "abc", "self_check": [2, 1, 99, -1]}, [false, true, null, null, null, 0.4]],
  [26, {"text": "abc", "self_check": [true, false]}, [false, true, null, null, null, 0.4]],
  [26, {"text": "abc", "self_check": ["0", "1"]}, [false, true, null, null, null, 0.0]],
  [26, {"text": "abc", "self_check": [1.5]}, [false, true, null, null, null, 0.0]],
  [26, {"text": null, "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [26, {"text": 123, "self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [26, {"self_check": [0]}, [false, false, null, null, "Write your explanation in your own words first.", null]],
  [26, {"text": "abc", "self_check": [0, 2]}, [false, true, null, null, null, 0.4]],
  [26, {"text": "abc", "self_check": [0, 1, 2, 3]}, [true, true, null, null, null, 0.8]],
  [27, {"text": "abc", "self_check": []}, [false, true, null, null, null, 0.0]],
  [27, {"text": "abc", "self_check": [0, 0, 0]}, [true, true, null, null, null, 1.0]],
  [27, {"text": "abc", "self_check": [0, 1, 2]}, [true, true, null, null, null, 1.0]],
  [27, {"text": "abc", "self_check": [0, 1, 2, 3, 4]}, [true, true, null, null, null, 1.0]],
];

// prettier-ignore
const GOLDEN_VIEWS: [Q, string, string][] = [  // [question, JSON of publicView, JSON of reveal]
  [{"id": "c", "kind": "recall", "prompt": "Pick", "hint": null, "explanation": "Because.", "visual": null, "type": "choice", "options": [{"id": "a", "text": "Yes", "correct": true, "diagnosis": null, "revisit": null}, {"id": "b", "text": "No", "correct": false, "diagnosis": "Not so.", "revisit": "l1-x"}, {"id": "c", "text": "Maybe", "correct": true, "diagnosis": null, "revisit": null}], "multi": true, "max_tries": 2}, "{\"id\": \"c\", \"kind\": \"recall\", \"prompt\": \"Pick\", \"hint\": null, \"visual\": null, \"type\": \"choice\", \"options\": [{\"id\": \"a\", \"text\": \"Yes\"}, {\"id\": \"b\", \"text\": \"No\"}, {\"id\": \"c\", \"text\": \"Maybe\"}], \"multi\": true, \"max_tries\": 2}", "{\"explanation\": \"Because.\", \"correct_options\": [\"a\", \"c\"]}"],
  [{"type": "number", "kind": "solve", "prompt": "How many?", "answer": "3/4", "tolerance": null, "unit": "cm", "common_wrong": [{"answer": "4/3", "diagnosis": "upside down", "revisit": null}], "explanation": "Count.", "hint": "Look.", "visual": {"widget": "fraction", "props": {"numerator": 3}, "caption": "c"}, "generated_from": "fraction-of-shape", "id": "shape", "max_tries": 2}, "{\"type\": \"number\", \"kind\": \"solve\", \"prompt\": \"How many?\", \"tolerance\": null, \"unit\": \"cm\", \"hint\": \"Look.\", \"visual\": {\"widget\": \"fraction\", \"props\": {\"numerator\": 3}, \"caption\": \"c\"}, \"generated_from\": \"fraction-of-shape\", \"id\": \"shape\", \"max_tries\": 2}", "{\"explanation\": \"Count.\", \"answer\": \"3/4\"}"],
  [{"id": "t", "kind": "apply", "prompt": "Write", "hint": null, "explanation": "$6+3=9$.", "visual": null, "type": "text", "accept": ["6+3=9", "9=6+3"], "common_wrong": [], "mode": "math", "max_tries": 2}, "{\"id\": \"t\", \"kind\": \"apply\", \"prompt\": \"Write\", \"hint\": null, \"visual\": null, \"type\": \"text\", \"mode\": \"math\", \"max_tries\": 2}", "{\"explanation\": \"$6+3=9$.\", \"answer\": \"6+3=9\"}"],
  [{"id": "tf", "kind": "recall", "prompt": "True?", "hint": null, "explanation": "Yes.", "visual": null, "type": "truefalse", "answer": true, "diagnosis": "Think again.", "revisit": null, "max_tries": 1}, "{\"id\": \"tf\", \"kind\": \"recall\", \"prompt\": \"True?\", \"hint\": null, \"visual\": null, \"type\": \"truefalse\", \"max_tries\": 1}", "{\"explanation\": \"Yes.\", \"answer\": true}"],
  [{"type": "order", "kind": "solve", "prompt": "Order these", "items": ["$1$", "$2$", "$3$"], "order_label": "smallest to largest", "explanation": "Left to right.", "hint": null, "visual": null, "generated_from": "order-numbers", "id": "o", "shuffled": ["$3$", "$1$", "$2$"], "max_tries": 2}, "{\"type\": \"order\", \"kind\": \"solve\", \"prompt\": \"Order these\", \"order_label\": \"smallest to largest\", \"hint\": null, \"visual\": null, \"generated_from\": \"order-numbers\", \"id\": \"o\", \"max_tries\": 2, \"items\": [\"$3$\", \"$1$\", \"$2$\"]}", "{\"explanation\": \"Left to right.\", \"answer\": [\"$1$\", \"$2$\", \"$3$\"]}"],
  [{"id": "e", "kind": "explain", "prompt": "Explain", "hint": null, "explanation": "Ideas.", "visual": null, "type": "explain", "rubric": ["one", "two"], "model_answer": "One and two.", "max_tries": 1}, "{\"id\": \"e\", \"kind\": \"explain\", \"prompt\": \"Explain\", \"hint\": null, \"visual\": null, \"type\": \"explain\", \"max_tries\": 1, \"rubric_count\": 2}", "{\"explanation\": \"Ideas.\", \"rubric\": [\"one\", \"two\"], \"model_answer\": \"One and two.\"}"],
  [{"id": "m", "type": "mystery", "prompt": "?", "shuffled": [1], "answer": 1}, "{\"id\": \"m\", \"type\": \"mystery\", \"prompt\": \"?\"}", "{\"explanation\": null}"],
  [{"id": "n", "type": "number", "answer": "2", "_tries": 1}, "{\"id\": \"n\", \"type\": \"number\", \"_tries\": 1}", "{\"explanation\": null, \"answer\": \"2\"}"],
];
