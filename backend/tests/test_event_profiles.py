"""Event profiles: acceleration curves built from speed, road surface and fog."""

import numpy as np
import pytest

from app.scenario import EventKind, RoadSurface, TripEvent
from physics.conditions import SURFACES, build_profile
from physics.conditions.events import (
    BRAKE_RISE_S,
    SERVICE_BRAKING_G,
    SHOCK_CEILING_G,
)
from physics.constants import (
    EN_CX_FORWARD,
    EN_CY_SLIDING,
    STANDARD_GRAVITY_MPS2,
    TIMESTEP_S,
)

G = STANDARD_GRAVITY_MPS2


def event(kind: EventKind, **fields: object) -> TripEvent:
    return TripEvent.model_validate({"kind": kind, "speed_kmh": 80, **fields})


@pytest.mark.parametrize("kind", list(EventKind))
@pytest.mark.parametrize("surface", list(RoadSurface))
@pytest.mark.parametrize("fog", [False, True])
def test_every_event_builds_within_the_trucks_limits(
    kind: EventKind, surface: RoadSurface, fog: bool
) -> None:
    profile, condition = build_profile(event(kind, road_surface=surface, fog=fog))
    acceleration = profile.acceleration_mps2

    assert np.isfinite(acceleration).all()
    assert 1.5 < profile.duration_s < 12
    # The truck cannot brake or corner harder than its tyres grip (plus the downhill grade).
    grade = 0.08 * G if kind is EventKind.MOUNTAIN_DESCENT else 0.0
    horizontal = np.hypot(np.minimum(acceleration[:, 0] + grade, 0), acceleration[:, 1])
    assert horizontal.max() <= condition.tyre_friction * G + 1e-6
    assert np.abs(acceleration[:, 1]).max() <= EN_CY_SLIDING * G + 1e-9
    # Starts and ends gently: nothing happens in the first instants.
    assert np.abs(acceleration[:50, :2]).max() == pytest.approx(0.0, abs=grade + 1e-9)


def test_emergency_braking_on_a_dry_road_is_limited_by_tyre_grip_and_stops_the_truck() -> None:
    profile, _ = build_profile(event(EventKind.EMERGENCY_BRAKING))
    peak = -profile.acceleration_mps2[:, 0].min()

    assert peak == pytest.approx(SURFACES[RoadSurface.DRY].tyre_friction * G)
    assert peak <= EN_CX_FORWARD * G
    assert profile.truck_speed_mps[0] == pytest.approx(80 / 3.6, abs=0.01)
    assert profile.truck_speed_mps[-1] == pytest.approx(0.0, abs=0.05)
    assert profile.parameters["braking_limited_by"] == "tyre_road_friction"


def test_a_wet_road_lowers_the_braking_the_truck_can_reach() -> None:
    dry, _ = build_profile(event(EventKind.EMERGENCY_BRAKING))
    wet, _ = build_profile(event(EventKind.EMERGENCY_BRAKING, road_surface="wet"))
    rain, _ = build_profile(event(EventKind.EMERGENCY_BRAKING, road_surface="heavy_rain"))

    peaks = [-p.acceleration_mps2[:, 0].min() for p in (dry, wet, rain)]
    assert peaks[0] > peaks[1] > peaks[2]


def test_only_dirty_roads_cap_the_cargo_friction() -> None:
    assert SURFACES[RoadSurface.DRY].cargo_friction_cap is None
    assert SURFACES[RoadSurface.WET].cargo_friction_cap is None
    assert SURFACES[RoadSurface.HEAVY_RAIN].cargo_friction_cap is None
    assert SURFACES[RoadSurface.MUD].cargo_friction_cap == 0.2
    assert SURFACES[RoadSurface.GRAVEL].cargo_friction_cap == 0.3


def test_fog_makes_emergency_braking_build_up_faster() -> None:
    clear, _ = build_profile(event(EventKind.EMERGENCY_BRAKING))
    fog, _ = build_profile(event(EventKind.EMERGENCY_BRAKING, fog=True))

    def rise_time(profile_acceleration: np.ndarray) -> float:
        braking = -profile_acceleration[:, 0]
        above = np.flatnonzero(braking > 0.99 * braking.max())[0]
        started = np.flatnonzero(braking > 0)[0]
        return float((above - started) * TIMESTEP_S)

    assert rise_time(clear.acceleration_mps2) == pytest.approx(BRAKE_RISE_S, abs=0.02)
    assert rise_time(fog.acceleration_mps2) < rise_time(clear.acceleration_mps2) / 1.5
    assert fog.parameters["reaction_time_s"] > clear.parameters["reaction_time_s"]  # type: ignore[operator]


def test_fog_turns_the_braking_at_a_pothole_into_an_emergency_stop() -> None:
    clear, _ = build_profile(event(EventKind.POTHOLE))
    fog, _ = build_profile(event(EventKind.POTHOLE, fog=True))

    assert -clear.acceleration_mps2[:, 0].min() == pytest.approx(SERVICE_BRAKING_G * G)
    assert -fog.acceleration_mps2[:, 0].min() > 2 * SERVICE_BRAKING_G * G * 0.99


def test_a_sharp_curve_follows_speed_squared_over_radius() -> None:
    slow, _ = build_profile(event(EventKind.SHARP_CURVE, speed_kmh=40, curve_radius_m=60))
    lateral = np.abs(slow.acceleration_mps2[:, 1]).max()
    assert lateral == pytest.approx((40 / 3.6) ** 2 / 60)

    fast, _ = build_profile(event(EventKind.SHARP_CURVE, speed_kmh=100, curve_radius_m=60))
    assert np.abs(fast.acceleration_mps2[:, 1]).max() == pytest.approx(EN_CY_SLIDING * G)
    assert fast.parameters["lateral_limited_by"] == "en_12195_1_design_value"


def test_a_lane_change_moves_the_truck_one_lane_sideways() -> None:
    profile, _ = build_profile(event(EventKind.LANE_CHANGE, speed_kmh=60))
    velocity = np.cumsum(profile.acceleration_mps2[:, 1]) * TIMESTEP_S
    offset = np.cumsum(velocity) * TIMESTEP_S

    assert offset[-1] == pytest.approx(3.66, rel=0.02)
    assert velocity[-1] == pytest.approx(0.0, abs=0.02)


def test_a_speed_bump_taken_faster_is_harsher_up_to_the_measured_ceiling() -> None:
    peaks = []
    for speed in (20, 30, 60, 100):
        profile, _ = build_profile(event(EventKind.SPEED_BUMP, speed_kmh=speed))
        peaks.append(np.abs(profile.acceleration_mps2[:, 2]).max() / G)

    assert peaks == sorted(peaks)
    assert peaks[0] < 1.0
    assert peaks[-1] == pytest.approx(SHOCK_CEILING_G)


def test_a_pothole_drops_the_bed_by_its_depth_and_brings_it_back() -> None:
    profile, _ = build_profile(event(EventKind.POTHOLE, speed_kmh=40))
    velocity = np.cumsum(profile.acceleration_mps2[:, 2]) * TIMESTEP_S
    height = np.cumsum(velocity) * TIMESTEP_S

    assert height.min() == pytest.approx(-0.05, rel=0.1)
    assert height[-1] == pytest.approx(0.0, abs=0.005)


def test_a_mountain_descent_pulls_the_cargo_forward_all_the_time() -> None:
    profile, _ = build_profile(event(EventKind.MOUNTAIN_DESCENT, grade_percent=8))
    forward = -profile.acceleration_mps2[:, 0]

    assert forward.min() == pytest.approx(G * 0.08 / np.hypot(1, 0.08))
    assert profile.parameters["grade_percent"] == 8


def test_long_vibration_loosens_the_lashings_before_braking() -> None:
    profile, _ = build_profile(event(EventKind.LONG_VIBRATION))

    assert profile.pretension_factor is not None
    assert profile.pretension_factor[0] == 1.0
    assert profile.pretension_factor[-1] == pytest.approx(0.5)
    assert np.abs(profile.acceleration_mps2[:, 2]).max() > 0.2 * G


def test_profiles_are_identical_when_built_twice() -> None:
    for kind in EventKind:
        first, _ = build_profile(event(kind, road_surface="gravel"))
        second, _ = build_profile(event(kind, road_surface="gravel"))
        assert np.array_equal(first.acceleration_mps2, second.acceleration_mps2)
