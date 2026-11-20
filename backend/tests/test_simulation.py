"""Behaviour of the simulation: metrics, verdicts, determinism."""

from typing import Any

import pytest

from app.scenario import (
    CargoMaterial,
    CargoUnit,
    EventKind,
    FloorMaterial,
    Headboard,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    TripEvent,
    TruckBed,
)
from app.scenario.presets import side_anchor_points, top_over_lashings
from physics.constants import REPLAY_FPS, STANDARD_GRAVITY_MPS2
from physics.profile import constant_pulse
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash
from physics.simulate import simulate

G = STANDARD_GRAVITY_MPS2
ANCHORS = side_anchor_points(length_m=6.0, width_m=2.4, spacing_m=0.25)


def bed(**overrides: Any) -> TruckBed:
    fields: dict[str, Any] = {
        "length_m": 6.0,
        "width_m": 2.4,
        "floor_material": FloorMaterial.PLYWOOD_LAMINATE,
        "headboard": Headboard(height_m=1.2),
        "anchor_points": ANCHORS,
    }
    return TruckBed(**{**fields, **overrides})


def box(unit_id: str = "u1", **overrides: Any) -> CargoUnit:
    fields: dict[str, Any] = {
        "id": unit_id,
        "size_m": (1.2, 1.0, 1.0),
        "mass_kg": 1000.0,
        "position_m": (0.0, 0.0, 0.0),
        "material": CargoMaterial.SAWN_WOOD,
    }
    return CargoUnit(**{**fields, **overrides})


def strapped(unit: CargoUnit, straps: int, **bed_overrides: Any) -> Scenario:
    return Scenario(
        id="test",
        bed=bed(**bed_overrides),
        units=[unit],
        lashings=top_over_lashings(
            unit, ANCHORS, count=straps, pretension_n=4000, lashing_capacity_n=25000
        ),
    )


def brake(scenario: Scenario, g: float, hold_s: float = 1.5) -> SimulationResult:
    return simulate(scenario, constant_pulse(acceleration_mps2=(-g * G, 0, 0), hold_s=hold_s))


def test_a_load_below_its_friction_limit_does_not_move() -> None:
    result = brake(strapped(box(), 0), 0.40)  # sawn wood on plywood: friction 0.45

    assert result.verdict.status == "pass"
    assert result.verdict.findings == []
    assert result.units[0].max_slide_m < 0.001
    assert result.units[0].friction_coefficient == 0.45
    assert result.units[0].friction_source == "en_12195_1_annex_b"


def test_a_load_above_its_friction_limit_slides_and_fails() -> None:
    result = brake(strapped(box(), 0), 0.55)

    assert result.verdict.status == "fail"
    assert result.verdict.findings[0].code == "unit_slid"
    assert result.keyframes.result.unit_ids == ["u1"]


def test_doubling_the_mass_under_the_same_lashing_fails() -> None:
    # Two straps hold 1000 kg at 0.8 g (formula: 1.16 straps), not 2000 kg (2.33 straps).
    light = brake(strapped(box(mass_kg=1000), 2), 0.8)
    heavy = brake(strapped(box(mass_kg=2000), 2), 0.8)

    assert light.verdict.status == "pass"
    assert heavy.verdict.status == "fail"
    assert heavy.units[0].max_slide_m > 0.05


def test_the_same_input_gives_exactly_the_same_output() -> None:
    scenario = strapped(box(mass_kg=2000), 2)
    event = TripEvent(kind=EventKind.LONG_VIBRATION, speed_kmh=80, road_surface="gravel")

    first = run_event(scenario, event)
    second = run_event(scenario, event)

    assert first.model_dump_json() == second.model_dump_json()


def test_lashings_start_at_the_pretension_given_in_the_scenario() -> None:
    result = brake(strapped(box(), 3), 0.1)

    for lashing in result.lashings:
        assert lashing.initial_tension_n == pytest.approx(4000, rel=0.005)


def test_the_bed_follows_the_prescribed_motion() -> None:
    result = brake(strapped(box(mass_kg=20000, size_m=(4.0, 2.2, 1.5)), 4), 0.8)

    assert result.engine.bed_tracking_error_m < 1e-6


def test_an_unsecured_load_slides_into_the_headboard() -> None:
    result = brake(strapped(box(), 0), 0.8, hold_s=2.5)
    unit = result.units[0]

    assert unit.hit_headboard
    assert unit.peak_headboard_force_n > 1000
    assert "unit_hit_headboard" in {finding.code for finding in result.verdict.findings}
    # It cannot go further than the gap to the headboard (2.4 m), give or take a bounce.
    assert unit.max_slide_m == pytest.approx(2.4, abs=0.05)


def test_a_load_blocked_by_the_headboard_is_held_without_an_impact() -> None:
    blocked = box(position_m=(2.4, 0.0, 0.0))  # front face touching the headboard
    result = brake(strapped(blocked, 0), 0.8)
    unit = result.units[0]

    assert not unit.hit_headboard
    assert unit.max_slide_m < 0.005
    assert unit.peak_headboard_force_n > 0
    assert result.verdict.status == "pass"


def test_an_overloaded_headboard_fails_the_run() -> None:
    blocked = box(mass_kg=8000, size_m=(2.0, 2.0, 1.0), position_m=(2.0, 0.0, 0.0))
    weak = Headboard(height_m=1.2, rated_capacity_n=10000)
    result = brake(strapped(blocked, 0, headboard=weak), 0.8)

    assert "headboard_overloaded" in {finding.code for finding in result.verdict.findings}
    assert result.verdict.status == "fail"


def test_a_load_thrown_sideways_leaves_a_bed_without_side_rails() -> None:
    unit = box(friction_coefficient=0.2)
    result = simulate(
        strapped(unit, 0), constant_pulse(acceleration_mps2=(0, 0.5 * G, 0), hold_s=2.5)
    )

    assert result.units[0].left_bed
    assert "unit_left_bed" in {finding.code for finding in result.verdict.findings}


def test_side_rails_keep_the_load_on_the_bed() -> None:
    unit = box(friction_coefficient=0.2)
    result = simulate(
        strapped(unit, 0, side_rail_height_m=0.6),
        constant_pulse(acceleration_mps2=(0, 0.5 * G, 0), hold_s=2.5),
    )

    assert not result.units[0].left_bed
    assert result.verdict.status == "fail"  # it still slid into the rail


def test_a_tall_load_tips_over() -> None:
    tall = box(size_m=(0.8, 1.0, 2.4), friction_coefficient=0.9)
    result = brake(strapped(tall, 0), 0.6)

    assert result.units[0].max_tilt_deg > 5
    assert "unit_tilted" in {finding.code for finding in result.verdict.findings}


def test_a_rope_that_is_too_weak_breaks() -> None:
    unit = box(mass_kg=2000, friction_coefficient=0.2)
    rope = Lashing(
        id="rope",
        kind=LashingKind.ROPE,
        routing=LashingRouting.DIRECT,
        unit_id="u1",
        anchor_ids=["L4"],
        attachment_point_m=(-0.6, 0.5, 1.0),
        pretension_n=200,
        lashing_capacity_n=1500,
        breaking_strength_n=5000,
    )
    scenario = Scenario(id="test", bed=bed(), units=[unit], lashings=[rope])
    result = brake(scenario, 0.8, hold_s=2.0)
    lashing = result.lashings[0]

    assert lashing.broke_at_s is not None
    assert lashing.final_tension_n == 0
    assert "lashing_broke" in {finding.code for finding in result.verdict.findings}
    assert result.verdict.status == "fail"


def test_stacked_units_stay_put_when_nothing_happens() -> None:
    lower = box("lower", size_m=(1.2, 1.0, 0.8))
    upper = box("upper", size_m=(1.0, 0.8, 0.6), mass_kg=300, position_m=(0.0, 0.0, 0.8))
    scenario = Scenario(id="test", bed=bed(), units=[lower, upper])
    result = brake(scenario, 0.0, hold_s=1.0)

    assert result.verdict.status == "pass"
    assert max(unit.max_slide_m for unit in result.units) < 0.001


def test_a_muddy_road_caps_the_cargo_friction() -> None:
    event = TripEvent(kind=EventKind.EMERGENCY_BRAKING, speed_kmh=40, road_surface="mud")
    result = run_event(strapped(box(), 2), event)

    assert result.units[0].friction_coefficient == 0.2
    assert result.profile["cargo_friction_cap"] == 0.2


def test_keyframes_cover_the_event_at_thirty_frames_per_second() -> None:
    scenario = strapped(box(), 2)
    result = brake(scenario, 0.5, hold_s=1.0)
    keyframes = result.keyframes

    assert keyframes.version == 2
    assert keyframes.source == "simulation"
    assert keyframes.fps == REPLAY_FPS
    assert len(keyframes.frames) == round(keyframes.duration_s * REPLAY_FPS) + 1
    assert [frame.t for frame in keyframes.frames[:3]] == pytest.approx(
        [0, 1 / 30, 2 / 30], abs=1e-4
    )
    first = keyframes.frames[0]
    assert len(first.units) == 1 and len(first.straps) == 2
    # The unit starts where the scenario put it (centre of the box), upright.
    assert first.units[0].p == pytest.approx((0.0, 0.0, 0.5), abs=0.005)
    assert first.units[0].q == pytest.approx((1, 0, 0, 0), abs=1e-4)
    assert first.straps[0].tension_n == pytest.approx(4000, rel=0.01)
    assert len(keyframes.straps[0].path_m) == 4
    assert keyframes.events[0].kind == "pulse_start"


def test_axle_loads_are_reported_when_the_vehicle_is_described() -> None:
    from app.scenario import AxleGroup, AxleGroupKind, Vehicle

    vehicle = Vehicle(
        axle_groups=(
            AxleGroup(
                id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=3.5, tare_load_kg=3500
            ),
            AxleGroup(
                id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-1.0, tare_load_kg=2500
            ),
        )
    )
    heavy = box(mass_kg=8000, size_m=(2.0, 2.0, 1.0), position_m=(-1.5, 0.0, 0.0))
    scenario = Scenario(id="test", bed=bed(), vehicle=vehicle, units=[heavy])
    event = TripEvent(kind=EventKind.SHARP_CURVE, speed_kmh=30)

    result = run_event(scenario, event)

    # 8 t placed 0.5 m behind the rear axle: the rear carries more than the whole load.
    rear = next(load for load in result.axle_loads if load.axle_group_id == "rear")
    assert rear.load_kg == pytest.approx(2500 + 8000 * (3.5 + 1.5) / 4.5, abs=0.1)
    assert rear.load_kg > rear.limit_kg == 10000
    assert "axle_overloaded" in {finding.code for finding in result.verdict.findings}
    assert result.verdict.status == "fail"


def test_the_cache_key_changes_with_any_input() -> None:
    scenario = strapped(box(), 2)
    event = TripEvent(kind=EventKind.EMERGENCY_BRAKING, speed_kmh=80)

    assert scenario_hash(scenario, event) == scenario_hash(scenario, event)
    assert scenario_hash(scenario, event) != scenario_hash(strapped(box(mass_kg=1001), 2), event)
    assert scenario_hash(scenario, event) != scenario_hash(
        scenario, event.model_copy(update={"fog": True})
    )


def test_friction_use_reports_how_close_a_load_is_to_sliding() -> None:
    # Friction 0.45 and no lashing: braking at 0.36 g needs 80 % of the available friction.
    held = brake(strapped(box(), 0), 0.36)
    sliding = brake(strapped(box(), 0), 0.55)

    assert held.units[0].peak_friction_use == pytest.approx(0.80, abs=0.01)
    assert held.margins.peak_friction_use == held.units[0].peak_friction_use
    assert sliding.units[0].peak_friction_use == 1.0


def test_margins_report_the_busiest_lashing_against_its_capacity() -> None:
    result = brake(strapped(box(), 2), 0.5)

    assert result.margins.peak_lashing_force_n == pytest.approx(4000, rel=0.01)
    assert result.margins.peak_lashing_force_ratio == pytest.approx(0.16, abs=0.005)
    assert result.margins.lashing_capacity_reserve == pytest.approx(0.84, abs=0.005)
    assert result.margins.slide_limit_m == 0.05


def test_a_run_without_lashings_has_no_lashing_margin() -> None:
    margins = brake(strapped(box(), 0), 0.2).margins

    assert margins.peak_lashing_force_ratio is None
    assert margins.lashing_capacity_reserve is None


def test_keyframes_carry_what_the_replay_needs_to_draw_forces() -> None:
    result = brake(strapped(box(), 2), 0.5, hold_s=1.0)
    keyframes = result.keyframes
    unit, first = keyframes.units[0], keyframes.frames[0]

    assert unit.mass_kg == 1000 and unit.friction_coefficient == 0.45
    # The floor carries the weight plus the clamping force of two straps at 55 degrees.
    clamping = 2 * 2 * 4000 * 0.819
    assert first.units[0].n == pytest.approx(1000 * G + clamping, rel=0.01)
    # A box rests on its four corners; together the contact points carry that same force.
    floor = [contact for contact in first.contacts if contact[4] == "floor"]
    assert len(floor) == 4
    assert sum(contact[3] for contact in floor) == pytest.approx(first.units[0].n, abs=4)
    assert {round(abs(contact[0]), 1) for contact in floor} == {0.6}
    assert all(abs(contact[2]) < 0.01 for contact in floor)


def test_a_unit_sliding_into_the_headboard_shows_a_headboard_contact() -> None:
    result = brake(strapped(box(), 0), 0.8, hold_s=2.5)
    kinds_by_frame = [
        {contact[4] for contact in frame.contacts} for frame in result.keyframes.frames
    ]

    assert "headboard" not in kinds_by_frame[0]
    assert any("headboard" in kinds for kinds in kinds_by_frame)


def test_the_renderer_options_do_not_change_the_simulation() -> None:
    scenario = strapped(box(mass_kg=2000), 2)
    profile = constant_pulse(acceleration_mps2=(-0.8 * G, 0, 0), hold_s=1.0)
    seen: list[float] = []

    plain = simulate(scenario, profile)
    rendered = simulate(scenario, profile, visual=True, frame_hook=lambda _m, _d, t: seen.append(t))

    assert rendered.model_dump_json() == plain.model_dump_json()
    assert len(seen) == len(plain.keyframes.frames)
    assert seen[:2] == pytest.approx([0.0, 1 / 30])


def test_the_floor_force_of_a_sliding_unit_averages_to_its_weight() -> None:
    # A sliding box chatters on the floor: at single instants it is in the air or knocking
    # hard. The exported force is an average per frame, and over the slide it is the weight.
    result = brake(strapped(box(), 0), 0.6, hold_s=1.5)
    sliding = result.keyframes.frames[16:60]
    forces = [frame.units[0].n for frame in sliding]

    assert result.units[0].max_slide_m > 0.2
    assert sum(forces) / len(forces) == pytest.approx(1000 * G, rel=0.12)
    # Contact points are shown whenever the unit touched the floor during the frame.
    assert sum(1 for frame in sliding if frame.contacts) > 0.8 * len(sliding)
