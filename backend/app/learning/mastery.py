"""The learner model: how each concept moves between knowledge states.

States
------
``not_started``    never opened.
``introduced``     the lesson has been opened (or attempted) but not yet passed.
``understood``     the assessment was passed once.
``mastered``       passed again, with a high score, on a later day - knowledge
                   that survives a gap is far more reliable than knowledge
                   shown once.
``needs_revision`` previously understood or mastered, but a later failed
                   assessment or a diagnosed mistake suggests it has slipped.

The rules are deliberately simple and transparent so the learner can see
exactly why a concept is in a given state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

KNOWN = {"understood", "mastered"}
MASTERY_SCORE = 0.9
MASTERY_GAP = timedelta(hours=20)
# Review schedule (spaced repetition) indexed by number of passes so far.
REVIEW_INTERVALS = [timedelta(days=1), timedelta(days=3), timedelta(days=7), timedelta(days=16), timedelta(days=35)]


@dataclass
class StateView:
    state: str = "not_started"
    pass_count: int = 0
    last_passed_at: datetime | None = None
    best_score: float | None = None


def on_open(s: StateView) -> str:
    return "introduced" if s.state == "not_started" else s.state


def on_assessment(s: StateView, score: float, pass_score: float, now: datetime) -> tuple[str, str | None]:
    """Return (new_state, reason) after an assessment with the given score."""
    passed = score >= pass_score
    if passed:
        if s.state == "mastered":
            return "mastered", None
        if (
            s.state in ("understood", "needs_revision")
            and s.last_passed_at is not None
            and now - s.last_passed_at >= MASTERY_GAP
            and score >= MASTERY_SCORE
        ):
            return "mastered", "Passed again with a high score on a later day."
        return "understood", None
    if s.state in KNOWN:
        return "needs_revision", f"A later assessment scored {round(score * 100)}%."
    return ("introduced" if s.state == "not_started" else s.state), None


def on_diagnosed_gap(s: StateView, reason: str) -> tuple[str, str | None]:
    """A mistake elsewhere points back at this concept."""
    if s.state in KNOWN:
        return "needs_revision", reason
    return s.state, None


def review_due(s: StateView, now: datetime) -> bool:
    if s.state not in KNOWN or s.last_passed_at is None:
        return False
    idx = min(max(s.pass_count - 1, 0), len(REVIEW_INTERVALS) - 1)
    if s.state == "mastered":
        idx = len(REVIEW_INTERVALS) - 1
    return now - s.last_passed_at >= REVIEW_INTERVALS[idx]
