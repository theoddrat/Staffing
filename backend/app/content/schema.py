"""Typed schema for all curriculum content.

Content lives as YAML files in the repository's ``content/`` directory and is
validated against these models when the backend starts (and in the test
suite).  Every lesson is a separate structured unit; the curriculum graph is
the single source of truth for titles and prerequisites.

Rich text fields use a small markup language understood by the frontend:

* ``$...$`` inline mathematics (KaTeX), ``$$...$$`` display mathematics
* ``[[term-id]]`` or ``[[term-id|shown words]]`` link to a dictionary entry
* ``[[lesson:lesson-id|shown words]]`` link to a lesson
* ``**bold**``, ``*italic*``, blank-line paragraphs, ``- `` bullet lists,
  ``1. `` numbered lists and ``### `` sub-headings
* ``\\$`` produces a literal dollar sign
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ID_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class Strict(BaseModel):
    """Base model that rejects unknown keys so typos in YAML are caught."""

    model_config = ConfigDict(extra="forbid")


Goal = Literal["pnp", "rh"]


class StatementKind(str, Enum):
    """Part 7 of the specification: every mathematical statement is classified."""

    definition = "definition"
    established_fact = "established-fact"
    proven_theorem = "proven-theorem"
    conjecture = "conjecture"
    computational_observation = "computational-observation"
    hypothesis = "hypothesis"
    speculation = "speculation"
    disproved_claim = "disproved-claim"
    unverified_proof = "unverified-proof"
    formally_verified_proof = "formally-verified-proof"
    convention = "convention"  # an agreed choice of notation or naming


# ---------------------------------------------------------------------------
# Curriculum graph
# ---------------------------------------------------------------------------


class Module(Strict):
    id: str = Field(pattern=ID_PATTERN)
    title: str
    why: str
    goals: list[Goal] = []


class Stage(Strict):
    """A level of the curriculum (L0-L12) or one of the two research paths."""

    id: str
    kind: Literal["level", "path"]
    number: int | None = None
    title: str
    summary: str
    why: str
    goals: list[Goal] = []
    modules: list[Module] = []
    target: str | None = None  # for paths: the destination lesson id


class LessonNode(Strict):
    id: str = Field(pattern=ID_PATTERN)
    stage: str
    module: str | None = None
    title: str
    summary: str
    pre: list[str] = []
    goals: list[Goal] = []


class Curriculum(Strict):
    stages: list[Stage]
    lessons: list[LessonNode]


# ---------------------------------------------------------------------------
# Widgets (interactive and static visuals rendered by the frontend)
# ---------------------------------------------------------------------------


class WidgetSpec(Strict):
    id: str = Field(pattern=ID_PATTERN)
    title: str
    description: str
    props: list[str] = []
    goals: list[str] = []


class WidgetRegistry(Strict):
    widgets: list[WidgetSpec]


class WidgetRef(Strict):
    widget: str
    props: dict[str, Any] = {}


class Visual(WidgetRef):
    caption: str  # "What you are seeing" - every visual must be explained
    prompt: str | None = None  # an optional invitation: "Try ..."


# ---------------------------------------------------------------------------
# Dictionary
# ---------------------------------------------------------------------------


class UseLater(Strict):
    lesson: str
    how: str


class TermVisual(WidgetRef):
    caption: str


class Term(Strict):
    """A personal-dictionary entry. All ten fields from Part 1.3 are required."""

    id: str = Field(pattern=ID_PATTERN)
    word: str  # 1. the mathematical word
    pronunciation: str  # 2. how to say it
    plain: str  # 3. simplest possible meaning
    analogy: str  # 4. everyday analogy
    visual: TermVisual  # 5. visual representation
    formal: str  # 6. formal definition
    example: str  # 7. an example
    non_example: str  # 8. a non-example
    related: list[str] = []  # 9. related words (term ids)
    used_later: list[UseLater] = Field(min_length=1)  # 10. where it is used later
    introduced_in: str
    aliases: list[str] = []  # other spellings/plurals used for automatic linking
    symbol: str | None = None  # LaTeX for the symbol, if the idea has one
    formal_kind: StatementKind = StatementKind.definition


class DictionaryFile(Strict):
    terms: list[Term]


# ---------------------------------------------------------------------------
# Lessons
# ---------------------------------------------------------------------------


class Example(Strict):
    title: str
    problem: str
    steps: list[str] = Field(min_length=1)
    answer: str
    visual: Visual | None = None


class WordIntro(Strict):
    terms: list[str] = Field(min_length=1)
    text: str


class SymbolIntro(Strict):
    symbol: str  # LaTeX
    name: str
    looks_like: str
    means: str
    why: str
    read_aloud: str


class GlossaryItem(Strict):
    word: str
    meaning: str


class FormalDefinition(Strict):
    statement: str
    kind: StatementKind = StatementKind.definition
    glossary: list[GlossaryItem] = Field(min_length=1)


class NotationPart(Strict):
    symbol: str  # LaTeX for the piece being explained
    meaning: str


class NotationLine(Strict):
    expression: str  # LaTeX
    read_aloud: str
    parts: list[NotationPart] = Field(min_length=1)
    english: str


class Connection(Strict):
    lesson: str
    how: str


class Experiment(Strict):
    widget: str
    props: dict[str, Any] = {}
    task: str
    goal: dict[str, Any] | None = None
    success: str  # shown when the goal is reached: what to notice


class Mistake(Strict):
    mistake: str
    why: str
    fix: str


class Statement(Strict):
    kind: StatementKind
    text: str
    note: str | None = None


AlternativeStrategy = Literal[
    "story",
    "everyday-objects",
    "visual",
    "smaller-steps",
    "eli5",
    "contrast",
    "history",
    "physical-activity",
    "question-led",
]


class Alternative(Strict):
    strategy: AlternativeStrategy
    title: str
    text: str
    visual: Visual | None = None


UnderstandingKind = Literal["recall", "explain", "solve", "counterexample", "predict", "apply"]


class WrongAnswer(Strict):
    answer: str
    diagnosis: str
    revisit: str | None = None


class QuestionBase(Strict):
    id: str = Field(pattern=ID_PATTERN)
    kind: UnderstandingKind
    prompt: str
    hint: str | None = None
    explanation: str
    visual: Visual | None = None


class ChoiceOption(Strict):
    text: str
    correct: bool = False
    diagnosis: str | None = None
    revisit: str | None = None


class ChoiceQuestion(QuestionBase):
    type: Literal["choice"]
    options: list[ChoiceOption] = Field(min_length=2)
    multi: bool = False

    @model_validator(mode="after")
    def _check_correct(self) -> "ChoiceQuestion":
        n = sum(1 for o in self.options if o.correct)
        if n == 0:
            raise ValueError(f"question {self.id}: no correct option")
        if n > 1 and not self.multi:
            raise ValueError(f"question {self.id}: several correct options but multi is false")
        return self


class NumberQuestion(QuestionBase):
    type: Literal["number"]
    answer: str  # exact value: "7", "-3", "3/4", "0.25"
    tolerance: float | None = None
    unit: str | None = None
    common_wrong: list[WrongAnswer] = []


class TextQuestion(QuestionBase):
    type: Literal["text"]
    accept: list[str] = Field(min_length=1)
    common_wrong: list[WrongAnswer] = []
    # "words": case/punctuation-insensitive; "math": keeps symbols, ignores spaces
    mode: Literal["words", "math"] = "words"


class TrueFalseQuestion(QuestionBase):
    type: Literal["truefalse"]
    answer: bool
    diagnosis: str | None = None  # shown when the learner picks the wrong value
    revisit: str | None = None


class OrderQuestion(QuestionBase):
    type: Literal["order"]
    items: list[str] = Field(min_length=2)  # listed in the correct order
    order_label: str = "smallest to largest"


class ExplainQuestion(QuestionBase):
    type: Literal["explain"]
    rubric: list[str] = Field(min_length=1)  # key ideas a good answer contains
    model_answer: str


class GeneratedQuestion(Strict):
    """A question template whose numbers are generated fresh for every attempt."""

    id: str = Field(pattern=ID_PATTERN)
    type: Literal["generated"]
    generator: str
    params: dict[str, Any] = {}


Question = Annotated[
    Union[
        ChoiceQuestion,
        NumberQuestion,
        TextQuestion,
        TrueFalseQuestion,
        OrderQuestion,
        ExplainQuestion,
        GeneratedQuestion,
    ],
    Field(discriminator="type"),
]


class Assessment(Strict):
    pass_score: float = Field(default=0.7, ge=0.0, le=1.0)
    questions: list[Question] = Field(min_length=3)

    @field_validator("questions")
    @classmethod
    def _unique_ids(cls, qs: list[Any]) -> list[Any]:
        ids = [q.id for q in qs]
        if len(ids) != len(set(ids)):
            raise ValueError(f"duplicate question ids: {ids}")
        return qs


class Lesson(Strict):
    """A complete lesson unit (Part 4.1 format + Part 1.1 ten-step principle)."""

    id: str = Field(pattern=ID_PATTERN)
    estimated_minutes: int = 15
    # 1-3: what, why, what problem
    goal: str
    why: str
    problem: str
    # Step 1: ordinary-language meaning
    plain: str
    # Step 2: everyday analogy
    analogy: Alternative
    # Step 3: visual explanation
    visual: Visual
    # Step 4: examples
    example_simple: Example
    example_harder: Example
    # Step 5: the mathematical word
    word: WordIntro
    # Step 6: the symbol(s), if the idea has one
    symbols: list[SymbolIntro] = []
    no_symbol_note: str | None = None
    # Step 7: the formal definition
    formal: FormalDefinition
    # Formal notation, symbol by symbol
    notation: list[NotationLine] = []
    # Step 8: connections to previous knowledge
    connections_back: list[Connection] = []
    # Worked problem
    worked: Example
    # Step 9: experiment
    experiment: Experiment
    # Common mistakes
    mistakes: list[Mistake] = Field(min_length=1)
    # Classified statements (Part 7)
    statements: list[Statement] = []
    # Step 10: check understanding
    assessment: Assessment
    # Connection to future subjects
    connections_forward: list[Connection] = Field(min_length=1)
    # Different teaching strategies for the "I don't understand" button
    alternatives: list[Alternative] = Field(min_length=2)
    # Practice generators offered after the lesson
    practice: list[str] = []

    @model_validator(mode="after")
    def _symbols_or_note(self) -> "Lesson":
        if not self.symbols and not self.no_symbol_note:
            raise ValueError(
                f"lesson {self.id}: give at least one symbol or a no_symbol_note explaining why there is none"
            )
        strategies = [a.strategy for a in self.alternatives]
        if len(strategies) != len(set(strategies)):
            raise ValueError(f"lesson {self.id}: alternatives must each use a different strategy")
        return self


LESSON_SECTIONS: list[str] = [
    "goal",
    "plain",
    "analogy",
    "visual",
    "examples",
    "word",
    "symbol",
    "formal",
    "notation",
    "connections",
    "worked",
    "experiment",
    "mistakes",
    "assessment",
    "forward",
]
