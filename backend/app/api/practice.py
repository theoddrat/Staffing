"""Endless practice with generated, computer-checked questions."""

from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..content.loader import ContentBundle
from ..learning import grading, service
from ..learning.practice import GENERATORS, generate
from ..models import ExerciseCompletion, PracticeItem
from .deps import get_bundle, get_db, node_out
from .schemas import AnswerOut, GeneratorOut, PracticeAnswerIn, PracticeIn, PracticeOut, QuestionPublic

router = APIRouter()


@router.get("/practice/generators", response_model=list[GeneratorOut])
def generators() -> list[GeneratorOut]:
    return [GeneratorOut(id=g.id, title=g.title, lesson=g.lesson) for g in GENERATORS.values()]


@router.post("/practice/{generator_id}", response_model=PracticeOut)
def new_question(generator_id: str, body: PracticeIn, db: Session = Depends(get_db)) -> PracticeOut:
    if generator_id not in GENERATORS:
        raise HTTPException(404, "Unknown generator")
    q = generate(generator_id, random.Random(), body.params)
    q["id"] = "practice"
    grading._prepare(q, random.Random())
    item = PracticeItem(generator=generator_id, lesson_id=body.lesson_id or GENERATORS[generator_id].lesson, question=q)
    db.add(item)
    db.commit()
    return PracticeOut(id=item.id, generator=generator_id, question=QuestionPublic.model_validate(grading.public_view(q)))


@router.post("/practice/items/{item_id}/answer", response_model=AnswerOut)
def answer(item_id: str, body: PracticeAnswerIn, bundle: ContentBundle = Depends(get_bundle),
           db: Session = Depends(get_db)) -> AnswerOut:
    item = db.get(PracticeItem, item_id)
    if item is None:
        raise HTTPException(404, "Unknown practice item")
    q = item.question
    tries = q.get("_tries", 0)
    if item.answered_correctly is not None:
        raise HTTPException(409, "This question is already finished.")
    g = grading.grade(q, body.answer)
    if not g.valid:
        return AnswerOut(valid=False, correct=False, credit=0, try_number=tries + 1, tries_left=q["max_tries"] - tries,
                         done=False, message=g.message)
    tries += 1
    done = g.correct or tries >= q["max_tries"]
    item.question = {**q, "_tries": tries}
    if done:
        item.answered_correctly = g.correct
        if g.correct:
            db.add(ExerciseCompletion(lesson_id=item.lesson_id or "", exercise=item.generator, data={"tries": tries}))
        service.record_event(db, "practice_answered", lesson_id=item.lesson_id,
                             data={"generator": item.generator, "correct": g.correct, "tries": tries})
    db.commit()
    revisit = node_out(bundle, g.revisit) if g.revisit and g.revisit in bundle.nodes else None
    return AnswerOut(valid=True, correct=g.correct, credit=grading.credit_for(tries, g.correct), try_number=tries,
                     tries_left=max(q["max_tries"] - tries, 0), done=done, diagnosis=g.diagnosis, revisit=revisit,
                     hint=q.get("hint") if not done else None, reveal=grading.reveal(q) if done else None)
