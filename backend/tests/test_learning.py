"""Grading, practice generators, mastery and recommendations."""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from fractions import Fraction

import pytest

from app.learning import mastery
from app.learning.grading import _prepare, credit_for, grade, normalise_text, parse_number
from app.learning.practice import GENERATORS, divisors, generate, is_prime, lcm
from app.learning.recommend import next_lessons, path_progress, readiness


@pytest.mark.parametrize(
    "raw,expected",
    [("7", 7), ("-3", -3), ("−3", -3), ("3/4", Fraction(3, 4)), ("0.75", Fraction(3, 4)), (".5", Fraction(1, 2)),
     ("1 1/2", Fraction(3, 2)), ("-1 1/2", Fraction(-3, 2)), ("1,000", 1000), ("75%", 75), (" 3 / 4 ", Fraction(3, 4)),
     ("2/4", Fraction(1, 2))],
)
def test_parse_number(raw, expected):
    assert parse_number(raw) == expected


@pytest.mark.parametrize("raw", ["", "abc", "1/0", "3//4", None])
def test_parse_number_rejects(raw):
    assert parse_number(raw) is None


def test_number_grading_accepts_equivalent_fractions_and_diagnoses_common_errors():
    q = {"type": "number", "answer": "1/2", "common_wrong": [{"answer": "2", "diagnosis": "upside down", "revisit": "l1-fractions"}]}
    assert grade(q, {"value": "2/4"}).correct
    assert grade(q, {"value": "0.5"}).correct
    assert not grade(q, {"value": "0.33"}).correct
    g = grade(q, {"value": "2"})
    assert not g.correct and g.diagnosis == "upside down" and g.revisit == "l1-fractions"
    assert not grade(q, {"value": "hello"}).valid


def test_choice_grading_multi():
    q = {"type": "choice", "multi": True, "options": [
        {"id": "a", "text": "1", "correct": True}, {"id": "b", "text": "2", "correct": True},
        {"id": "c", "text": "3", "correct": False, "diagnosis": "no", "revisit": None}]}
    assert grade(q, {"selected": ["a", "b"]}).correct
    assert not grade(q, {"selected": ["a"]}).correct
    g = grade(q, {"selected": ["a", "c"]})
    assert not g.correct and g.diagnosis == "no"
    assert not grade(q, {"selected": []}).valid
    assert not grade(q, {"selected": ["zzz"]}).valid


def test_text_math_mode_ignores_spaces():
    q = {"type": "text", "mode": "math", "accept": ["6+3=9"], "common_wrong": []}
    assert grade(q, {"value": "6 + 3 = 9"}).correct
    assert normalise_text("3 : 2", "math") == "3:2"


def test_order_and_truefalse():
    q = {"type": "order", "items": ["1", "2", "3"]}
    assert grade(q, {"order": ["1", "2", "3"]}).correct
    assert not grade(q, {"order": ["2", "1", "3"]}).correct
    assert not grade(q, {"order": ["1", "2"]}).valid
    tf = {"type": "truefalse", "answer": False, "diagnosis": "d"}
    assert grade(tf, {"value": False}).correct
    assert grade(tf, {"value": True}).diagnosis == "d"


def test_explain_self_assessment():
    q = {"type": "explain", "rubric": ["a", "b", "c"]}
    assert grade(q, {"text": "my answer", "self_check": [0, 1]}).correct
    assert not grade(q, {"text": "my answer", "self_check": [0]}).correct
    assert not grade(q, {"text": "", "self_check": [0]}).valid


def test_credit():
    assert credit_for(1, True) == 1.0 and credit_for(2, True) == 0.5 and credit_for(1, False) == 0.0


def test_number_theory_helpers_agree_with_brute_force():
    for n in range(1, 300):
        assert divisors(n) == [d for d in range(1, n + 1) if n % d == 0]
        assert is_prime(n) == (n > 1 and all(n % d for d in range(2, n)))
    assert lcm(4, 6) == 12 and lcm(7, 5) == 35


@pytest.mark.parametrize("gid", sorted(GENERATORS))
def test_every_generator_produces_gradeable_questions(gid):
    rng = random.Random(42)
    for _ in range(200):
        q = generate(gid, rng, {})
        q["id"] = "x"
        _prepare(q, rng)
        if q["type"] == "number":
            assert grade(q, {"value": q["answer"]}).correct
            for w in q["common_wrong"]:
                assert not grade(q, {"value": w["answer"]}).correct
        elif q["type"] == "choice":
            ids = [o["id"] for o in q["options"] if o["correct"]]
            assert ids and grade(q, {"selected": ids}).correct
        elif q["type"] == "truefalse":
            assert grade(q, {"value": q["answer"]}).correct
        elif q["type"] == "order":
            assert grade(q, {"order": q["items"]}).correct
        assert q["explanation"]


def test_generated_answers_are_mathematically_right():
    rng = random.Random(3)
    import math

    for _ in range(100):
        q = generate("gcd", rng, {})
        a, b = map(int, q["prompt"].rstrip("?").split("of ")[1].split(" and "))
        assert Fraction(q["answer"]) == math.gcd(a, b)
        q = generate("lcm", rng, {})
        a, b = map(int, q["prompt"].rstrip("?").split("of ")[1].split(" and "))
        assert Fraction(q["answer"]) == a * b // math.gcd(a, b)


# ------------------------------------------------------------------ mastery

NOW = datetime(2026, 11, 2, 12, tzinfo=timezone.utc)


def test_mastery_transitions():
    s = mastery.StateView()
    assert mastery.on_open(s) == "introduced"
    assert mastery.on_assessment(s, 0.5, 0.7, NOW)[0] == "introduced"
    assert mastery.on_assessment(s, 0.8, 0.7, NOW)[0] == "understood"
    u = mastery.StateView("understood", 1, NOW)
    # a second pass the same day is not mastery
    assert mastery.on_assessment(u, 1.0, 0.7, NOW + timedelta(hours=2))[0] == "understood"
    # a high score on a later day is
    assert mastery.on_assessment(u, 0.95, 0.7, NOW + timedelta(days=1))[0] == "mastered"
    # failing something you understood flags it for revision
    state, reason = mastery.on_assessment(u, 0.3, 0.7, NOW)
    assert state == "needs_revision" and "30%" in reason
    # passing again restores understanding
    r = mastery.StateView("needs_revision", 1, NOW - timedelta(days=3))
    assert mastery.on_assessment(r, 0.95, 0.7, NOW)[0] == "mastered"
    assert mastery.on_diagnosed_gap(u, "why")[0] == "needs_revision"
    assert mastery.on_diagnosed_gap(mastery.StateView("introduced"), "why")[0] == "introduced"


def test_review_schedule():
    u = mastery.StateView("understood", 1, NOW)
    assert not mastery.review_due(u, NOW + timedelta(hours=12))
    assert mastery.review_due(u, NOW + timedelta(days=2))
    assert not mastery.review_due(mastery.StateView("introduced"), NOW + timedelta(days=100))


# ------------------------------------------------------------------ recommendations


def test_first_recommendation_is_what_is_mathematics(bundle):
    assert next_lessons(bundle, {}, limit=1) == ["l0-what-is-mathematics"]


def test_recommendations_follow_prerequisites(bundle):
    states = {"l0-what-is-mathematics": "understood"}
    assert next_lessons(bundle, states, limit=1) == ["l0-why-mathematics"]


def test_readiness_stops_at_known_concepts(bundle):
    r = readiness(bundle, "l1-fractions", {})
    assert not r.ready
    assert r.missing[0] == "l0-what-is-mathematics"
    known = {lid: "understood" for lid in bundle.ancestors("l1-fractions")}
    assert readiness(bundle, "l1-fractions", known).ready
    # if a direct prerequisite is known, we never send the learner further back through it
    states = {"l1-equal-quantities": "mastered", "l1-number-lines": "understood"}
    r = readiness(bundle, "l1-fractions", states)
    assert r.ready and r.missing == []


def test_path_progress(bundle):
    pp = path_progress(bundle, "pb-research", {"l0-what-is-mathematics": "mastered"})
    assert pp["known"] == 1 and pp["mastered"] == 1 and pp["total"] > 200
