"""Shared FastAPI dependencies and model converters."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..ai.provider import AIProvider, get_provider
from ..config import get_settings
from ..content.loader import ContentBundle, get_content, link_forms
from ..db import get_session
from ..learning.recommend import readiness
from ..models import ConceptState, TermState
from .schemas import ConceptStateOut, NodeOut, ReadinessOut, TermSummary


def get_bundle() -> ContentBundle:
    return get_content(str(get_settings().content_dir))


def get_db() -> Iterator[Session]:
    yield from get_session()


def get_ai() -> AIProvider | None:
    return get_provider(get_settings())


_order_cache: dict[int, dict[str, int]] = {}


def node_out(bundle: ContentBundle, lesson_id: str) -> NodeOut:
    idx = _order_cache.get(id(bundle))
    if idx is None:
        idx = {lid: i for i, lid in enumerate(bundle.order)}
        _order_cache[id(bundle)] = idx
    n = bundle.nodes[lesson_id]
    return NodeOut(
        id=n.id, stage=n.stage, module=n.module, title=n.title, summary=n.summary, pre=list(n.pre),
        goals=list(n.goals), feeds=bundle.feeds.get(n.id, []), available=n.id in bundle.lessons, order=idx[n.id],
    )


def state_out(lesson_id: str, st: ConceptState | None) -> ConceptStateOut:
    if st is None:
        return ConceptStateOut(lesson_id=lesson_id, state="not_started")
    return ConceptStateOut(
        lesson_id=st.lesson_id, state=st.state, first_seen_at=st.first_seen_at, updated_at=st.updated_at,
        last_passed_at=st.last_passed_at, pass_count=st.pass_count, attempt_count=st.attempt_count,
        best_score=st.best_score, last_score=st.last_score, revision_reason=st.revision_reason, tested_out=st.tested_out,
    )


def readiness_out(bundle: ContentBundle, lesson_id: str, states: dict[str, str]) -> ReadinessOut:
    r = readiness(bundle, lesson_id, states)
    return ReadinessOut(ready=r.ready, missing=[node_out(bundle, m) for m in r.missing], direct_missing=r.direct_missing)


def term_summary(bundle: ContentBundle, term_id: str, ts: TermState | None) -> TermSummary:
    t = bundle.terms[term_id]
    return TermSummary(
        id=t.id, word=t.word, plain=t.plain, symbol=t.symbol, introduced_in=t.introduced_in, aliases=list(t.aliases), link_forms=link_forms(t),
        seen=ts is not None, learned=bool(ts and ts.learned), lookups=ts.lookups if ts else 0,
    )
