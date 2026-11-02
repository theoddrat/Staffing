"""Question generators: endless fresh practice with answers computed by code.

Each generator returns a *materialised question* - the same dictionary shape
the assessment engine stores for authored questions - so generated and
authored questions are graded by the same code. Answers are computed here,
never written by hand, which keeps them correct.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Callable

Q = dict[str, Any]


@dataclass(frozen=True)
class Generator:
    id: str
    title: str
    lesson: str  # where the idea is taught
    fn: Callable[[random.Random, dict[str, Any]], Q]


GENERATORS: dict[str, Generator] = {}

OBJECTS = ["apple", "star", "cookie", "ball", "flower", "fish"]


def generator(gid: str, title: str, lesson: str):
    def deco(fn: Callable[[random.Random, dict[str, Any]], Q]):
        GENERATORS[gid] = Generator(gid, title, lesson, fn)
        return fn

    return deco


def generate(gid: str, rng: random.Random | None = None, params: dict[str, Any] | None = None) -> Q:
    rng = rng or random.Random()
    q = GENERATORS[gid].fn(rng, dict(params or {}))
    q.setdefault("hint", None)
    q.setdefault("visual", None)
    q["generated_from"] = gid
    return q


# --------------------------------------------------------------- helpers


def divisors(n: int) -> list[int]:
    n = abs(n)
    small, large = [], []
    d = 1
    while d * d <= n:
        if n % d == 0:
            small.append(d)
            if d != n // d:
                large.append(n // d)
        d += 1
    return small + large[::-1]


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0:
        return False
    d = 3
    while d * d <= n:
        if n % d == 0:
            return False
        d += 2
    return True


def lcm(a: int, b: int) -> int:
    return abs(a * b) // math.gcd(a, b)


def frac_tex(f: Fraction) -> str:
    if f.denominator == 1:
        return str(f.numerator)
    sign = "-" if f < 0 else ""
    return f"{sign}\\tfrac{{{abs(f.numerator)}}}{{{f.denominator}}}"


def fmt_list(xs: list[int]) -> str:
    return ", ".join(str(x) for x in xs)


def num_tex(n: int) -> str:
    """LaTeX for an integer, using a proper minus sign."""
    return f"-{abs(n)}" if n < 0 else str(n)


def choice(options: list[tuple[str, bool, str | None, str | None]], multi: bool = False) -> dict[str, Any]:
    return {
        "options": [
            {"id": chr(ord("a") + i), "text": t, "correct": c, "diagnosis": d, "revisit": r}
            for i, (t, c, d, r) in enumerate(options)
        ],
        "multi": multi,
    }


def number_q(prompt: str, answer: Fraction | int | str, explanation: str, *, kind: str = "solve",
             common_wrong: list[tuple[Any, str, str | None]] | None = None, unit: str | None = None,
             hint: str | None = None, visual: dict | None = None) -> Q:
    ans = answer if isinstance(answer, str) else str(Fraction(answer))
    seen: set[str] = set()
    cw = []
    for a, d, r in common_wrong or []:
        key = str(Fraction(a)) if not isinstance(a, str) else a
        if key == ans or key in seen:
            continue  # a "wrong" answer that coincides with the right one is not wrong
        seen.add(key)
        cw.append({"answer": key, "diagnosis": d, "revisit": r})
    return {
        "type": "number",
        "kind": kind,
        "prompt": prompt,
        "answer": ans,
        "tolerance": None,
        "unit": unit,
        "common_wrong": cw,
        "explanation": explanation,
        "hint": hint,
        "visual": visual,
    }


# ------------------------------------------------------------ counting


@generator("count-objects", "How many objects?", "l1-counting-objects")
def _count_objects(rng: random.Random, p: dict[str, Any]) -> Q:
    n = rng.randint(p.get("min", 3), p.get("max", 15))
    obj = rng.choice(OBJECTS)
    return number_q(
        f"How many {obj}s are in the tray? Tap each one to count it.",
        n,
        f"Giving each {obj} exactly one counting number, the last number said is **{n}**, so there are {n}.",
        kind="recall",
        common_wrong=[
            (n + 1, "One too many usually means one object was counted twice. Tap each object exactly once.", "l1-counting-meaning"),
            (n - 1, "One too few usually means one object was skipped. Check that every object has a number.", "l1-counting-meaning"),
        ],
        visual={"widget": "counting-objects", "props": {"count": n, "object": obj, "editable": False, "tagging": True},
                "caption": f"A tray of {obj}s. Tapping an object gives it the next counting number."},
    )


@generator("next-number", "What comes next?", "l1-one-two-three")
def _next_number(rng: random.Random, p: dict[str, Any]) -> Q:
    n = rng.randint(p.get("min", 0), p.get("max", 99))
    if n > 0 and rng.random() < 0.4:
        return number_q(
            f"Which counting number comes just **before** {n}?",
            n - 1,
            f"Counting up goes ..., {n - 1}, {n}, ... so the number just before {n} is **{n - 1}**.",
            common_wrong=[(n + 1, f"{n + 1} comes just *after* {n}. 'Before' means one step back.", None)],
        )
    return number_q(
        f"Which counting number comes just **after** {n}?",
        n + 1,
        f"Every counting number has a next one, found by adding one more: after {n} comes **{n + 1}**.",
        common_wrong=[(n - 1, f"{n - 1} comes just *before* {n}. 'After' means one more.", None)],
    )


@generator("skip-count", "Counting in equal jumps", "l1-equal-groups")
def _skip_count(rng: random.Random, p: dict[str, Any]) -> Q:
    k = rng.choice(p.get("steps", [2, 3, 5, 10]))
    m = rng.randint(2, 6)
    seq = [k * i for i in range(1, m + 1)]
    return number_q(
        f"Counting in jumps of {k}: {fmt_list(seq)}, ... What number comes next?",
        k * (m + 1),
        f"Each jump adds {k} more, so after {seq[-1]} comes **{k * (m + 1)}**.",
        kind="predict",
        common_wrong=[(seq[-1] + 1, f"That adds one. In this pattern each step jumps by {k}.", "l0-patterns")],
    )


@generator("rows-total", "Equal rows", "l1-equal-groups")
def _rows_total(rng: random.Random, p: dict[str, Any]) -> Q:
    r = rng.randint(2, p.get("maxRows", 5))
    c = rng.randint(2, p.get("maxCols", 6))
    return number_q(
        f"Chairs are set out in {r} equal rows with {c} chairs in each row. How many chairs are there?",
        r * c,
        f"Count in jumps of {c}, once for each of the {r} rows: "
        + ", ".join(str(c * i) for i in range(1, r + 1))
        + f". There are **{r * c}** chairs.",
        kind="apply",
        common_wrong=[(r + c, "That adds the number of rows to the row length. Each row holds a whole group of chairs, so count group by group.", "l1-equal-groups")],
        visual={"widget": "rectangle-arranger", "props": {"n": r * c, "rows": r, "editable": False},
                "caption": f"{r * c} chairs arranged in {r} equal rows."},
    )


# ----------------------------------------------------------- comparing


@generator("compare-numbers", "Which symbol?", "l1-bigger-smaller")
def _compare(rng: random.Random, p: dict[str, Any]) -> Q:
    lo, hi = p.get("min", 0), p.get("max", 100)
    a = rng.randint(lo, hi)
    b = a if rng.random() < 0.15 else rng.randint(lo, hi)
    neg = a < 0 or b < 0
    rel = "<" if a < b else ">" if a > b else "="
    word = {"<": "is less than", ">": "is greater than", "=": "is equal to"}[rel]
    revisit = "l1-negative-numbers" if neg else "l1-bigger-smaller"
    wrong_diag = (
        "With negative numbers, the number further to the left on the number line is smaller - "
        "for example $-7$ is colder than $-3$."
        if neg
        else "The wide-open side of $<$ or $>$ always faces the bigger number."
    )
    opts = []
    for sym in ["<", ">", "="]:
        opts.append((f"${sym}$", sym == rel, None if sym == rel else wrong_diag, None if sym == rel else revisit))
    return {
        "type": "choice",
        "kind": "solve",
        "prompt": f"Which symbol makes this true?  $\\;{num_tex(a)} \\;\\square\\; {num_tex(b)}$",
        **choice(opts),
        "explanation": f"${num_tex(a)} {rel} {num_tex(b)}$: {num_tex(a)} {word} {num_tex(b)}.",
    }


@generator("order-numbers", "Put in order", "l1-number-lines")
def _order(rng: random.Random, p: dict[str, Any]) -> Q:
    count = p.get("count", 4)
    lo, hi = p.get("min", 0), p.get("max", 50)
    vals = rng.sample(range(lo, hi + 1), count)
    items = [num_tex(v) for v in sorted(vals)]
    return {
        "type": "order",
        "kind": "solve",
        "prompt": "Put these numbers in order from smallest to largest.",
        "items": [f"${x}$" for x in items],
        "order_label": "smallest to largest",
        "explanation": "On the number line they appear left to right as " + ", ".join(f"${x}$" for x in items) + ".",
    }


@generator("number-line-move", "Moving on the number line", "l1-negative-numbers")
def _nl_move(rng: random.Random, p: dict[str, Any]) -> Q:
    start = rng.randint(-5, 5)
    steps = rng.randint(2, 8)
    left = rng.random() < 0.6
    end = start - steps if left else start + steps
    direction = "left" if left else "right"
    return number_q(
        f"Start at ${num_tex(start)}$ on the number line and move {steps} steps to the {direction}. Where do you land?",
        end,
        f"Counting {steps} steps {direction} from ${num_tex(start)}$ lands on **${num_tex(end)}$**.",
        common_wrong=[(-end, "That is the right distance from zero but on the wrong side of zero. Moving left goes toward the negative numbers.", "l1-negative-numbers")],
        visual={"widget": "number-line", "props": {"min": -12, "max": 12, "value": start, "editable": False},
                "caption": f"The point starts at {start}."},
    )


@generator("build-number", "Digits and place value", "l1-number-symbols")
def _build_number(rng: random.Random, p: dict[str, Any]) -> Q:
    h = rng.randint(1, 9)
    t = 0 if rng.random() < 0.5 else rng.randint(1, 9)
    o = rng.randint(0, 9)
    n = 100 * h + 10 * t + o
    wrong = [(int(f"{h}{o}"), "A zero is needed to hold the empty tens place. Without it the hundreds slide into the tens place.", "l1-zero")] if t == 0 else []
    wrong.append((h + t + o, "That adds the digits. Each digit's position says how big a group it counts.", "l1-number-symbols"))
    return number_q(
        f"Which number has **{h}** hundreds, **{t}** tens and **{o}** ones?",
        n,
        f"{h} hundreds, {t} tens and {o} ones is written **{n}**: the position of each digit tells you its size.",
        common_wrong=wrong,
        visual=None,
    )


@generator("digit-value", "What is this digit worth?", "l1-number-symbols")
def _digit_value(rng: random.Random, p: dict[str, Any]) -> Q:
    n = rng.randint(1000, 9999)
    s = str(n)
    pos = rng.randint(0, 3)
    while s[pos] == "0":
        pos = rng.randint(0, 3)
    d = int(s[pos])
    value = d * 10 ** (3 - pos)
    place = ["thousands", "hundreds", "tens", "ones"][pos]
    return number_q(
        f"In the number {n}, what is the digit **{d}** (in the {place} place) worth?",
        value,
        f"The {d} sits in the {place} place, so it stands for {d} {place}: **{value}**.",
        common_wrong=[(d, "The digit alone is not its value - its position multiplies it by ones, tens, hundreds or thousands.", "l1-number-symbols")] if pos < 3 else [],
    )


# --------------------------------------------------------- families of numbers


_POOL = ["7", "1", "0", "-3", "-12", "25", "1/2", "3/4", "-2/5", "0.5", "-1"]


@generator("classify-number", "Which families?", "l1-integers")
def _classify(rng: random.Random, p: dict[str, Any]) -> Q:
    s = rng.choice(p.get("pool", _POOL))
    v = Fraction(s)
    is_int = v.denominator == 1
    nat, whole, integer = is_int and v >= 1, is_int and v >= 0, is_int
    shown = s.replace("-", "−") if "/" not in s else f"${'-' if v < 0 else ''}\\tfrac{{{abs(v.numerator)}}}{{{v.denominator}}}$"
    opts = [
        ("Natural numbers $\\mathbb{N}$ (the counting numbers 1, 2, 3, ...)", nat,
         "Natural numbers are the counting numbers 1, 2, 3, ... (some books also include 0 - see the lesson on conventions).", "l1-natural-numbers"),
        ("Whole numbers (0, 1, 2, 3, ...)", whole,
         "Whole numbers are 0, 1, 2, 3, ... - no negatives and no parts.", "l1-whole-numbers"),
        ("Integers $\\mathbb{Z}$ (..., −2, −1, 0, 1, 2, ...)", integer,
         "Integers are the whole numbers together with their negatives - but no fractions in between.", "l1-integers"),
        ("Fractions (rational numbers $\\mathbb{Q}$)", True,
         "Every integer is also a fraction: for example $3 = \\tfrac{3}{1}$ and $-2 = \\tfrac{-2}{1}$.", "l1-fractions"),
    ]
    fams = [t.split(" (")[0].split(" $")[0] for t, c, _, _ in opts if c]
    return {
        "type": "choice",
        "kind": "apply",
        "prompt": f"Which families does the number {shown} belong to? Choose **all** that apply.",
        **choice([(t, c, d if not c else None, r if not c else None) for t, c, d, r in opts], multi=True),
        "explanation": f"{shown} belongs to: " + ", ".join(fams) + ". The families are nested - each one contains the ones inside it.",
    }


# ------------------------------------------------------------- fractions


@generator("fraction-of-shape", "What fraction is shaded?", "l1-fractions")
def _fraction_of_shape(rng: random.Random, p: dict[str, Any]) -> Q:
    d = rng.randint(2, p.get("maxDenominator", 12))
    n = rng.randint(1, d - 1)
    wrong = [
        (Fraction(d, n), "That is upside down. The bottom number counts how many equal slices make the whole pizza.", "l1-numerators-denominators"),
    ]
    if d - n != n:
        wrong.append((Fraction(n, d - n), "That compares the slices eaten with the slices left over - a ratio - instead of with the whole pizza.", "l1-ratios"))
    return number_q(
        f"A pizza is cut into {d} equal slices and you eat {n} of them. What fraction of the pizza did you eat? (Type it like 3/8.)",
        Fraction(n, d),
        f"The whole is {d} equal slices and you took {n} of them: $\\tfrac{{{n}}}{{{d}}}$.",
        common_wrong=wrong,
        visual={"widget": "fraction", "props": {"numerator": n, "denominator": d, "shape": "circle", "editable": False},
                "caption": f"A pizza cut into {d} equal slices, with {n} shaded."},
    )


@generator("equivalent-fraction", "Equivalent fractions", "l1-numerators-denominators")
def _equiv(rng: random.Random, p: dict[str, Any]) -> Q:
    b = rng.randint(2, 6)
    a = rng.randint(1, b - 1)
    k = rng.randint(2, 4)
    return number_q(
        f"Fill in the missing top number: $\\tfrac{{{a}}}{{{b}}} = \\tfrac{{\\;?\\;}}{{{b * k}}}$",
        a * k,
        f"Cutting every slice into {k} pieces makes {b * k} slices in the whole, and the {a} shaded slices become {a * k}. "
        f"So $\\tfrac{{{a}}}{{{b}}} = \\tfrac{{{a * k}}}{{{b * k}}}$.",
        common_wrong=[(a + (b * k - b), "Adding the same amount to top and bottom changes the size of the fraction. Cutting each slice into equal pieces multiplies both by the same number.", "l1-numerators-denominators")],
        visual={"widget": "fraction", "props": {"numerator": a, "denominator": b, "shape": "bar", "editable": False, "compare": [a * k, b * k]},
                "caption": f"The top bar shows {a}/{b}; the bottom bar shows the same amount cut into {b * k} parts."},
    )


@generator("compare-fractions", "Which fraction is bigger?", "l1-numerators-denominators")
def _cmp_frac(rng: random.Random, p: dict[str, Any]) -> Q:
    if rng.random() < 0.5:  # unit fractions - the classic misconception
        b, d = rng.sample(range(2, 11), 2)
        x, y = Fraction(1, b), Fraction(1, d)
    else:
        b, d = rng.sample(range(2, 9), 2)
        x, y = Fraction(rng.randint(1, b - 1), b), Fraction(rng.randint(1, d - 1), d)
    rel = "<" if x < y else ">" if x > y else "="
    diag = ("A bigger bottom number means the whole is cut into *more* pieces, so each piece is *smaller*. "
            "One slice of a pizza cut into 8 is smaller than one slice of a pizza cut into 4.")
    opts = [(f"${s}$", s == rel, None if s == rel else diag, None if s == rel else "l1-numerators-denominators") for s in ["<", ">", "="]]
    return {
        "type": "choice",
        "kind": "solve",
        "prompt": f"Which symbol makes this true?  $\\;{frac_tex(x)} \\;\\square\\; {frac_tex(y)}$",
        **choice(opts),
        "explanation": f"${frac_tex(x)} {rel} {frac_tex(y)}$. As decimals: {float(x):.3g} and {float(y):.3g}.",
        "visual": {"widget": "fraction", "props": {"numerator": x.numerator, "denominator": x.denominator, "shape": "bar", "editable": False,
                                                   "compare": [y.numerator, y.denominator]},
                   "caption": "Two bars of the same length, each cut into equal parts."},
    }


_NICE_DEN = [2, 4, 5, 10, 20, 25]


@generator("fraction-to-decimal", "Fraction to decimal", "l1-decimals")
def _f2d(rng: random.Random, p: dict[str, Any]) -> Q:
    d = rng.choice(_NICE_DEN)
    n = rng.randint(1, d - 1)
    f = Fraction(n, d)
    dec = f"{float(f):.4f}".rstrip("0").rstrip(".")
    scale = 100 // d  # every denominator in _NICE_DEN divides 100
    return number_q(
        f"Write $\\tfrac{{{n}}}{{{d}}}$ as a decimal.",
        f,
        f"Cut each of the {d} parts into {scale} smaller pieces: $\\tfrac{{{n}}}{{{d}}} = \\tfrac{{{n * scale}}}{{100}}$, "
        f"which is {n * scale} hundredths, written **{dec}**.",
        common_wrong=[(Fraction(f"{n}.{d}"), "Writing the top and bottom numbers either side of a point does not give the same amount. The fraction bar means sharing - find how many hundredths it is.", "l1-decimals")],
    )


_DECIMALS = ["0.5", "0.25", "0.75", "0.2", "0.4", "0.6", "0.8", "0.1", "0.3", "0.05", "0.125", "1.5"]


@generator("decimal-to-fraction", "Decimal to fraction", "l1-decimals")
def _d2f(rng: random.Random, p: dict[str, Any]) -> Q:
    s = rng.choice(_DECIMALS)
    f = Fraction(s)
    places = len(s.split(".")[1])
    top, bottom = int(s.replace(".", "")), 10**places
    unit = {1: "tenths", 2: "hundredths", 3: "thousandths"}[places]
    simplified = "" if (top, bottom) == (f.numerator, f.denominator) else \
        f", which is the same amount as $\\tfrac{{{f.numerator}}}{{{f.denominator}}}$"
    return number_q(
        f"Write {s} as a fraction. (Any equal fraction is fine, e.g. 2/4 or 1/2.)",
        f,
        f"{s} is {top} {unit}: $\\tfrac{{{top}}}{{{bottom}}}${simplified}.",
        common_wrong=[(Fraction(int(s.split(".")[1]), 10), "Count the decimal places: each place to the right of the point is ten times smaller (tenths, hundredths, thousandths).", "l1-decimals")]
        if places > 1 else [],
    )


@generator("percent-of", "Percent of a number", "l1-percentages")
def _percent_of(rng: random.Random, p: dict[str, Any]) -> Q:
    pct = rng.choice([10, 20, 25, 50, 75, 5, 1])
    base = rng.choice([20, 40, 60, 80, 100, 200, 120, 400])
    ans = Fraction(pct * base, 100)
    if ans.denominator != 1:
        base = 100
        ans = Fraction(pct)
    return number_q(
        f"What is {pct}% of {base}?",
        ans,
        f"{pct}% means {pct} out of every 100. {base} contains {Fraction(base, 100)} hundreds, so take {pct} for each hundred: **{ans}**.",
        common_wrong=[(pct, "That is the percentage itself, not the part of the amount.", "l1-percentages")],
    )


@generator("fraction-to-percent", "Fraction to percent", "l1-percentages")
def _f2p(rng: random.Random, p: dict[str, Any]) -> Q:
    d = rng.choice([2, 4, 5, 10, 20, 25, 50])
    n = rng.randint(1, d - 1)
    pct = Fraction(n, d) * 100
    return number_q(
        f"Write $\\tfrac{{{n}}}{{{d}}}$ as a percentage. (Type just the number.)",
        pct,
        f"$\\tfrac{{{n}}}{{{d}}} = \\tfrac{{{pct}}}{{100}}$, and 'out of 100' is what percent means: **{pct}%**.",
        unit="%",
        common_wrong=[(Fraction(n, d), "That is the value as a decimal or fraction of one whole. A percentage counts out of 100, so multiply by 100.", "l1-percentages")],
    )


@generator("ratio-scale", "Scaling a ratio", "l1-ratios")
def _ratio_scale(rng: random.Random, p: dict[str, Any]) -> Q:
    a, b = rng.choice([(2, 3), (1, 4), (3, 5), (2, 5), (1, 2), (3, 4)])
    k = rng.randint(2, 5)
    return number_q(
        f"A recipe uses {a} cups of flour for every {b} eggs. If you use {a * k} cups of flour, how many eggs do you need?",
        b * k,
        f"{a * k} cups is {k} times as much flour as {a}, so you need {k} times as many eggs: {k} groups of {b} = **{b * k}** eggs.",
        kind="apply",
        common_wrong=[(b + (a * k - a), f"That adds the same amount to both ({a * k - a} extra). Ratios stay the same by repeating whole groups, so the eggs must grow by the same *times* as the flour.", "l1-ratios")],
    )


# ---------------------------------------------- primes, factors and multiples


@generator("is-prime", "Prime or not?", "l1-prime-numbers")
def _is_prime(rng: random.Random, p: dict[str, Any]) -> Q:
    hi = p.get("max", 60)
    n = rng.choice([x for x in range(2, hi + 1) if is_prime(x)] if rng.random() < 0.45 else
                   [x for x in range(4, hi + 1) if not is_prime(x)])
    prime = is_prime(n)
    if prime:
        exp = f"**{n} is prime.** Its only factors are 1 and {n}: the only rectangle of {n} tiles is a single row."
        diag = None
    else:
        ds = divisors(n)
        a = ds[1]
        exp = f"**{n} is not prime.** {n} tiles make {a} equal rows of {n // a}, so {n} has factors other than 1 and itself."
        diag = (f"{n} looks prime, but {n} = {a} rows of {n // a}." if n % 2 and n % 5 else
                f"{n} can be split into equal rows of {n // a}.")
    return {
        "type": "truefalse",
        "kind": "solve",
        "prompt": f"True or false: {n} is a prime number.",
        "answer": prime,
        "diagnosis": diag if not prime else "A prime cannot be split into equal rows (other than one row). Try dividing by 2, 3, 5 and 7 - none of them works here.",
        "revisit": "l1-prime-numbers",
        "explanation": exp,
        "visual": None,
    }


@generator("even-odd", "Even or odd?", "l1-even-odd")
def _even_odd(rng: random.Random, p: dict[str, Any]) -> Q:
    lo, hi = p.get("min", 0), p.get("max", 200)
    n = rng.randint(lo, hi)
    even = n % 2 == 0
    last = str(abs(n))[-1]
    exp = (f"{n} is **{'even' if even else 'odd'}**: its last digit is {last}, "
           f"and a number is even exactly when its last digit is 0, 2, 4, 6 or 8.")
    return {
        "type": "choice",
        "kind": "solve",
        "prompt": f"Is {num_tex(n) if n >= 0 else '$' + num_tex(n) + '$'} even or odd?",
        **choice([
            ("Even", even, None if even else "Pair the objects up: an odd number always leaves one without a partner.", None if even else "l1-even-odd"),
            ("Odd", not even, None if not even else "This number splits exactly into pairs, so it is even.", None if not even else "l1-even-odd"),
        ]),
        "explanation": exp,
    }


@generator("factor-check", "Which are factors?", "l1-factors")
def _factor_check(rng: random.Random, p: dict[str, Any]) -> Q:
    n = rng.choice([12, 18, 20, 24, 30, 36, 16, 28, 40, 42, 45, 48])
    ds = divisors(n)
    picks_yes = rng.sample([d for d in ds if 1 < d < n], k=min(3, len(ds) - 2))
    pool_no = [x for x in range(2, n) if n % x]
    picks_no = rng.sample(pool_no, k=3)
    cands = sorted(picks_yes + picks_no)
    opts = [(str(c), n % c == 0,
             None if n % c == 0 else f"{n} tiles cannot make equal rows of {c}: there would be {n % c} left over.",
             None if n % c == 0 else "l1-factors") for c in cands]
    return {
        "type": "choice",
        "kind": "solve",
        "prompt": f"Which of these numbers are factors of {n}? Choose all that apply.",
        **choice(opts, multi=True),
        "explanation": f"The factors of {n} are {fmt_list(ds)}.",
        "visual": {"widget": "rectangle-arranger", "props": {"n": n, "editable": True},
                   "caption": f"{n} tiles. Try different numbers of rows to test each candidate."},
    }


@generator("count-factors", "How many factors?", "l1-factors")
def _count_factors(rng: random.Random, p: dict[str, Any]) -> Q:
    n = rng.randint(p.get("min", 6), p.get("max", 36))
    ds = divisors(n)
    return number_q(
        f"How many factors does {n} have? (Count 1 and {n} too.)",
        len(ds),
        f"The factors of {n} are {fmt_list(ds)} - that is **{len(ds)}** factors. They come in pairs that make {n}: "
        + ", ".join(f"{d} and {n // d}" for d in ds if d * d <= n) + ".",
        common_wrong=[(len(ds) - 2, f"Remember that 1 and {n} itself are factors too.", "l1-factors")],
        visual={"widget": "rectangle-arranger", "props": {"n": n, "editable": True},
                "caption": f"{n} tiles. Every perfect rectangle shows a factor pair."},
    )


@generator("is-multiple", "Is it a multiple?", "l1-multiples")
def _is_multiple(rng: random.Random, p: dict[str, Any]) -> Q:
    b = rng.randint(2, 9)
    a = b * rng.randint(2, 12) if rng.random() < 0.5 else rng.randint(10, 100)
    yes = a % b == 0
    return {
        "type": "truefalse",
        "kind": "solve",
        "prompt": f"True or false: {a} is a multiple of {b}.",
        "answer": yes,
        "diagnosis": (f"Counting in jumps of {b} lands on {a}: {a} = {a // b} jumps of {b}." if yes else
                      f"Jumps of {b} go ..., {b * (a // b)}, {b * (a // b + 1)}, ... and skip over {a}."),
        "revisit": "l1-multiples",
        "explanation": (f"Yes: {a // b} jumps of {b} land exactly on {a}." if yes else
                        f"No: jumps of {b} land on {b * (a // b)} and then {b * (a // b + 1)}, missing {a}."),
        "visual": None,
    }


@generator("remainder", "What is left over?", "l1-divisibility")
def _remainder(rng: random.Random, p: dict[str, Any]) -> Q:
    b = rng.randint(2, 9)
    a = rng.randint(b + 1, 60)
    return number_q(
        f"{a} stickers are shared equally among {b} friends, giving out as many as possible. How many stickers are left over?",
        a % b,
        f"Each friend can get {a // b} stickers, using {b * (a // b)}. That leaves **{a % b}**.",
        common_wrong=[(a // b, f"{a // b} is how many each friend gets. The question asks how many are left over.", None)],
        visual={"widget": "sharing", "props": {"items": a, "groups": b, "editable": False},
                "caption": f"{a} stickers dealt one at a time to {b} friends."},
    )


@generator("divides", "Does it share exactly?", "l1-divisibility")
def _divides(rng: random.Random, p: dict[str, Any]) -> Q:
    b = rng.randint(2, 10)
    a = b * rng.randint(2, 10) if rng.random() < 0.5 else rng.randint(12, 90)
    yes = a % b == 0
    return {
        "type": "truefalse",
        "kind": "solve",
        "prompt": f"True or false: {b} divides {a} (that is, {a} shares equally into {b} groups with nothing left over).",
        "answer": yes,
        "diagnosis": f"Sharing {a} into {b} groups gives {a // b} each with {a % b} left over.",
        "revisit": "l1-divisibility",
        "explanation": f"{a} into {b} equal groups gives {a // b} each, remainder {a % b}. " + ("So yes." if yes else "So no."),
        "visual": None,
    }


@generator("gcd", "Greatest common divisor", "l1-greatest-common-divisor")
def _gcd(rng: random.Random, p: dict[str, Any]) -> Q:
    hi = p.get("max", 48)
    while True:
        g = rng.randint(2, 12)
        a, b = g * rng.randint(1, hi // g), g * rng.randint(1, hi // g)
        if a != b and min(a, b) > 3:
            break
    g = math.gcd(a, b)
    common = [d for d in divisors(a) if b % d == 0]
    wrong = [(lcm(a, b), "That is a common *multiple* (a number both go into). The greatest common divisor is a number that goes into both.", "l1-least-common-multiple")]
    for c in common[:-1]:
        if c > 1:
            wrong.append((c, f"{c} does divide both, but it is not the greatest common divisor.", None))
    if min(a, b) % max(a, b) and max(a, b) % min(a, b):
        wrong.append((min(a, b), f"{min(a, b)} does not divide {max(a, b)} exactly.", "l1-divisibility"))
    return number_q(
        f"What is the greatest common divisor of {a} and {b}?",
        g,
        f"Factors of {a}: {fmt_list(divisors(a))}. Factors of {b}: {fmt_list(divisors(b))}. "
        f"Common factors: {fmt_list(common)}. The greatest is **{g}**.",
        common_wrong=wrong,
        visual={"widget": "common-factors", "props": {"a": a, "b": b, "editable": False},
                "caption": f"Factors of {a} and of {b}; shared factors sit in the overlap."},
    )


@generator("lcm", "Least common multiple", "l1-least-common-multiple")
def _lcm(rng: random.Random, p: dict[str, Any]) -> Q:
    a, b = rng.sample(range(2, p.get("max", 12) + 1), 2)
    m = lcm(a, b)
    wrong = [(math.gcd(a, b), "That is the greatest common *divisor*. The least common multiple is the first number both jump sequences land on.", "l1-greatest-common-divisor")]
    if a * b != m:
        wrong.append((a * b, f"{a * b} is a common multiple, but there is a smaller one.", "l1-least-common-multiple"))
    return number_q(
        f"What is the least common multiple of {a} and {b}?",
        m,
        f"Multiples of {a}: {fmt_list([a * i for i in range(1, m // a + 1)])}. "
        f"Multiples of {b}: {fmt_list([b * i for i in range(1, m // b + 1)])}. The first number in both lists is **{m}**.",
        common_wrong=wrong,
        visual={"widget": "multiples-jumps", "props": {"a": a, "b": b, "max": max(m + max(a, b), 30), "editable": False},
                "caption": f"One frog jumps by {a}, the other by {b}."},
    )
