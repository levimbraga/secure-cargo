"""FastAPI application entry point."""

import hmac
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import mujoco
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from app import __version__
from app.config import Settings, get_settings
from app.demo import load_demo_scenarios
from app.demo.fixtures import Variant
from app.explorer import BuildError, DraftTruck, ExplorerConfig, build, build_draft
from app.explorer.draft import LoadDraft
from app.inspection.battery import (
    SITUATIONS,
    BatteryChecks,
    SituationId,
    SituationResult,
    battery_checks,
    run_battery,
    situation_result,
)
from app.schemas import (
    DemoScenariosResponse,
    DraftRequest,
    ErrorDetail,
    ExplorerResponse,
    HealthResponse,
    LiveModelResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.simulation_service import simulate_cached
from app.storage import create_storage
from perception.draft import PerceptionDraft, PhotoAnalysis, Weight, analysis_to_draft
from physics.live import build_live_model
from physics.results import SimulationResult
from physics.simulate import SimulationError
from planner.plan import (
    BatteryResponse,
    Candidates,
    Plan,
    Recommendation,
    candidates,
    plan,
    recommend,
)

INTERNAL_HEADER = "x-securecargo-internal"


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

    # Added before CORS so that it runs after it: a refused request still carries CORS headers.
    @app.middleware("http")
    async def only_the_worker(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Refuse every request that did not come through the Worker (see ``internal_token``)."""
        expected = settings.internal_token
        if expected:
            given = request.headers.get(INTERNAL_HEADER, "")
            if not hmac.compare_digest(given.encode(), expected.encode()):
                detail = ErrorDetail(
                    code="forbidden", message="The physics engine answers only the API Worker."
                )
                return JSONResponse(status_code=403, content={"detail": detail.model_dump()})
        return await call_next(request)

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

    @app.get(
        "/explorer",
        response_model=ExplorerResponse,
        tags=["explorer"],
        responses={422: {"description": "A configuration that cannot be loaded."}},
    )
    def explorer(request: Request, response: Response) -> ExplorerResponse:
        """The load of an explorer configuration, given as the page's query string.

        Returns the load draft (what the editor edits), the scenario and trip event built
        from it, and the live model the browser steps. Nothing is simulated here, and the
        answer depends only on the query, so it may be cached.
        """
        try:
            config = ExplorerConfig.from_query(dict(request.query_params))
            built = build(config)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        except ValueError as error:
            raise _unprocessable("invalid_config", str(error)) from error
        response.headers["Cache-Control"] = "public, max-age=86400"
        return ExplorerResponse(
            query=config.to_query(),
            config=config,
            draft=built.draft,
            scenario=built.scenario,
            event=built.event,
            live=build_live_model(built.scenario, built.event),
        )

    @app.post(
        "/explorer/draft",
        response_model=ExplorerResponse,
        tags=["explorer"],
        responses={422: {"description": "A draft that cannot be loaded."}},
    )
    def explorer_draft(body: DraftRequest) -> ExplorerResponse:
        """The scenario and live model of a load draft: an edited load, or a photo's."""
        try:
            scenario, event = build_draft(body.draft)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        return ExplorerResponse(
            query=None,
            config=None,
            draft=body.draft,
            scenario=scenario,
            event=event,
            live=build_live_model(scenario, event),
        )

    @app.post("/perception/draft", response_model=PerceptionDraft, tags=["inspection"])
    def perception_draft(body: PerceptionRequest) -> PerceptionDraft:
        """A photo analysis on the confirmed truck, as the load draft the editor shows.

        Weights come only from ``weight`` (the user's): without it the units have none.
        """
        return analysis_to_draft(body.analysis, body.truck, body.weight)

    @app.post(
        "/battery",
        response_model=BatteryResponse,
        tags=["inspection"],
        responses={422: {"description": "A draft that cannot be loaded or simulated."}},
    )
    def battery(body: DraftRequest, request: Request) -> BatteryResponse:
        """The load through the standard battery of seven situations.

        Returns a verdict per situation, the worst one with its keyframes (fetch the others with
        ``POST /simulate``, from the cache), axle loads, the EN 12195-1 and CONTRAN 945 checks,
        and, when anything fails, the fix the planner recommends on paper.
        """
        try:
            result = run_battery(request.app.state.storage, body.draft)
            needs_fix = result.verdict.state != "approved"
            recommendation = None
            if needs_fix:
                fixed, changes = recommend(body.draft)
                recommendation = Recommendation(draft=fixed, changes=changes)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        except SimulationError as error:
            raise _unprocessable("simulation_unstable", str(error)) from error
        return BatteryResponse(**result.model_dump(), recommendation=recommendation)

    # The Worker runs the seven situations in parallel, one container instance each: a
    # 1/4-vCPU instance takes most of a minute for the whole battery on its own.

    @app.post("/battery/situation", response_model=SituationRun, tags=["inspection"])
    def battery_situation(body: SituationRequest, request: Request) -> SituationRun:
        """One situation of the battery, with its full run (keyframes included)."""
        situation = next(s for s in SITUATIONS if s.id == body.situation)
        try:
            summary, result = situation_result(request.app.state.storage, body.draft, situation)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        except SimulationError as error:
            raise _unprocessable("simulation_unstable", str(error)) from error
        return SituationRun(situation=summary, result=result)

    @app.post("/battery/checks", response_model=ChecksResponse, tags=["inspection"])
    def battery_rule_checks(body: DraftRequest) -> ChecksResponse:
        """Axle loads, EN 12195-1, both countries' rules and the planner's fix (no simulation)."""
        try:
            checks = battery_checks(body.draft)
            fixed, changes = recommend(body.draft)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        return ChecksResponse(
            **checks.model_dump(), recommendation=Recommendation(draft=fixed, changes=changes)
        )

    @app.post("/plan/candidates", response_model=Candidates, tags=["inspection"])
    def plan_candidates(body: DraftRequest) -> Candidates:
        """The planner's candidates, cheapest first, for a proof in parallel."""
        try:
            return candidates(body.draft)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error

    @app.post(
        "/plan",
        response_model=Plan,
        tags=["inspection"],
        responses={422: {"description": "A draft that cannot be loaded or simulated."}},
    )
    def plan_fix(body: DraftRequest, request: Request) -> Plan:
        """The smallest change that passes the rules and the whole battery, proven in simulation."""
        try:
            return plan(request.app.state.storage, body.draft)
        except BuildError as error:
            raise _unprocessable(error.code, str(error)) from error
        except SimulationError as error:
            raise _unprocessable("simulation_unstable", str(error)) from error

    return app


class SituationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft: LoadDraft
    situation: SituationId


class SituationRun(BaseModel):
    situation: SituationResult
    result: SimulationResult


class ChecksResponse(BatteryChecks):
    recommendation: Recommendation


class PerceptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis: PhotoAnalysis
    truck: DraftTruck
    weight: Weight | None = None


def _unprocessable(code: str, message: str) -> HTTPException:
    detail = ErrorDetail(code=code, message=message)
    return HTTPException(status_code=422, detail=detail.model_dump())


app = create_app()
