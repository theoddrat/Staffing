"""The AI teaching engine: context building, structured schemas and checks.

The tutor sees a compact model of the learner (what they have understood,
what needs revision, their recent mistakes, the words in their dictionary)
so it can follow the new-language principle - never using a word or symbol
the learner has not been taught.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..content.loader import LINK_RE, ContentBundle
from ..content.schema import StatementKind
from .provider import AIProvider

PROMPT_DIR = Path(__file__).parent / "prompts"

STRATEGIES = [
    "plain-language", "everyday-analogy", "visual", "worked-example", "story", "eli5", "contrast",
    "smaller-steps", "question-led", "history", "physical-activity", "formal", "other",
]
KINDS = [k.value for k in StatementKind]


@lru_cache
def load_prompt(name: str) -> str:
    return (PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")


def _strict(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


STATEMENTS_SCHEMA = {
    "type": "array",
    "items": _strict({"kind": {"type": "string", "enum": KINDS}, "text": {"type": "string"}}),
}

CHAT_SCHEMA = _strict({
    "reply": {"type": "string", "description": "The answer to the learner, in the formatting described."},
    "strategy": {"type": "string", "enum": STRATEGIES},
    "check_question": {"type": "string", "description": "One short question checking understanding, or empty."},
    "missing_prerequisites": {"type": "array", "items": {"type": "string"}},
    "new_terms": {"type": "array", "items": {"type": "string"}},
    "statements": STATEMENTS_SCHEMA,
})

EXPLAIN_SCHEMA = _strict({
    "strategy": {"type": "string", "enum": STRATEGIES},
    "title": {"type": "string"},
    "explanation": {"type": "string"},
    "check_question": {"type": "string"},
})

GRADE_SCHEMA = _strict({
    "rubric_met": {"type": "array", "items": {"type": "boolean"}},
    "feedback": {"type": "string", "description": "Kind, specific feedback in plain language."},
    "misconception": {"type": "string", "description": "A misconception the answer reveals, or empty."},
})

TERM_SCHEMA = _strict({
    "word": {"type": "string"},
    "pronunciation": {"type": "string"},
    "plain": {"type": "string"},
    "analogy": {"type": "string"},
    "visual_description": {"type": "string"},
    "formal": {"type": "string"},
    "example": {"type": "string"},
    "non_example": {"type": "string"},
    "related": {"type": "array", "items": {"type": "string"}},
    "used_later": {"type": "string"},
    "is_mathematical_term": {"type": "boolean"},
})


# --------------------------------------------------------------------------- context


def stable_context(bundle: ContentBundle) -> str:
    """Large, rarely changing context: dictionary and lesson indexes (cached by the API)."""
    terms = "\n".join(f"- {t.id}: {t.word}" for t in bundle.terms.values())
    lessons = "\n".join(
        f"- {lid}: {bundle.nodes[lid].title}{'' if lid in bundle.lessons else ' (planned)'}" for lid in bundle.order
    )
    return f"## Dictionary index (term id: word)\n{terms}\n\n## Lesson index (lesson id: title)\n{lessons}\n"


def learner_context(
    bundle: ContentBundle,
    states: dict[str, str],
    *,
    lesson_id: str | None = None,
    section: str | None = None,
    known_terms: list[str] | None = None,
    mistakes: list[str] | None = None,
) -> str:
    known = [i for i in bundle.order if states.get(i) in ("understood", "mastered")]
    revision = [i for i in bundle.order if states.get(i) == "needs_revision"]
    parts = ["## The learner right now"]
    parts.append("Lessons understood or mastered: " + (", ".join(known) if known else "none yet - treat the learner as a complete beginner"))
    if revision:
        parts.append("Lessons needing revision: " + ", ".join(revision))
    if known_terms is not None:
        parts.append("Dictionary words the learner has met: " + (", ".join(known_terms) if known_terms else "none yet"))
    if mistakes:
        parts.append("Recent mistakes (diagnoses):\n" + "\n".join(f"- {m}" for m in mistakes[:8]))
    if lesson_id and lesson_id in bundle.nodes:
        node = bundle.nodes[lesson_id]
        parts.append(f"\n## Current lesson: {node.title} ({lesson_id})")
        parts.append(f"Learner's state for this lesson: {states.get(lesson_id, 'not_started')}")
        if section:
            parts.append(f"The learner is looking at the '{section}' section.")
        lesson = bundle.lessons.get(lesson_id)
        if lesson:
            parts.append(f"Goal: {lesson.goal.strip()}")
            parts.append(f"Plain explanation used in the lesson:\n{lesson.plain.strip()}")
            parts.append(f"Formal statement: {lesson.formal.statement.strip()}")
            parts.append("Strategies the lesson already uses: " + ", ".join(
                [lesson.analogy.strategy] + [a.strategy for a in lesson.alternatives]))
        else:
            parts.append(f"This lesson is planned but not yet written. Summary: {node.summary}")
        if node.pre:
            parts.append("Its prerequisites: " + ", ".join(f"{p} ({states.get(p, 'not_started')})" for p in node.pre))
    return "\n".join(parts)


def system_blocks(bundle: ContentBundle, mode: str, learner: str) -> list[dict[str, Any]]:
    prompt = load_prompt("research" if mode == "research" else "teaching")
    return [
        {"type": "text", "text": prompt + "\n\n" + stable_context(bundle), "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": learner},
    ]


# --------------------------------------------------------------------------- sanitising


def sanitize_links(text: str, bundle: ContentBundle) -> str:
    """Replace links to unknown terms or lessons with their plain words."""

    def repl(m: re.Match[str]) -> str:
        target, label = m.group(1).strip(), m.group(2)
        if target.startswith("lesson:"):
            ok = target[len("lesson:"):] in bundle.nodes
        else:
            ok = target in bundle.terms
        if ok:
            return m.group(0)
        return label if label else target.removeprefix("lesson:")

    return LINK_RE.sub(repl, text)


def clean_reply(data: dict[str, Any], bundle: ContentBundle) -> dict[str, Any]:
    out = dict(data)
    for key in ("reply", "explanation", "check_question", "feedback", "title"):
        if isinstance(out.get(key), str):
            out[key] = sanitize_links(out[key], bundle)
    if "missing_prerequisites" in out:
        out["missing_prerequisites"] = [p for p in out["missing_prerequisites"] if p in bundle.nodes][:6]
    if "statements" in out:
        out["statements"] = [s for s in out["statements"] if s.get("kind") in KINDS][:10]
    return out


# --------------------------------------------------------------------------- operations


async def chat(
    provider: AIProvider,
    bundle: ContentBundle,
    *,
    mode: str,
    learner: str,
    history: list[dict[str, str]],
    user_text: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Answer one learner message. Earlier turns are replayed as plain text only."""
    messages = [{"role": m["role"], "content": m["content"]} for m in history[-20:]]
    messages.append({"role": "user", "content": user_text})
    result = await provider.structured(
        system=system_blocks(bundle, mode, learner), messages=messages, schema=CHAT_SCHEMA, use_calculator=True
    )
    meta = {"model": result.model, "tool_calls": result.tool_calls}
    return clean_reply(result.data, bundle), meta


async def explain_differently(
    provider: AIProvider, bundle: ContentBundle, *, learner: str, lesson_id: str, section: str | None, tried: list[str]
) -> dict[str, Any]:
    lesson = bundle.lessons.get(lesson_id)
    node = bundle.nodes[lesson_id]
    ask = (
        f"The learner pressed \"I don't understand\" while studying '{node.title}'"
        + (f", in the '{section}' section" if section else "")
        + ". These teaching strategies have already been tried and did not work: "
        + (", ".join(tried) if tried else "the lesson's main explanation")
        + ". Explain the core idea again using a genuinely different strategy, in very simple language, "
        "following the new-language principle. Keep it under 250 words, and end with one short check question."
    )
    if lesson:
        ask += f"\n\nThe idea being taught: {lesson.goal.strip()}"
    result = await provider.structured(
        system=system_blocks(bundle, "teaching", learner),
        messages=[{"role": "user", "content": ask}],
        schema=EXPLAIN_SCHEMA,
        use_calculator=True,
    )
    return clean_reply(result.data, bundle) | {"model": result.model}


async def grade_explanation(
    provider: AIProvider, bundle: ContentBundle, *, question: dict[str, Any], answer_text: str
) -> dict[str, Any]:
    rubric = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(question["rubric"]))
    ask = (
        "Grade a beginner's explanation against a rubric. Judge meaning, not wording: credit an idea if the learner "
        "expresses it in their own words, even informally. Do not credit ideas that are absent or wrong.\n\n"
        f"Question: {question['prompt']}\n\nRubric (key ideas):\n{rubric}\n\n"
        f"Model answer (for reference only): {question['model_answer']}\n\n"
        f"Learner's answer:\n<<<\n{answer_text}\n>>>\n\n"
        "Return one boolean per rubric item in order, short encouraging feedback that names what was good and what "
        "is missing, and any misconception revealed (or an empty string)."
    )
    result = await provider.structured(
        system=[{"type": "text", "text": load_prompt("teaching")}],
        messages=[{"role": "user", "content": ask}],
        schema=GRADE_SCHEMA,
        max_tokens=4000,
    )
    data = clean_reply(result.data, bundle)
    met = [bool(x) for x in data.get("rubric_met", [])][: len(question["rubric"])]
    met += [False] * (len(question["rubric"]) - len(met))
    data["rubric_met"] = met
    return data | {"model": result.model}


async def draft_term(provider: AIProvider, bundle: ContentBundle, *, word: str, context: str | None) -> dict[str, Any]:
    ask = (
        f"Write a dictionary entry for the mathematical word \"{word}\" for a learner starting from the foundations."
        + (f" The learner met it here: {context}" if context else "")
        + " Give every field. The plain meaning must use no technical words. The formal definition must be correct "
        "and standard. If the word is not a mathematical term, set is_mathematical_term to false. Do not invent "
        "facts; if a field cannot be filled honestly, say so in that field."
    )
    result = await provider.structured(
        system=[{"type": "text", "text": load_prompt("teaching") + "\n\n" + stable_context(bundle),
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": ask}],
        schema=TERM_SCHEMA,
        max_tokens=6000,
    )
    return clean_reply(result.data, bundle) | {"model": result.model}
