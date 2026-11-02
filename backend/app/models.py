"""Persistent learner model and learning history.

Only portable SQLAlchemy types are used (String, Integer, Float, Boolean,
DateTime, JSON) so the schema migrates unchanged from SQLite to PostgreSQL.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


class ConceptState(Base):
    """Where the learner stands with one concept (one curriculum node)."""

    __tablename__ = "concept_states"

    lesson_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    # not_started | introduced | understood | mastered | needs_revision
    state: Mapped[str] = mapped_column(String(20), default="not_started")
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pass_count: Mapped[int] = mapped_column(Integer, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    best_score: Mapped[float | None] = mapped_column(Float)
    last_score: Mapped[float | None] = mapped_column(Float)
    revision_reason: Mapped[str | None] = mapped_column(Text)
    tested_out: Mapped[bool] = mapped_column(Boolean, default=False)


class LearningEvent(Base):
    """Append-only learning history."""

    __tablename__ = "learning_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    lesson_id: Mapped[str | None] = mapped_column(String(120), index=True)
    term_id: Mapped[str | None] = mapped_column(String(120))
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class AssessmentAttempt(Base):
    __tablename__ = "assessment_attempts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    lesson_id: Mapped[str] = mapped_column(String(120), index=True)
    mode: Mapped[str] = mapped_column(String(20), default="lesson")  # lesson | test_out | review
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    questions: Mapped[list] = mapped_column(JSON)  # materialised questions incl. answers
    score: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)

    responses: Mapped[list["QuestionResponse"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan", order_by="QuestionResponse.id"
    )


class QuestionResponse(Base):
    __tablename__ = "question_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attempt_id: Mapped[str] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"))
    lesson_id: Mapped[str] = mapped_column(String(120), index=True)
    question_id: Mapped[str] = mapped_column(String(120))
    try_number: Mapped[int] = mapped_column(Integer, default=1)
    answer: Mapped[dict] = mapped_column(JSON)
    correct: Mapped[bool] = mapped_column(Boolean)
    credit: Mapped[float] = mapped_column(Float, default=0.0)
    diagnosis: Mapped[str | None] = mapped_column(Text)
    revisit: Mapped[str | None] = mapped_column(String(120))
    graded_by: Mapped[str] = mapped_column(String(20), default="rule")  # rule | ai | self
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    attempt: Mapped[AssessmentAttempt] = relationship(back_populates="responses")


class TermState(Base):
    """A word in the learner's personal dictionary."""

    __tablename__ = "term_states"

    term_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    first_seen_lesson: Mapped[str | None] = mapped_column(String(120))
    lookups: Mapped[int] = mapped_column(Integer, default=0)
    last_lookup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    learned: Mapped[bool] = mapped_column(Boolean, default=False)


class ExerciseCompletion(Base):
    __tablename__ = "exercise_completions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lesson_id: Mapped[str] = mapped_column(String(120), index=True)
    exercise: Mapped[str] = mapped_column(String(60))  # "experiment" or a practice generator
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class PracticeItem(Base):
    """A generated practice question awaiting (or holding) an answer."""

    __tablename__ = "practice_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    generator: Mapped[str] = mapped_column(String(60))
    lesson_id: Mapped[str | None] = mapped_column(String(120))
    question: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    answered_correctly: Mapped[bool | None] = mapped_column(Boolean)


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    mode: Mapped[str] = mapped_column(String(20), default="teaching")  # teaching | research
    lesson_id: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan", order_by="ChatMessage.id"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    structured: Mapped[dict | None] = mapped_column(JSON)
    context: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    thread: Mapped[ChatThread] = relationship(back_populates="messages")


class GeneratedTerm(Base):
    """A dictionary entry drafted by the AI for a word not yet in the curated dictionary."""

    __tablename__ = "generated_terms"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    word: Mapped[str] = mapped_column(String(200))
    entry: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    model: Mapped[str | None] = mapped_column(String(80))


class Wondering(Base):
    """A question the learner wants to explore later (feeds the research labs)."""

    __tablename__ = "wonderings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text)
    lesson_id: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | exploring | answered
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
