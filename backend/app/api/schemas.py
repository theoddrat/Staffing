"""Request and response models for the HTTP API (also the source of the TypeScript types)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..content.schema import Lesson, Term, TermVisual, Visual

State = Literal["not_started", "introduced", "understood", "mastered", "needs_revision"]


class NodeOut(BaseModel):
    id: str
    stage: str
    module: str | None = None
    title: str
    summary: str
    pre: list[str]
    goals: list[str]
    feeds: list[str]
    available: bool
    order: int


class ModuleOut(BaseModel):
    id: str
    title: str
    why: str
    goals: list[str]


class StageOut(BaseModel):
    id: str
    kind: Literal["level", "path"]
    number: int | None
    title: str
    summary: str
    why: str
    goals: list[str]
    modules: list[ModuleOut]
    target: str | None


class CurriculumOut(BaseModel):
    stages: list[StageOut]
    lessons: list[NodeOut]


class ConceptStateOut(BaseModel):
    lesson_id: str
    state: State
    first_seen_at: datetime | None = None
    updated_at: datetime | None = None
    last_passed_at: datetime | None = None
    pass_count: int = 0
    attempt_count: int = 0
    best_score: float | None = None
    last_score: float | None = None
    revision_reason: str | None = None
    tested_out: bool = False


class AssessmentInfo(BaseModel):
    pass_score: float
    question_count: int


class LessonPublic(Lesson):
    """A lesson as sent to the browser: the assessment answers are removed."""

    assessment: AssessmentInfo  # type: ignore[assignment]


class ReadinessOut(BaseModel):
    ready: bool
    missing: list[NodeOut]
    direct_missing: list[str]


class TermSummary(BaseModel):
    id: str
    word: str
    plain: str
    symbol: str | None
    introduced_in: str
    aliases: list[str]
    link_forms: list[str]
    seen: bool
    learned: bool
    lookups: int
    ai_generated: bool = False


class LessonOut(BaseModel):
    node: NodeOut
    lesson: LessonPublic
    state: ConceptStateOut
    readiness: ReadinessOut
    terms: list[TermSummary]
    prerequisites: list[NodeOut]
    unlocks: list[NodeOut]


class TermOut(BaseModel):
    term: Term
    state: TermSummary
    introduced_in: NodeOut


class GeneratedTermOut(BaseModel):
    id: str
    word: str
    entry: dict[str, Any]
    model: str | None
    created_at: datetime


class OpenLessonOut(BaseModel):
    state: ConceptStateOut
    new_terms: list[str]
    readiness: ReadinessOut


class LessonEventIn(BaseModel):
    type: Literal["section_viewed", "experiment_completed", "example_viewed", "dont_understand", "lesson_completed"]
    data: dict[str, Any] = {}


class ExplainDifferentlyIn(BaseModel):
    section: str | None = None
    seen: list[str] = []  # strategies already shown
    use_ai: bool = False


class AlternativeOut(BaseModel):
    source: Literal["authored", "ai", "none"]
    strategy: str | None = None
    title: str | None = None
    text: str | None = None
    visual: Visual | None = None
    check_question: str | None = None
    remaining_authored: int = 0
    ai_available: bool = False
    message: str | None = None


class OptionPublic(BaseModel):
    id: str
    text: str


class QuestionPublic(BaseModel):
    id: str
    type: Literal["choice", "number", "text", "truefalse", "order", "explain"]
    kind: str
    prompt: str
    hint: str | None = None
    visual: Visual | None = None
    options: list[OptionPublic] | None = None
    multi: bool | None = None
    unit: str | None = None
    items: list[str] | None = None
    order_label: str | None = None
    rubric_count: int | None = None
    mode: str | None = None
    max_tries: int
    generated_from: str | None = None


class ResponseOut(BaseModel):
    question_id: str
    try_number: int
    correct: bool
    credit: float
    diagnosis: str | None
    revisit: str | None
    graded_by: str
    answer: dict[str, Any]


class QuestionProgress(BaseModel):
    question_id: str
    tries: int
    done: bool
    correct: bool
    credit: float
    reveal: dict[str, Any] | None = None


class AttemptOut(BaseModel):
    id: str
    lesson_id: str
    mode: str
    pass_score: float
    started_at: datetime
    finished_at: datetime | None
    score: float | None
    passed: bool | None
    questions: list[QuestionPublic]
    progress: list[QuestionProgress]


class StartAttemptIn(BaseModel):
    mode: Literal["lesson", "test_out", "review"] = "lesson"


class AnswerIn(BaseModel):
    question_id: str
    answer: dict[str, Any]


class AnswerOut(BaseModel):
    valid: bool
    correct: bool
    credit: float
    try_number: int
    tries_left: int
    done: bool
    message: str | None = None
    diagnosis: str | None = None
    revisit: NodeOut | None = None
    hint: str | None = None
    reveal: dict[str, Any] | None = None
    graded_by: str = "rule"
    feedback: str | None = None
    rubric_met: list[bool] | None = None


class QuestionResult(BaseModel):
    question_id: str
    prompt: str
    correct: bool
    credit: float
    tries: int


class AttemptSummary(BaseModel):
    attempt_id: str
    lesson_id: str
    score: float
    passed: bool
    pass_score: float
    state_before: str
    state_after: str
    results: list[QuestionResult]
    revisit: list[NodeOut]
    next: list[NodeOut]
    learned_terms: list[str]


class StageProgress(BaseModel):
    id: str
    total: int
    available: int
    understood: int
    mastered: int
    introduced: int


class PathProgress(BaseModel):
    id: str
    title: str
    target: str
    total: int
    known: int
    mastered: int


class RevisionItem(BaseModel):
    lesson_id: str
    reason: str


class ProgressOut(BaseModel):
    states: dict[str, ConceptStateOut]
    counts: dict[str, int]
    stages: list[StageProgress]
    paths: list[PathProgress]
    vocabulary: dict[str, int]
    exercises_completed: int
    assessments_passed: int
    next: list[str]
    revision: list[RevisionItem]
    review_due: list[str]
    frontier_planned: list[str]
    last_lesson: str | None


class EventOut(BaseModel):
    id: int
    created_at: datetime
    type: str
    lesson_id: str | None
    term_id: str | None
    data: dict[str, Any]


class MistakeOut(BaseModel):
    lesson_id: str
    question_id: str
    diagnosis: str
    revisit: str | None
    count: int
    last_at: datetime


class GeneratorOut(BaseModel):
    id: str
    title: str
    lesson: str


class PracticeIn(BaseModel):
    lesson_id: str | None = None
    params: dict[str, Any] = {}


class PracticeOut(BaseModel):
    id: str
    generator: str
    question: QuestionPublic


class PracticeAnswerIn(BaseModel):
    answer: dict[str, Any]


class AIStatus(BaseModel):
    configured: bool
    provider: str
    model: str | None
    reason: str | None


class StatementOut(BaseModel):
    kind: str
    text: str


class MessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    strategy: str | None = None
    check_question: str | None = None
    missing_prerequisites: list[NodeOut] = []
    new_terms: list[str] = []
    statements: list[StatementOut] = []
    tool_calls: list[dict[str, Any]] = []
    error: str | None = None


class ThreadSummary(BaseModel):
    id: str
    title: str
    mode: str
    lesson_id: str | None
    created_at: datetime
    updated_at: datetime
    message_count: int


class ThreadOut(ThreadSummary):
    messages: list[MessageOut]


class ThreadIn(BaseModel):
    title: str | None = None
    mode: Literal["teaching", "research"] = "teaching"
    lesson_id: str | None = None


class ChatIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    lesson_id: str | None = None
    section: str | None = None


class DraftTermIn(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    context: str | None = Field(default=None, max_length=1000)


class WonderingIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    lesson_id: str | None = None


class WonderingPatch(BaseModel):
    status: Literal["open", "exploring", "answered"] | None = None
    note: str | None = None


class WonderingOut(BaseModel):
    id: int
    text: str
    lesson_id: str | None
    status: str
    note: str | None
    created_at: datetime
    updated_at: datetime


class HealthOut(BaseModel):
    ok: bool
    lessons_available: int
    lessons_planned: int
    terms: int
    version: str


class ResetIn(BaseModel):
    confirm: str


__all__ = [n for n in dir() if n[0].isupper()] + ["TermVisual"]
