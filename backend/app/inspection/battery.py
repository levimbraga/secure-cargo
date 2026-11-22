"""The standard battery of an inspection: one load, seven situations every trip can bring.

An inspection does not ask "does it survive the trip the driver has in mind" but "does it
survive what any trip can throw at it": hard braking, a sudden lane change, a sharp curve, a
pothole, a speed bump, a mountain descent in heavy rain and a long stretch of dirt road. Each
situation is a trip of the explorer (``DraftTrip``), so any one of them can be opened in the
explorer and changed.

A situation *passes* when its verdict is not "fail". A warning (the load crept 1 to 5 cm, or a
lashing reached 90 % of its capacity) is shown as such but counts as arriving intact. An axle
overload is not a situation's failure: it is a rule, reported once in the checklist (the
inspection is then "holds, but out of compliance", see ``verdict.py``).

Some physical findings depend on whose rules judge them (rules audit items 3 and 4). A lashing's
load is compared with its rated capacity LC in Brazil and the EU (EN 12195-1), but with its
*breaking strength* at these accelerations in the US (49 CFR 393.102(a)(1)); a van's front wall
holds its EN 12642 rating in Brazil and the EU. In the US, 393.114(c) asks for a front end
structure rated for 0.5 (0.4 if 6 ft or taller) times the cargo weight, a rating the model does
not know: a run fails on the wall only when the truck declares a rating (``front_end_rating_kg``)
and the simulated wall load exceeds it; otherwise the wall is "to confirm", with the simulated
load (``wall_load_n``) shown next to the minimum (``front_end_min_n``). Each such finding names
the ``countries`` it applies to; every other finding applies everywhere.
"""

import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer import build_draft
from app.explorer.config import Country, Road, Weather
from app.explorer.draft import DraftTrip, LoadDraft
from app.inspection.verdict import RULE_FINDINGS, Verdict, verdict_of
from app.scenario import EventKind, Scenario, TripEvent
from app.simulation_service import simulate_cached
from app.storage import Storage
from physics.constants import STANDARD_GRAVITY_MPS2
from physics.results import (
    AxleLoad,
    Finding,
    Margins,
    SimulationResult,
    StandardCheck,
    Status,
)
from physics.verdict import LASHING_FAIL_RATIO, LASHING_WARNING_RATIO
from rules.axle_loads import axle_loads
from rules.checklist import Checklist, checklist
from rules.contran945 import ContranCheck, check_contran_945
from rules.country import RuleSet, rule_sets
from rules.en12195 import check_scenario
from rules.fmcsa393 import front_end_rating_n, us_breaking_n

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


class SituationFinding(Finding):
    countries: list[Country] | None = Field(
        default=None,
        description="Whose rules this finding belongs to; None: every country's.",
    )


EN_COUNTRIES = [Country.BR, Country.EU]
# Findings judged against a rating that differs by country.
RATED_FINDINGS = {"lashing_overloaded", "headboard_overloaded"}


def applies(finding: SituationFinding, country: Country) -> bool:
    return finding.countries is None or country in finding.countries


def wall_load_n(scenario: Scenario, result: SimulationResult) -> float | None:
    """The peak load the cargo put on the headboard or front wall in a run (None: no wall)."""
    if scenario.bed.headboard is None:
        return None
    return sum(unit.peak_headboard_force_n for unit in result.units)


def country_findings(
    scenario: Scenario, result: SimulationResult, declared_kg: float | None = None
) -> list[SituationFinding]:
    """A run's physical findings, with the US versions of the rated ones.

    ``declared_kg``: the front end structure's declared rating (US only, 393.114(c)).
    """
    out: list[SituationFinding] = []
    for finding in result.verdict.findings:
        if finding.code in RULE_FINDINGS:
            continue
        countries = EN_COUNTRIES if finding.code in RATED_FINDINGS else None
        out.append(SituationFinding(**finding.model_dump(), countries=countries))
    lashings = {x.id: x for x in scenario.lashings}
    for run in result.lashings:
        if run.broke_at_s is not None or run.id not in lashings:
            continue
        breaking = us_breaking_n(lashings[run.id])
        ratio = run.peak_force_n / breaking
        if ratio <= LASHING_WARNING_RATIO:
            continue
        failed = ratio > LASHING_FAIL_RATIO
        out.append(
            SituationFinding(
                code="lashing_overloaded",
                severity="fail" if failed else "warning",
                lashing_id=run.id,
                unit_id=run.unit_id,
                value=run.peak_force_n,
                limit=breaking * (LASHING_FAIL_RATIO if failed else LASHING_WARNING_RATIO),
                message=(
                    f"Lashing {run.id} reached {ratio * 100:.0f} % of its breaking strength "
                    "(49 CFR 393.102(a)(1))."
                ),
                countries=[Country.US],
            )
        )
    total = wall_load_n(scenario, result)
    if total is not None and declared_kg is not None:
        rating = declared_kg * STANDARD_GRAVITY_MPS2
        if total > rating:
            out.append(
                SituationFinding(
                    code="headboard_overloaded",
                    severity="fail",
                    value=total,
                    limit=rating,
                    message=(
                        f"The front end structure took {total / 1000:.1f} kN; its declared "
                        f"rating is {rating / 1000:.1f} kN (49 CFR 393.114(c))."
                    ),
                    countries=[Country.US],
                )
            )
    return out


def physical_status(findings: list[SituationFinding], country: Country) -> Status:
    mine = [f for f in findings if applies(f, country)]
    if any(f.severity == "fail" for f in mine):
        return "fail"
    return "warning" if mine else "pass"


class SituationResult(_Model):
    """One situation of the battery, without its keyframes (fetched on demand)."""

    id: SituationId
    trip: DraftTrip
    event: TripEvent = Field(description="The trip event simulated; POST it to /simulate.")
    status: Status
    passed: bool
    severity: float = Field(description="How badly it failed, for ranking (0: held).")
    findings: list[SituationFinding]
    margins: Margins
    profile: dict[str, float | str]
    scenario_hash: str
    wall_load_n: float | None = Field(
        default=None, description="Peak load on the headboard or front wall [N]; None: no wall."
    )
    front_end_min_n: float | None = Field(
        default=None,
        description="The forward load 49 CFR 393.114(c) asks the front end structure to hold [N].",
    )


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
    checklist: Checklist
    country: Country = Field(description="Whose rules the verdict uses (the draft's).")
    rules: dict[Country, RuleSet] = Field(
        description="Both countries' rule checks: a page switches country without a simulation."
    )
    verdicts: dict[Country, Verdict] = Field(description="The verdict under each country's rules.")
    verdict: Verdict
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
        if stop_at_first_failure and situation_holds(scenario, response.result, draft) is False:
            break
    return out


def situation_holds(scenario: Scenario, result: SimulationResult, draft: LoadDraft) -> bool:
    """No physical failure under the draft's country's ratings (axle loads are rules)."""
    findings = country_findings(scenario, result, draft.truck.front_end_rating_kg)
    return physical_status(findings, draft.country) != "fail"


def wall_within_us_minimum(situations: list["SituationResult"]) -> bool:
    """Every run keeps the wall load within the 393.114(c) minimum: then any front end structure
    built to 393.114 holds it, whatever its (unknown) rating. The planner prefers such fixes."""
    return all(
        s.wall_load_n is None or s.front_end_min_n is None or s.wall_load_n <= s.front_end_min_n
        for s in situations
    )


def situation_result(
    storage: Storage, draft: LoadDraft, situation: Situation
) -> tuple[SituationResult, SimulationResult]:
    """One situation of the battery: its summary and its full run (with keyframes)."""
    scenario, event = scenario_for(draft, situation)
    response = simulate_cached(storage, scenario, event)
    result = response.result
    # The axle loads are the same in every situation and are a rule: the checklist has them.
    findings = country_findings(scenario, result, draft.truck.front_end_rating_kg)
    status = physical_status(findings, draft.country)
    mine: list[Finding] = [f for f in findings if applies(f, draft.country)]
    physical = result.model_copy(
        update={"verdict": result.verdict.model_copy(update={"findings": mine})}
    )
    summary = SituationResult(
        id=situation.id,
        trip=situation.trip,
        event=event,
        status=status,
        passed=status != "fail",
        severity=severity(physical) if status != "pass" else 0.0,
        findings=findings,
        margins=result.margins,
        profile=result.profile,
        scenario_hash=response.scenario_hash,
        wall_load_n=_rounded(wall_load_n(scenario, result)),
        front_end_min_n=_rounded(front_end_rating_n(scenario)),
    )
    return summary, result


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


class BatteryChecks(_Model):
    """What a battery reports besides the situations: the same for all of them."""

    draft: LoadDraft
    scenario: Scenario
    axle_loads: list[AxleLoad]
    en_12195_1: list[StandardCheck]
    contran_945: list[ContranCheck]
    checklist: Checklist
    country: Country
    rules: dict[Country, RuleSet]


def headboard_known(draft: LoadDraft) -> bool:
    """An explorer load is on our preset truck; an inspection's headboard must be given."""
    return draft.source == "explorer" or draft.truck.headboard_height_m is not None


def battery_checks(draft: LoadDraft) -> BatteryChecks:
    """Axle loads, EN 12195-1, CONTRAN 945 and the checklist of a load (no simulation)."""
    scenario, _ = scenario_for(draft, SITUATIONS[0])
    known = headboard_known(draft)
    return BatteryChecks(
        draft=draft,
        scenario=scenario,
        axle_loads=axle_loads(scenario),
        en_12195_1=check_scenario(scenario),
        contran_945=check_contran_945(
            scenario, anchored_on_wood=draft.anchored_on_wood, headboard_known=known
        ),
        checklist=checklist(
            scenario,
            cargo=[u.cargo.value for u in draft.units],
            restraint=draft.restraint.value,
            headboard_known=known,
        ),
        country=draft.country,
        rules=rule_sets(scenario, draft, headboard_known=known),
    )


def verdicts_of(situations: list[SituationResult], checks: BatteryChecks) -> dict[Country, Verdict]:
    """The verdict under each country's rules (the physics is the same)."""
    runs = [s.model_dump() for s in situations]
    return {
        country: verdict_of(
            {
                "situations": runs,
                "country": country.value,
                "rules": {country.value: rules.model_dump()},
            }
        )
        for country, rules in checks.rules.items()
    }


def worst_of(situations: list[SituationResult]) -> int:
    """Index of the situation shown first: failures before warnings, then by severity."""
    return max(
        range(len(situations)),
        key=lambda i: (_STATUS_RANK[situations[i].status], situations[i].severity, -i),
    )


def run_battery(storage: Storage, draft: LoadDraft) -> BatteryResult:
    """The load through all seven situations, with the rule checks and the worst case first."""
    started = time.thread_time()
    runs = [situation_result(storage, draft, situation) for situation in SITUATIONS]
    situations = [summary for summary, _ in runs]
    worst_index = worst_of(situations)
    statuses = {s.status for s in situations}
    status: Status = (
        "fail" if "fail" in statuses else "warning" if "warning" in statuses else "pass"
    )
    checks = battery_checks(draft)
    verdicts = verdicts_of(situations, checks)
    return BatteryResult(
        draft=draft,
        scenario=checks.scenario,
        situations=situations,
        passed=sum(s.passed for s in situations),
        total=len(situations),
        status=status,
        worst=situations[worst_index].id,
        worst_result=runs[worst_index][1],
        axle_loads=checks.axle_loads,
        en_12195_1=checks.en_12195_1,
        contran_945=checks.contran_945,
        checklist=checks.checklist,
        country=checks.country,
        rules=checks.rules,
        verdicts=verdicts,
        verdict=verdicts[checks.country],
        cpu_time_s=round(time.thread_time() - started, 3),
    )
