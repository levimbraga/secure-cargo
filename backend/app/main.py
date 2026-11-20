"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import mujoco
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.demo import load_demo_scenarios
from app.schemas import (
    DemoScenariosResponse,
    ErrorDetail,
    HealthResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.simulation_service import simulate_cached
from app.storage import create_storage
from physics.simulate import SimulationError


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

    @app.post(
        "/simulate",
        response_model=SimulateResponse,
        tags=["simulation"],
        responses={422: {"description": "Invalid scenario, or one the engine cannot integrate."}},
    )
    def simulate(body: SimulateRequest, request: Request) -> SimulateResponse:
        """Run a load scenario through a trip event.

        Returns the verdict, per-unit and per-lashing metrics and keyframes at 30 fps for the
        replay. Results are cached by the hash of the inputs.
        """
        try:
            return simulate_cached(request.app.state.storage, body.scenario, body.event)
        except SimulationError as error:
            detail = ErrorDetail(code="simulation_unstable", message=str(error))
            raise HTTPException(status_code=422, detail=detail.model_dump()) from error

    @app.get("/scenarios/demo", response_model=DemoScenariosResponse, tags=["simulation"])
    def demo_scenarios() -> DemoScenariosResponse:
        """The four demo scenarios, each as loaded and fixed, with their trip event."""
        return DemoScenariosResponse(scenarios=list(load_demo_scenarios()))

    return app


app = create_app()
