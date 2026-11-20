"""API request and response models."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.demo import DemoScenario
from app.scenario import Scenario, TripEvent
from physics.live import LiveModel
from physics.results import SimulationResult


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    mujoco_version: str


class SimulateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: Scenario
    event: TripEvent


class SimulateResponse(BaseModel):
    scenario_hash: str = Field(description="SHA-256 of the inputs and engine version; cache key.")
    cached: bool = Field(description="True when the result came from the cache.")
    cpu_time_s: float = Field(description="CPU time the simulation took when it was computed.")
    result: SimulationResult


class LiveModelResponse(LiveModel):
    """The MJCF and run plan the browser steps live (see ``physics/live.py``)."""


class DemoScenariosResponse(BaseModel):
    scenarios: list[DemoScenario]


class ErrorDetail(BaseModel):
    """Errors carry a stable code (translated by the UI) and an English message."""

    code: str
    message: str
