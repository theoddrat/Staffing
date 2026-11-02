from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.provider import clear_provider_override, set_provider_override
from app.config import REPO_DIR, Settings
from app.content.loader import load_content
from app.learning.practice import GENERATORS


@pytest.fixture(scope="session")
def bundle():
    return load_content(REPO_DIR / "content", set(GENERATORS))


@pytest.fixture
def make_client(tmp_path: Path):
    clients = []

    def _make(provider: Any = None) -> TestClient:
        from app.main import create_app

        set_provider_override(provider)
        settings = Settings(MATH_DATABASE_URL=f"sqlite:///{tmp_path / 'test.db'}")
        c = TestClient(create_app(settings))
        c.__enter__()
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)
    clear_provider_override()


@pytest.fixture
def client(make_client):
    return make_client(None)


def correct_answer(q: dict[str, Any]) -> dict[str, Any]:
    """Build a correct answer payload for a materialised question."""
    t = q["type"]
    if t == "choice":
        return {"selected": [o["id"] for o in q["options"] if o["correct"]]}
    if t == "number":
        return {"value": str(Fraction(q["answer"]))}
    if t == "text":
        return {"value": q["accept"][0]}
    if t == "truefalse":
        return {"value": q["answer"]}
    if t == "order":
        return {"order": q["items"]}
    if t == "explain":
        return {"text": "My explanation in my own words.", "self_check": list(range(len(q["rubric"])))}
    raise AssertionError(t)


def wrong_answer(q: dict[str, Any]) -> dict[str, Any]:
    t = q["type"]
    if t == "choice":
        wrong = [o["id"] for o in q["options"] if not o["correct"]]
        return {"selected": wrong[:1]}
    if t == "number":
        if q.get("common_wrong"):
            return {"value": q["common_wrong"][0]["answer"]}
        return {"value": str(Fraction(q["answer"]) + 1000)}
    if t == "text":
        return {"value": "definitely not the answer"}
    if t == "truefalse":
        return {"value": not q["answer"]}
    if t == "order":
        return {"order": list(reversed(q["items"]))}
    if t == "explain":
        return {"text": "I am not sure.", "self_check": []}
    raise AssertionError(t)
