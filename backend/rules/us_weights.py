"""US federal weight limits, 23 CFR 658.17, and the bridge formula of 23 U.S.C. 127(a).

The limits apply on the Interstate System and reasonable access to it, and they include every
enforcement tolerance (658.17(g)). Sources, worked examples and what is not covered (state limits,
permits, grandfathered weights): the workspace's ``notes/us-rules.md``, section 2.

* any one axle: 20,000 lb (658.17(c));
* a tandem axle (consecutive axles more than 40 in and at most 96 in apart, 658.5): 34,000 lb
  (658.17(d));
* the gross vehicle weight: 80,000 lb (658.17(b));
* any group of two or more consecutive axles: W = 500 (L N / (N - 1) + 12 N + 36) pounds, L the
  distance between the group's extreme axles in feet, N the number of axles (658.17(e)); two
  consecutive tandems may carry 34,000 lb each when their extreme axles are 36 ft or more apart.

Axle loads come from the same moment balance as the Brazilian check (``axle_loads.py``). Each
group's load is shared equally between its axles. On a US tractor-semitrailer (our presets) the
group at the kingpin is the tractor's drive tandem; the kingpin's share of the trailer is split
between the steer axle and the drive tandem by the tractor's geometry. A Brazilian semi checked
against US rules has no steer axle in the model: the check covers the axles it has.
"""

import math
from dataclasses import dataclass

from app.explorer.config import US_SIZES, Size
from app.scenario import AxleGroupKind, Scenario
from rules.axle_loads import axle_loads

LB_KG = 0.45359237
FOOT_M = 0.3048
INCH_M = 0.0254

SINGLE_AXLE_LB = 20_000  # 658.17(c)
TANDEM_LB = 34_000  # 658.17(d)
GROSS_LB = 80_000  # 658.17(b)
TANDEM_MAX_SPREAD_M = 96 * INCH_M  # 658.5, "tandem axle weight"
TWO_TANDEMS_MIN_FT = 36  # 658.17(e), the exception for two consecutive tandems

# Tractor of the US presets (notes/us-rules.md, section 4): steer to drive-tandem centre 220 in,
# fifth wheel 12 in ahead of the drive tandem centre, empty tractor 11,000 lb on the steer axle
# and 8,000 lb on the drive tandem (the drive tare is part of the kingpin group's tare).
TRACTOR_WHEELBASE_M = 5.6
FIFTH_WHEEL_AHEAD_M = 0.3
STEER_TARE_KG = 11_000 * LB_KG
DRIVE_TARE_KG = 8_000 * LB_KG

# Spacing between the axles of a group [m]: 52 in for a drive or straight-truck tandem, 49 in for
# a trailer tandem (US presets); the Brazilian tandem and triple groups, 1.32 m and 1.25 m.
SPREAD_M: dict[AxleGroupKind, float] = {
    AxleGroupKind.SINGLE_2_TYRES: 0.0,
    AxleGroupKind.SINGLE_4_TYRES: 0.0,
    AxleGroupKind.TANDEM_2_AXLES: 52 * INCH_M,
    AxleGroupKind.TANDEM_3_AXLES: 1.25,
}
TRAILER_TANDEM_SPREAD_M = 49 * INCH_M
AXLES_IN: dict[AxleGroupKind, int] = {
    AxleGroupKind.SINGLE_2_TYRES: 1,
    AxleGroupKind.SINGLE_4_TYRES: 1,
    AxleGroupKind.TANDEM_2_AXLES: 2,
    AxleGroupKind.TANDEM_3_AXLES: 3,
}


def kg(pounds: float) -> float:
    return pounds * LB_KG


def pounds(kilograms: float) -> float:
    return kilograms / LB_KG


@dataclass(frozen=True)
class Axle:
    group: str  # "steer", "front", "rear", "tractor" (drive tandem), "trailer"
    x_m: float  # bed frame, forward from the centre of the bed
    load_kg: float


@dataclass(frozen=True)
class AxleGroupLoad:
    group: str
    axles: int
    load_kg: float
    limit_lb: float
    tandem: bool


def bridge_limit_lb(length_ft: float, axles: int) -> float:
    """The bridge formula as FHWA's Bridge Table applies it (FHWA-HOP-06-105).

    ``length_ft``: the distance between the extreme axles of the group. Axles within 96 in of
    each other are a tandem (34,000 lb). Between 8 and 9 ft the table uses 8 ft; otherwise the
    distance is rounded to the nearest foot. The weight is rounded to the nearest 500 lb, down
    when exactly halfway (FHWA's policy, stated under the table).
    """
    if axles < 2:
        return SINGLE_AXLE_LB
    if length_ft * FOOT_M <= TANDEM_MAX_SPREAD_M + 1e-9:
        return TANDEM_LB
    feet = 8 if length_ft < 9 else math.floor(length_ft + 0.5)
    exact = 500 * (feet * axles / (axles - 1) + 12 * axles + 36)
    return math.ceil(exact / 500 - 0.5) * 500


def _spread(kind: AxleGroupKind, group_id: str, size: Size | None) -> float:
    if group_id == "trailer" and size in US_SIZES and kind is AxleGroupKind.TANDEM_2_AXLES:
        return TRAILER_TANDEM_SPREAD_M
    return SPREAD_M[kind]


def _group_axles(
    group_id: str, kind: AxleGroupKind, x: float, load: float, size: Size | None
) -> list[Axle]:
    count = AXLES_IN[kind]
    spread = _spread(kind, group_id, size)
    first = x + spread * (count - 1) / 2
    return [Axle(group_id, first - i * spread, load / count) for i in range(count)]


def us_axles(scenario: Scenario, size: Size | None) -> list[Axle]:
    """Every axle with its load, front to back."""
    if scenario.vehicle is None:
        return []
    loads = {load.axle_group_id: load.load_kg for load in axle_loads(scenario)}
    front, rear = scenario.vehicle.axle_groups
    axles: list[Axle] = []
    if front.id == "tractor" and size in US_SIZES:
        # The kingpin group = drive tandem tare + the trailer's load on the kingpin.
        kingpin_load = loads[front.id] - DRIVE_TARE_KG
        drive_x = front.position_x_m - FIFTH_WHEEL_AHEAD_M
        steer_x = drive_x + TRACTOR_WHEELBASE_M
        to_steer = FIFTH_WHEEL_AHEAD_M / TRACTOR_WHEELBASE_M
        axles.append(Axle("steer", steer_x, STEER_TARE_KG + kingpin_load * to_steer))
        axles += _group_axles(
            "tractor",
            front.kind,
            drive_x,
            DRIVE_TARE_KG + kingpin_load * (1 - to_steer),
            size,
        )
    else:
        axles += _group_axles(front.id, front.kind, front.position_x_m, loads[front.id], size)
    axles += _group_axles(rear.id, rear.kind, rear.position_x_m, loads[rear.id], size)
    return axles


def group_loads(axles: list[Axle]) -> list[AxleGroupLoad]:
    """Each axle group (steer, drive tandem, trailer tandem, ...) against its federal limit."""
    out: list[AxleGroupLoad] = []
    for group in dict.fromkeys(a.group for a in axles):
        members = [a for a in axles if a.group == group]
        load = sum(a.load_kg for a in members)
        if len(members) == 1:
            limit, tandem = float(SINGLE_AXLE_LB), False
        else:
            span_ft = (members[0].x_m - members[-1].x_m) / FOOT_M
            tandem = span_ft * FOOT_M <= TANDEM_MAX_SPREAD_M + 1e-9
            limit = (
                float(TANDEM_LB)
                if tandem
                else min(bridge_limit_lb(span_ft, len(members)), SINGLE_AXLE_LB * len(members))
            )
        out.append(AxleGroupLoad(group, len(members), round(load, 1), limit, tandem))
    return out


@dataclass(frozen=True)
class BridgeGroup:
    first: int  # index of the front axle of the group
    last: int
    axles: int
    length_ft: float
    load_kg: float
    limit_lb: float


def bridge_groups(axles: list[Axle], tandem_groups: set[str]) -> list[BridgeGroup]:
    """Every group of two or more consecutive axles with its bridge-formula limit.

    Axles within 96 in of each other are a tandem, limited by 658.17(d) (``group_loads``): the
    bridge formula is applied to the longer groups.
    """
    groups: list[BridgeGroup] = []
    for i in range(len(axles)):
        for j in range(i + 1, len(axles)):
            members = axles[i : j + 1]
            length_ft = (members[0].x_m - members[-1].x_m) / FOOT_M
            if length_ft * FOOT_M <= TANDEM_MAX_SPREAD_M + 1e-9:
                continue
            limit = bridge_limit_lb(length_ft, len(members))
            names = [a.group for a in members]
            sets = list(dict.fromkeys(names))
            two_tandems = (
                len(sets) == 2
                and all(s in tandem_groups and names.count(s) == 2 for s in sets)
                and length_ft >= TWO_TANDEMS_MIN_FT
            )
            if two_tandems:
                limit = max(limit, 2 * TANDEM_LB)
            groups.append(
                BridgeGroup(
                    first=i,
                    last=j,
                    axles=len(members),
                    length_ft=round(length_ft, 2),
                    load_kg=round(sum(a.load_kg for a in members), 1),
                    limit_lb=min(limit, GROSS_LB),
                )
            )
    return groups


def group_limits_kg(scenario: Scenario, size: Size | None) -> tuple[float, float] | None:
    """Federal limits of the scenario's two modelled groups, for the planner's placement search.

    For a US tractor-semitrailer the kingpin group's limit is the load that keeps both the steer
    axle and the drive tandem within theirs.
    """
    if scenario.vehicle is None:
        return None
    front, rear = scenario.vehicle.axle_groups

    def limit(group_id: str, kind: AxleGroupKind) -> float:
        if AXLES_IN[kind] == 1:
            return kg(SINGLE_AXLE_LB)
        if AXLES_IN[kind] == 2:
            return kg(TANDEM_LB)
        span_ft = _spread(kind, group_id, size) * (AXLES_IN[kind] - 1) / FOOT_M
        return kg(min(bridge_limit_lb(span_ft, AXLES_IN[kind]), SINGLE_AXLE_LB * AXLES_IN[kind]))

    rear_limit = limit(rear.id, rear.kind)
    if front.id == "tractor" and size in US_SIZES:
        to_steer = FIFTH_WHEEL_AHEAD_M / TRACTOR_WHEELBASE_M
        by_steer = (kg(SINGLE_AXLE_LB) - STEER_TARE_KG) / to_steer
        by_drive = (kg(TANDEM_LB) - DRIVE_TARE_KG) / (1 - to_steer)
        return DRIVE_TARE_KG + min(by_steer, by_drive), rear_limit
    return limit(front.id, front.kind), rear_limit
