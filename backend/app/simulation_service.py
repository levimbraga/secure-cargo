"""Runs simulations for the API, with results cached by scenario hash."""

import time

from app.scenario import Scenario, TripEvent
from app.schemas import SimulateResponse
from app.storage import Storage
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash

_COLLECTION = "simulations"


def simulate_cached(storage: Storage, scenario: Scenario, event: TripEvent) -> SimulateResponse:
    """Return the cached result for these inputs, or simulate and cache it.

    The simulation is deterministic, so a cached result is exactly what a new run would give.
    """
    key = scenario_hash(scenario, event)
    cached = storage.get(_COLLECTION, key)
    if cached is not None:
        return SimulateResponse(
            scenario_hash=key,
            cached=True,
            cpu_time_s=cached["cpu_time_s"],
            result=SimulationResult.model_validate(cached["result"]),
        )

    started = time.thread_time()
    result = run_event(scenario, event)
    cpu_time = round(time.thread_time() - started, 4)
    storage.put(
        _COLLECTION, key, {"cpu_time_s": cpu_time, "result": result.model_dump(mode="json")}
    )
    return SimulateResponse(scenario_hash=key, cached=False, cpu_time_s=cpu_time, result=result)
