"""The per-unit EN 12195-1 check, against the worked examples of the EC guidelines."""

from typing import Any

import pytest

from app.scenario import (
    AnchorPoint,
    CargoMaterial,
    CargoUnit,
    FloorMaterial,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    TruckBed,
)
from physics.results import DirectionCheck, StandardCheck
from rules.en12195 import check_scenario


def scenario(
    *,
    mass_kg: float,
    size_m: tuple[float, float, float],
    anchor_y: float,
    straps: int,
    tension_n: float = 5000.0,
    capacity_n: float = 20000.0,
    friction: float = 0.45,
    kind: LashingKind = LashingKind.STRAP,
) -> Scenario:
    anchors = [
        AnchorPoint(id=f"{side}{index}", position_m=(0.2 * index - 0.4, sign * anchor_y, 0.0))
        for index in range(5)
        for side, sign in (("L", 1), ("R", -1))
    ]
    unit = CargoUnit(
        id="u",
        size_m=size_m,
        mass_kg=mass_kg,
        position_m=(0.0, 0.0, 0.0),
        material=CargoMaterial.SAWN_WOOD,
        friction_coefficient=friction,
    )
    lashings = [
        Lashing(
            id=f"s{index}",
            kind=kind,
            routing=LashingRouting.TOP_OVER,
            unit_id="u",
            anchor_ids=[f"L{index}", f"R{index}"],
            pretension_n=tension_n,
            lashing_capacity_n=capacity_n,
        )
        for index in range(straps)
    ]
    bed = TruckBed(
        length_m=6.0,
        width_m=2.4,
        floor_material=FloorMaterial.PLYWOOD_LAMINATE,
        anchor_points=anchors,
    )
    return Scenario(id="en", bed=bed, units=[unit], lashings=lashings)


def check(**fields: Any) -> StandardCheck:
    return check_scenario(scenario(**fields))[0]


def entry(result: StandardCheck, direction: str, mode: str) -> DirectionCheck:
    return next(c for c in result.checks if c.direction == direction and c.mode == mode)


# EC guidelines 6.1.2: two top-over lashings at 55 degrees, S_TF 500 daN, friction 0.45,
# hold 1.7 t forward (f_s 1.25) and 13.7 t sideways and backward (f_s 1.1).
# A 1.0 m wide, 1.0 m high unit with anchors 0.7 m outside its edges gives the 55 degrees.
BOX: dict[str, Any] = {"size_m": (1.2, 1.0, 1.0), "anchor_y": 1.2, "straps": 2}


def test_two_lashings_hold_the_published_mass_forward_and_no_more() -> None:
    at_limit = check(mass_kg=1700, **BOX)
    over_limit = check(mass_kg=1760, **BOX)

    assert entry(at_limit, "forward", "sliding").ok
    assert at_limit.required_lashings == 2 and at_limit.meets_standard
    assert not entry(over_limit, "forward", "sliding").ok
    assert over_limit.required_lashings == 3 and not over_limit.meets_standard


def test_sideways_and_rearward_use_the_lower_safety_factor() -> None:
    # 13.7 t is the published sideways and backward limit; forward fails long before.
    result = check(mass_kg=13600, **BOX)

    assert entry(result, "sideways", "sliding").ok
    assert entry(result, "rearward", "sliding").ok
    assert entry(result, "sideways", "sliding").required == pytest.approx(
        2 * 13600 / 13660, abs=0.01
    )
    assert not entry(check(mass_kg=13800, **BOX), "sideways", "sliding").ok


# EC guidelines 6.2.6: two lashings at 74 degrees over a 1.0 m wide, 2.4 m high load hold
# 8.9 t against tipping sideways at 0.5 g with S_TF 500 daN, and 8.1 t at 0.6 g with half of
# LC 2000 daN; the lower value governs.
TALL: dict[str, Any] = {"size_m": (7.8, 1.0, 2.4), "anchor_y": 0.5 + 2.4 / 3.4874, "straps": 2}


def test_sideways_tipping_is_governed_by_the_lower_published_mass() -> None:
    assert entry(check(mass_kg=8000, **TALL), "sideways", "tilting").ok
    assert not entry(check(mass_kg=8300, **TALL), "sideways", "tilting").ok


def test_a_stable_box_needs_no_lashing_against_tipping() -> None:
    result = check(mass_kg=1000, **BOX)

    assert entry(result, "forward", "tilting").required == 0
    assert entry(result, "sideways", "tilting").required == 0


def test_high_friction_needs_no_lashing_sideways() -> None:
    result = check(mass_kg=5000, friction=0.6, **BOX)

    assert entry(result, "sideways", "sliding").required == 0
    assert entry(result, "forward", "sliding").required > 0


def test_an_unsecured_unit_that_can_slide_does_not_meet_the_standard() -> None:
    result = check(mass_kg=500, size_m=(1.2, 1.0, 1.0), anchor_y=1.2, straps=0)

    assert result.method == "unsecured"
    assert result.meets_standard is False
    assert result.required_lashings is None


def test_rope_never_meets_the_standard() -> None:
    result = check(mass_kg=100, kind=LashingKind.ROPE, tension_n=300, capacity_n=1000, **BOX)

    assert result.meets_standard is False
    assert "Rope" in result.note


def test_a_stacked_unit_is_not_assessed() -> None:
    base = scenario(mass_kg=1000, **BOX)
    upper = CargoUnit(
        id="top",
        size_m=(1.0, 0.8, 0.5),
        mass_kg=200,
        position_m=(0.0, 0.0, 1.0),
        material=CargoMaterial.SAWN_WOOD,
    )
    stacked = base.model_copy(update={"units": [*base.units, upper]})

    results = {result.unit_id: result for result in check_scenario(stacked)}

    assert results["top"].method == "not_assessed" and results["top"].meets_standard is None
    assert results["u"].method == "not_assessed"
