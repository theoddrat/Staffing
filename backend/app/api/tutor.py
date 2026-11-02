"""The AI tutor: conversations that persist, with lesson context."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import tutor
from ..ai.provider import AIError, AIProvider, provider_status
from ..config import get_settings
from ..content.loader import ContentBundle
from ..learning import service
from ..models import ChatMessage, ChatThread, utcnow
from .deps import get_ai, get_bundle, get_db, node_out
from .schemas import AIStatus, ChatIn, MessageOut, StatementOut, ThreadIn, ThreadOut, ThreadSummary

router = APIRouter()


@router.get("/ai/status", response_model=AIStatus)
def ai_status() -> AIStatus:
    return AIStatus(**provider_status(get_settings()))


def _message_out(bundle: ContentBundle, m: ChatMessage) -> MessageOut:
    s = m.structured or {}
    return MessageOut(
        id=m.id, role=m.role, content=m.content, created_at=m.created_at, strategy=s.get("strategy"),
        check_question=s.get("check_question") or None,
        missing_prerequisites=[node_out(bundle, p) for p in s.get("missing_prerequisites", []) if p in bundle.nodes],
        new_terms=s.get("new_terms", []), statements=[StatementOut(**x) for x in s.get("statements", [])],
        tool_calls=s.get("tool_calls", []),
    )


def _summary(t: ChatThread) -> ThreadSummary:
    return ThreadSummary(id=t.id, title=t.title, mode=t.mode, lesson_id=t.lesson_id, created_at=t.created_at,
                         updated_at=t.updated_at, message_count=len(t.messages))


@router.get("/tutor/threads", response_model=list[ThreadSummary])
def list_threads(db: Session = Depends(get_db)) -> list[ThreadSummary]:
    return [_summary(t) for t in db.scalars(select(ChatThread).order_by(ChatThread.updated_at.desc()))]


@router.post("/tutor/threads", response_model=ThreadOut)
def create_thread(body: ThreadIn, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> ThreadOut:
    if body.lesson_id and body.lesson_id not in bundle.nodes:
        raise HTTPException(404, "Unknown lesson")
    title = body.title or (f"About: {bundle.nodes[body.lesson_id].title}" if body.lesson_id else "New conversation")
    t = ChatThread(title=title[:200], mode=body.mode, lesson_id=body.lesson_id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return ThreadOut(**_summary(t).model_dump(), messages=[])


@router.get("/tutor/threads/{thread_id}", response_model=ThreadOut)
def get_thread(thread_id: str, bundle: ContentBundle = Depends(get_bundle), db: Session = Depends(get_db)) -> ThreadOut:
    t = db.get(ChatThread, thread_id)
    if t is None:
        raise HTTPException(404, "Unknown conversation")
    return ThreadOut(**_summary(t).model_dump(), messages=[_message_out(bundle, m) for m in t.messages])


@router.delete("/tutor/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str, db: Session = Depends(get_db)) -> None:
    t = db.get(ChatThread, thread_id)
    if t is None:
        raise HTTPException(404, "Unknown conversation")
    db.delete(t)
    db.commit()


@router.post("/tutor/threads/{thread_id}/messages", response_model=MessageOut)
async def send_message(thread_id: str, body: ChatIn, bundle: ContentBundle = Depends(get_bundle),
                       db: Session = Depends(get_db), ai: AIProvider | None = Depends(get_ai)) -> MessageOut:
    t = db.get(ChatThread, thread_id)
    if t is None:
        raise HTTPException(404, "Unknown conversation")
    if ai is None:
        raise HTTPException(503, provider_status(get_settings())["reason"] or "The AI tutor is not configured.")
    lesson_id = body.lesson_id or t.lesson_id
    if lesson_id and lesson_id not in bundle.nodes:
        lesson_id = None
    history = [{"role": m.role, "content": m.content} for m in t.messages]
    learner = tutor.learner_context(
        bundle, service.states_map(db), lesson_id=lesson_id, section=body.section,
        known_terms=service.known_terms(db, bundle), mistakes=service.recent_mistakes(db),
    )
    try:
        data, meta = await tutor.chat(ai, bundle, mode=t.mode, learner=learner, history=history, user_text=body.content)
    except AIError as e:
        raise HTTPException(502, str(e)) from e

    now = utcnow()
    db.add(ChatMessage(thread_id=t.id, role="user", content=body.content,
                       context={"lesson_id": lesson_id, "section": body.section}, created_at=now))
    reply = ChatMessage(thread_id=t.id, role="assistant", content=data.get("reply", ""),
                        structured={**{k: v for k, v in data.items() if k != "reply"}, "tool_calls": meta["tool_calls"],
                                    "model": meta["model"]}, created_at=utcnow())
    db.add(reply)
    if t.title == "New conversation":
        t.title = body.content.strip().replace("\n", " ")[:60]
    t.updated_at = utcnow()
    service.record_event(db, "tutor_message", lesson_id=lesson_id,
                         data={"thread": t.id, "strategy": data.get("strategy"), "mode": t.mode})
    db.commit()
    db.refresh(reply)
    return _message_out(bundle, reply)
