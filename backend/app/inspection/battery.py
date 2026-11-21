"""The standard battery of an inspection: one load, seven situations every trip can bring.

An inspection does not ask "does it survive the trip the driver has in mind" but "does it
survive what any trip can throw at it": hard braking, a sudden lane change, a sharp curve, a
pothole, a speed bump, a mountain descent in heavy rain and a long stretch of dirt road. Each
situation is a trip of the explorer (``DraftTrip``), so any one of them can be opened in the
explorer and changed.

A situation *passes* when its verdict is not "fail". A warning (the load crept 1 to 5 cm, or a
lashing reached 90 % of its capacity) is shown as such but counts as arriving intact.
"""

import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer import build_draft
from app.explorer.config import Road, Weather
from app.explorer.draft import DraftTrip, LoadDraft
from app.scenario import EventKind, Scenario, TripEvent
from app.simulation_service import simulate_cached
from app.storage import Storage
from physics.results import (
    AxleLoad,
    Finding,
    Margins,
    SimulationResult,
    StandardCheck,
    Status,
)
from rules.contran945 import ContranCheck, check_contran_945

SituationId = Literal[
    "emergency_braking",
    "lane_change",
    "sharp_curve",
    "pothole",
    "speed_bump",
    "mountain_descent",
    "long_vibration",
]


@dataclass(frozen=True)
class Situation:
    id: SituationId
    trip: DraftTrip


def _trip(event: EventKind, speed: int, road: Road, weather: Weather = Weather.DRY) -> DraftTrip:
    return DraftTrip(speed_kmh=speed, road=road, weather=weather, event=event)


# The order is the order of the scorecard. Speeds: 80 km/h on a highway, 60 km/h where the
# road is curvy, broken or steep, and 30 km/h over a speed bump (the speed a "Type A" bump of
# the Brazilian signalling manual is designed for).
SITUATIONS: tuple[Situation, ...] = (
    Situation("emergency_braking", _trip(EventKind.EMERGENCY_BRAKING, 80, Road.STRAIGHT)),
    Situation("lane_change", _trip(EventKind.LANE_CHANGE, 80, Road.STRAIGHT)),
    Situation("sharp_curve", _trip(EventKind.SHARP_CURVE, 60, Road.CURVY)),
    Situation("pothole", _trip(EventKind.POTHOLE, 60, Road.POTHOLED)),
    Situation("speed_bump", _trip(EventKind.SPEED_BUMP, 30, Road.URBAN)),
    Situation(
        "mountain_descent",
        _trip(EventKind.MOUNTAIN_DESCENT, 60, Road.MOUNTAIN, Weather.HEAVY_RAIN),
    ),
    Situation("long_vibration", _trip(EventKind.LONG_VIBRATION, 60, Road.DIRT)),
)
SITUATION_IDS: tuple[SituationId, ...] = tuple(s.id for s in SITUATIONS)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SituationResult(_Model):
    """One situation of the battery, without its keyframes (fetched on demand)."""

    id: SituationId
    trip: DraftTrip
    event: TripEvent = Field(description="The trip event simulated; POST it to /simulate.")
    status: Status
    passed: bool
    severity: float = Field(description="How badly it failed, for ranking (0: held).")
    findings: list[Finding]
    margins: Margins
    profile: dict[str, float | str]
    scenario_hash: str


class BatteryResult(_Model):
    draft: LoadDraft
    scenario: Scenario
    situations: list[SituationResult]
    passed: int
    total: int
    status: Status = Field(description="fail if any situation fails, warning if any warns.")
    worst: SituationId = Field(description="The situation shown first.")
    worst_result: SimulationResult = Field(description="The worst situation, with keyframes.")
    axle_loads: list[AxleLoad]
    en_12195_1: list[StandardCheck]
    contran_945: list[ContranCheck]
    cpu_time_s: float


_STATUS_RANK: dict[Status, int] = {"pass": 0, "warning": 1, "fail": 2}


def severity(result: SimulationResult) -> float:
    """A number that orders failures: how far past its limit the worst finding went."""
    worst = 0.0
    for finding in result.verdict.findings:
        if finding.code in ("unit_left_bed", "lashing_broke"):
            ratio = 10.0
        elif finding.limit > 0:
            ratio = finding.value / finding.limit
        else:
            ratio = 2.0 if finding.severity == "fail" else 1.0
        worst = max(worst, ratio)
    return round(worst, 3)


def scenario_for(draft: LoadDraft, situation: Situation) -> tuple[Scenario, TripEvent]:
    return build_draft(draft.model_copy(update={"trip": situation.trip}))


def run_situations(
    storage: Storage,
    draft: LoadDraft,
    situations: tuple[Situation, ...] = SITUATIONS,
    *,
    stop_at_first_failure: bool = False,
) -> list[tuple[Situation, SimulationResult, str]]:
    """Simulate the draft in each situation (cached by input hash)."""
    out: list[tuple[Situation, SimulationResult, str]] = []
    for situation in situations:
        scenario, event = scenario_for(draft, situation)
        response = simulate_cached(storage, scenario, event)
        out.append((situation, response.result, response.scenario_hash))
        if stop_at_first_failure and response.result.verdict.status == "fail":
            break
    return out


def run_battery(storage: Storage, draft: LoadDraft) -> BatteryResult:
    """The load through all seven situations, with the rule checks and the worst case first."""
    started = time.thread_time()
    runs = run_situations(storage, draft)
    situations = [
        SituationResult(
            id=situation.id,
            trip=situation.trip,
            event=scenario_for(draft, situation)[1],
            status=result.verdict.status,
            passed=result.verdict.status != "fail",
            severity=severity(result) if result.verdict.status != "pass" else 0.0,
            findings=result.verdict.findings,
            margins=result.margins,
            profile=result.profile,
            scenario_hash=key,
        )
        for situation, result, key in runs
    ]
    worst_index = max(
        range(len(runs)),
        key=lambda i: (_STATUS_RANK[situations[i].status], situations[i].severity, -i),
    )
    statuses = {s.status for s in situations}
    status: Status = (
        "fail" if "fail" in statuses else "warning" if "warning" in statuses else "pass"
    )
    scenario, _ = scenario_for(draft, SITUATIONS[0])
    first = runs[0][1]
    return BatteryResult(
        draft=draft,
        scenario=scenario,
        situations=situations,
        passed=sum(s.passed for s in situations),
        total=len(situations),
        status=status,
        worst=situations[worst_index].id,
        worst_result=runs[worst_index][1],
        axle_loads=first.axle_loads,
        en_12195_1=first.en_12195_1,
        contran_945=check_contran_945(scenario, anchored_on_wood=draft.anchored_on_wood),
        cpu_time_s=round(time.thread_time() - started, 3),
    )
