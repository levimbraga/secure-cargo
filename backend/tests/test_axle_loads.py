"""Axle loads against hand calculations, and the limits of CONTRAN Resolution 882/2021."""

import pytest

from app.scenario import (
    AxleGroup,
    AxleGroupKind,
    CargoMaterial,
    CargoUnit,
    FloorMaterial,
    Scenario,
    TruckBed,
    Vehicle,
)
from rules.axle_loads import LEGAL_LIMIT_KG, axle_findings, axle_loads

BED = TruckBed(
    length_m=6.0, width_m=2.4, floor_material=FloorMaterial.PLYWOOD_LAMINATE, anchor_points=[]
)
# Front axle 1.0 m ahead of the bed's front end, rear axle 1.5 m behind the bed's centre.
VEHICLE = Vehicle(
    axle_groups=(
        AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.0, tare_load_kg=3200
        ),
        AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-1.0, tare_load_kg=2300
        ),
    )
)


def scenario(*positions_and_masses: tuple[float, float]) -> Scenario:
    units = [
        CargoUnit(
            id=f"u{index}",
            size_m=(1.0, 1.0, 1.0),
            mass_kg=mass,
            position_m=(x, 0.0, 0.0),
            material=CargoMaterial.SAWN_WOOD,
        )
        for index, (x, mass) in enumerate(positions_and_masses)
    ]
    return Scenario(id="axles", bed=BED, vehicle=VEHICLE, units=units)


def test_limits_are_those_of_resolution_882_article_6() -> None:
    assert LEGAL_LIMIT_KG == {
        AxleGroupKind.SINGLE_2_TYRES: 6000,
        AxleGroupKind.SINGLE_4_TYRES: 10000,
        AxleGroupKind.TANDEM_2_AXLES: 17000,
        AxleGroupKind.TANDEM_3_AXLES: 25500,
    }


def test_a_unit_over_the_rear_axle_loads_only_the_rear_axle() -> None:
    front, rear = axle_loads(scenario((-1.0, 5000)))

    assert front.load_kg == pytest.approx(3200)
    assert rear.load_kg == pytest.approx(2300 + 5000)


def test_a_unit_between_the_axles_is_shared_by_the_lever_rule() -> None:
    # 5 m wheelbase; a 4 t unit 1 m ahead of the rear axle: 1/5 to the front, 4/5 to the rear.
    front, rear = axle_loads(scenario((0.0, 4000)))

    assert front.load_kg == pytest.approx(3200 + 800)
    assert rear.load_kg == pytest.approx(2300 + 3200)
    assert front.load_kg + rear.load_kg == pytest.approx(3200 + 2300 + 4000)


def test_a_unit_behind_the_rear_axle_unloads_the_front_axle() -> None:
    front, rear = axle_loads(scenario((-2.0, 5000)))

    assert front.load_kg == pytest.approx(3200 - 1000)
    assert rear.load_kg == pytest.approx(2300 + 6000)


def test_an_axle_over_its_limit_is_a_failure() -> None:
    loads = axle_loads(scenario((-2.0, 7000)))
    findings = axle_findings(loads)

    assert [finding.axle_group_id for finding in findings] == ["rear"]
    assert findings[0].code == "axle_overloaded"
    assert findings[0].limit == 10000


def test_axles_within_their_limits_raise_nothing() -> None:
    assert axle_findings(axle_loads(scenario((0.5, 6000)))) == []


def test_without_vehicle_data_there_is_no_axle_check() -> None:
    plain = Scenario(id="plain", bed=BED, units=scenario((0.0, 1000)).units)
    assert axle_loads(plain) == []
