"""Write the API's OpenAPI schema to frontend/src/lib/openapi.json (used to generate TypeScript types)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402

out = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "openapi.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(create_app().openapi(), indent=1))
print(f"wrote {out}")
