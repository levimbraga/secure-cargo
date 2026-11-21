"""EU weights in international traffic: Council Directive 96/53/EC, Annex I (as of 2019-08-14).

Sources, worked examples and what is not applied (national limits, the 44 t intermodal case, the
zero-emission allowances, the revision still in trilogue): the workspace's ``notes/eu-rules.md``,
section 2. The Directive has no weighing tolerance.

* a single non-driving axle: 10 t (3.1); a driving axle: 11.5 t (3.4);
* a tandem of a trailer or semi-trailer by its spacing d: < 1.0 m 11 t, < 1.3 m 16 t, < 1.8 m
  18 t, otherwise 20 t (3.2); a tri-axle: d <= 1.3 m 21 t, d <= 1.4 m 24 t (3.3);
* a tandem of a motor vehicle: < 1.0 m 11.5 t, < 1.3 m 16 t, < 1.8 m 18 t, or 19 t with twin
  tyres and air suspension (3.5);
* gross: two-axle motor vehicle 18 t (2.3.1), three-axle 25 t, 26 t with air suspension (2.3.2),
  five- or six-axle articulated vehicle 40 t (2.2.2);
* the driving axle(s) carry at least 25 % of the total laden weight (4.1).

Axle loads come from the same moment balance as the other countries (``axle_loads.py``). On the EU
articulated presets the kingpin load is shared between the 4x2 tractor's steer and driving axles
by the tractor's geometry (as ``us_weights.py`` does for the US tractors). Other trucks keep their
two modelled groups: a Brazilian or US semi's kingpin group is checked as a motor-vehicle tandem.
"""

from dataclasses import dataclass

from app.explorer.config import EU_ARTICULATED, EU_SIZES, Size
from app.scenario import AxleGroupKind, Scenario
from rules.axle_loads import axle_loads

T = 1000.0
SINGLE_NON_DRIVING_KG = 10 * T  # 3.1
DRIVING_AXLE_KG = 11.5 * T  # 3.4
GROSS_TWO_AXLE_KG = 18 * T  # 2.3.1
GROSS_THREE_AXLE_KG = 25 * T  # 2.3.2
GROSS_THREE_AXLE_AIR_KG = 26 * T  # 2.3.2, twin-tyred driving axle on air suspension
GROSS_ARTICULATED_KG = 40 * T  # 2.2.2 (a), (b)
MIN_DRIVING_SHARE = 0.25  # 4.1

# EU 4x2 tractor of the articulated presets (notes/eu-rules.md section 4, an assumption): wheelbase
# 3.7 m, fifth wheel 0.55 m ahead of the driving axle, 5,000 kg on the steer axle and 2,400 kg on
# the driving axle empty (the driving-axle tare is part of the kingpin group's tare).
TRACTOR_WHEELBASE_M = 3.7
FIFTH_WHEEL_AHEAD_M = 0.55
STEER_TARE_KG = 5000.0
DRIVE_TARE_KG = 2400.0

# Spacing of the axles of a group [m]: the EU presets' driving tandem 1.37 m and tri-axle 1.31 m;
# Brazil's tandem 1.32 m and triple 1.25 m; the US trailer tandem 49 in.
EU_TANDEM_SPREAD_M = 1.37
EU_TRI_AXLE_SPREAD_M = 1.31
OTHER_SPREAD_M: dict[AxleGroupKind, float] = {
    AxleGroupKind.TANDEM_2_AXLES: 1.32,
    AxleGroupKind.TANDEM_3_AXLES: 1.25,
}
US_TRAILER_TANDEM_M = 49 * 0.0254


@dataclass(frozen=True)
class EuAxle:
    group: str  # "steer", "front", "rear", "drive", "tractor", "trailer"
    axles: int
    spread_m: float
    load_kg: float
    limit_kg: float
    point: str  # the Annex I point of the limit
    driving: bool


def tandem_trailer_limit_kg(spread_m: float) -> float:
    """Annex I 3.2: a tandem axle of a trailer or semi-trailer."""
    if spread_m < 1.0:
        return 11 * T
    if spread_m < 1.3:
        return 16 * T
    if spread_m < 1.8:
        return 18 * T
    return 20 * T


def tri_axle_limit_kg(spread_m: float) -> float:
    """Annex I 3.3: a tri-axle of a trailer or semi-trailer (beyond 1.4 m: silent, 24 t used)."""
    return 21 * T if spread_m <= 1.3 + 1e-9 else 24 * T


def tandem_motor_limit_kg(spread_m: float, air: bool) -> float:
    """Annex I 3.5: a tandem axle of a motor vehicle."""
    if spread_m < 1.0:
        return 11.5 * T
    if spread_m < 1.3:
        return 16 * T
    return (19 if air else 18) * T


def _spread(kind: AxleGroupKind, group: str, size: Size | None) -> float:
    if kind is AxleGroupKind.TANDEM_3_AXLES and size in EU_SIZES:
        return EU_TRI_AXLE_SPREAD_M
    if kind is AxleGroupKind.TANDEM_2_AXLES and size in EU_SIZES:
        return EU_TANDEM_SPREAD_M
    if (
        kind is AxleGroupKind.TANDEM_2_AXLES
        and group == "trailer"
        and size
        and size.startswith("us_")
    ):
        return US_TRAILER_TANDEM_M
    return OTHER_SPREAD_M.get(kind, 0.0)


def _count(kind: AxleGroupKind) -> int:
    return {AxleGroupKind.TANDEM_2_AXLES: 2, AxleGroupKind.TANDEM_3_AXLES: 3}.get(kind, 1)


def eu_axles(scenario: Scenario, size: Size | None) -> list[EuAxle]:
    """Every axle group with its load and its Annex I limit, front to back."""
    if scenario.vehicle is None:
        return []
    loads = {load.axle_group_id: load.load_kg for load in axle_loads(scenario)}
    front, rear = scenario.vehicle.axle_groups
    air = size in EU_SIZES
    out: list[EuAxle] = []
    if size in EU_ARTICULATED:
        kingpin = loads[front.id] - DRIVE_TARE_KG
        to_steer = FIFTH_WHEEL_AHEAD_M / TRACTOR_WHEELBASE_M
        steer = STEER_TARE_KG + kingpin * to_steer
        drive = DRIVE_TARE_KG + kingpin * (1 - to_steer)
        out.append(EuAxle("steer", 1, 0.0, round(steer, 1), SINGLE_NON_DRIVING_KG, "3.1", False))
        out.append(EuAxle("drive", 1, 0.0, round(drive, 1), DRIVING_AXLE_KG, "3.4", True))
    else:
        articulated = front.id == "tractor"
        count = _count(front.kind)
        spread = _spread(front.kind, front.id, size)
        if articulated:  # a Brazilian or US tractor's driving group at the kingpin
            limit, point = (
                (tandem_motor_limit_kg(spread, air), "3.5")
                if count == 2
                else (DRIVING_AXLE_KG, "3.4")
            )
            out.append(EuAxle(front.id, count, spread, loads[front.id], limit, point, True))
        else:  # a rigid truck's front axle: single, non-driving
            out.append(
                EuAxle(
                    front.id, count, spread, loads[front.id], SINGLE_NON_DRIVING_KG, "3.1", False
                )
            )
    count = _count(rear.kind)
    spread = _spread(rear.kind, rear.id, size)
    if rear.id == "trailer":
        limit, point = (
            (tri_axle_limit_kg(spread), "3.3")
            if count == 3
            else (tandem_trailer_limit_kg(spread), "3.2")
        )
        if count == 1:
            limit, point = SINGLE_NON_DRIVING_KG, "3.1"
        out.append(EuAxle(rear.id, count, spread, loads[rear.id], limit, point, False))
    else:  # a rigid truck's driving axle or driving tandem
        if count == 1:
            limit, point = DRIVING_AXLE_KG, "3.4"
        else:
            limit, point = tandem_motor_limit_kg(spread, air), "3.5"
        out.append(EuAxle(rear.id, count, spread, loads[rear.id], limit, point, True))
    return out


def gross_limit(scenario: Scenario, size: Size | None) -> tuple[float, str]:
    """The maximum authorised weight of the vehicle's class and its Annex I point."""
    assert scenario.vehicle is not None
    front, rear = scenario.vehicle.axle_groups
    if front.id == "tractor":
        return GROSS_ARTICULATED_KG, "2.2.2"
    axles = _count(front.kind) + _count(rear.kind)
    if axles == 2:
        return GROSS_TWO_AXLE_KG, "2.3.1"
    return (GROSS_THREE_AXLE_AIR_KG if size in EU_SIZES else GROSS_THREE_AXLE_KG), "2.3.2"


def group_limits_kg(scenario: Scenario, size: Size | None) -> tuple[float, float] | None:
    """Limits of the scenario's two modelled groups, for the planner's placement search.

    On an EU articulated preset the kingpin group's limit is the load that keeps both the steer
    axle and the driving axle within theirs.
    """
    if scenario.vehicle is None:
        return None
    axles = eu_axles(scenario, size)
    rear_limit = axles[-1].limit_kg
    if size in EU_ARTICULATED:
        to_steer = FIFTH_WHEEL_AHEAD_M / TRACTOR_WHEELBASE_M
        by_steer = (SINGLE_NON_DRIVING_KG - STEER_TARE_KG) / to_steer
        by_drive = (DRIVING_AXLE_KG - DRIVE_TARE_KG) / (1 - to_steer)
        return DRIVE_TARE_KG + min(by_steer, by_drive), rear_limit
    return axles[0].limit_kg, rear_limit
