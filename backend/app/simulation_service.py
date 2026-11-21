"""Runs simulations for the API, with results cached by scenario hash.

Two levels of cache: the storage (survives as long as the container's disk), and the last
``RECENT_SIZE`` results as objects in memory. The second matters for the battery and the
planner, which read the same seven results several times in a row: decoding and validating a
result with its keyframes costs a few tenths of a second, as much as simulating some loads.
"""

import threading
import time
import weakref
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from app.scenario import Scenario, TripEvent
from app.schemas import SimulateResponse
from app.storage import Storage
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash

_COLLECTION = "simulations"
RECENT_SIZE = 32

# One memory cache per storage (each app and each test has its own).
_recent: "weakref.WeakKeyDictionary[Storage, OrderedDict[str, SimulateResponse]]" = (
    weakref.WeakKeyDictionary()
)
_lock = threading.Lock()
# Writing a result with its keyframes to the storage takes as long as a short simulation; it
# happens after the answer, one write at a time.
_writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="results-writer")


def _memory(storage: Storage) -> "OrderedDict[str, SimulateResponse]":
    with _lock:
        return _recent.setdefault(storage, OrderedDict())


def _remember(storage: Storage, response: SimulateResponse) -> None:
    memory = _memory(storage)
    with _lock:
        memory[response.scenario_hash] = response
        memory.move_to_end(response.scenario_hash)
        while len(memory) > RECENT_SIZE:
            memory.popitem(last=False)


def _store(storage: Storage, key: str, cpu_time: float, result: SimulationResult) -> None:
    storage.put(
        _COLLECTION, key, {"cpu_time_s": cpu_time, "result": result.model_dump(mode="json")}
    )


def simulate_cached(storage: Storage, scenario: Scenario, event: TripEvent) -> SimulateResponse:
    """Return the cached result for these inputs, or simulate and cache it.

    The simulation is deterministic, so a cached result is exactly what a new run would give.
    Results are shared, never modified: callers copy before changing one.
    """
    key = scenario_hash(scenario, event)
    memory = _memory(storage)
    with _lock:
        recent = memory.get(key)
        if recent is not None:
            memory.move_to_end(key)
    if recent is not None:
        return recent.model_copy(update={"cached": True})

    cached = storage.get(_COLLECTION, key)
    if cached is not None:
        response = SimulateResponse(
            scenario_hash=key,
            cached=True,
            cpu_time_s=cached["cpu_time_s"],
            result=SimulationResult.model_validate(cached["result"]),
        )
        _remember(storage, response)
        return response

    started = time.thread_time()
    result = run_event(scenario, event)
    cpu_time = round(time.thread_time() - started, 4)
    response = SimulateResponse(scenario_hash=key, cached=False, cpu_time_s=cpu_time, result=result)
    _remember(storage, response)
    _writer.submit(_store, storage, key, cpu_time, result)
    return response
