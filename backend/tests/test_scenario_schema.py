"""The scenario schema accepts well-formed loads and rejects inconsistent ones."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.scenario import (
    SCHEMA_VERSION,
    CargoMaterial,
    CargoUnit,
    FloorMaterial,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    TruckBed,
)
from app.scenario.presets import side_anchor_points, top_over_lashings

ANCHORS = side_anchor_points(length_m=6.0, width_m=2.4)
BED = TruckBed(
    length_m=6.0, width_m=2.4, floor_material=FloorMaterial.PLYWOOD_LAMINATE, anchor_points=ANCHORS
)


def unit(unit_id: str = "u1", **overrides: Any) -> CargoUnit:
    fields: dict[str, Any] = {
        "id": unit_id,
        "size_m": (1.2, 1.0, 1.0),
        "mass_kg": 800.0,
        "position_m": (0.0, 0.0, 0.0),
        "material": CargoMaterial.SAWN_WOOD,
    }
    return CargoUnit(**{**fields, **overrides})


def strap(**overrides: Any) -> Lashing:
    fields: dict[str, Any] = {
        "id": "s1",
        "kind": LashingKind.STRAP,
        "routing": LashingRouting.TOP_OVER,
        "unit_id": "u1",
        "anchor_ids": ["L6", "R6"],
        "pretension_n": 3000.0,
        "lashing_capacity_n": 25000.0,
    }
    return Lashing(**{**fields, **overrides})


def test_a_valid_scenario_round_trips_through_json() -> None:
    box = unit()
    scenario = Scenario(
        id="demo",
        bed=BED,
        units=[box],
        lashings=top_over_lashings(
            box, ANCHORS, count=2, pretension_n=3000, lashing_capacity_n=25000
        ),
    )

    restored = Scenario.model_validate_json(scenario.model_dump_json())

    assert restored == scenario
    assert restored.schema_version == SCHEMA_VERSION


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError, match="extra"):
        Scenario.model_validate(
            {"id": "x", "bed": BED.model_dump(), "units": [unit().model_dump()], "colour": "red"}
        )


def test_a_newer_schema_version_is_rejected() -> None:
    payload = Scenario(id="x", bed=BED, units=[unit()]).model_dump()
    payload["schema_version"] = 2
    with pytest.raises(ValidationError):
        Scenario.model_validate(payload)


def test_duplicate_unit_ids_are_rejected() -> None:
    with pytest.raises(ValidationError, match="duplicate cargo unit"):
        Scenario(id="x", bed=BED, units=[unit(), unit(position_m=(2.0, 0.0, 0.0))])


def test_overlapping_units_are_rejected() -> None:
    with pytest.raises(ValidationError, match="overlap"):
        Scenario(id="x", bed=BED, units=[unit("a"), unit("b", position_m=(0.5, 0.0, 0.0))])


def test_units_may_touch_and_stack() -> None:
    scenario = Scenario(
        id="x",
        bed=BED,
        units=[
            unit("a"),
            unit("b", position_m=(1.2, 0.0, 0.0)),
            unit("c", position_m=(0.0, 0.0, 1.0)),
        ],
    )
    assert len(scenario.units) == 3


def test_a_floating_unit_is_rejected() -> None:
    with pytest.raises(ValidationError, match="not resting"):
        Scenario(id="x", bed=BED, units=[unit(position_m=(0.0, 0.0, 0.4))])


def test_a_lashing_must_refer_to_existing_units_and_anchors() -> None:
    with pytest.raises(ValidationError, match="unknown unit"):
        Scenario(id="x", bed=BED, units=[unit()], lashings=[strap(unit_id="ghost")])
    with pytest.raises(ValidationError, match="unknown anchor"):
        Scenario(id="x", bed=BED, units=[unit()], lashings=[strap(anchor_ids=["L6", "nope"])])


def test_top_over_anchors_must_be_on_opposite_sides_and_over_the_unit() -> None:
    with pytest.raises(ValidationError, match="opposite sides"):
        Scenario(id="x", bed=BED, units=[unit()], lashings=[strap(anchor_ids=["L6", "L5"])])
    with pytest.raises(ValidationError, match="does not pass over"):
        Scenario(id="x", bed=BED, units=[unit()], lashings=[strap(anchor_ids=["L0", "R0"])])


def test_direct_routing_needs_one_anchor_and_an_attachment_point_on_the_unit() -> None:
    with pytest.raises(ValidationError, match="attachment_point_m"):
        strap(routing=LashingRouting.DIRECT, anchor_ids=["L0"])
    with pytest.raises(ValidationError, match="off the unit"):
        Scenario(
            id="x",
            bed=BED,
            units=[unit()],
            lashings=[
                strap(
                    routing=LashingRouting.DIRECT,
                    anchor_ids=["L0"],
                    attachment_point_m=(3.0, 0.0, 0.5),
                )
            ],
        )


def test_pretension_cannot_exceed_the_lashing_capacity() -> None:
    with pytest.raises(ValidationError, match="pretension_n"):
        strap(pretension_n=30000.0)
