"""Database-backed operations on the learner model and learning history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..content.loader import LINK_RE, ContentBundle, iter_strings
from ..models import ConceptState, LearningEvent, QuestionResponse, TermState, utcnow
from . import mastery


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_state(db: Session, lesson_id: str) -> ConceptState:
    st = db.get(ConceptState, lesson_id)
    if st is None:
        st = ConceptState(lesson_id=lesson_id, state="not_started", pass_count=0, attempt_count=0, tested_out=False)
        db.add(st)
        db.flush()
    return st


def states_map(db: Session) -> dict[str, str]:
    return {s.lesson_id: s.state for s in db.scalars(select(ConceptState))}


def record_event(db: Session, type_: str, *, lesson_id: str | None = None, term_id: str | None = None,
                 data: dict[str, Any] | None = None) -> LearningEvent:
    ev = LearningEvent(type=type_, lesson_id=lesson_id, term_id=term_id, data=data or {})
    db.add(ev)
    return ev


def _view(st: ConceptState) -> mastery.StateView:
    return mastery.StateView(state=st.state, pass_count=st.pass_count, last_passed_at=_aware(st.last_passed_at),
                             best_score=st.best_score)


def _set_state(db: Session, st: ConceptState, new: str, reason: str | None, cause: str) -> None:
    if new != st.state:
        record_event(db, "state_changed", lesson_id=st.lesson_id,
                     data={"from": st.state, "to": new, "reason": reason, "cause": cause})
        st.state = new
        if new == "needs_revision":
            st.revision_reason = reason
        elif new in ("understood", "mastered"):
            st.revision_reason = None
    st.updated_at = utcnow()


def lesson_terms(bundle: ContentBundle, lesson_id: str) -> list[str]:
    """Every dictionary term a lesson introduces or links to."""
    lesson = bundle.lessons.get(lesson_id)
    if lesson is None:
        return []
    found: list[str] = list(lesson.word.terms)
    for _, text in iter_strings(lesson):
        for m in LINK_RE.finditer(text):
            t = m.group(1).strip()
            if not t.startswith("lesson:") and t in bundle.terms and t not in found:
                found.append(t)
        for t in bundle.find_terms(text):
            if t not in found:
                found.append(t)
    return found


def touch_terms(db: Session, term_ids: list[str], lesson_id: str | None) -> list[str]:
    """Add words to the personal dictionary. Returns the ids that are new."""
    new = []
    for tid in term_ids:
        ts = db.get(TermState, tid)
        if ts is None:
            db.add(TermState(term_id=tid, first_seen_lesson=lesson_id, lookups=0, learned=False))
            new.append(tid)
    if new:
        record_event(db, "terms_added", lesson_id=lesson_id, data={"terms": new})
    return new


def open_lesson(db: Session, bundle: ContentBundle, lesson_id: str) -> tuple[ConceptState, list[str]]:
    st = get_state(db, lesson_id)
    if st.first_seen_at is None:
        st.first_seen_at = utcnow()
    _set_state(db, st, mastery.on_open(_view(st)), None, "lesson_opened")
    record_event(db, "lesson_opened", lesson_id=lesson_id)
    new_terms = touch_terms(db, lesson_terms(bundle, lesson_id), lesson_id)
    return st, new_terms


def apply_assessment(db: Session, bundle: ContentBundle, lesson_id: str, score: float, pass_score: float,
                     mode: str) -> tuple[str, str]:
    st = get_state(db, lesson_id)
    before = st.state
    now = utcnow()
    new, reason = mastery.on_assessment(_view(st), score, pass_score, now)
    st.attempt_count += 1
    st.last_score = score
    st.best_score = score if st.best_score is None else max(st.best_score, score)
    if score >= pass_score:
        st.pass_count += 1
        st.last_passed_at = now
        if mode == "test_out":
            st.tested_out = True
        # words introduced by this lesson are now "learned"
        lesson = bundle.lessons.get(lesson_id)
        if lesson:
            for tid in lesson.word.terms:
                ts = db.get(TermState, tid)
                if ts is None:
                    ts = TermState(term_id=tid, first_seen_lesson=lesson_id, lookups=0, learned=True)
                    db.add(ts)
                ts.learned = True
    if st.first_seen_at is None:
        st.first_seen_at = now
    _set_state(db, st, new, reason, f"assessment:{mode}")
    return before, st.state


def apply_diagnosed_gap(db: Session, lesson_id: str, reason: str) -> bool:
    """A mistake points back to lesson_id. Returns True if it was flagged for revision."""
    st = db.get(ConceptState, lesson_id)
    if st is None:
        return False
    new, why = mastery.on_diagnosed_gap(_view(st), reason)
    if new != st.state:
        _set_state(db, st, new, why, "diagnosed_gap")
        return True
    return False


def review_due(db: Session) -> list[str]:
    now = utcnow()
    return [s.lesson_id for s in db.scalars(select(ConceptState)) if mastery.review_due(_view(s), now)]


def recent_mistakes(db: Session, limit: int = 8) -> list[str]:
    rows = db.scalars(
        select(QuestionResponse).where(QuestionResponse.correct.is_(False), QuestionResponse.diagnosis.is_not(None))
        .order_by(QuestionResponse.id.desc()).limit(limit)
    )
    return [f"{r.lesson_id}: {r.diagnosis}" for r in rows]


def known_terms(db: Session, bundle: ContentBundle) -> list[str]:
    return [bundle.terms[t.term_id].word for t in db.scalars(select(TermState)) if t.term_id in bundle.terms]
