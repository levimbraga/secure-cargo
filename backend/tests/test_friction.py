"""Friction factors come from EN 12195-1 Annex B, with documented fallbacks."""

import pytest

from app.scenario import CargoMaterial, FloorMaterial
from physics.friction import DIRTY_SURFACE_CAP, resolve_friction


@pytest.mark.parametrize(
    ("material", "floor", "expected"),
    [
        (CargoMaterial.SAWN_WOOD, FloorMaterial.PLYWOOD_LAMINATE, 0.45),
        (CargoMaterial.SAWN_WOOD, FloorMaterial.GROOVED_ALUMINIUM, 0.40),
        (CargoMaterial.PLANE_WOOD, FloorMaterial.STAINLESS_STEEL, 0.20),
        (CargoMaterial.PLASTIC_PALLET, FloorMaterial.PLYWOOD_LAMINATE, 0.20),
        (CargoMaterial.STEEL_CRATE, FloorMaterial.GROOVED_ALUMINIUM, 0.30),
        (CargoMaterial.CONCRETE_ROUGH, FloorMaterial.SAWN_WOOD, 0.70),
        (CargoMaterial.RUBBER_MAT, FloorMaterial.STAINLESS_STEEL, 0.60),
    ],
)
def test_table_values(material: CargoMaterial, floor: FloorMaterial, expected: float) -> None:
    friction = resolve_friction(material, floor)
    assert friction.coefficient == expected
    assert friction.source == "en_12195_1_annex_b"


def test_a_pair_missing_from_the_table_falls_back_to_the_ctu_code_value() -> None:
    friction = resolve_friction(CargoMaterial.STEEL_CRATE, FloorMaterial.SAWN_WOOD)
    assert friction.coefficient == 0.30
    assert friction.source == "fallback_pair_not_listed"


def test_cargo_on_cargo_uses_the_fallback() -> None:
    assert resolve_friction(CargoMaterial.SAWN_WOOD, None).source == "fallback_pair_not_listed"


def test_a_tested_value_overrides_the_table() -> None:
    friction = resolve_friction(
        CargoMaterial.SAWN_WOOD, FloorMaterial.PLYWOOD_LAMINATE, override=0.52
    )
    assert friction.coefficient == 0.52
    assert friction.source == "unit_override"


def test_a_dirty_deck_caps_the_friction_factor() -> None:
    friction = resolve_friction(
        CargoMaterial.SAWN_WOOD, FloorMaterial.PLYWOOD_LAMINATE, surface_cap=DIRTY_SURFACE_CAP
    )
    assert friction.coefficient == 0.20
    assert friction.capped_by_dirty_surface


def test_a_cap_above_the_table_value_changes_nothing() -> None:
    friction = resolve_friction(
        CargoMaterial.PLASTIC_PALLET, FloorMaterial.GROOVED_ALUMINIUM, surface_cap=0.3
    )
    assert friction.coefficient == 0.15
    assert not friction.capped_by_dirty_surface
