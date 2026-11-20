"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import mujoco
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.demo import load_demo_scenarios
from app.demo.fixtures import Variant
from app.schemas import (
    DemoScenariosResponse,
    ErrorDetail,
    HealthResponse,
    LiveModelResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.simulation_service import simulate_cached
from app.storage import create_storage
from physics.live import build_live_model
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

    @app.post("/mjcf", response_model=LiveModelResponse, tags=["simulation"])
    def mjcf(body: SimulateRequest) -> LiveModelResponse:
        """The exact MJCF the server simulates for these inputs, with its run plan.

        A browser loads the document into MuJoCo WebAssembly and steps it live: same model,
        same 2 ms step, same prescribed bed motion. Nothing is simulated here.
        """
        live = build_live_model(body.scenario, body.event)
        return LiveModelResponse.model_validate(live, from_attributes=True)

    @app.get(
        "/scenarios/{scenario_id}/mjcf",
        response_model=LiveModelResponse,
        tags=["simulation"],
        responses={
            200: {"content": {"application/xml": {}}},
            404: {"description": "Unknown demo scenario."},
        },
    )
    def scenario_mjcf(
        scenario_id: str,
        variant: Variant = "as_loaded",
        format: str = Query(default="json", pattern="^(json|xml)$"),
    ) -> Response | LiveModelResponse:
        """Live model of a demo scenario; ``format=xml`` returns only the MJCF document."""
        demo = next((d for d in load_demo_scenarios() if d.id == scenario_id), None)
        if demo is None:
            detail = ErrorDetail(code="unknown_scenario", message="No such demo scenario.")
            raise HTTPException(status_code=404, detail=detail.model_dump())
        live = build_live_model(demo.variant(variant), demo.event)
        if format == "xml":
            return Response(content=live.mjcf, media_type="application/xml")
        return LiveModelResponse.model_validate(live, from_attributes=True)

    return app


app = create_app()
