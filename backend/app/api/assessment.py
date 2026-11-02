"""Lesson assessments: start an attempt, answer questions, finish and update mastery."""

from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..ai import tutor
from ..ai.provider import AIError, AIProvider
from ..content.loader import ContentBundle
from ..learning import grading, service
from ..learning.mastery import KNOWN
from ..learning.recommend import next_lessons
from ..models import AssessmentAttempt, QuestionResponse, utcnow
from .deps import get_ai, get_bundle, get_db, node_out
from .schemas import (
    AnswerIn,
    AnswerOut,
    AttemptOut,
    AttemptSummary,
    QuestionProgress,
    QuestionPublic,
    QuestionResult,
    StartAttemptIn,
)

router = APIRouter()


def _progress(attempt: AssessmentAttempt) -> list[QuestionProgress]:
    out = []
    for q in attempt.questions:
        rs = [r for r in attempt.responses if r.question_id == q["id"]]
        correct = any(r.correct for r in rs)
        done = correct or len(rs) >= q["max_tries"]
        out.append(QuestionProgress(question_id=q["id"], tries=len(rs), done=done, correct=correct,
                                    credit=max((r.credit for r in rs), default=0.0),
                                    reveal=grading.reveal(q) if done else None))
    return out


def _attempt_out(attempt: AssessmentAttempt, pass_score: float) -> AttemptOut:
    return AttemptOut(
        id=attempt.id, lesson_id=attempt.lesson_id, mode=attempt.mode, pass_score=pass_score,
        started_at=attempt.started_at, finished_at=attempt.finished_at, score=attempt.score, passed=attempt.passed,
        questions=[QuestionPublic.model_validate(grading.public_view(q)) for q in attempt.questions],
        progress=_progress(attempt),
    )


def _get_attempt(db: Session, attempt_id: str) -> AssessmentAttempt:
    a = db.get(AssessmentAttempt, attempt_id)
    if a is None:
        raise HTTPException(404, "Unknown attempt")
    return a


@router.post("/lessons/{lesson_id}/assessment", response_model=AttemptOut)
def start_attempt(lesson_id: str, body: StartAttemptIn, bundle: ContentBundle = Depends(get_bundle),
                  db: Session = Depends(get_db)) -> AttemptOut:
    lesson = bundle.lessons.get(lesson_id)
    if lesson is None:
        raise HTTPException(404, "Lesson not available")
    rng = random.Random()
    questions = grading.materialise(lesson.assessment, rng)
    attempt = AssessmentAttempt(lesson_id=lesson_id, mode=body.mode, questions=questions)
    db.add(attempt)
    service.get_state(db, lesson_id)
    service.record_event(db, "assessment_started", lesson_id=lesson_id, data={"mode": body.mode})
    db.commit()
    db.refresh(attempt)
    return _attempt_out(attempt, lesson.assessment.pass_score)


@router.get("/attempts/{attempt_id}", response_model=AttemptOut)
def get_attempt(attempt_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> AttemptOut:
    a = _get_attempt(db, attempt_id)
    return _attempt_out(a, bundle.lessons[a.lesson_id].assessment.pass_score)


@router.post("/attempts/{attempt_id}/answer", response_model=AnswerOut)
async def answer(attempt_id: str, body: AnswerIn, bundle: ContentBundle = Depends(get_bundle),
                 db: Session = Depends(get_db), ai: AIProvider | None = Depends(get_ai)) -> AnswerOut:
    a = _get_attempt(db, attempt_id)
    if a.finished_at is not None:
        raise HTTPException(409, "This attempt is already finished.")
    q = next((q for q in a.questions if q["id"] == body.question_id), None)
    if q is None:
        raise HTTPException(404, "Unknown question")
    previous = [r for r in a.responses if r.question_id == q["id"]]
    if any(r.correct for r in previous) or len(previous) >= q["max_tries"]:
        raise HTTPException(409, "This question is already finished.")
    try_number = len(previous) + 1

    graded_by, feedback, rubric_met = "rule", None, None
    if q["type"] == "explain":
        text = str(body.answer.get("text", "")).strip()
        if "self_check" in body.answer:
            g = grading.grade_explain_self(q, body.answer)
            graded_by = "self"
        elif ai is not None and len(text) >= 3:
            try:
                res = await tutor.grade_explanation(ai, bundle, question=q, answer_text=text)
            except AIError as e:
                return AnswerOut(valid=False, correct=False, credit=0, try_number=try_number, tries_left=q["max_tries"] - len(previous),
                                 done=False, message=f"AI grading is unavailable ({e}). Compare your answer with the key ideas and tick the ones you included.",
                                 reveal={"rubric": q["rubric"]})
            rubric_met = res["rubric_met"]
            score = sum(rubric_met) / len(rubric_met)
            g = grading.Grade(score >= 0.6, score=score, diagnosis=res.get("misconception") or None)
            graded_by, feedback = "ai", res.get("feedback")
        else:
            if len(text) < 3:
                return AnswerOut(valid=False, correct=False, credit=0, try_number=try_number, tries_left=1, done=False,
                                 message="Write your explanation in your own words first.")
            return AnswerOut(valid=False, correct=False, credit=0, try_number=try_number, tries_left=1, done=False,
                             message="Now compare your explanation with these key ideas, and tick each one you included.",
                             reveal={"rubric": q["rubric"]})
    else:
        g = grading.grade(q, body.answer)

    if not g.valid:
        return AnswerOut(valid=False, correct=False, credit=0, try_number=try_number,
                         tries_left=q["max_tries"] - len(previous), done=False, message=g.message)

    credit = g.score if g.score is not None else grading.credit_for(try_number, g.correct)
    if q["type"] == "explain":
        credit = round(g.score or 0.0, 3)
    db.add(QuestionResponse(attempt_id=a.id, lesson_id=a.lesson_id, question_id=q["id"], try_number=try_number,
                            answer=body.answer, correct=g.correct, credit=credit, diagnosis=g.diagnosis,
                            revisit=g.revisit, graded_by=graded_by))
    service.record_event(db, "question_answered", lesson_id=a.lesson_id,
                         data={"question": q["id"], "correct": g.correct, "try": try_number})
    db.commit()
    db.refresh(a)

    tries_left = q["max_tries"] - try_number
    done = g.correct or tries_left <= 0
    revisit = node_out(bundle, g.revisit) if g.revisit and g.revisit in bundle.nodes and g.revisit != a.lesson_id else None
    return AnswerOut(
        valid=True, correct=g.correct, credit=credit, try_number=try_number, tries_left=max(tries_left, 0), done=done,
        diagnosis=g.diagnosis, revisit=revisit, hint=q.get("hint") if not g.correct and not done else None,
        reveal=grading.reveal(q) if done else None, graded_by=graded_by, feedback=feedback, rubric_met=rubric_met,
    )


@router.post("/attempts/{attempt_id}/finish", response_model=AttemptSummary)
def finish(attempt_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> AttemptSummary:
    a = _get_attempt(db, attempt_id)
    if a.finished_at is not None:
        raise HTTPException(409, "This attempt is already finished.")
    lesson = bundle.lessons[a.lesson_id]
    results, total = [], 0.0
    for q in a.questions:
        rs = [r for r in a.responses if r.question_id == q["id"]]
        credit = max((r.credit for r in rs), default=0.0)
        total += credit
        results.append(QuestionResult(question_id=q["id"], prompt=q["prompt"], correct=any(r.correct for r in rs),
                                      credit=credit, tries=len(rs)))
    score = total / len(a.questions)
    passed = score >= lesson.assessment.pass_score
    a.score, a.passed, a.finished_at = score, passed, utcnow()

    before, after = service.apply_assessment(db, bundle, a.lesson_id, score, lesson.assessment.pass_score, a.mode)

    # Mistakes that point at earlier lessons: suggest them, and if the learner did not pass,
    # mark previously understood ones for revision.
    targets: list[str] = []
    for r in a.responses:
        if not r.correct and r.revisit and r.revisit in bundle.nodes and r.revisit != a.lesson_id and r.revisit not in targets:
            targets.append(r.revisit)
    if not passed:
        for t in targets:
            service.apply_diagnosed_gap(db, t, f"Mistakes in '{bundle.nodes[a.lesson_id].title}' pointed back to this idea.")

    service.record_event(db, "assessment_finished", lesson_id=a.lesson_id,
                         data={"score": round(score, 3), "passed": passed, "mode": a.mode, "from": before, "to": after})
    db.commit()
    states = service.states_map(db)
    learned = [t for t in lesson.word.terms] if passed else []
    return AttemptSummary(
        attempt_id=a.id, lesson_id=a.lesson_id, score=score, passed=passed, pass_score=lesson.assessment.pass_score,
        state_before=before, state_after=after, results=results,
        revisit=[node_out(bundle, t) for t in targets if states.get(t) not in KNOWN or not passed],
        next=[node_out(bundle, n) for n in next_lessons(bundle, states, limit=3)],
        learned_terms=learned,
    )
