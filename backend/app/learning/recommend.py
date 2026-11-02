"""Use the prerequisite graph to decide what to teach next."""

from __future__ import annotations

from dataclasses import dataclass

from ..content.loader import ContentBundle
from .mastery import KNOWN


@dataclass
class Readiness:
    lesson_id: str
    ready: bool
    missing: list[str]  # prerequisites (direct or indirect) not yet understood, in teaching order
    direct_missing: list[str]


def readiness(bundle: ContentBundle, lesson_id: str, states: dict[str, str]) -> Readiness:
    """Which earlier concepts does this lesson need that are not yet understood?

    We walk back through the prerequisite graph but stop at concepts that are
    already understood: a known concept vouches for its own prerequisites, so
    the learner is never sent back to repeat material they have shown they
    know.
    """
    node = bundle.nodes[lesson_id]
    direct = [p for p in node.pre if states.get(p) not in KNOWN]
    missing: set[str] = set()
    stack = list(direct)
    while stack:
        cur = stack.pop()
        if cur in missing:
            continue
        missing.add(cur)
        for p in bundle.nodes[cur].pre:
            if states.get(p) not in KNOWN:
                stack.append(p)
    ordered = [i for i in bundle.order if i in missing]
    return Readiness(lesson_id, ready=not direct, missing=ordered, direct_missing=direct)


def next_lessons(bundle: ContentBundle, states: dict[str, str], limit: int = 3) -> list[str]:
    """Available lessons whose prerequisites are all understood, in teaching order."""
    out: list[str] = []
    for lid in bundle.order:
        if lid not in bundle.lessons:
            continue
        if states.get(lid) in KNOWN:
            continue
        if all(states.get(p) in KNOWN for p in bundle.nodes[lid].pre):
            out.append(lid)
            if len(out) >= limit:
                break
    return out


def frontier_planned(bundle: ContentBundle, states: dict[str, str], limit: int = 5) -> list[str]:
    """Planned (not yet written) lessons whose prerequisites are understood."""
    out: list[str] = []
    for lid in bundle.order:
        if lid in bundle.lessons or states.get(lid) in KNOWN:
            continue
        if all(states.get(p) in KNOWN for p in bundle.nodes[lid].pre):
            out.append(lid)
            if len(out) >= limit:
                break
    return out


def path_progress(bundle: ContentBundle, target: str, states: dict[str, str]) -> dict[str, int]:
    chain = bundle.ancestors(target) + [target]
    known = sum(1 for i in chain if states.get(i) in KNOWN)
    mastered = sum(1 for i in chain if states.get(i) == "mastered")
    return {"total": len(chain), "known": known, "mastered": mastered}
