/**
 * Question generators: endless fresh practice with answers computed by code.
 *
 * A faithful port of backend/app/learning/practice.py. Each generator returns a *materialised
 * question* - the same plain-object shape the assessment engine stores for authored questions - so
 * generated and authored questions are graded by the same code. Answers are computed here, never
 * written by hand, which keeps them correct.
 *
 * Key order, value types and learner-facing wording match the Python generators exactly (numeric
 * answers are strings, as Python's `str(Fraction(...))`; question objects contain only JSON values).
 */
import { Fraction } from "./fraction";
import { Random, range } from "./rng";
import type { Q } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Params = Record<string, any>;

export type Generator = { id: string; title: string; lesson: string; fn: (rng: Random, params: Params) => Q };

/** Every generator by id, in the same (registration) order as the Python dict. */
export const GENERATORS: Record<string, Generator> = {};

export const OBJECTS = ["apple", "star", "cookie", "ball", "flower", "fish"];

/** A question as a generator builds it (no `id` yet: the caller adds one, as in Python). */
type Fields = Params;

function generator(id: string, title: string, lesson: string, fn: (rng: Random, params: Params) => Fields): void {
  GENERATORS[id] = { id, title, lesson, fn: fn as (rng: Random, params: Params) => Q };
}

/** Like Python's `generate`: a fresh question, with `hint` / `visual` defaulting to null. */
export function generate(gid: string, rng?: Random, params?: Params | null): Q {
  const g = Object.prototype.hasOwnProperty.call(GENERATORS, gid) ? GENERATORS[gid] : undefined;
  if (!g) throw new Error(`unknown generator '${gid}'`);
  const q = g.fn(rng ?? new Random(), { ...(params ?? {}) });
  if (!("hint" in q)) q.hint = null;
  if (!("visual" in q)) q.visual = null;
  q.generated_from = gid;
  return q;
}

/** `p.get(key, default)`: the default only when the key is absent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function get<T = any>(p: Params, key: string, dflt: T): T {
  return Object.prototype.hasOwnProperty.call(p, key) ? p[key] : dflt;
}

// --------------------------------------------------------------- helpers

export function divisors(n: number): number[] {
  n = Math.abs(n);
  const small: number[] = [];
  const large: number[] = [];
  let d = 1;
  while (d * d <= n) {
    if (n % d === 0) {
      small.push(d);
      if (d !== n / d) large.push(n / d);
    }
    d += 1;
  }
  return small.concat(large.reverse());
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  let d = 3;
  while (d * d <= n) {
    if (n % d === 0) return false;
    d += 2;
  }
  return true;
}

/** Python's `math.gcd`: always non-negative, gcd(0, 0) = 0. */
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  const g = gcd(a, b);
  if (g === 0) throw new RangeError("integer division or modulo by zero"); // as Python: lcm(0, 0)
  return Math.abs(a * b) / g;
}

export function fracTex(f: Fraction): string {
  if (f.denominator === 1n) return f.numerator.toString();
  const sign = f.lt(0) ? "-" : "";
  const num = f.numerator < 0n ? -f.numerator : f.numerator;
  return `${sign}\\tfrac{${num}}{${f.denominator}}`;
}

export function fmtList(xs: readonly number[]): string {
  return xs.map((x) => String(x)).join(", ");
}

/** LaTeX for an integer, using a proper minus sign. */
export function numTex(n: number): string {
  return n < 0 ? `-${Math.abs(n)}` : String(n);
}

export type OptionSpec = [text: string, correct: boolean, diagnosis: string | null, revisit: string | null];

/** The `options` / `multi` fields of a choice question (ids "a", "b", ...). */
export function choice(options: OptionSpec[], multi = false): { options: Q["options"]; multi: boolean } {
  return {
    options: options.map(([t, c, d, r], i) => ({ id: String.fromCharCode(97 + i), text: t, correct: c, diagnosis: d, revisit: r })),
    multi,
  };
}

type Num = Fraction | number | string;

function numStr(x: Num): string {
  if (typeof x === "string") return x;
  return (x instanceof Fraction ? x : new Fraction(x)).toString();
}

export type NumberQOptions = {
  kind?: string;
  commonWrong?: [answer: Num, diagnosis: string, revisit: string | null][] | null;
  unit?: string | null;
  hint?: string | null;
  visual?: Record<string, unknown> | null;
};

export function numberQ(prompt: string, answer: Num, explanation: string, opts: NumberQOptions = {}): Q {
  return numberFields(prompt, answer, explanation, opts) as Q;
}

function numberFields(prompt: string, answer: Num, explanation: string, opts: NumberQOptions): Fields {
  const ans = numStr(answer);
  const seen = new Set<string>();
  const cw: { answer: string; diagnosis: string; revisit: string | null }[] = [];
  for (const [a, d, r] of opts.commonWrong ?? []) {
    const key = numStr(a);
    if (key === ans || seen.has(key)) continue; // a "wrong" answer that coincides with the right one is not wrong
    seen.add(key);
    cw.push({ answer: key, diagnosis: d, revisit: r });
  }
  return {
    type: "number",
    kind: opts.kind ?? "solve",
    prompt,
    answer: ans,
    tolerance: null,
    unit: opts.unit ?? null,
    common_wrong: cw,
    explanation,
    hint: opts.hint ?? null,
    visual: opts.visual ?? null,
  };
}

// Python's float formatting, exactly (correct rounding of the binary value, ties to even).

function exactDouble(x: number): { n: bigint; d: bigint } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp = -1074;
  if (expBits) {
    mant |= 1n << 52n;
    exp = expBits - 1075;
  }
  return exp >= 0 ? { n: mant << BigInt(exp), d: 1n } : { n: mant, d: 1n << BigInt(-exp) };
}

function roundHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = 2n * (n - q * d);
  return r2 > d || (r2 === d && q % 2n === 1n) ? q + 1n : q;
}

/** `f"{x:.{k}f}"` */
export function pyFormatFixed(x: number, k: number): string {
  const { n, d } = exactDouble(x);
  const s = roundHalfEven(n * 10n ** BigInt(k), d).toString().padStart(k + 1, "0");
  const body = k ? `${s.slice(0, -k)}.${s.slice(-k)}` : s;
  return (x < 0 || Object.is(x, -0) ? "-" : "") + body;
}

/** `f"{x:.{p}g}"` */
export function pyFormatGeneral(x: number, p: number): string {
  if (p === 0) p = 1;
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  if (x === 0) return sign + "0";
  const { n, d } = exactDouble(x);
  const atLeast = (e: number) => (e >= 0 ? n >= d * 10n ** BigInt(e) : n * 10n ** BigInt(-e) >= d); // |x| >= 10^e
  let e = Math.floor(Math.log10(Math.abs(x)));
  while (!atLeast(e)) e--;
  while (atLeast(e + 1)) e++;
  const k = e - p + 1;
  let digits = k >= 0 ? roundHalfEven(n, d * 10n ** BigInt(k)) : roundHalfEven(n * 10n ** BigInt(-k), d);
  if (digits === 10n ** BigInt(p)) {
    digits = 10n ** BigInt(p - 1);
    e += 1;
  }
  const ds = digits.toString();
  if (e >= -4 && e < p) {
    const intPart = e >= 0 ? ds.slice(0, e + 1) : "0";
    const frac = (e >= 0 ? ds.slice(e + 1) : "0".repeat(-e - 1) + ds).replace(/0+$/, "");
    return sign + intPart + (frac ? "." + frac : "");
  }
  const mant = (ds[0] + "." + ds.slice(1)).replace(/0+$/, "").replace(/\.$/, "");
  return `${sign}${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

function sortedNums(xs: number[]): number[] {
  return xs.slice().sort((a, b) => a - b);
}

// ------------------------------------------------------------ counting

generator("count-objects", "How many objects?", "l1-counting-objects", (rng, p) => {
  const n = rng.randint(get(p, "min", 3), get(p, "max", 15));
  const obj = rng.choice(OBJECTS);
  return numberQ(
    `How many ${obj}s are in the tray? Tap each one to count it.`,
    n,
    `Giving each ${obj} exactly one counting number, the last number said is **${n}**, so there are ${n}.`,
    {
      kind: "recall",
      commonWrong: [
        [n + 1, "One too many usually means one object was counted twice. Tap each object exactly once.", "l1-counting-meaning"],
        [n - 1, "One too few usually means one object was skipped. Check that every object has a number.", "l1-counting-meaning"],
      ],
      visual: {
        widget: "counting-objects",
        props: { count: n, object: obj, editable: false, tagging: true },
        caption: `A tray of ${obj}s. Tapping an object gives it the next counting number.`,
      },
    },
  );
});

generator("next-number", "What comes next?", "l1-one-two-three", (rng, p) => {
  const n = rng.randint(get(p, "min", 0), get(p, "max", 99));
  if (n > 0 && rng.random() < 0.4) {
    return numberQ(
      `Which counting number comes just **before** ${n}?`,
      n - 1,
      `Counting up goes ..., ${n - 1}, ${n}, ... so the number just before ${n} is **${n - 1}**.`,
      { commonWrong: [[n + 1, `${n + 1} comes just *after* ${n}. 'Before' means one step back.`, null]] },
    );
  }
  return numberQ(
    `Which counting number comes just **after** ${n}?`,
    n + 1,
    `Every counting number has a next one, found by adding one more: after ${n} comes **${n + 1}**.`,
    { commonWrong: [[n - 1, `${n - 1} comes just *before* ${n}. 'After' means one more.`, null]] },
  );
});

generator("skip-count", "Counting in equal jumps", "l1-equal-groups", (rng, p) => {
  const k: number = rng.choice(get(p, "steps", [2, 3, 5, 10]));
  const m = rng.randint(2, 6);
  const seq = range(1, m + 1).map((i) => k * i);
  return numberQ(
    `Counting in jumps of ${k}: ${fmtList(seq)}, ... What number comes next?`,
    k * (m + 1),
    `Each jump adds ${k} more, so after ${seq[seq.length - 1]} comes **${k * (m + 1)}**.`,
    {
      kind: "predict",
      commonWrong: [[seq[seq.length - 1] + 1, `That adds one. In this pattern each step jumps by ${k}.`, "l0-patterns"]],
    },
  );
});

generator("rows-total", "Equal rows", "l1-equal-groups", (rng, p) => {
  const r = rng.randint(2, get(p, "maxRows", 5));
  const c = rng.randint(2, get(p, "maxCols", 6));
  return numberQ(
    `Chairs are set out in ${r} equal rows with ${c} chairs in each row. How many chairs are there?`,
    r * c,
    `Count in jumps of ${c}, once for each of the ${r} rows: ` +
      range(1, r + 1)
        .map((i) => String(c * i))
        .join(", ") +
      `. There are **${r * c}** chairs.`,
    {
      kind: "apply",
      commonWrong: [
        [r + c, "That adds the number of rows to the row length. Each row holds a whole group of chairs, so count group by group.", "l1-equal-groups"],
      ],
      visual: { widget: "rectangle-arranger", props: { n: r * c, rows: r, editable: false }, caption: `${r * c} chairs arranged in ${r} equal rows.` },
    },
  );
});

// ----------------------------------------------------------- comparing

generator("compare-numbers", "Which symbol?", "l1-bigger-smaller", (rng, p) => {
  const lo: number = get(p, "min", 0);
  const hi: number = get(p, "max", 100);
  const a = rng.randint(lo, hi);
  const b = rng.random() < 0.15 ? a : rng.randint(lo, hi);
  const neg = a < 0 || b < 0;
  const rel = a < b ? "<" : a > b ? ">" : "=";
  const word = ({ "<": "is less than", ">": "is greater than", "=": "is equal to" } as Record<string, string>)[rel];
  const revisit = neg ? "l1-negative-numbers" : "l1-bigger-smaller";
  const wrongDiag = neg
    ? "With negative numbers, the number further to the left on the number line is smaller - " + "for example $-7$ is colder than $-3$."
    : "The wide-open side of $<$ or $>$ always faces the bigger number.";
  const opts: OptionSpec[] = [];
  for (const sym of ["<", ">", "="]) {
    opts.push([`$${sym}$`, sym === rel, sym === rel ? null : wrongDiag, sym === rel ? null : revisit]);
  }
  return {
    type: "choice",
    kind: "solve",
    prompt: `Which symbol makes this true?  $\\;${numTex(a)} \\;\\square\\; ${numTex(b)}$`,
    ...choice(opts),
    explanation: `$${numTex(a)} ${rel} ${numTex(b)}$: ${numTex(a)} ${word} ${numTex(b)}.`,
  };
});

generator("order-numbers", "Put in order", "l1-number-lines", (rng, p) => {
  const count: number = get(p, "count", 4);
  const lo: number = get(p, "min", 0);
  const hi: number = get(p, "max", 50);
  const vals = rng.sample(range(lo, hi + 1), count);
  const items = sortedNums(vals).map(numTex);
  return {
    type: "order",
    kind: "solve",
    prompt: "Put these numbers in order from smallest to largest.",
    items: items.map((x) => `$${x}$`),
    order_label: "smallest to largest",
    explanation: "On the number line they appear left to right as " + items.map((x) => `$${x}$`).join(", ") + ".",
  };
});

generator("number-line-move", "Moving on the number line", "l1-negative-numbers", (rng) => {
  const start = rng.randint(-5, 5);
  const steps = rng.randint(2, 8);
  const left = rng.random() < 0.6;
  const end = left ? start - steps : start + steps;
  const direction = left ? "left" : "right";
  return numberQ(
    `Start at $${numTex(start)}$ on the number line and move ${steps} steps to the ${direction}. Where do you land?`,
    end,
    `Counting ${steps} steps ${direction} from $${numTex(start)}$ lands on **$${numTex(end)}$**.`,
    {
      commonWrong: [
        [-end, "That is the right distance from zero but on the wrong side of zero. Moving left goes toward the negative numbers.", "l1-negative-numbers"],
      ],
      visual: { widget: "number-line", props: { min: -12, max: 12, value: start, editable: false }, caption: `The point starts at ${start}.` },
    },
  );
});

generator("build-number", "Digits and place value", "l1-number-symbols", (rng) => {
  const h = rng.randint(1, 9);
  const t = rng.random() < 0.5 ? 0 : rng.randint(1, 9);
  const o = rng.randint(0, 9);
  const n = 100 * h + 10 * t + o;
  const wrong: [Num, string, string | null][] =
    t === 0
      ? [[parseInt(`${h}${o}`, 10), "A zero is needed to hold the empty tens place. Without it the hundreds slide into the tens place.", "l1-zero"]]
      : [];
  wrong.push([h + t + o, "That adds the digits. Each digit's position says how big a group it counts.", "l1-number-symbols"]);
  return numberQ(
    `Which number has **${h}** hundreds, **${t}** tens and **${o}** ones?`,
    n,
    `${h} hundreds, ${t} tens and ${o} ones is written **${n}**: the position of each digit tells you its size.`,
    { commonWrong: wrong, visual: null },
  );
});

generator("digit-value", "What is this digit worth?", "l1-number-symbols", (rng) => {
  const n = rng.randint(1000, 9999);
  const s = String(n);
  let pos = rng.randint(0, 3);
  while (s[pos] === "0") pos = rng.randint(0, 3);
  const d = parseInt(s[pos], 10);
  const value = d * 10 ** (3 - pos);
  const place = ["thousands", "hundreds", "tens", "ones"][pos];
  return numberQ(
    `In the number ${n}, what is the digit **${d}** (in the ${place} place) worth?`,
    value,
    `The ${d} sits in the ${place} place, so it stands for ${d} ${place}: **${value}**.`,
    {
      commonWrong:
        pos < 3 ? [[d, "The digit alone is not its value - its position multiplies it by ones, tens, hundreds or thousands.", "l1-number-symbols"]] : [],
    },
  );
});

// --------------------------------------------------------- families of numbers

const POOL = ["7", "1", "0", "-3", "-12", "25", "1/2", "3/4", "-2/5", "0.5", "-1"];

generator("classify-number", "Which families?", "l1-integers", (rng, p) => {
  const s: string = rng.choice(get(p, "pool", POOL));
  const v = Fraction.parse(s);
  if (!v) throw new RangeError(`Invalid literal for Fraction: '${s}'`);
  const isInt = v.denominator === 1n;
  const nat = isInt && v.ge(1);
  const whole = isInt && v.ge(0);
  const integer = isInt;
  const shown = !s.includes("/") ? s.split("-").join("−") : `$${v.lt(0) ? "-" : ""}\\tfrac{${v.abs().numerator}}{${v.denominator}}$`;
  const opts: OptionSpec[] = [
    [
      "Natural numbers $\\mathbb{N}$ (the counting numbers 1, 2, 3, ...)",
      nat,
      "Natural numbers are the counting numbers 1, 2, 3, ... (some books also include 0 - see the lesson on conventions).",
      "l1-natural-numbers",
    ],
    ["Whole numbers (0, 1, 2, 3, ...)", whole, "Whole numbers are 0, 1, 2, 3, ... - no negatives and no parts.", "l1-whole-numbers"],
    [
      "Integers $\\mathbb{Z}$ (..., −2, −1, 0, 1, 2, ...)",
      integer,
      "Integers are the whole numbers together with their negatives - but no fractions in between.",
      "l1-integers",
    ],
    [
      "Fractions (rational numbers $\\mathbb{Q}$)",
      true,
      "Every integer is also a fraction: for example $3 = \\tfrac{3}{1}$ and $-2 = \\tfrac{-2}{1}$.",
      "l1-fractions",
    ],
  ];
  const fams = opts.filter(([, c]) => c).map(([t]) => t.split(" (")[0].split(" $")[0]);
  return {
    type: "choice",
    kind: "apply",
    prompt: `Which families does the number ${shown} belong to? Choose **all** that apply.`,
    ...choice(
      opts.map(([t, c, d, r]): OptionSpec => [t, c, !c ? d : null, !c ? r : null]),
      true,
    ),
    explanation: `${shown} belongs to: ` + fams.join(", ") + ". The families are nested - each one contains the ones inside it.",
  };
});

// ------------------------------------------------------------- fractions

generator("fraction-of-shape", "What fraction is shaded?", "l1-fractions", (rng, p) => {
  const d = rng.randint(2, get(p, "maxDenominator", 12));
  const n = rng.randint(1, d - 1);
  const wrong: [Num, string, string | null][] = [
    [new Fraction(d, n), "That is upside down. The bottom number counts how many equal slices make the whole pizza.", "l1-numerators-denominators"],
  ];
  if (d - n !== n) {
    wrong.push([
      new Fraction(n, d - n),
      "That compares the slices eaten with the slices left over - a ratio - instead of with the whole pizza.",
      "l1-ratios",
    ]);
  }
  return numberQ(
    `A pizza is cut into ${d} equal slices and you eat ${n} of them. What fraction of the pizza did you eat? (Type it like 3/8.)`,
    new Fraction(n, d),
    `The whole is ${d} equal slices and you took ${n} of them: $\\tfrac{${n}}{${d}}$.`,
    {
      commonWrong: wrong,
      visual: {
        widget: "fraction",
        props: { numerator: n, denominator: d, shape: "circle", editable: false },
        caption: `A pizza cut into ${d} equal slices, with ${n} shaded.`,
      },
    },
  );
});

generator("equivalent-fraction", "Equivalent fractions", "l1-numerators-denominators", (rng) => {
  const b = rng.randint(2, 6);
  const a = rng.randint(1, b - 1);
  const k = rng.randint(2, 4);
  return numberQ(
    `Fill in the missing top number: $\\tfrac{${a}}{${b}} = \\tfrac{\\;?\\;}{${b * k}}$`,
    a * k,
    `Cutting every slice into ${k} pieces makes ${b * k} slices in the whole, and the ${a} shaded slices become ${a * k}. ` +
      `So $\\tfrac{${a}}{${b}} = \\tfrac{${a * k}}{${b * k}}$.`,
    {
      commonWrong: [
        [
          a + (b * k - b),
          "Adding the same amount to top and bottom changes the size of the fraction. Cutting each slice into equal pieces multiplies both by the same number.",
          "l1-numerators-denominators",
        ],
      ],
      visual: {
        widget: "fraction",
        props: { numerator: a, denominator: b, shape: "bar", editable: false, compare: [a * k, b * k] },
        caption: `The top bar shows ${a}/${b}; the bottom bar shows the same amount cut into ${b * k} parts.`,
      },
    },
  );
});

generator("compare-fractions", "Which fraction is bigger?", "l1-numerators-denominators", (rng) => {
  let x: Fraction;
  let y: Fraction;
  if (rng.random() < 0.5) {
    // unit fractions - the classic misconception
    const [b, d] = rng.sample(range(2, 11), 2);
    x = new Fraction(1, b);
    y = new Fraction(1, d);
  } else {
    const [b, d] = rng.sample(range(2, 9), 2);
    x = new Fraction(rng.randint(1, b - 1), b);
    y = new Fraction(rng.randint(1, d - 1), d);
  }
  const rel = x.lt(y) ? "<" : x.gt(y) ? ">" : "=";
  const diag =
    "A bigger bottom number means the whole is cut into *more* pieces, so each piece is *smaller*. " +
    "One slice of a pizza cut into 8 is smaller than one slice of a pizza cut into 4.";
  const opts = ["<", ">", "="].map((s): OptionSpec => [`$${s}$`, s === rel, s === rel ? null : diag, s === rel ? null : "l1-numerators-denominators"]);
  return {
    type: "choice",
    kind: "solve",
    prompt: `Which symbol makes this true?  $\\;${fracTex(x)} \\;\\square\\; ${fracTex(y)}$`,
    ...choice(opts),
    explanation: `$${fracTex(x)} ${rel} ${fracTex(y)}$. As decimals: ${pyFormatGeneral(x.toNumber(), 3)} and ${pyFormatGeneral(y.toNumber(), 3)}.`,
    visual: {
      widget: "fraction",
      props: {
        numerator: Number(x.numerator),
        denominator: Number(x.denominator),
        shape: "bar",
        editable: false,
        compare: [Number(y.numerator), Number(y.denominator)],
      },
      caption: "Two bars of the same length, each cut into equal parts.",
    },
  };
});

const NICE_DEN = [2, 4, 5, 10, 20, 25];

generator("fraction-to-decimal", "Fraction to decimal", "l1-decimals", (rng) => {
  const d = rng.choice(NICE_DEN);
  const n = rng.randint(1, d - 1);
  const f = new Fraction(n, d);
  const dec = pyFormatFixed(f.toNumber(), 4).replace(/0+$/, "").replace(/\.+$/, "");
  const scale = Math.floor(100 / d); // every denominator in NICE_DEN divides 100
  return numberQ(
    `Write $\\tfrac{${n}}{${d}}$ as a decimal.`,
    f,
    `Cut each of the ${d} parts into ${scale} smaller pieces: $\\tfrac{${n}}{${d}} = \\tfrac{${n * scale}}{100}$, ` +
      `which is ${n * scale} hundredths, written **${dec}**.`,
    {
      commonWrong: [
        [
          Fraction.from(`${n}.${d}`),
          "Writing the top and bottom numbers either side of a point does not give the same amount. The fraction bar means sharing - find how many hundredths it is.",
          "l1-decimals",
        ],
      ],
    },
  );
});

const DECIMALS = ["0.5", "0.25", "0.75", "0.2", "0.4", "0.6", "0.8", "0.1", "0.3", "0.05", "0.125", "1.5"];

generator("decimal-to-fraction", "Decimal to fraction", "l1-decimals", (rng) => {
  const s = rng.choice(DECIMALS);
  const f = Fraction.from(s);
  const after = s.split(".")[1];
  const places = after.length;
  const top = parseInt(s.replace(".", ""), 10);
  const bottom = 10 ** places;
  const unit = ({ 1: "tenths", 2: "hundredths", 3: "thousandths" } as Record<number, string>)[places];
  const simplified =
    BigInt(top) === f.numerator && BigInt(bottom) === f.denominator
      ? ""
      : `, which is the same amount as $\\tfrac{${f.numerator}}{${f.denominator}}$`;
  return numberQ(`Write ${s} as a fraction. (Any equal fraction is fine, e.g. 2/4 or 1/2.)`, f, `${s} is ${top} ${unit}: $\\tfrac{${top}}{${bottom}}$${simplified}.`, {
    commonWrong:
      places > 1
        ? [
            [
              new Fraction(parseInt(after, 10), 10),
              "Count the decimal places: each place to the right of the point is ten times smaller (tenths, hundredths, thousandths).",
              "l1-decimals",
            ],
          ]
        : [],
  });
});

generator("percent-of", "Percent of a number", "l1-percentages", (rng) => {
  const pct = rng.choice([10, 20, 25, 50, 75, 5, 1]);
  let base = rng.choice([20, 40, 60, 80, 100, 200, 120, 400]);
  let ans = new Fraction(pct * base, 100);
  if (ans.denominator !== 1n) {
    base = 100;
    ans = new Fraction(pct);
  }
  return numberQ(
    `What is ${pct}% of ${base}?`,
    ans,
    `${pct}% means ${pct} out of every 100. ${base} contains ${new Fraction(base, 100)} hundreds, so take ${pct} for each hundred: **${ans}**.`,
    { commonWrong: [[pct, "That is the percentage itself, not the part of the amount.", "l1-percentages"]] },
  );
});

generator("fraction-to-percent", "Fraction to percent", "l1-percentages", (rng) => {
  const d = rng.choice([2, 4, 5, 10, 20, 25, 50]);
  const n = rng.randint(1, d - 1);
  const pct = new Fraction(n, d).mul(100);
  return numberQ(
    `Write $\\tfrac{${n}}{${d}}$ as a percentage. (Type just the number.)`,
    pct,
    `$\\tfrac{${n}}{${d}} = \\tfrac{${pct}}{100}$, and 'out of 100' is what percent means: **${pct}%**.`,
    {
      unit: "%",
      commonWrong: [
        [
          new Fraction(n, d),
          "That is the value as a decimal or fraction of one whole. A percentage counts out of 100, so multiply by 100.",
          "l1-percentages",
        ],
      ],
    },
  );
});

generator("ratio-scale", "Scaling a ratio", "l1-ratios", (rng) => {
  const [a, b] = rng.choice([
    [2, 3],
    [1, 4],
    [3, 5],
    [2, 5],
    [1, 2],
    [3, 4],
  ]);
  const k = rng.randint(2, 5);
  return numberQ(
    `A recipe uses ${a} cups of flour for every ${b} eggs. If you use ${a * k} cups of flour, how many eggs do you need?`,
    b * k,
    `${a * k} cups is ${k} times as much flour as ${a}, so you need ${k} times as many eggs: ${k} groups of ${b} = **${b * k}** eggs.`,
    {
      kind: "apply",
      commonWrong: [
        [
          b + (a * k - a),
          `That adds the same amount to both (${a * k - a} extra). Ratios stay the same by repeating whole groups, so the eggs must grow by the same *times* as the flour.`,
          "l1-ratios",
        ],
      ],
    },
  );
});

// ---------------------------------------------- primes, factors and multiples

generator("is-prime", "Prime or not?", "l1-prime-numbers", (rng, p) => {
  const hi: number = get(p, "max", 60);
  const n = rng.choice(rng.random() < 0.45 ? range(2, hi + 1).filter((x) => isPrime(x)) : range(4, hi + 1).filter((x) => !isPrime(x)));
  const prime = isPrime(n);
  let exp: string;
  let diag: string | null;
  if (prime) {
    exp = `**${n} is prime.** Its only factors are 1 and ${n}: the only rectangle of ${n} tiles is a single row.`;
    diag = null;
  } else {
    const ds = divisors(n);
    const a = ds[1];
    exp = `**${n} is not prime.** ${n} tiles make ${a} equal rows of ${n / a}, so ${n} has factors other than 1 and itself.`;
    diag = n % 2 && n % 5 ? `${n} looks prime, but ${n} = ${a} rows of ${n / a}.` : `${n} can be split into equal rows of ${n / a}.`;
  }
  return {
    type: "truefalse",
    kind: "solve",
    prompt: `True or false: ${n} is a prime number.`,
    answer: prime,
    diagnosis: !prime ? diag : "A prime cannot be split into equal rows (other than one row). Try dividing by 2, 3, 5 and 7 - none of them works here.",
    revisit: "l1-prime-numbers",
    explanation: exp,
    visual: null,
  };
});

generator("even-odd", "Even or odd?", "l1-even-odd", (rng, p) => {
  const lo: number = get(p, "min", 0);
  const hi: number = get(p, "max", 200);
  const n = rng.randint(lo, hi);
  const even = n % 2 === 0;
  const last = String(Math.abs(n)).slice(-1);
  const exp =
    `${n} is **${even ? "even" : "odd"}**: its last digit is ${last}, ` + `and a number is even exactly when its last digit is 0, 2, 4, 6 or 8.`;
  return {
    type: "choice",
    kind: "solve",
    prompt: `Is ${n >= 0 ? numTex(n) : "$" + numTex(n) + "$"} even or odd?`,
    ...choice([
      ["Even", even, even ? null : "Pair the objects up: an odd number always leaves one without a partner.", even ? null : "l1-even-odd"],
      ["Odd", !even, !even ? null : "This number splits exactly into pairs, so it is even.", !even ? null : "l1-even-odd"],
    ]),
    explanation: exp,
  };
});

generator("factor-check", "Which are factors?", "l1-factors", (rng) => {
  const n = rng.choice([12, 18, 20, 24, 30, 36, 16, 28, 40, 42, 45, 48]);
  const ds = divisors(n);
  const picksYes = rng.sample(
    ds.filter((d) => 1 < d && d < n),
    Math.min(3, ds.length - 2),
  );
  const poolNo = range(2, n).filter((x) => n % x);
  const picksNo = rng.sample(poolNo, 3);
  const cands = sortedNums(picksYes.concat(picksNo));
  const opts = cands.map((c): OptionSpec => [
    String(c),
    n % c === 0,
    n % c === 0 ? null : `${n} tiles cannot make equal rows of ${c}: there would be ${n % c} left over.`,
    n % c === 0 ? null : "l1-factors",
  ]);
  return {
    type: "choice",
    kind: "solve",
    prompt: `Which of these numbers are factors of ${n}? Choose all that apply.`,
    ...choice(opts, true),
    explanation: `The factors of ${n} are ${fmtList(ds)}.`,
    visual: { widget: "rectangle-arranger", props: { n, editable: true }, caption: `${n} tiles. Try different numbers of rows to test each candidate.` },
  };
});

generator("count-factors", "How many factors?", "l1-factors", (rng, p) => {
  const n = rng.randint(get(p, "min", 6), get(p, "max", 36));
  const ds = divisors(n);
  return numberQ(
    `How many factors does ${n} have? (Count 1 and ${n} too.)`,
    ds.length,
    `The factors of ${n} are ${fmtList(ds)} - that is **${ds.length}** factors. They come in pairs that make ${n}: ` +
      ds
        .filter((d) => d * d <= n)
        .map((d) => `${d} and ${n / d}`)
        .join(", ") +
      ".",
    {
      commonWrong: [[ds.length - 2, `Remember that 1 and ${n} itself are factors too.`, "l1-factors"]],
      visual: { widget: "rectangle-arranger", props: { n, editable: true }, caption: `${n} tiles. Every perfect rectangle shows a factor pair.` },
    },
  );
});

generator("is-multiple", "Is it a multiple?", "l1-multiples", (rng) => {
  const b = rng.randint(2, 9);
  const a = rng.random() < 0.5 ? b * rng.randint(2, 12) : rng.randint(10, 100);
  const yes = a % b === 0;
  const q = Math.floor(a / b);
  return {
    type: "truefalse",
    kind: "solve",
    prompt: `True or false: ${a} is a multiple of ${b}.`,
    answer: yes,
    diagnosis: yes ? `Counting in jumps of ${b} lands on ${a}: ${a} = ${q} jumps of ${b}.` : `Jumps of ${b} go ..., ${b * q}, ${b * (q + 1)}, ... and skip over ${a}.`,
    revisit: "l1-multiples",
    explanation: yes ? `Yes: ${q} jumps of ${b} land exactly on ${a}.` : `No: jumps of ${b} land on ${b * q} and then ${b * (q + 1)}, missing ${a}.`,
    visual: null,
  };
});

generator("remainder", "What is left over?", "l1-divisibility", (rng) => {
  const b = rng.randint(2, 9);
  const a = rng.randint(b + 1, 60);
  const q = Math.floor(a / b);
  return numberQ(
    `${a} stickers are shared equally among ${b} friends, giving out as many as possible. How many stickers are left over?`,
    a % b,
    `Each friend can get ${q} stickers, using ${b * q}. That leaves **${a % b}**.`,
    {
      commonWrong: [[q, `${q} is how many each friend gets. The question asks how many are left over.`, null]],
      visual: { widget: "sharing", props: { items: a, groups: b, editable: false }, caption: `${a} stickers dealt one at a time to ${b} friends.` },
    },
  );
});

generator("divides", "Does it share exactly?", "l1-divisibility", (rng) => {
  const b = rng.randint(2, 10);
  const a = rng.random() < 0.5 ? b * rng.randint(2, 10) : rng.randint(12, 90);
  const yes = a % b === 0;
  const q = Math.floor(a / b);
  return {
    type: "truefalse",
    kind: "solve",
    prompt: `True or false: ${b} divides ${a} (that is, ${a} shares equally into ${b} groups with nothing left over).`,
    answer: yes,
    diagnosis: `Sharing ${a} into ${b} groups gives ${q} each with ${a % b} left over.`,
    revisit: "l1-divisibility",
    explanation: `${a} into ${b} equal groups gives ${q} each, remainder ${a % b}. ` + (yes ? "So yes." : "So no."),
    visual: null,
  };
});

generator("gcd", "Greatest common divisor", "l1-greatest-common-divisor", (rng, p) => {
  const hi: number = get(p, "max", 48);
  let a: number;
  let b: number;
  for (;;) {
    const g0 = rng.randint(2, 12);
    a = g0 * rng.randint(1, Math.floor(hi / g0));
    b = g0 * rng.randint(1, Math.floor(hi / g0));
    if (a !== b && Math.min(a, b) > 3) break;
  }
  const g = gcd(a, b);
  const common = divisors(a).filter((d) => b % d === 0);
  const wrong: [Num, string, string | null][] = [
    [
      lcm(a, b),
      "That is a common *multiple* (a number both go into). The greatest common divisor is a number that goes into both.",
      "l1-least-common-multiple",
    ],
  ];
  for (const c of common.slice(0, -1)) {
    if (c > 1) wrong.push([c, `${c} does divide both, but it is not the greatest common divisor.`, null]);
  }
  const lo = Math.min(a, b);
  const big = Math.max(a, b);
  if (lo % big && big % lo) wrong.push([lo, `${lo} does not divide ${big} exactly.`, "l1-divisibility"]);
  return numberQ(
    `What is the greatest common divisor of ${a} and ${b}?`,
    g,
    `Factors of ${a}: ${fmtList(divisors(a))}. Factors of ${b}: ${fmtList(divisors(b))}. ` + `Common factors: ${fmtList(common)}. The greatest is **${g}**.`,
    {
      commonWrong: wrong,
      visual: { widget: "common-factors", props: { a, b, editable: false }, caption: `Factors of ${a} and of ${b}; shared factors sit in the overlap.` },
    },
  );
});

generator("lcm", "Least common multiple", "l1-least-common-multiple", (rng, p) => {
  const [a, b] = rng.sample(range(2, get(p, "max", 12) + 1), 2);
  const m = lcm(a, b);
  const wrong: [Num, string, string | null][] = [
    [
      gcd(a, b),
      "That is the greatest common *divisor*. The least common multiple is the first number both jump sequences land on.",
      "l1-greatest-common-divisor",
    ],
  ];
  if (a * b !== m) wrong.push([a * b, `${a * b} is a common multiple, but there is a smaller one.`, "l1-least-common-multiple"]);
  return numberQ(
    `What is the least common multiple of ${a} and ${b}?`,
    m,
    `Multiples of ${a}: ${fmtList(range(1, m / a + 1).map((i) => a * i))}. ` +
      `Multiples of ${b}: ${fmtList(range(1, m / b + 1).map((i) => b * i))}. The first number in both lists is **${m}**.`,
    {
      commonWrong: wrong,
      visual: {
        widget: "multiples-jumps",
        props: { a, b, max: Math.max(m + Math.max(a, b), 30), editable: false },
        caption: `One frog jumps by ${a}, the other by ${b}.`,
      },
    },
  );
});
