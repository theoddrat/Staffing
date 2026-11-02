"""End-to-end API behaviour: lessons, assessments, progress, history, persistence."""

from __future__ import annotations

from app import db as dbmod
from app.models import AssessmentAttempt

from .conftest import correct_answer, wrong_answer


def _private_questions(attempt_id: str) -> list[dict]:
    with dbmod._SessionLocal() as s:  # type: ignore[misc]
        return s.get(AssessmentAttempt, attempt_id).questions


def _complete(client, lesson_id: str, *, correctly: bool = True) -> dict:
    a = client.post(f"/api/lessons/{lesson_id}/assessment", json={"mode": "lesson"}).json()
    for q in _private_questions(a["id"]):
        payload = correct_answer(q) if correctly else wrong_answer(q)
        r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": payload})
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["valid"], res
        assert res["correct"] == correctly, (q, res)
        if not correctly and not res["done"]:
            # second (also wrong) try
            r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": payload})
            assert r.json()["done"]
    return client.post(f"/api/attempts/{a['id']}/finish").json()


def test_health_and_curriculum(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["lessons_available"] >= 41
    cur = client.get("/api/curriculum").json()
    assert {s["id"] for s in cur["stages"]} >= {"L0", "L1", "L12", "PA", "PB"}
    first = next(l for l in cur["lessons"] if l["id"] == "l0-what-is-mathematics")
    assert first["available"] and set(first["feeds"]) == {"pnp", "rh"}


def test_lesson_payload_hides_answers(client):
    r = client.get("/api/lessons/l1-fractions")
    assert r.status_code == 200
    body = r.json()
    assert body["lesson"]["assessment"] == {"pass_score": 0.7, "question_count": 5}
    assert "questions" not in body["lesson"]["assessment"]
    assert body["readiness"]["ready"] is False


def test_planned_lesson_is_reported_honestly(client):
    r = client.get("/api/lessons/pb-critical-line")
    assert r.status_code == 404
    assert "planned" in r.json()["detail"]


def test_opening_a_lesson_introduces_it_and_adds_words(client):
    r = client.post("/api/lessons/l0-what-is-mathematics/open").json()
    assert r["state"]["state"] == "introduced"
    assert "mathematics" in r["new_terms"]
    terms = {t["id"]: t for t in client.get("/api/dictionary").json()}
    assert terms["mathematics"]["seen"] and not terms["mathematics"]["learned"]


def test_full_assessment_flow_updates_mastery_and_history(client):
    client.post("/api/lessons/l0-what-is-mathematics/open")
    summary = _complete(client, "l0-what-is-mathematics")
    assert summary["passed"] and summary["score"] == 1.0
    assert summary["state_after"] == "understood"
    assert summary["next"][0]["id"] == "l0-why-mathematics"
    assert "mathematics" in summary["learned_terms"]

    prog = client.get("/api/progress").json()
    assert prog["states"]["l0-what-is-mathematics"]["state"] == "understood"
    assert prog["next"][0] == "l0-why-mathematics"
    assert prog["vocabulary"]["learned"] >= 1
    assert prog["assessments_passed"] == 1

    types = [e["type"] for e in client.get("/api/history").json()]
    for t in ("lesson_opened", "assessment_started", "question_answered", "assessment_finished", "state_changed"):
        assert t in types


def test_failing_records_mistakes_and_offers_revisits(client):
    summary = _complete(client, "l1-fractions", correctly=False)
    assert not summary["passed"]
    assert summary["state_after"] == "introduced"
    mistakes = client.get("/api/progress/mistakes").json()
    assert mistakes and all(m["diagnosis"] for m in mistakes)


def test_failing_flags_previously_understood_prerequisites(client):
    # The learner has understood numerators and denominators...
    assert _complete(client, "l1-numerators-denominators")["state_after"] == "understood"
    # ...then, in the fractions assessment, writes a fraction upside down (a diagnosed mistake that
    # points back to numerators and denominators) and fails overall.
    summary = _complete(client, "l1-fractions", correctly=False)
    assert not summary["passed"]
    assert "l1-numerators-denominators" in [n["id"] for n in summary["revisit"]]
    st = client.get("/api/progress").json()["states"]["l1-numerators-denominators"]
    assert st["state"] == "needs_revision"
    assert "Fractions" in st["revision_reason"]
    assert any(r["lesson_id"] == "l1-numerators-denominators" for r in client.get("/api/progress").json()["revision"])


def test_question_cannot_be_answered_after_it_is_finished(client):
    a = client.post("/api/lessons/l0-counting/assessment", json={}).json()
    q = _private_questions(a["id"])[0]
    client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": correct_answer(q)})
    r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": correct_answer(q)})
    assert r.status_code == 409


def test_invalid_answers_do_not_use_up_tries(client):
    a = client.post("/api/lessons/l1-fractions/assessment", json={}).json()
    q = next(q for q in _private_questions(a["id"]) if q["type"] == "number")
    r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": {"value": "banana"}}).json()
    assert r["valid"] is False and r["message"]
    r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": correct_answer(q)}).json()
    assert r["correct"] and r["credit"] == 1.0


def test_second_try_gets_half_credit_and_a_hint(client):
    a = client.post("/api/lessons/l0-patterns/assessment", json={}).json()
    q = next(q for q in _private_questions(a["id"]) if q["id"] == "triangle-next")
    r1 = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": {"value": "20"}}).json()
    assert not r1["correct"] and r1["diagnosis"] and r1["hint"] and r1["tries_left"] == 1
    r2 = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": {"value": "21"}}).json()
    assert r2["correct"] and r2["credit"] == 0.5 and r2["reveal"]["answer"] == "21"


def test_self_assessed_explanation_without_ai(client):
    a = client.post("/api/lessons/l0-counting/assessment", json={}).json()
    q = next(q for q in _private_questions(a["id"]) if q["type"] == "explain")
    r = client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": {"text": "One word per thing."}}).json()
    assert r["valid"] is False and r["reveal"]["rubric"] == q["rubric"]
    r = client.post(f"/api/attempts/{a['id']}/answer",
                    json={"question_id": q["id"], "answer": {"text": "One word per thing.", "self_check": [0, 1]}}).json()
    assert r["valid"] and r["graded_by"] == "self" and r["correct"]


def test_test_out_marks_concept_understood(client):
    a = client.post("/api/lessons/l0-quantity/assessment", json={"mode": "test_out"}).json()
    for q in _private_questions(a["id"]):
        client.post(f"/api/attempts/{a['id']}/answer", json={"question_id": q["id"], "answer": correct_answer(q)})
    s = client.post(f"/api/attempts/{a['id']}/finish").json()
    assert s["passed"]
    st = client.get("/api/progress").json()["states"]["l0-quantity"]
    assert st["state"] == "understood" and st["tested_out"]


def test_explain_differently_cycles_authored_strategies_then_stops(client):
    seen: list[str] = []
    lesson = client.get("/api/lessons/l0-counting").json()["lesson"]
    expected = [a["strategy"] for a in lesson["alternatives"] if a["strategy"] != lesson["analogy"]["strategy"]]
    for strat in expected:
        r = client.post("/api/lessons/l0-counting/explain-differently", json={"section": "plain", "seen": seen}).json()
        assert r["source"] == "authored" and r["strategy"] == strat and r["strategy"] not in seen
        seen.append(r["strategy"])
    r = client.post("/api/lessons/l0-counting/explain-differently", json={"section": "plain", "seen": seen}).json()
    assert r["source"] == "none" and r["message"]


def test_practice_flow(client):
    gens = client.get("/api/practice/generators").json()
    assert any(g["id"] == "gcd" for g in gens)
    p = client.post("/api/practice/gcd", json={}).json()
    assert p["question"]["type"] == "number"
    r = client.post(f"/api/practice/items/{p['id']}/answer", json={"answer": {"value": "999999"}}).json()
    assert r["valid"] and not r["correct"]


def test_wonderings(client):
    w = client.post("/api/wonderings", json={"text": "Why are there infinitely many primes?", "lesson_id": "l1-prime-numbers"}).json()
    assert w["status"] == "open"
    w = client.patch(f"/api/wonderings/{w['id']}", json={"status": "exploring"}).json()
    assert w["status"] == "exploring"
    assert len(client.get("/api/wonderings").json()) == 1


def test_export_import_reset_roundtrip(client):
    _complete(client, "l0-what-is-mathematics")
    backup = client.get("/api/progress/export").json()
    assert backup["format"] == "mathematical-universe-backup"
    assert client.post("/api/progress/reset", json={"confirm": "nope"}).status_code == 400
    assert client.post("/api/progress/reset", json={"confirm": "RESET"}).status_code == 204
    assert client.get("/api/progress").json()["states"] == {}
    assert client.post("/api/progress/import", json=backup).status_code == 204
    assert client.get("/api/progress").json()["states"]["l0-what-is-mathematics"]["state"] == "understood"


def test_progress_persists_across_restarts(make_client):
    c1 = make_client(None)
    c1.post("/api/lessons/l0-counting/open")
    c1.__exit__(None, None, None)
    c2 = make_client(None)
    assert c2.get("/api/progress").json()["states"]["l0-counting"]["state"] == "introduced"


def test_dictionary_entry_and_lookups(client):
    t = client.get("/api/dictionary/prime-number").json()
    assert t["term"]["non_example"] and t["introduced_in"]["id"] == "l1-prime-numbers"
    r = client.post("/api/dictionary/prime-number/viewed").json()
    assert r["lookups"] == 1 and r["seen"]
    assert client.get("/api/dictionary/no-such-word").status_code == 404


def test_tutor_reports_unavailable_without_ai(client):
    status = client.get("/api/ai/status").json()
    assert status["configured"] is False
    th = client.post("/api/tutor/threads", json={"lesson_id": "l1-fractions"}).json()
    r = client.post(f"/api/tutor/threads/{th['id']}/messages", json={"content": "What is a fraction?"})
    assert r.status_code == 503
    assert client.post("/api/dictionary/draft", json={"word": "bijection"}).status_code == 503
