"""FastAPI application factory.

Run in development with:  ``uvicorn app.main:app --reload`` (from ``backend/``).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .content.loader import get_content
from .db import init_engine, run_migrations

VERSION = "0.1.0"
log = logging.getLogger("universe")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Fail fast: invalid content or an un-migratable database stops startup.
        bundle = get_content(str(settings.content_dir))
        run_migrations(settings.database_url)
        init_engine(settings.database_url)
        log.info("Loaded %d lessons (%d written) and %d dictionary terms", len(bundle.nodes), len(bundle.lessons),
                 len(bundle.terms))
        yield

    app = FastAPI(title="The Mathematical Universe", version=VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from . import api  # noqa: F401
    from .api import assessment, content, practice, progress, tutor, wonderings
    from .api.schemas import HealthOut

    api_router = APIRouter(prefix="/api")

    @api_router.get("/health", response_model=HealthOut)
    def health() -> HealthOut:
        b = get_content(str(settings.content_dir))
        return HealthOut(ok=True, lessons_available=len(b.lessons), lessons_planned=len(b.nodes) - len(b.lessons),
                         terms=len(b.terms), version=VERSION)

    for module in (content, assessment, progress, practice, tutor, wonderings):
        api_router.include_router(module.router)
    app.include_router(api_router)
    return app


app = create_app()
