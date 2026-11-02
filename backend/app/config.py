"""Application settings, read from environment variables or ``backend/.env``.

API keys are only ever read here, on the server. They are never sent to the
browser; the settings page only shows whether a key is configured.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = Field(
        default=f"sqlite:///{(BACKEND_DIR / 'data' / 'universe.db').as_posix()}",
        alias="MATH_DATABASE_URL",
    )
    content_dir: Path = Field(default=REPO_DIR / "content", alias="MATH_CONTENT_DIR")

    # AI provider configuration. "none" disables every AI feature cleanly.
    ai_provider: Literal["anthropic", "none"] = Field(default="anthropic", alias="MATH_AI_PROVIDER")
    ai_model: str = Field(default="claude-opus-5-5", alias="MATH_AI_MODEL")
    ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = Field(
        default="medium", alias="MATH_AI_EFFORT"
    )
    ai_server_fallbacks: bool = Field(default=True, alias="MATH_AI_SERVER_FALLBACKS")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    cors_origins: str = Field(default="http://localhost:3000,http://127.0.0.1:3000", alias="MATH_CORS_ORIGINS")


@lru_cache
def get_settings() -> Settings:
    return Settings()
