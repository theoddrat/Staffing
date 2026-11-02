"""Export the validated course content as one JSON file for the standalone (in-browser) build.

The standalone app has no Python server, so it reads this file instead of calling the API's
content loader. Everything is validated first (the same checks the backend runs at startup),
so the browser never sees content the backend would refuse.

    backend/.venv/bin/python backend/scripts/export_content.py   # -> frontend/standalone/content.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_DIR  # noqa: E402
from app.content.loader import AUTOLINK_STOPWORDS, link_forms, load_content  # noqa: E402
from app.learning.practice import GENERATORS  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "standalone" / "content.json"


def _dump(model):
    return model.model_dump(mode="json")


def build_export() -> dict:
    """The standalone build's content file, as a dict (also used by the tests to check the file is current)."""
    bundle = load_content(REPO_DIR / "content", set(GENERATORS))
    return {
        "version": 1,
        "curriculum": _dump(bundle.curriculum),
        "lessons": {k: _dump(v) for k, v in bundle.lessons.items()},
        "terms": {k: {**_dump(v), "link_forms": link_forms(v)} for k, v in bundle.terms.items()},
        "widgets": {k: _dump(v) for k, v in bundle.widgets.items()},
        "order": bundle.order,
        "children": bundle.children,
        "feeds": dict(sorted(bundle.feeds.items())),  # sorted: the loader builds it from a set
        "generators": [{"id": g.id, "title": g.title, "lesson": g.lesson} for g in GENERATORS.values()],
        "autolink_stopwords": sorted(AUTOLINK_STOPWORDS),
        # The tutor's system prompts, so the browser build and the backend teach from the same text.
        "prompts": {
            name: (REPO_DIR / "backend" / "app" / "ai" / "prompts" / f"{name}.md").read_text(encoding="utf-8")
            for name in ("teaching", "research")
        },
    }


def main() -> None:
    data = build_export()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(data['lessons'])} lessons, {len(data['terms'])} terms")


if __name__ == "__main__":
    main()
