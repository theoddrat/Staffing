/**
 * Materialise assessment questions and grade answers: a port of backend/app/learning/grading.py.
 *
 * All numeric answers are compared exactly using rational arithmetic (Fraction), so "2/4" is
 * accepted for "1/2" and "0.5" for "1/2", but "0.33" is not accepted for "1/3".
 *
 * What a learner types is read exactly as Python reads it: `str.strip()` and regex `\s` use
 * Python's whitespace set, `\w` is any letter, number or "_", `\d` is any Unicode decimal digit,
 * and `Fraction(str)` follows Python 3.13's grammar (underscores between digits, exponents, and the
 * 4300-digit limit on converting a string to an integer).
 */
import { Fraction } from "./fraction";
import { generate } from "./practice";
import type { Random } from "./rng";
import type { Assessment, Q } from "./types";

/** Fields hidden from the learner until the question is answered. */
export const PRIVATE_FIELDS: readonly string[] = [
  "answer",
  "accept",
  "common_wrong",
  "items",
  "rubric",
  "model_answer",
  "explanation",
  "diagnosis",
  "revisit",
];
const PRIVATE = new Set(PRIVATE_FIELDS);

/** An explanation passes when at least this fraction of its rubric is met. */
export const EXPLAIN_PASS_SCORE = 0.6;

type Row = Record<string, unknown>;

/** Turn an authored assessment into concrete questions for one attempt. */
export function materialise(assessment: Assessment, rng: Random): Q[] {
  const out: Q[] = [];
  for (const q of assessment.questions) {
    let m: Q;
    if (q.type === "generated") {
      m = generate(q.generator, rng, { ...q.params });
      m.id = q.id;
    } else {
      // Python: q.model_dump(mode="json") - a fresh JSON copy, so the content is never mutated.
      m = JSON.parse(JSON.stringify(q)) as Q;
      if (q.type === "choice") {
        m.options = (m.options as Row[]).map((o, i) => ({ id: String.fromCharCode(97 + i), ...o }));
      }
    }
    prepare(m, rng);
    out.push(m);
  }
  return out;
}

const SYMBOLS = new Set(["<", ">", "="]);
const ORDERED_LISTS = [
  ["true", "false"],
  ["even", "odd"],
  ["yes", "no"],
];

/** Python `_prepare`: shuffle choice options and order items, and set `max_tries`. */
export function prepare(q: Q, rng: Random): void {
  if (q.type === "choice") {
    // Keep a stable order for symbol questions (<, >, =); shuffle others.
    const texts = (q.options as Row[]).map((o) => o.text as string);
    if (!texts.every((t) => SYMBOLS.has(t.replace(/^\$+|\$+$/g, ""))) && !isOrderedList(texts)) {
      rng.shuffle(q.options);
    }
  }
  if (q.type === "order") {
    const shuffled = [...q.items];
    for (let i = 0; i < 10; i++) {
      rng.shuffle(shuffled);
      if (!listEq(shuffled, q.items)) break;
    }
    q.shuffled = shuffled;
  }
  q.max_tries = maxTries(q);
}

function isOrderedList(texts: string[]): boolean {
  const lowered = texts.map((t) => t.toLowerCase());
  return ORDERED_LISTS.some((l) => listEq(lowered, l));
}

export function maxTries(q: Q): number {
  if (q.type === "truefalse" || q.type === "explain") return 1;
  if (q.type === "choice" && q.options.length <= 2) return 1;
  return 2;
}

/** What the learner may see before answering. */
export function publicView(q: Q): Q {
  const pub: Row = {};
  for (const [k, v] of Object.entries(q)) if (!PRIVATE.has(k)) pub[k] = v;
  if (q.type === "choice") pub.options = (q.options as Row[]).map((o) => ({ id: o.id, text: o.text }));
  if (q.type === "order") pub.items = q.shuffled;
  delete pub.shuffled;
  if (q.type === "explain") pub.rubric_count = q.rubric.length;
  return pub as Q;
}

/** What the learner sees after the question is finished. */
export function reveal(q: Q): Record<string, unknown> {
  const r: Row = { explanation: get(q, "explanation") };
  const t = q.type;
  if (t === "choice") r.correct_options = (q.options as Row[]).filter((o) => truthy(o.correct)).map((o) => o.id);
  else if (t === "number") r.answer = q.answer;
  else if (t === "text") r.answer = q.accept[0];
  else if (t === "truefalse") r.answer = q.answer;
  else if (t === "order") r.answer = q.items;
  else if (t === "explain") {
    r.rubric = q.rubric;
    r.model_answer = q.model_answer;
  }
  return r;
}

// ------------------------------------------------------------------ parsing

/** Python's whitespace (`str.isspace()`, and `\s` in str patterns), as a regex class body. */
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const SPACE_RUNS = new RegExp(`[${WS}]+`, "g");
// Python `[^\w\s/.-]`: \w is a letter, a number or "_".
const NOT_WORDISH = new RegExp(`[^\\p{L}\\p{N}_${WS}/.-]`, "gu");
// Python `^([+-]?\d+)\s+(\d+)\s*/\s*(\d+)$` (digits are made ASCII first).
const MIXED = new RegExp(`^([+-]?\\d+)[${WS}]+(\\d+)[${WS}]*/[${WS}]*(\\d+)$`);
// Python 3.13 fractions._RATIONAL_FORMAT (re.IGNORECASE only affects the "E").
const RATIONAL = new RegExp(
  `^[${WS}]*(?<sign>[-+]?)(?=\\d|\\.\\d)(?<num>\\d*|\\d+(?:_\\d+)*)` +
    `(?:(?:[${WS}]*/[${WS}]*(?<denom>\\d+(?:_\\d+)*))?|(?:\\.(?<decimal>\\d*|\\d+(?:_\\d+)*))?(?:[eE](?<exp>[-+]?\\d+(?:_\\d+)*))?)` +
    `[${WS}]*$`,
);
const DIGIT = /^\p{Nd}$/u;
const DIGITS = /\p{Nd}/gu;
/** Python refuses to convert a string of more than 4300 digits to an int (sys.get_int_max_str_digits). */
const MAX_STR_DIGITS = 4300;
/**
 * Exponents beyond this are refused instead of computed: 10**(10**7) takes Python seconds and the
 * browser about one, and larger ones would hang the page. (No sensible answer is near them.)
 */
const MAX_EXPONENT = 1000000n;

class ValueError extends Error {}

function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && PY_SPACE.has(s.charCodeAt(a))) a++;
  while (b > a && PY_SPACE.has(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

// Python `re.sub(r"\s*/\s*", "/", s)`: drop the whitespace on both sides of every "/" (written as a
// loop to avoid the regex's quadratic backtracking on long runs of spaces).
function tightenSlashes(s: string): string {
  const parts = s.split("/");
  const last = parts.length - 1;
  return parts
    .map((p, i) => {
      let a = 0;
      let b = p.length;
      if (i > 0) while (a < b && PY_SPACE.has(p.charCodeAt(a))) a++;
      if (i < last) while (b > a && PY_SPACE.has(p.charCodeAt(b - 1))) b--;
      return p.slice(a, b);
    })
    .join("/");
}

/**
 * Every Unicode decimal digit as its ASCII digit (Python's `\d` and `int()` accept them all).
 * Unicode encodes each set of decimal digits as a contiguous run 0-9, so a digit's value is its
 * position in its block of digits, modulo 10.
 */
function asciiDigits(s: string): string {
  return s.replace(DIGITS, (ch) => {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x39) return ch;
    let start = cp;
    while (DIGIT.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}

/** Python `int(s)` for a sign, ASCII digits and single underscores between digits. */
function pyInt(s: string): bigint {
  if (s.replace(/[^0-9]/g, "").length > MAX_STR_DIGITS) {
    throw new ValueError(`Exceeds the limit (${MAX_STR_DIGITS} digits) for integer string conversion`);
  }
  return BigInt(s.replace(/_/g, ""));
}

/** Python `Fraction(s)` for a string: throws (like ValueError / ZeroDivisionError) when it would. */
function fractionFromString(raw: string): Fraction {
  const m = RATIONAL.exec(asciiDigits(raw));
  const g = m?.groups;
  if (!g) throw new ValueError(`Invalid literal for Fraction: ${JSON.stringify(raw)}`);
  let num = pyInt(g.num || "0");
  let den = 1n;
  if (g.denom) den = pyInt(g.denom);
  else {
    if (g.decimal) {
      const decimal = pyInt(g.decimal);
      const scale = 10n ** BigInt(g.decimal.replace(/_/g, "").length);
      num = num * scale + decimal;
      den *= scale;
    }
    if (g.exp) {
      const exp = pyInt(g.exp);
      if (exp > MAX_EXPONENT || exp < -MAX_EXPONENT) throw new ValueError("exponent too large");
      if (exp >= 0n) num *= 10n ** exp;
      else den *= 10n ** -exp;
    }
  }
  if (g.sign === "-") num = -num;
  if (den === 0n) throw new RangeError(`Fraction(${num}, 0)`);
  return new Fraction(num, den);
}

/** Python `Fraction(x)` for the values a question can hold (strings, numbers, booleans). */
function pyFraction(x: unknown): Fraction {
  if (x instanceof Fraction) return x;
  if (typeof x === "string") return fractionFromString(x);
  if (typeof x === "bigint") return new Fraction(x);
  if (typeof x === "boolean") return new Fraction(x ? 1n : 0n);
  if (typeof x === "number") {
    // Exact, like Fraction(float): doubling a double is exact, so this finds m * 2**-k exactly.
    if (!Number.isFinite(x)) throw new ValueError(`cannot convert ${x} to a Fraction`);
    let v = x;
    let k = 0n;
    while (!Number.isInteger(v)) {
      v *= 2;
      k++;
    }
    return new Fraction(BigInt(v), 1n << k);
  }
  throw new TypeError("argument should be a string or a Rational instance");
}

/** Python `str(x)` for the scalars that can arrive in an answer or a question. */
function pyStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === null || x === undefined) return "None";
  if (typeof x === "boolean") return x ? "True" : "False";
  return String(x);
}

/** Parse '7', '-3', '−3', '3/4', '0.75', '.5', '1 1/2', '1,000', '75%'. */
export function parseNumber(raw: unknown): Fraction | null {
  if (raw === null || raw === undefined) return null;
  // Python's str() of a list or dict ("[...]", "{...}") never parses as a number.
  if (typeof raw === "object" || typeof raw === "function" || typeof raw === "symbol") return null;
  let s = pyStrip(pyStr(raw).normalize("NFKC"));
  s = pyStrip(s.replaceAll("\u2212", "-").replaceAll("\u2013", "-").replaceAll(",", "").replaceAll("%", ""));
  s = s.replaceAll("\u00f7", "/");
  if (!s) return null;
  s = asciiDigits(s);
  const m = MIXED.exec(s);
  try {
    if (m) {
      const whole = pyInt(m[1]);
      const num = pyInt(m[2]);
      const den = pyInt(m[3]);
      if (den === 0n) return null;
      const frac = new Fraction(num, den);
      return whole < 0n || s.startsWith("-") ? new Fraction(whole).sub(frac) : new Fraction(whole).add(frac);
    }
    s = tightenSlashes(s);
    const i = s.indexOf("/");
    if (i >= 0) {
      const a = s.slice(0, i);
      const b = s.slice(i + 1);
      if (fractionFromString(b).eq(0)) return null;
      return fractionFromString(a).div(fractionFromString(b));
    }
    return fractionFromString(s);
  } catch {
    // Python catches ValueError and ZeroDivisionError here; nothing else can be raised.
    return null;
  }
}

/** "words": case/punctuation-insensitive; "math": keeps symbols, ignores spaces. */
export function normaliseText(s: string, mode: string | null = "words"): string {
  s = pyStrip(s.normalize("NFKC").toLowerCase());
  if (mode === "math") {
    s = s.replaceAll("\u2212", "-").replaceAll("\u00d7", "*").replaceAll("x", "*").replaceAll("\u00f7", "/");
    return s.replace(SPACE_RUNS, "");
  }
  s = s.replace(NOT_WORDISH, "");
  return s.replace(SPACE_RUNS, " ");
}

// ------------------------------------------------------------------ grading

/** The result of grading one answer (Python dataclass `Grade`, same fields in the same order). */
export type Grade = {
  correct: boolean;
  /** false when the answer could not be understood (not counted as a try) */
  valid: boolean;
  diagnosis: string | null;
  revisit: string | null;
  message: string | null;
  /** for explain questions: fraction of rubric met */
  score: number | null;
};

/** Python `Grade(correct, valid=True, diagnosis=None, revisit=None, message=None, score=None)`. */
export function makeGrade(correct: boolean, fields: Partial<Omit<Grade, "correct">> = {}): Grade {
  return {
    correct,
    valid: fields.valid ?? true,
    diagnosis: fields.diagnosis ?? null,
    revisit: fields.revisit ?? null,
    message: fields.message ?? null,
    score: fields.score ?? null,
  };
}

function invalid(message: string): Grade {
  return makeGrade(false, { valid: false, message });
}

export function grade(q: Q, answer: Record<string, unknown>): Grade {
  const t = q.type;
  if (t === "choice") return gradeChoice(q, answer);
  if (t === "number") return gradeNumber(q, answer);
  if (t === "text") return gradeText(q, answer);
  if (t === "truefalse") {
    const val = get(answer, "value");
    if (typeof val !== "boolean") return invalid("Choose true or false.");
    const ok = val === q.answer;
    return makeGrade(ok, { diagnosis: ok ? null : str(get(q, "diagnosis")), revisit: ok ? null : str(get(q, "revisit")) });
  }
  if (t === "order") {
    const order = get(answer, "order");
    if (!Array.isArray(order) || !sameItems(order, q.items)) return invalid("Arrange all of the items.");
    const ok = listEq(order, q.items);
    return makeGrade(ok, {
      diagnosis: ok ? null : `Check each neighbouring pair: the list should go ${pyStr(get(q, "order_label", "in order"))}.`,
    });
  }
  if (t === "explain") return gradeExplainSelf(q, answer);
  throw new Error(`unknown question type ${t}`);
}

function gradeChoice(q: Q, answer: Record<string, unknown>): Grade {
  let selected = get(answer, "selected");
  if (typeof selected === "string") selected = [selected];
  if (!Array.isArray(selected) || !selected.length) return invalid("Choose an answer.");
  const options = q.options as Row[];
  const byId = new Map<unknown, Row>(options.map((o) => [o.id, o]));
  // (Python raises TypeError for an unhashable entry such as a list; here it is just unknown.)
  if (selected.some((s) => !byId.has(s))) return invalid("Unknown option.");
  const correctIds = new Set(options.filter((o) => truthy(o.correct)).map((o) => o.id));
  const chosen = new Set<unknown>(selected);
  if (chosen.size === correctIds.size && [...chosen].every((s) => correctIds.has(s))) return makeGrade(true);
  const wrongPicks = selected.filter((s) => !correctIds.has(s)).map((s) => byId.get(s) as Row);
  if (wrongPicks.length) {
    const w = wrongPicks[0];
    return makeGrade(false, { diagnosis: str(get(w, "diagnosis")), revisit: str(get(w, "revisit")) });
  }
  // Python takes the first of a set difference (no defined order); this takes the first in option order.
  const missed = [...correctIds].filter((i) => !chosen.has(i)).map((i) => byId.get(i) as Row);
  return makeGrade(false, {
    diagnosis: truthy(get(q, "multi"))
      ? "Everything you chose is right, but something is missing. Look again: more than one answer is correct."
      : null,
    revisit: missed.length ? str(get(missed[0], "revisit")) : null,
  });
}

function gradeNumber(q: Q, answer: Record<string, unknown>): Grade {
  const val = parseNumber(get(answer, "value", ""));
  if (val === null) return invalid("Type a number such as 7, -3, 3/4 or 0.25.");
  const target = pyFraction(q.answer);
  const tol = get(q, "tolerance");
  const ok = truthy(tol) ? val.sub(target).abs().le(pyFraction(pyStr(tol))) : val.eq(target);
  if (ok) return makeGrade(true);
  for (const w of rows(get(q, "common_wrong", []))) {
    const wv = parseNumber(w.answer);
    if (wv !== null && wv.eq(val)) return makeGrade(false, { diagnosis: str(w.diagnosis), revisit: str(get(w, "revisit")) });
  }
  return makeGrade(false);
}

function gradeText(q: Q, answer: Record<string, unknown>): Grade {
  const raw = get(answer, "value", "");
  if (typeof raw !== "string" || !pyStrip(raw)) return invalid("Type an answer.");
  const mode = get(q, "mode", "words") as string | null;
  const val = normaliseText(raw, mode);
  if ((q.accept as string[]).some((a) => val === normaliseText(a, mode))) return makeGrade(true);
  for (const w of rows(get(q, "common_wrong", []))) {
    if (val === normaliseText(w.answer as string, mode)) {
      return makeGrade(false, { diagnosis: str(w.diagnosis), revisit: str(get(w, "revisit")) });
    }
  }
  return makeGrade(false);
}

/** Self-assessment against the rubric (used when no AI grader is configured). */
export function gradeExplainSelf(q: Q, answer: Record<string, unknown>): Grade {
  const text = get(answer, "text", "");
  // Python's len() counts code points, not UTF-16 units.
  if (typeof text !== "string" || [...pyStrip(text)].length < 3) {
    return invalid("Write your explanation in your own words first.");
  }
  const claimed = get(answer, "self_check");
  if (!Array.isArray(claimed)) return invalid("Tick the key ideas your explanation included.");
  const n = q.rubric.length;
  const met = new Set<number>();
  for (const c of claimed) {
    const i = typeof c === "boolean" ? Number(c) : c; // a bool is an int in Python
    if (typeof i === "number" && Number.isInteger(i) && 0 <= i && i < n) met.add(i);
  }
  const score = met.size / n;
  return makeGrade(score >= EXPLAIN_PASS_SCORE, { score });
}

export function creditFor(tryNumber: number, correct: boolean): number {
  if (!correct) return 0.0;
  return tryNumber === 1 ? 1.0 : 0.5;
}

// ------------------------------------------------------------------ helpers

/** Python `d.get(key, default)`. */
function get(obj: unknown, key: string, dflt: unknown = null): unknown {
  if (obj === null || typeof obj !== "object" || !Object.prototype.hasOwnProperty.call(obj, key)) return dflt;
  const v = (obj as Row)[key];
  return v === undefined ? dflt : v;
}

/** A diagnosis or revisit as stored: content gives a string or null. */
function str(v: unknown): string | null {
  return (v ?? null) as string | null;
}

function rows(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

/** Python truthiness. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || v === 0n) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function listEq(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Python `sorted(a) == sorted(b)` for lists of strings: the same items, ignoring order. */
function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && listEq([...a].sort(), [...b].sort());
}
