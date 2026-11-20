"""Axle loads of a loaded truck, against the legal limits.

Limits: CONTRAN Resolution 882/2021 (DOU 2021-12-24), art. 6, items II, III, V and VII.
Art. 50 sets the weighing tolerance (12.5 % per axle); a plan should respect the limit
itself, so the tolerance is reported but not used to pass a load.

This module covers what the weigh-station demo needs: a rigid truck with two axle groups.
"""

from app.scenario import AxleGroupKind, Scenario
from physics.results import AxleLoad, Finding

LEGAL_LIMIT_KG: dict[AxleGroupKind, float] = {
    AxleGroupKind.SINGLE_2_TYRES: 6_000,  # art. 6, II
    AxleGroupKind.SINGLE_4_TYRES: 10_000,  # art. 6, III
    AxleGroupKind.TANDEM_2_AXLES: 17_000,  # art. 6, V (axles 1.20 m to 2.40 m apart)
    AxleGroupKind.TANDEM_3_AXLES: 25_500,  # art. 6, VII (semi-trailers only)
}
WEIGHING_TOLERANCE_PER_AXLE = 0.125  # art. 50, II


def axle_loads(scenario: Scenario) -> list[AxleLoad]:
    """Load on each axle group: tare plus the cargo, shared by a moment balance."""
    if scenario.vehicle is None:
        return []
    front, rear = scenario.vehicle.axle_groups
    span = front.position_x_m - rear.position_x_m
    front_cargo = rear_cargo = 0.0
    for unit in scenario.units:
        # A unit at the rear group puts all its weight there; at the front group, none.
        share_front = (unit.position_m[0] - rear.position_x_m) / span
        front_cargo += unit.mass_kg * share_front
        rear_cargo += unit.mass_kg * (1 - share_front)
    loads = []
    for group, cargo in ((front, front_cargo), (rear, rear_cargo)):
        limit = LEGAL_LIMIT_KG[group.kind]
        load = group.tare_load_kg + cargo
        loads.append(
            AxleLoad(
                axle_group_id=group.id,
                load_kg=round(load, 1),
                limit_kg=limit,
                ratio=round(load / limit, 4),
            )
        )
    return loads


def axle_findings(loads: list[AxleLoad]) -> list[Finding]:
    return [
        Finding(
            code="axle_overloaded",
            severity="fail",
            axle_group_id=load.axle_group_id,
            value=load.load_kg,
            limit=load.limit_kg,
            message=(
                f"Axle group {load.axle_group_id} carries {load.load_kg / 1000:.2f} t; "
                f"the legal limit is {load.limit_kg / 1000:.1f} t."
            ),
        )
        for load in loads
        if load.load_kg > load.limit_kg
    ]
