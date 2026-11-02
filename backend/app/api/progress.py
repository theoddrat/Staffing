"""Progress overview, learning history, mistakes, and data export/import/reset."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..content.loader import ContentBundle
from ..learning import service
from ..learning.recommend import frontier_planned, next_lessons, path_progress
from ..models import (
    AssessmentAttempt,
    ChatMessage,
    ChatThread,
    ConceptState,
    ExerciseCompletion,
    GeneratedTerm,
    LearningEvent,
    PracticeItem,
    QuestionResponse,
    TermState,
    Wondering,
)
from .deps import get_bundle, get_db, state_out
from .schemas import EventOut, MistakeOut, PathProgress, ProgressOut, ResetIn, RevisionItem, StageProgress

router = APIRouter()

EXPORT_TABLES = [ConceptState, LearningEvent, AssessmentAttempt, QuestionResponse, TermState, ExerciseCompletion,
                 PracticeItem, ChatThread, ChatMessage, GeneratedTerm, Wondering]


@router.get("/progress", response_model=ProgressOut)
def progress(bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> ProgressOut:
    rows = list(db.scalars(select(ConceptState)))
    by_id = {r.lesson_id: r for r in rows if r.lesson_id in bundle.nodes}
    states = {k: v.state for k, v in by_id.items()}
    counts: dict[str, int] = defaultdict(int)
    for s in states.values():
        counts[s] += 1
    counts["not_started"] = len(bundle.nodes) - sum(counts[k] for k in ("introduced", "understood", "mastered", "needs_revision"))
    counts["available"] = len(bundle.lessons)
    counts["total"] = len(bundle.nodes)

    stage_rows = []
    for s in bundle.curriculum.stages:
        ids = [n.id for n in bundle.curriculum.lessons if n.stage == s.id]
        stage_rows.append(StageProgress(
            id=s.id, total=len(ids), available=sum(1 for i in ids if i in bundle.lessons),
            understood=sum(1 for i in ids if states.get(i) in ("understood", "mastered")),
            mastered=sum(1 for i in ids if states.get(i) == "mastered"),
            introduced=sum(1 for i in ids if states.get(i) in ("introduced", "needs_revision")),
        ))
    paths = []
    for s in bundle.curriculum.stages:
        if s.kind == "path" and s.target:
            pp = path_progress(bundle, s.target, states)
            paths.append(PathProgress(id=s.id, title=s.title, target=s.target, **pp))

    term_rows = list(db.scalars(select(TermState)))
    vocab = {"total": len(bundle.terms), "seen": sum(1 for t in term_rows if t.term_id in bundle.terms),
             "learned": sum(1 for t in term_rows if t.learned and t.term_id in bundle.terms)}
    exercises = db.scalar(select(func.count()).select_from(ExerciseCompletion)) or 0
    passed = db.scalar(select(func.count()).select_from(AssessmentAttempt).where(AssessmentAttempt.passed.is_(True))) or 0
    revision = [RevisionItem(lesson_id=r.lesson_id, reason=r.revision_reason or "Marked for revision.")
                for r in by_id.values() if r.state == "needs_revision"]
    last = db.scalars(select(LearningEvent).where(LearningEvent.type == "lesson_opened")
                      .order_by(LearningEvent.id.desc()).limit(1)).first()
    return ProgressOut(
        states={k: state_out(k, v) for k, v in by_id.items()}, counts=dict(counts), stages=stage_rows, paths=paths,
        vocabulary=vocab, exercises_completed=exercises, assessments_passed=passed,
        next=next_lessons(bundle, states, limit=5), revision=revision,
        review_due=[i for i in service.review_due(db) if i in bundle.nodes],
        frontier_planned=frontier_planned(bundle, states), last_lesson=last.lesson_id if last else None,
    )


@router.get("/history", response_model=list[EventOut])
def history(limit: int = Query(100, ge=1, le=1000), before: int | None = None, lesson_id: str | None = None,
            db: Session = Depends(get_db)) -> list[EventOut]:
    q = select(LearningEvent).order_by(LearningEvent.id.desc()).limit(limit)
    if before is not None:
        q = q.where(LearningEvent.id < before)
    if lesson_id is not None:
        q = q.where(LearningEvent.lesson_id == lesson_id)
    return [EventOut(id=e.id, created_at=e.created_at, type=e.type, lesson_id=e.lesson_id, term_id=e.term_id,
                     data=e.data or {}) for e in db.scalars(q)]


@router.get("/progress/mistakes", response_model=list[MistakeOut])
def mistakes(db: Session = Depends(get_db)) -> list[MistakeOut]:
    rows = db.scalars(select(QuestionResponse).where(QuestionResponse.correct.is_(False), QuestionResponse.diagnosis.is_not(None)))
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        key = (r.lesson_id, r.diagnosis)
        e = agg.setdefault(key, {"lesson_id": r.lesson_id, "question_id": r.question_id, "diagnosis": r.diagnosis,
                                 "revisit": r.revisit, "count": 0, "last_at": r.created_at})
        e["count"] += 1
        e["last_at"] = max(e["last_at"], r.created_at)
    return sorted((MistakeOut(**v) for v in agg.values()), key=lambda m: (-m.count, m.lesson_id))


# ------------------------------------------------------------------ export / import / reset


def _row_to_dict(row: Any) -> dict[str, Any]:
    out = {}
    for col in row.__table__.columns:
        v = getattr(row, col.name)
        out[col.name] = v.isoformat() if isinstance(v, datetime) else v
    return out


@router.get("/progress/export")
def export_data(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Everything the app knows about the learner, as JSON (a complete backup)."""
    return {
        "format": "mathematical-universe-backup",
        "version": 1,
        "tables": {m.__tablename__: [_row_to_dict(r) for r in db.scalars(select(m))] for m in EXPORT_TABLES},
    }


def _clear(db: Session) -> None:
    for m in reversed(EXPORT_TABLES):
        db.execute(delete(m))


@router.post("/progress/import", status_code=204)
def import_data(payload: dict[str, Any], db: Session = Depends(get_db)) -> None:
    if payload.get("format") != "mathematical-universe-backup":
        raise HTTPException(400, "This is not a Mathematical Universe backup file.")
    tables = payload.get("tables", {})
    _clear(db)
    for m in EXPORT_TABLES:
        cols = {c.name: c for c in m.__table__.columns}
        for row in tables.get(m.__tablename__, []):
            data = {}
            for k, v in row.items():
                if k not in cols:
                    continue
                if v is not None and cols[k].type.python_type is datetime:
                    v = datetime.fromisoformat(v)
                data[k] = v
            db.add(m(**data))
        db.flush()
    db.commit()


@router.post("/progress/reset", status_code=204)
def reset(body: ResetIn, db: Session = Depends(get_db)) -> None:
    if body.confirm != "RESET":
        raise HTTPException(400, 'Send {"confirm": "RESET"} to erase all progress.')
    _clear(db)
    db.commit()
