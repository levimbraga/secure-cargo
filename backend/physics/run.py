"""Entry point: one scenario, one trip event -> result."""

import hashlib
import json

import mujoco

from app.scenario import Scenario, TripEvent
from physics.conditions import build_profile
from physics.constants import PHYSICS_MODEL_VERSION
from physics.results import SimulationResult
from physics.simulate import simulate
from rules.axle_loads import axle_findings, axle_loads
from rules.en12195 import check_scenario


def run_event(scenario: Scenario, event: TripEvent) -> SimulationResult:
    """Simulate ``scenario`` through ``event``.

    Also reports axle loads (when the vehicle is described) and how each unit's lashing
    compares with the design values of EN 12195-1.
    """
    profile, surface = build_profile(event)
    loads = axle_loads(scenario)
    result = simulate(
        scenario,
        profile,
        surface_friction_cap=surface.cargo_friction_cap,
        extra_findings=axle_findings(loads),
    )
    return result.model_copy(update={"axle_loads": loads, "en_12195_1": check_scenario(scenario)})


def scenario_hash(scenario: Scenario, event: TripEvent) -> str:
    """Cache key: the inputs plus everything that can change the output for the same inputs."""
    payload = {
        "scenario": scenario.model_dump(mode="json"),
        "event": event.model_dump(mode="json"),
        "physics_model_version": PHYSICS_MODEL_VERSION,
        "mujoco_version": mujoco.__version__,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()
