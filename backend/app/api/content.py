"""Curriculum, lessons and the personal dictionary."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import tutor
from ..ai.provider import AIError, AIProvider
from ..content.loader import ContentBundle
from ..learning import service
from ..models import ConceptState, GeneratedTerm, TermState, utcnow
from .deps import get_ai, get_bundle, get_db, node_out, readiness_out, state_out, term_summary
from .schemas import (
    AlternativeOut,
    AssessmentInfo,
    CurriculumOut,
    DraftTermIn,
    ExplainDifferentlyIn,
    GeneratedTermOut,
    LessonEventIn,
    LessonOut,
    LessonPublic,
    ModuleOut,
    OpenLessonOut,
    ReadinessOut,
    StageOut,
    TermOut,
    TermSummary,
)

router = APIRouter()


def _lesson_or_404(bundle: ContentBundle, lesson_id: str) -> None:
    if lesson_id not in bundle.nodes:
        raise HTTPException(404, f"Unknown lesson '{lesson_id}'")


@router.get("/curriculum", response_model=CurriculumOut)
def curriculum(bundle: ContentBundle = Depends(get_bundle)) -> CurriculumOut:
    stages = [
        StageOut(id=s.id, kind=s.kind, number=s.number, title=s.title, summary=s.summary, why=s.why, goals=list(s.goals),
                 modules=[ModuleOut(id=m.id, title=m.title, why=m.why, goals=list(m.goals)) for m in s.modules],
                 target=s.target)
        for s in bundle.curriculum.stages
    ]
    lessons = [node_out(bundle, n.id) for n in bundle.curriculum.lessons]
    return CurriculumOut(stages=stages, lessons=lessons)


@router.get("/lessons/{lesson_id}", response_model=LessonOut)
def get_lesson(lesson_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> LessonOut:
    _lesson_or_404(bundle, lesson_id)
    lesson = bundle.lessons.get(lesson_id)
    if lesson is None:
        raise HTTPException(404, f"The lesson '{bundle.nodes[lesson_id].title}' is planned but not yet written.")
    data = lesson.model_dump(mode="json")
    data["assessment"] = AssessmentInfo(pass_score=lesson.assessment.pass_score,
                                        question_count=len(lesson.assessment.questions)).model_dump()
    public = LessonPublic.model_validate(data)
    states = service.states_map(db)
    term_ids = service.lesson_terms(bundle, lesson_id)
    tstates = {t.term_id: t for t in db.scalars(select(TermState).where(TermState.term_id.in_(term_ids)))}
    node = bundle.nodes[lesson_id]
    return LessonOut(
        node=node_out(bundle, lesson_id),
        lesson=public,
        state=state_out(lesson_id, db.get(ConceptState, lesson_id)),
        readiness=readiness_out(bundle, lesson_id, states),
        terms=[term_summary(bundle, t, tstates.get(t)) for t in term_ids],
        prerequisites=[node_out(bundle, p) for p in node.pre],
        unlocks=[node_out(bundle, c) for c in bundle.children.get(lesson_id, [])],
    )


@router.post("/lessons/{lesson_id}/open", response_model=OpenLessonOut)
def open_lesson(lesson_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> OpenLessonOut:
    _lesson_or_404(bundle, lesson_id)
    st, new_terms = service.open_lesson(db, bundle, lesson_id)
    db.commit()
    return OpenLessonOut(state=state_out(lesson_id, st), new_terms=new_terms,
                         readiness=readiness_out(bundle, lesson_id, service.states_map(db)))


@router.post("/lessons/{lesson_id}/events", status_code=204)
def lesson_event(lesson_id: str, body: LessonEventIn, bundle: ContentBundle = Depends(get_bundle),
                 db: Session = Depends(get_db)) -> None:
    _lesson_or_404(bundle, lesson_id)
    service.record_event(db, body.type, lesson_id=lesson_id, data=body.data)
    if body.type == "experiment_completed":
        from ..models import ExerciseCompletion

        db.add(ExerciseCompletion(lesson_id=lesson_id, exercise="experiment", data=body.data))
    db.commit()


@router.get("/lessons/{lesson_id}/readiness", response_model=ReadinessOut)
def lesson_readiness(lesson_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> ReadinessOut:
    _lesson_or_404(bundle, lesson_id)
    return readiness_out(bundle, lesson_id, service.states_map(db))


@router.post("/lessons/{lesson_id}/explain-differently", response_model=AlternativeOut)
async def explain_differently(
    lesson_id: str,
    body: ExplainDifferentlyIn,
    bundle: ContentBundle = Depends(get_bundle),
    db: Session = Depends(get_db),
    ai: AIProvider | None = Depends(get_ai),
) -> AlternativeOut:
    """The "I don't understand" button: a different teaching strategy each time."""
    lesson = bundle.lessons.get(lesson_id)
    if lesson is None:
        raise HTTPException(404, "Lesson not available")
    seen = set(body.seen) | {lesson.analogy.strategy}
    unseen = [a for a in lesson.alternatives if a.strategy not in seen]
    if unseen and not body.use_ai:
        alt = unseen[0]
        service.record_event(db, "dont_understand", lesson_id=lesson_id,
                             data={"section": body.section, "strategy": alt.strategy, "source": "authored"})
        db.commit()
        return AlternativeOut(source="authored", strategy=alt.strategy, title=alt.title, text=alt.text, visual=alt.visual,
                              remaining_authored=len(unseen) - 1, ai_available=ai is not None)
    if ai is None:
        service.record_event(db, "dont_understand", lesson_id=lesson_id, data={"section": body.section, "source": "none"})
        db.commit()
        return AlternativeOut(
            source="none", ai_available=False,
            message="You have seen every prepared explanation for this lesson. Revisiting an earlier lesson often "
                    "helps - check the prerequisites below - or enable the AI tutor for a personalised explanation.",
        )
    states = service.states_map(db)
    learner = tutor.learner_context(bundle, states, lesson_id=lesson_id, section=body.section,
                                    known_terms=service.known_terms(db, bundle), mistakes=service.recent_mistakes(db))
    tried = sorted(seen)
    try:
        data = await tutor.explain_differently(ai, bundle, learner=learner, lesson_id=lesson_id, section=body.section,
                                               tried=tried)
    except AIError as e:
        raise HTTPException(502, str(e)) from e
    service.record_event(db, "dont_understand", lesson_id=lesson_id,
                         data={"section": body.section, "strategy": data.get("strategy"), "source": "ai"})
    db.commit()
    return AlternativeOut(source="ai", strategy=data.get("strategy"), title=data.get("title"), text=data.get("explanation"),
                          check_question=data.get("check_question") or None, remaining_authored=0, ai_available=True)


# ------------------------------------------------------------------ dictionary


@router.get("/dictionary", response_model=list[TermSummary])
def dictionary(bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> list[TermSummary]:
    tstates = {t.term_id: t for t in db.scalars(select(TermState))}
    out = [term_summary(bundle, tid, tstates.get(tid)) for tid in bundle.terms]
    out.sort(key=lambda t: t.word.lower())
    return out


@router.get("/dictionary/drafts", response_model=list[GeneratedTermOut])
def drafts(db: Session = Depends(get_db)) -> list[GeneratedTermOut]:
    return [GeneratedTermOut(id=g.id, word=g.word, entry=g.entry, model=g.model, created_at=g.created_at)
            for g in db.scalars(select(GeneratedTerm).order_by(GeneratedTerm.created_at.desc()))]


@router.post("/dictionary/draft", response_model=GeneratedTermOut)
async def draft_term(body: DraftTermIn, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db),
                     ai: AIProvider | None = Depends(get_ai)) -> GeneratedTermOut:
    """Ask the AI to draft an entry for a word not yet in the curated dictionary."""
    if ai is None:
        raise HTTPException(503, "The AI tutor is not configured, so new dictionary entries cannot be drafted.")
    slug = "ai-" + re.sub(r"[^a-z0-9]+", "-", body.word.lower()).strip("-")
    existing = db.get(GeneratedTerm, slug)
    if existing:
        return GeneratedTermOut(id=existing.id, word=existing.word, entry=existing.entry, model=existing.model,
                                created_at=existing.created_at)
    try:
        data = await tutor.draft_term(ai, bundle, word=body.word, context=body.context)
    except AIError as e:
        raise HTTPException(502, str(e)) from e
    model = data.pop("model", None)
    g = GeneratedTerm(id=slug, word=data.get("word") or body.word, entry=data, model=model, created_at=utcnow())
    db.add(g)
    service.record_event(db, "term_drafted", term_id=slug, data={"word": g.word})
    db.commit()
    return GeneratedTermOut(id=g.id, word=g.word, entry=g.entry, model=g.model, created_at=g.created_at)


@router.get("/dictionary/{term_id}", response_model=TermOut)
def get_term(term_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> TermOut:
    term = bundle.terms.get(term_id)
    if term is None:
        raise HTTPException(404, f"Unknown term '{term_id}'")
    return TermOut(term=term, state=term_summary(bundle, term_id, db.get(TermState, term_id)),
                   introduced_in=node_out(bundle, term.introduced_in))


@router.post("/dictionary/{term_id}/viewed", response_model=TermSummary)
def term_viewed(term_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> TermSummary:
    if term_id not in bundle.terms:
        raise HTTPException(404, f"Unknown term '{term_id}'")
    ts = db.get(TermState, term_id)
    if ts is None:
        ts = TermState(term_id=term_id, lookups=0, learned=False)
        db.add(ts)
    ts.lookups += 1
    ts.last_lookup_at = utcnow()
    service.record_event(db, "term_viewed", term_id=term_id)
    db.commit()
    return term_summary(bundle, term_id, ts)
