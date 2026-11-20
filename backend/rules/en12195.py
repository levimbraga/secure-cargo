"""Securing of each unit against the design values of EN 12195-1:2010.

This is the standard's own calculation, not the simulation: 0.8 g forward and 0.5 g rearward
and sideways, with the safety factor ``f_s`` for frictional (top-over) lashing and the
friction conversion factor ``f_mu`` for direct lashing. The simulation answers "does this
load survive this event"; this module answers "does the lashing meet the standard".

Sources (see docs/validation.md): the factors are in the standard's public preview (foreword
item d, 3.2.19, 3.2.20, Table 2); the direction of each safety factor and the equations are in
the European Commission's 2014 best-practice guidelines (6.1.2, 6.1.3, 6.1.5, 6.2.6).

Scope: units standing on the floor, secured either by top-over lashings or by direct
lashings. A unit on top of another, or with both kinds of lashing, is not assessed.
"""

import math
from typing import Literal

from app.scenario import CargoUnit, Lashing, LashingKind, LashingRouting, Scenario
from physics.constants import (
    EN_CX_FORWARD,
    EN_CX_REARWARD,
    EN_CY_SLIDING,
    EN_CZ,
    EN_F_MU,
    EN_FS_FORWARD,
    EN_FS_OTHER,
    STANDARD_GRAVITY_MPS2,
)
from physics.friction import resolve_friction
from physics.results import DirectionCheck, StandardCheck

Direction = Literal["forward", "rearward", "sideways"]

# Acceleration coefficient and safety factor of frictional lashing, per direction.
_DESIGN: dict[Direction, tuple[float, float]] = {
    "forward": (EN_CX_FORWARD, EN_FS_FORWARD),
    "rearward": (EN_CX_REARWARD, EN_FS_OTHER),
    "sideways": (EN_CY_SLIDING, EN_FS_OTHER),
}
# Sideways tilting is checked twice (EN 12195-1 Table 2, "0,5/0,6"): 0.5 g with the tension
# force S_TF, and 0.6 g with half the lashing capacity; the larger requirement governs.
_CY_TILTING_WITH_HALF_LC = 0.6
# Unit vector of the movement to prevent, in the bed frame (X forward, Y left).
_MOVEMENT: dict[Direction, tuple[tuple[float, float], ...]] = {
    "forward": ((1.0, 0.0),),
    "rearward": ((-1.0, 0.0),),
    "sideways": ((0.0, 1.0), (0.0, -1.0)),
}
_G = STANDARD_GRAVITY_MPS2


def check_scenario(scenario: Scenario) -> list[StandardCheck]:
    """One check per cargo unit."""
    return [_check_unit(scenario, unit) for unit in scenario.units]


def _check_unit(scenario: Scenario, unit: CargoUnit) -> StandardCheck:
    lashings = [lashing for lashing in scenario.lashings if lashing.unit_id == unit.id]
    top_over = [item for item in lashings if item.routing is LashingRouting.TOP_OVER]
    direct = [item for item in lashings if item.routing is LashingRouting.DIRECT]
    carries_another = any(
        other is not unit and other.position_m[2] > unit.position_m[2] for other in scenario.units
    )
    if (
        unit.position_m[2] > 0
        or (top_over and direct)
        or (carries_another and _overlaps(scenario, unit))
    ):
        return StandardCheck(
            unit_id=unit.id,
            method="not_assessed",
            installed_lashings=len(lashings),
            meets_standard=None,
            checks=[],
            note="Stacked units and mixed lashing methods are outside the closed-form check.",
        )
    friction = resolve_friction(
        unit.material, scenario.bed.floor_material, override=unit.friction_coefficient
    ).coefficient
    if direct:
        checks = _direct_checks(scenario, unit, direct, friction)
        return StandardCheck(
            unit_id=unit.id,
            method="direct",
            installed_lashings=len(direct),
            meets_standard=all(check.ok for check in checks),
            checks=checks,
        )
    checks = _top_over_checks(scenario, unit, top_over, friction)
    required = max((math.ceil(check.required - 1e-9) for check in checks), default=0)
    uses_rope = any(item.kind is LashingKind.ROPE for item in top_over)
    note = ""
    if not top_over:
        note = "No lashing: only friction and the unit's own stability hold it."
    elif uses_rope:
        note = "Rope is not a rated lashing device; it cannot meet the standard."
    return StandardCheck(
        unit_id=unit.id,
        method="top_over" if top_over else "unsecured",
        installed_lashings=len(top_over),
        required_lashings=required if top_over and not uses_rope else None,
        meets_standard=all(check.ok for check in checks) and not uses_rope,
        checks=checks,
        note=note,
    )


def _overlaps(scenario: Scenario, unit: CargoUnit) -> bool:
    """Whether another unit rests on this one."""
    top = unit.position_m[2] + unit.size_m[2]
    for other in scenario.units:
        if other is unit or abs(other.position_m[2] - top) > 0.005:
            continue
        if all(
            abs(other.position_m[axis] - unit.position_m[axis])
            < (other.size_m[axis] + unit.size_m[axis]) / 2
            for axis in (0, 1)
        ):
            return True
    return False


def _top_over_checks(
    scenario: Scenario, unit: CargoUnit, lashings: list[Lashing], friction: float
) -> list[DirectionCheck]:
    """Sliding (eq. 10) and tilting of a unit under top-over lashings, or under none."""
    length, width, height = unit.size_m
    installed = len(lashings)
    # The weakest lashing governs: lowest tension, lowest capacity, flattest angle.
    tension = min((item.pretension_n for item in lashings), default=0.0)
    capacity = min((item.lashing_capacity_n for item in lashings), default=0.0)
    sine = min((_top_over_sine(scenario, unit, item) for item in lashings), default=1.0)

    def lashings_for(moment_or_force: float, safety_factor: float, per_lashing: float) -> float:
        if moment_or_force <= 0:
            return 0.0
        if per_lashing <= 0:
            return math.inf
        return moment_or_force * safety_factor / per_lashing

    checks: list[DirectionCheck] = []
    for direction, (coefficient, safety_factor) in _DESIGN.items():
        # Sliding: n >= (c - mu cz) m g / (2 mu sin(alpha) F_T) * f_s.
        sliding = lashings_for(
            (coefficient - friction * EN_CZ) * unit.mass_kg * _G,
            safety_factor,
            2 * friction * sine * tension,
        )
        checks.append(_lashing_check(direction, "sliding", sliding, installed))

        # Tilting: n >= m g (c h / b - cz) / (2 F_T sin(alpha)) * f_s, with b the base
        # length in the direction of the movement.
        base = width if direction == "sideways" else length
        tilting = lashings_for(
            (coefficient * height / base - EN_CZ) * unit.mass_kg * _G,
            safety_factor,
            2 * sine * tension,
        )
        if direction == "sideways":
            tilting = max(
                tilting,
                lashings_for(
                    (_CY_TILTING_WITH_HALF_LC * height / base - EN_CZ) * unit.mass_kg * _G,
                    safety_factor,
                    2 * sine * 0.5 * capacity,
                ),
            )
        checks.append(_lashing_check(direction, "tilting", tilting, installed))
    return checks


def _lashing_check(
    direction: Direction, mode: Literal["sliding", "tilting"], required: float, installed: int
) -> DirectionCheck:
    return DirectionCheck(
        direction=direction,
        mode=mode,
        quantity="lashings",
        required=round(required, 3) if math.isfinite(required) else 999.0,
        provided=installed,
        ok=installed >= required - 1e-9,
    )


def _top_over_sine(scenario: Scenario, unit: CargoUnit, lashing: Lashing) -> float:
    """Sine of the angle between a top-over lashing and the floor (the flatter of its sides)."""
    anchors = {anchor.id: anchor.position_m for anchor in scenario.bed.anchor_points}
    top = unit.position_m[2] + unit.size_m[2]
    sines = []
    for anchor_id in lashing.anchor_ids:
        anchor = anchors[anchor_id]
        side = 1.0 if anchor[1] > unit.position_m[1] else -1.0
        edge_y = unit.position_m[1] + side * unit.size_m[1] / 2
        rise = top - anchor[2]
        sines.append(rise / math.hypot(rise, anchor[1] - edge_y))
    return min(sines)


def _direct_checks(
    scenario: Scenario, unit: CargoUnit, lashings: list[Lashing], friction: float
) -> list[DirectionCheck]:
    """Sliding of a unit held by direct lashings (based on eq. 22 / eq. 35 of the standard).

    Lashings that pull against the movement each restrain
    ``LC * (f_mu mu sin(alpha) + cos(alpha) cos(beta))``; together they must hold
    ``m g (c - f_mu mu cz)``.
    """
    anchors = {anchor.id: anchor.position_m for anchor in scenario.bed.anchor_points}
    effective = EN_F_MU * friction
    checks = []
    for direction, (coefficient, _) in _DESIGN.items():
        demand = max(unit.mass_kg * _G * (coefficient - effective * EN_CZ), 0.0)
        capacities = []
        for movement in _MOVEMENT[direction]:
            capacity = 0.0
            for lashing in lashings:
                assert lashing.attachment_point_m is not None
                anchor = anchors[lashing.anchor_ids[0]]
                point = tuple(
                    unit.position_m[axis] + lashing.attachment_point_m[axis] for axis in range(3)
                )
                pull = tuple(anchor[axis] - point[axis] for axis in range(3))
                span = math.hypot(*pull)
                # Component of the pull that opposes the movement (cos(alpha) cos(beta)).
                against = -(pull[0] * movement[0] + pull[1] * movement[1]) / span
                if against <= 0:
                    continue  # this lashing goes slack when the unit moves that way
                down = max(-pull[2] / span, 0.0)  # sin(alpha): how much it presses down
                capacity += lashing.lashing_capacity_n * (effective * down + against)
            capacities.append(capacity)
        provided = min(capacities)
        checks.append(
            DirectionCheck(
                direction=direction,
                mode="sliding",
                quantity="force_n",
                required=round(demand, 1),
                provided=round(provided, 1),
                ok=provided >= demand,
            )
        )
    # Stability of the unit itself (eq. 3): b > (c / cz) d.
    length, width, height = unit.size_m
    for direction, (coefficient, _) in _DESIGN.items():
        base = width if direction == "sideways" else length
        if base / 2 <= coefficient / EN_CZ * height / 2:
            checks.append(
                DirectionCheck(
                    direction=direction,
                    mode="tilting",
                    quantity="force_n",
                    required=0.0,
                    provided=0.0,
                    ok=False,
                )
            )
    return checks
