"""Materialise assessment questions and grade answers.

All numeric answers are compared exactly using rational arithmetic
(``fractions.Fraction``), so ``2/4`` is accepted for ``1/2`` and ``0.5``
for ``1/2``, but ``0.33`` is not accepted for ``1/3``.
"""

from __future__ import annotations

import random
import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from ..content.schema import (
    Assessment,
    ChoiceQuestion,
    ExplainQuestion,
    GeneratedQuestion,
    NumberQuestion,
    OrderQuestion,
    TextQuestion,
    TrueFalseQuestion,
)
from .practice import generate

Q = dict[str, Any]

# Fields hidden from the learner until the question is answered.
PRIVATE_FIELDS = {"answer", "accept", "common_wrong", "items", "rubric", "model_answer", "explanation", "diagnosis", "revisit"}


def materialise(assessment: Assessment, rng: random.Random) -> list[Q]:
    """Turn an authored assessment into concrete questions for one attempt."""
    out: list[Q] = []
    for q in assessment.questions:
        if isinstance(q, GeneratedQuestion):
            m = generate(q.generator, rng, q.params)
            m["id"] = q.id
        else:
            m = q.model_dump(mode="json")
            if isinstance(q, ChoiceQuestion):
                m["options"] = [
                    {"id": chr(ord("a") + i), **o} for i, o in enumerate(m["options"])
                ]
        _prepare(m, rng)
        out.append(m)
    return out


def _prepare(q: Q, rng: random.Random) -> None:
    if q["type"] == "choice":
        # Keep a stable order for symbol questions (<, >, =); shuffle others.
        texts = [o["text"] for o in q["options"]]
        if not all(t.strip("$") in {"<", ">", "="} for t in texts) and not _is_ordered_list(texts):
            rng.shuffle(q["options"])
    if q["type"] == "order":
        shuffled = list(q["items"])
        for _ in range(10):
            rng.shuffle(shuffled)
            if shuffled != q["items"]:
                break
        q["shuffled"] = shuffled
    q["max_tries"] = max_tries(q)


def _is_ordered_list(texts: list[str]) -> bool:
    lowered = [t.lower() for t in texts]
    return lowered in (["true", "false"], ["even", "odd"], ["yes", "no"])


def max_tries(q: Q) -> int:
    if q["type"] == "truefalse" or q["type"] == "explain":
        return 1
    if q["type"] == "choice" and len(q["options"]) <= 2:
        return 1
    return 2


def public_view(q: Q) -> Q:
    """What the learner may see before answering."""
    pub = {k: v for k, v in q.items() if k not in PRIVATE_FIELDS}
    if q["type"] == "choice":
        pub["options"] = [{"id": o["id"], "text": o["text"]} for o in q["options"]]
    if q["type"] == "order":
        pub["items"] = q["shuffled"]
    pub.pop("shuffled", None)
    if q["type"] == "explain":
        pub["rubric_count"] = len(q["rubric"])
    return pub


def reveal(q: Q) -> Q:
    """What the learner sees after the question is finished."""
    r: Q = {"explanation": q.get("explanation")}
    t = q["type"]
    if t == "choice":
        r["correct_options"] = [o["id"] for o in q["options"] if o["correct"]]
    elif t == "number":
        r["answer"] = q["answer"]
    elif t == "text":
        r["answer"] = q["accept"][0]
    elif t == "truefalse":
        r["answer"] = q["answer"]
    elif t == "order":
        r["answer"] = q["items"]
    elif t == "explain":
        r["rubric"] = q["rubric"]
        r["model_answer"] = q["model_answer"]
    return r


# ------------------------------------------------------------------ parsing

_MIXED = re.compile(r"^([+-]?\d+)\s+(\d+)\s*/\s*(\d+)$")


def parse_number(raw: str) -> Fraction | None:
    """Parse '7', '-3', '−3', '3/4', '0.75', '.5', '1 1/2', '1,000', '75%'."""
    if raw is None:
        return None
    s = unicodedata.normalize("NFKC", str(raw)).strip()
    s = s.replace("−", "-").replace("–", "-").replace(",", "").replace("%", "").strip()
    s = s.replace("÷", "/")
    if not s:
        return None
    m = _MIXED.match(s)
    try:
        if m:
            whole, num, den = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if den == 0:
                return None
            frac = Fraction(num, den)
            return Fraction(whole) - frac if whole < 0 or s.startswith("-") else Fraction(whole) + frac
        s = re.sub(r"\s*/\s*", "/", s)
        if "/" in s:
            a, b = s.split("/", 1)
            if Fraction(b) == 0:
                return None
            return Fraction(a) / Fraction(b)
        return Fraction(s)
    except (ValueError, ZeroDivisionError):
        return None


def normalise_text(s: str, mode: str = "words") -> str:
    s = unicodedata.normalize("NFKC", s).lower().strip()
    if mode == "math":
        s = s.replace("−", "-").replace("×", "*").replace("x", "*").replace("÷", "/")
        return re.sub(r"\s+", "", s)
    s = re.sub(r"[^\w\s/.-]", "", s)
    return re.sub(r"\s+", " ", s)


# ------------------------------------------------------------------ grading


@dataclass
class Grade:
    correct: bool
    valid: bool = True  # False when the answer could not be understood (not counted as a try)
    diagnosis: str | None = None
    revisit: str | None = None
    message: str | None = None
    score: float | None = None  # for explain questions: fraction of rubric met


def grade(q: Q, answer: dict[str, Any]) -> Grade:
    t = q["type"]
    if t == "choice":
        return _grade_choice(q, answer)
    if t == "number":
        return _grade_number(q, answer)
    if t == "text":
        return _grade_text(q, answer)
    if t == "truefalse":
        val = answer.get("value")
        if not isinstance(val, bool):
            return Grade(False, valid=False, message="Choose true or false.")
        ok = val == q["answer"]
        return Grade(ok, diagnosis=None if ok else q.get("diagnosis"), revisit=None if ok else q.get("revisit"))
    if t == "order":
        order = answer.get("order")
        if not isinstance(order, list) or sorted(order) != sorted(q["items"]):
            return Grade(False, valid=False, message="Arrange all of the items.")
        ok = order == q["items"]
        return Grade(ok, diagnosis=None if ok else f"Check each neighbouring pair: the list should go {q.get('order_label', 'in order')}.")
    if t == "explain":
        return grade_explain_self(q, answer)
    raise ValueError(f"unknown question type {t}")


def _grade_choice(q: Q, answer: dict[str, Any]) -> Grade:
    selected = answer.get("selected")
    if isinstance(selected, str):
        selected = [selected]
    if not isinstance(selected, list) or not selected:
        return Grade(False, valid=False, message="Choose an answer.")
    by_id = {o["id"]: o for o in q["options"]}
    if any(s not in by_id for s in selected):
        return Grade(False, valid=False, message="Unknown option.")
    correct_ids = {o["id"] for o in q["options"] if o["correct"]}
    chosen = set(selected)
    if chosen == correct_ids:
        return Grade(True)
    wrong_picks = [by_id[s] for s in selected if s not in correct_ids]
    if wrong_picks:
        w = wrong_picks[0]
        return Grade(False, diagnosis=w.get("diagnosis"), revisit=w.get("revisit"))
    missed = [by_id[i] for i in correct_ids - chosen]
    return Grade(False, diagnosis="Everything you chose is right, but something is missing. Look again: " +
                 "more than one answer is correct." if q.get("multi") else None,
                 revisit=missed[0].get("revisit") if missed else None)


def _grade_number(q: Q, answer: dict[str, Any]) -> Grade:
    val = parse_number(answer.get("value", ""))
    if val is None:
        return Grade(False, valid=False, message="Type a number such as 7, -3, 3/4 or 0.25.")
    target = Fraction(q["answer"])
    tol = q.get("tolerance")
    ok = abs(val - target) <= Fraction(str(tol)) if tol else val == target
    if ok:
        return Grade(True)
    for w in q.get("common_wrong", []):
        wv = parse_number(w["answer"])
        if wv is not None and wv == val:
            return Grade(False, diagnosis=w["diagnosis"], revisit=w.get("revisit"))
    return Grade(False)


def _grade_text(q: Q, answer: dict[str, Any]) -> Grade:
    raw = answer.get("value", "")
    if not isinstance(raw, str) or not raw.strip():
        return Grade(False, valid=False, message="Type an answer.")
    mode = q.get("mode", "words")
    val = normalise_text(raw, mode)
    if any(val == normalise_text(a, mode) for a in q["accept"]):
        return Grade(True)
    for w in q.get("common_wrong", []):
        if val == normalise_text(w["answer"], mode):
            return Grade(False, diagnosis=w["diagnosis"], revisit=w.get("revisit"))
    return Grade(False)


def grade_explain_self(q: Q, answer: dict[str, Any]) -> Grade:
    """Self-assessment against the rubric (used when no AI grader is configured)."""
    text = answer.get("text", "")
    if not isinstance(text, str) or len(text.strip()) < 3:
        return Grade(False, valid=False, message="Write your explanation in your own words first.")
    claimed = answer.get("self_check")
    if not isinstance(claimed, list):
        return Grade(False, valid=False, message="Tick the key ideas your explanation included.")
    n = len(q["rubric"])
    met = len({int(i) for i in claimed if isinstance(i, int) and 0 <= i < n})
    score = met / n
    return Grade(score >= 0.6, score=score)


def credit_for(try_number: int, correct: bool) -> float:
    if not correct:
        return 0.0
    return 1.0 if try_number == 1 else 0.5
