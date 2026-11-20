"""Acceleration-versus-time profiles of the trip events.

Each builder turns ``(speed, road surface, fog)`` into the motion of the truck bed. Every
number is either taken from a published source or marked ASSUMPTION; the full list with
links is in ``docs/physics-model.md``.

Axes: X forward, Y left, Z up. Braking is a negative X acceleration of the bed.
"""

import math
from collections.abc import Callable

import numpy as np

from app.scenario import EventKind, RoadSurface, TripEvent
from physics.conditions.surfaces import SURFACES, SurfaceCondition
from physics.constants import (
    EN_CX_FORWARD,
    EN_CY_SLIDING,
    RANDOM_SEED,
    STANDARD_GRAVITY_MPS2,
    TIMESTEP_S,
)
from physics.profile import FloatArray, Marker, MotionProfile

G = STANDARD_GRAVITY_MPS2

# --- Braking -------------------------------------------------------------------------
# Deceleration used in road design for a driver braking for an expected obstacle: 11.2 ft/s^2
# (AASHTO stopping-sight-distance criteria, as given by FHWA).
SERVICE_BRAKING_G = 0.35
# Air brakes must reach 60 psi in the chambers within 0.45 s (49 CFR 571.121 S5.3.3.1).
BRAKE_RISE_S = 0.45
# ASSUMPTION: in fog the hazard appears late and the driver stamps on the pedal; the rise is
# taken as half the regulatory limit.
BRAKE_RISE_FOG_S = 0.22
# Driver perception-reaction time: about 1 s is typical (0.75 to 1.5 s); road design uses
# 2.5 s (FHWA). In fog the design value is reported on the timeline.
REACTION_TIME_S = 1.0
REACTION_TIME_FOG_S = 2.5

# --- Cornering -----------------------------------------------------------------------
# One full lane (12 ft) of lateral offset...
LANE_WIDTH_M = 3.66
# ...covered in the length of the SAE J2179 heavy-truck lane-change manoeuvre.
LANE_CHANGE_LENGTH_M = 61.0
# ASSUMPTION: radius of a "sharp curve" when the event does not give one.
DEFAULT_CURVE_RADIUS_M = 60.0
# ASSUMPTION: time to build up and to release lateral acceleration at a curve.
CURVE_TRANSITION_S = 1.0
CURVE_HOLD_S = 2.5

# --- Vertical shocks ------------------------------------------------------------------
# Peak vertical accelerations measured on truck beds: 2.7 g striking a prominent joint in
# the highway, 5.0 g at a road intersection (Ostrem & Godshall, USDA FPL-22, 1979).
POTHOLE_PEAK_G = 2.7
SHOCK_CEILING_G = 5.0
# ASSUMPTION: depth and length of the pothole.
POTHOLE_DEPTH_M = 0.05
POTHOLE_LENGTH_M = 0.60
# Speed bump "Type A" of the Brazilian signalling manual (MBST vol. VI, 5.1): 3.70 m long,
# 0.08 to 0.10 m high, meant for 30 km/h.
SPEED_BUMP_LENGTH_M = 3.70
SPEED_BUMP_HEIGHT_M = 0.10

# --- Grades and vibration -------------------------------------------------------------
# Steepest grade allowed on mountainous Class III / IV-A federal roads (DNIT geometric design
# manual, 5.5.2).
DEFAULT_GRADE_PERCENT = 8.0
# Continuous vertical vibration of truck beds is "near 0.5 g" (FPL-22); taken as the 3-sigma
# peak of a random signal, that is 0.17 g RMS.
ROAD_VIBRATION_GRMS = 0.17
VIBRATION_BAND_HZ = (2.0, 40.0)
# ASSUMPTION: no measured pretension loss was found. CONTRAN 945/2022 (art. 4, par. 2) and the
# IRU guidelines require re-tightening on the way; the model lets the pretension fall to this
# fraction when nobody re-tightens.
PRETENSION_AFTER_VIBRATION = 0.5

LEAD_IN_S = 0.3
TAIL_S = 0.6


def build_profile(event: TripEvent) -> tuple[MotionProfile, SurfaceCondition]:
    """Bed motion for a trip event, and the surface condition it was built from."""
    surface = SURFACES[event.road_surface]
    profile = _BUILDERS[event.kind](event, surface)
    return profile, surface


class _Timeline:
    """Builds acceleration channels piece by piece on the fixed time grid."""

    def __init__(self, duration_s: float, event: TripEvent, surface: SurfaceCondition) -> None:
        self.steps = round(duration_s / TIMESTEP_S)
        self.t: FloatArray = np.arange(self.steps, dtype=np.float64) * TIMESTEP_S
        self.braking: FloatArray = np.zeros(self.steps)  # deceleration of the truck, >= 0
        self.grade: FloatArray = np.zeros(self.steps)  # gravity component along the bed
        self.lateral: FloatArray = np.zeros(self.steps)
        self.vertical: FloatArray = np.zeros(self.steps)
        self.markers: list[Marker] = []
        self.parameters: dict[str, float | str] = {
            "speed_kmh": event.speed_kmh,
            "road_surface": event.road_surface.value,
            "tyre_friction": surface.tyre_friction,
        }
        if surface.cargo_friction_cap is not None:
            self.parameters["cargo_friction_cap"] = surface.cargo_friction_cap
        self.event = event
        self.surface = surface

    def mark(self, t: float, kind: str) -> None:
        self.markers.append(Marker(t=t, kind=kind))

    def trapezoid(self, start: float, rise: float, hold: float, fall: float) -> FloatArray:
        """0 -> 1 over ``rise``, held for ``hold``, back to 0 over ``fall``."""
        up = np.clip((self.t - start) / rise, 0.0, 1.0)
        down = np.clip((start + rise + hold + fall - self.t) / fall, 0.0, 1.0)
        return np.asarray(np.minimum(up, down), dtype=np.float64)

    def finish(self) -> MotionProfile:
        if self.surface.roughness_grms > 0:
            self.vertical += _vibration(self.t, self.surface.roughness_grms * G)
            self.parameters["road_roughness_grms"] = self.surface.roughness_grms
        # The truck cannot brake and corner beyond the grip of its tyres (friction circle).
        grip = self.surface.tyre_friction * G
        demand = np.hypot(self.braking, self.lateral)
        scale = np.where(demand > grip, grip / np.maximum(demand, 1e-9), 1.0)
        braking, lateral = self.braking * scale, self.lateral * scale

        speed = np.maximum(
            self.event.speed_kmh / 3.6 - np.cumsum(braking - self.grade) * TIMESTEP_S, 0.0
        )
        acceleration = np.column_stack([-(braking + self.grade), lateral, self.vertical])
        self.parameters["peak_forward_g"] = _round(float(np.max(braking + self.grade)) / G)
        self.parameters["peak_lateral_g"] = _round(float(np.max(np.abs(lateral))) / G)
        self.parameters["peak_vertical_g"] = _round(float(np.max(np.abs(self.vertical))) / G)
        return MotionProfile(
            acceleration_mps2=acceleration,
            truck_speed_mps=speed,
            markers=tuple(self.markers),
            parameters=self.parameters,
        )


def _emergency_deceleration(surface: SurfaceCondition, parameters: dict[str, float | str]) -> float:
    """Hardest braking of the truck [m/s^2]: tyre grip, never above the EN design value."""
    if surface.tyre_friction < EN_CX_FORWARD:
        parameters["braking_limited_by"] = "tyre_road_friction"
        return surface.tyre_friction * G
    parameters["braking_limited_by"] = "en_12195_1_design_value"
    return EN_CX_FORWARD * G


def _braking_level(timeline: _Timeline) -> tuple[float, float]:
    """Deceleration [m/s^2] and rise time [s] of the braking that accompanies an event.

    Normally the driver sees the obstacle in time and brakes at the design rate. In fog it
    is seen late: the braking is an emergency stop that is still going on at the obstacle.
    """
    if timeline.event.fog:
        timeline.parameters["reaction_time_s"] = REACTION_TIME_FOG_S
        return _emergency_deceleration(timeline.surface, timeline.parameters), BRAKE_RISE_FOG_S
    timeline.parameters["reaction_time_s"] = REACTION_TIME_S
    return min(SERVICE_BRAKING_G, timeline.surface.tyre_friction) * G, BRAKE_RISE_S


def _emergency_braking(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    parameters: dict[str, float | str] = {}
    deceleration = _emergency_deceleration(surface, parameters)
    rise = BRAKE_RISE_FOG_S if event.fog else BRAKE_RISE_S
    fall = 0.1
    # Brake until the truck stands still: v0 = a * (rise / 2 + hold + fall / 2).
    hold = max(event.speed_kmh / 3.6 / deceleration - rise / 2 - fall / 2, 0.0)
    timeline = _Timeline(LEAD_IN_S + rise + hold + fall + TAIL_S, event, surface)
    timeline.parameters.update(parameters)
    timeline.parameters["reaction_time_s"] = REACTION_TIME_FOG_S if event.fog else REACTION_TIME_S
    timeline.braking = deceleration * timeline.trapezoid(LEAD_IN_S, rise, hold, fall)
    timeline.mark(LEAD_IN_S, "braking_start")
    timeline.mark(LEAD_IN_S + rise + hold + fall, "truck_stopped")
    return timeline.finish()


def _lateral_limit(timeline: _Timeline, demand: float) -> float:
    """Lateral acceleration the truck can reach: grip, and the EN sideways design value."""
    limit = min(timeline.surface.tyre_friction, EN_CY_SLIDING) * G
    if demand > limit:
        timeline.parameters["lateral_limited_by"] = (
            "tyre_road_friction"
            if timeline.surface.tyre_friction < EN_CY_SLIDING
            else "en_12195_1_design_value"
        )
        return limit
    return demand


def _lane_change(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    speed = event.speed_kmh / 3.6
    period = LANE_CHANGE_LENGTH_M / speed
    timeline = _Timeline(LEAD_IN_S + period + TAIL_S, event, surface)
    # A full sine of lateral acceleration moves the truck sideways by A * T^2 / (2 * pi).
    peak = _lateral_limit(timeline, 2 * math.pi * LANE_WIDTH_M / period**2)
    phase = np.clip((timeline.t - LEAD_IN_S) / period, 0.0, 1.0)
    timeline.lateral = peak * np.sin(2 * math.pi * phase)
    timeline.parameters["manoeuvre_time_s"] = _round(period)
    timeline.mark(LEAD_IN_S, "lane_change_start")
    timeline.mark(LEAD_IN_S + period, "lane_change_end")
    if event.fog:
        level, rise = _braking_level(timeline)
        timeline.braking = level * timeline.trapezoid(LEAD_IN_S, rise, period - rise - 0.1, 0.1)
    return timeline.finish()


def _sharp_curve(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    speed = event.speed_kmh / 3.6
    radius = event.curve_radius_m or DEFAULT_CURVE_RADIUS_M
    duration = CURVE_TRANSITION_S * 2 + CURVE_HOLD_S
    timeline = _Timeline(LEAD_IN_S + duration + TAIL_S, event, surface)
    timeline.parameters["curve_radius_m"] = radius
    peak = _lateral_limit(timeline, speed**2 / radius)
    # A left-hand curve: the bed accelerates to the left, the cargo is thrown to the right.
    timeline.lateral = peak * timeline.trapezoid(
        LEAD_IN_S, CURVE_TRANSITION_S, CURVE_HOLD_S, CURVE_TRANSITION_S
    )
    timeline.mark(LEAD_IN_S, "curve_start")
    timeline.mark(LEAD_IN_S + duration, "curve_end")
    if event.fog:
        level, rise = _braking_level(timeline)
        timeline.braking = level * timeline.trapezoid(LEAD_IN_S, rise, CURVE_HOLD_S, 0.1)
    return timeline.finish()


def _full_sine(t: FloatArray, start: float, period: float) -> FloatArray:
    """One period of a sine starting at ``start``; zero elsewhere."""
    phase = (t - start) / period
    return np.asarray(np.where((phase >= 0) & (phase < 1), np.sin(2 * math.pi * phase), 0.0))


def _pothole(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    speed = event.speed_kmh / 3.6
    peak = POTHOLE_PEAK_G * G
    # A full sine of acceleration with peak A moves the bed by A * T^2 / (2 * pi); the period
    # is chosen so that the bed drops by the depth of the pothole, then rises again.
    period = math.sqrt(2 * math.pi * POTHOLE_DEPTH_M / peak)
    crossing = POTHOLE_LENGTH_M / speed
    brake_start = LEAD_IN_S
    timeline = _Timeline(LEAD_IN_S + 1.6 + TAIL_S, event, surface)
    level, rise = _braking_level(timeline)
    timeline.braking = level * timeline.trapezoid(brake_start, rise, 1.6 - rise - 0.2, 0.2)
    hit = brake_start + rise + 0.3
    timeline.vertical = peak * (
        -_full_sine(timeline.t, hit, period)
        + _full_sine(timeline.t, hit + period + crossing, period)
    )
    timeline.parameters["pothole_depth_m"] = POTHOLE_DEPTH_M
    timeline.mark(brake_start, "braking_start")
    timeline.mark(hit, "pothole")
    return timeline.finish()


def _speed_bump(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    speed = event.speed_kmh / 3.6
    crossing = SPEED_BUMP_LENGTH_M / speed
    # The wheels follow h/2 * (1 - cos(2 pi t / T)); its second derivative is the vertical
    # acceleration. The suspension is ignored (conservative) and the result is capped at the
    # largest shock measured on truck beds.
    peak = min(2 * math.pi**2 * SPEED_BUMP_HEIGHT_M / crossing**2, SHOCK_CEILING_G * G)
    brake_start = LEAD_IN_S
    timeline = _Timeline(LEAD_IN_S + 1.6 + crossing + TAIL_S, event, surface)
    level, rise = _braking_level(timeline)
    timeline.braking = level * timeline.trapezoid(brake_start, rise, 1.6 - rise - 0.2, 0.2)
    hit = brake_start + rise + 0.3
    phase = (timeline.t - hit) / crossing
    timeline.vertical = np.where(
        (phase >= 0) & (phase < 1), peak * np.cos(2 * math.pi * phase), 0.0
    )
    timeline.parameters["speed_bump_height_m"] = SPEED_BUMP_HEIGHT_M
    timeline.parameters["speed_bump_length_m"] = SPEED_BUMP_LENGTH_M
    timeline.mark(brake_start, "braking_start")
    timeline.mark(hit, "speed_bump")
    return timeline.finish()


def _mountain_descent(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    speed = event.speed_kmh / 3.6
    radius = event.curve_radius_m or DEFAULT_CURVE_RADIUS_M
    grade = (
        event.grade_percent if event.grade_percent is not None else DEFAULT_GRADE_PERCENT
    ) / 100
    brake, transition, hold, gap = 1.2, 0.6, 0.6, 0.2
    curve = 2 * transition + hold
    timeline = _Timeline(LEAD_IN_S + 2 * (brake + gap + curve + gap) + TAIL_S, event, surface)
    # On a downhill grade gravity pulls the cargo forward all the time: g * sin(slope).
    timeline.grade = np.full(timeline.steps, G * grade / math.hypot(1.0, grade))
    timeline.parameters["grade_percent"] = grade * 100
    timeline.parameters["curve_radius_m"] = radius
    level, rise = _braking_level(timeline)
    peak = _lateral_limit(timeline, speed**2 / radius)
    start = LEAD_IN_S
    for direction in (1.0, -1.0):
        timeline.braking = timeline.braking + level * timeline.trapezoid(
            start, rise, brake - rise - 0.2, 0.2
        )
        timeline.mark(start, "braking_start")
        start += brake + gap
        timeline.lateral = timeline.lateral + direction * peak * timeline.trapezoid(
            start, transition, hold, transition
        )
        timeline.mark(start, "curve_start")
        start += curve + gap
    return timeline.finish()


def _long_vibration(event: TripEvent, surface: SurfaceCondition) -> MotionProfile:
    parameters: dict[str, float | str] = {}
    deceleration = _emergency_deceleration(surface, parameters)
    rise = BRAKE_RISE_FOG_S if event.fog else BRAKE_RISE_S
    vibration, brake_hold, fall = 3.0, 1.5, 0.1
    timeline = _Timeline(LEAD_IN_S + vibration + rise + brake_hold + fall + TAIL_S, event, surface)
    timeline.parameters.update(parameters)
    shaking = timeline.trapezoid(LEAD_IN_S, 0.3, vibration - 0.6, 0.3)
    timeline.vertical = shaking * _vibration(timeline.t, ROAD_VIBRATION_GRMS * G)
    # Hours of driving compressed into a few seconds: the pretension decays while the bed
    # shakes, then the truck brakes hard without the lashings having been re-tightened.
    progress = np.clip((timeline.t - LEAD_IN_S) / vibration, 0.0, 1.0)
    pretension = 1.0 - (1.0 - PRETENSION_AFTER_VIBRATION) * progress
    brake_start = LEAD_IN_S + vibration
    timeline.braking = deceleration * timeline.trapezoid(brake_start, rise, brake_hold, fall)
    timeline.parameters["pretension_after_vibration"] = PRETENSION_AFTER_VIBRATION
    timeline.parameters["vibration_grms"] = ROAD_VIBRATION_GRMS
    timeline.mark(LEAD_IN_S, "vibration_start")
    timeline.mark(brake_start, "braking_start")
    profile = timeline.finish()
    return MotionProfile(
        acceleration_mps2=profile.acceleration_mps2,
        truck_speed_mps=profile.truck_speed_mps,
        markers=profile.markers,
        pretension_factor=pretension,
        parameters=profile.parameters,
    )


def _vibration(t: FloatArray, rms_mps2: float) -> FloatArray:
    """Band-limited vertical vibration with the given RMS: a fixed set of sine tones.

    The phases come from a generator with a fixed seed, so the signal is always the same.
    """
    generator = np.random.default_rng(RANDOM_SEED)
    low, high = VIBRATION_BAND_HZ
    frequencies = np.geomspace(low, high, 24)
    phases = generator.uniform(0.0, 2 * math.pi, size=frequencies.size)
    signal = np.sin(2 * math.pi * np.outer(t, frequencies) + phases).sum(axis=1)
    # RMS of a sum of N unit sines with independent phases is sqrt(N / 2).
    return np.asarray(signal * rms_mps2 / math.sqrt(frequencies.size / 2), dtype=np.float64)


def _round(value: float) -> float:
    return round(value, 3)


_BUILDERS: dict[EventKind, Callable[[TripEvent, SurfaceCondition], MotionProfile]] = {
    EventKind.EMERGENCY_BRAKING: _emergency_braking,
    EventKind.LANE_CHANGE: _lane_change,
    EventKind.SHARP_CURVE: _sharp_curve,
    EventKind.POTHOLE: _pothole,
    EventKind.SPEED_BUMP: _speed_bump,
    EventKind.MOUNTAIN_DESCENT: _mountain_descent,
    EventKind.LONG_VIBRATION: _long_vibration,
}

__all__ = ["RoadSurface", "build_profile"]
