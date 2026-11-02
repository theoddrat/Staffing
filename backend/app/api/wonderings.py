"""Wonderings: questions the learner wants to explore - the seeds of research."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..learning import service
from ..models import Wondering, utcnow
from .deps import get_db
from .schemas import WonderingIn, WonderingOut, WonderingPatch

router = APIRouter()


def _out(w: Wondering) -> WonderingOut:
    return WonderingOut(id=w.id, text=w.text, lesson_id=w.lesson_id, status=w.status, note=w.note,
                        created_at=w.created_at, updated_at=w.updated_at)


@router.get("/wonderings", response_model=list[WonderingOut])
def list_wonderings(db: Session = Depends(get_db)) -> list[WonderingOut]:
    return [_out(w) for w in db.scalars(select(Wondering).order_by(Wondering.created_at.desc()))]


@router.post("/wonderings", response_model=WonderingOut)
def add_wondering(body: WonderingIn, db: Session = Depends(get_db)) -> WonderingOut:
    w = Wondering(text=body.text.strip(), lesson_id=body.lesson_id)
    db.add(w)
    service.record_event(db, "wondering_added", lesson_id=body.lesson_id, data={"text": body.text[:200]})
    db.commit()
    db.refresh(w)
    return _out(w)


@router.patch("/wonderings/{wid}", response_model=WonderingOut)
def update_wondering(wid: int, body: WonderingPatch, db: Session = Depends(get_db)) -> WonderingOut:
    w = db.get(Wondering, wid)
    if w is None:
        raise HTTPException(404, "Unknown wondering")
    if body.status is not None:
        w.status = body.status
    if body.note is not None:
        w.note = body.note
    w.updated_at = utcnow()
    db.commit()
    return _out(w)


@router.delete("/wonderings/{wid}", status_code=204)
def delete_wondering(wid: int, db: Session = Depends(get_db)) -> None:
    w = db.get(Wondering, wid)
    if w is None:
        raise HTTPException(404, "Unknown wondering")
    db.delete(w)
    db.commit()
