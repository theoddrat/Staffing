"""The AI teaching engine, exercised with a scripted provider (no network)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.ai import tutor
from app.ai.calculator import calculate, run_tool
from app.ai.provider import FakeProvider, _echo_content

from .conftest import correct_answer

CHAT_REPLY = {
    "reply": "A [[fraction|fraction]] is part of a whole. See [[no-such-term|this]] and [[lesson:l1-fractions|the lesson]].",
    "strategy": "everyday-analogy",
    "check_question": "What does the bottom number tell you?",
    "missing_prerequisites": ["l1-equal-quantities", "not-a-lesson"],
    "new_terms": [],
    "statements": [{"kind": "definition", "text": "A fraction is a/b with b not zero."}, {"kind": "bogus", "text": "x"}],
}


def test_chat_stores_messages_and_sanitises_output(make_client, bundle):
    fake = FakeProvider([CHAT_REPLY])
    c = make_client(fake)
    c.post("/api/lessons/l0-what-is-mathematics/open")
    th = c.post("/api/tutor/threads", json={"lesson_id": "l1-fractions"}).json()
    r = c.post(f"/api/tutor/threads/{th['id']}/messages", json={"content": "What is a fraction?", "section": "plain"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert "[[fraction|fraction]]" in m["content"]
    assert "no-such-term" not in m["content"] and "this" in m["content"]
    assert [p["id"] for p in m["missing_prerequisites"]] == ["l1-equal-quantities"]
    assert [s["kind"] for s in m["statements"]] == ["definition"]

    req = fake.requests[0]
    assert req["use_calculator"] is True
    system_text = " ".join(b["text"] for b in req["system"])
    assert "new-language principle" in system_text
    assert "Current lesson: Fractions" in system_text
    assert "plain" in system_text  # the section the learner is on
    assert req["system"][0].get("cache_control")  # stable part is cacheable
    assert req["schema"]["additionalProperties"] is False

    thread = c.get(f"/api/tutor/threads/{th['id']}").json()
    assert [x["role"] for x in thread["messages"]] == ["user", "assistant"]
    assert thread["title"] == "About: Fractions"


def test_history_is_replayed_as_plain_text(make_client):
    fake = FakeProvider([CHAT_REPLY, CHAT_REPLY])
    c = make_client(fake)
    th = c.post("/api/tutor/threads", json={}).json()
    c.post(f"/api/tutor/threads/{th['id']}/messages", json={"content": "first"})
    c.post(f"/api/tutor/threads/{th['id']}/messages", json={"content": "second"})
    msgs = fake.requests[1]["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert all(isinstance(m["content"], str) for m in msgs)
    assert c.get(f"/api/tutor/threads/{th['id']}").json()["title"] == "first"


def test_research_mode_uses_research_prompt(make_client):
    fake = FakeProvider([CHAT_REPLY])
    c = make_client(fake)
    th = c.post("/api/tutor/threads", json={"mode": "research"}).json()
    c.post(f"/api/tutor/threads/{th['id']}/messages", json={"content": "Is there a pattern in prime gaps?"})
    assert "research collaborator" in fake.requests[0]["system"][0]["text"]


def test_explain_differently_falls_back_to_ai_after_authored(make_client):
    fake = FakeProvider([{"strategy": "story", "title": "A new story", "explanation": "Once upon a time...",
                          "check_question": "Why?"}])
    c = make_client(fake)
    lesson = c.get("/api/lessons/l0-counting").json()["lesson"]
    seen = [a["strategy"] for a in lesson["alternatives"]]
    r = c.post("/api/lessons/l0-counting/explain-differently", json={"seen": seen}).json()
    assert r["source"] == "ai" and r["title"] == "A new story"
    ask = fake.requests[0]["messages"][0]["content"]
    for s in seen:
        assert s in ask  # the AI is told which strategies already failed


def test_ai_grades_explanations(make_client):
    fake = FakeProvider([{"rubric_met": [True, True, False], "feedback": "Good start.", "misconception": ""}])
    c = make_client(fake)
    from app import db as dbmod
    from app.models import AssessmentAttempt

    a = c.post("/api/lessons/l0-counting/assessment", json={}).json()
    with dbmod._SessionLocal() as s:
        q = next(q for q in s.get(AssessmentAttempt, a["id"]).questions if q["type"] == "explain")
    r = c.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": {"text": "Each thing gets one word."}}).json()
    assert r["graded_by"] == "ai" and r["rubric_met"] == [True, True, False] and r["feedback"] == "Good start."
    assert r["correct"] and abs(r["credit"] - 0.667) < 0.01


def test_draft_term(make_client):
    entry = {"word": "bijection", "pronunciation": "by-JEK-shun", "plain": "a perfect pairing", "analogy": "dance partners",
             "visual_description": "lines pairing dots", "formal": "a function that is one-to-one and onto",
             "example": "x maps to x+1 on integers", "non_example": "squaring on integers", "related": ["function"],
             "used_later": "counting arguments", "is_mathematical_term": True}
    c = make_client(FakeProvider([entry]))
    r = c.post("/api/dictionary/draft", json={"word": "Bijection"}).json()
    assert r["id"] == "ai-bijection" and r["entry"]["formal"].startswith("a function")
    # cached: no second model call needed
    assert c.post("/api/dictionary/draft", json={"word": "bijection"}).json()["id"] == "ai-bijection"
    assert len(c.get("/api/dictionary/drafts").json()) == 1


def test_learner_context_reflects_progress(bundle):
    ctx = tutor.learner_context(bundle, {}, lesson_id="l1-fractions")
    assert "complete beginner" in ctx
    ctx = tutor.learner_context(bundle, {"l0-counting": "mastered", "l0-quantity": "needs_revision"},
                                lesson_id="l2-addition", mistakes=["l1-fractions: upside down"])
    assert "l0-counting" in ctx and "needing revision: l0-quantity" in ctx
    assert "planned but not yet written" in ctx
    assert "upside down" in ctx


def test_sanitize_links(bundle):
    s = tutor.sanitize_links("[[prime-number|primes]] [[fake|x]] [[lesson:l1-zero|zero]] [[lesson:nope|y]]", bundle)
    assert s == "[[prime-number|primes]] x [[lesson:l1-zero|zero]] y"


def test_echo_content_after_fallback():
    blocks = [SimpleNamespace(type=t) for t in ["thinking", "tool_use", "text", "fallback", "thinking", "tool_use"]]
    out = [b.type for b in _echo_content(blocks)]
    assert out == ["text", "thinking", "tool_use"]
    plain = [SimpleNamespace(type=t) for t in ["thinking", "text", "tool_use"]]
    assert [b.type for b in _echo_content(plain)] == ["thinking", "text", "tool_use"]


@pytest.mark.parametrize("expr,expected", [
    ("gcd(84, 120)", "12"), ("3/4 + 1/6", "11/12"), ("2^10", "1024"), ("isprime(97)", "True"),
    ("17 % 5", "2"), ("0.1 + 0.2", "3/10"), ("lcm(4,6)*gcd(4,6) == 24", "True"), ("primepi(100)", "25"),
])
def test_calculator(expr, expected):
    assert calculate(expr) == expected


@pytest.mark.parametrize("expr", ["__import__('os')", "open('f')", "(1).__class__", "x + 1", "2**100000", "[1,2]", "lambda: 1"])
def test_calculator_rejects_unsafe_or_huge(expr):
    out, err = run_tool("calculate", {"expression": expr})
    assert err


def test_fake_provider_tool_calls_use_real_calculator():
    import asyncio

    fake = FakeProvider([{"ok": True}], tool_calls=[{"name": "calculate", "input": {"expression": "gcd(12, 18)"}}])
    res = asyncio.run(fake.structured(system=[], messages=[], schema={}, use_calculator=True))
    assert res.tool_calls[0]["output"] == "6"
