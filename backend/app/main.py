"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import mujoco
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.schemas import HealthResponse
from app.storage import create_storage


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.storage = create_storage(settings.storage_url)
        try:
            yield
        finally:
            app.state.storage.close()

    app = FastAPI(
        title="SecureCargo API",
        description="Physics-tested cargo securement.",
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    def health() -> HealthResponse:
        """Liveness probe. Also reports the physics engine version the API runs on."""
        return HealthResponse(status="ok", version=__version__, mujoco_version=mujoco.__version__)

    return app


app = create_app()
