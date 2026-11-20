"""Result of a simulation run: verdict, per-unit and per-lashing metrics, keyframes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.scenario import LashingKind, LashingRouting
from physics.friction import FrictionSource

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]
Status = Literal["pass", "warning", "fail"]

FindingCode = Literal[
    "unit_slid",
    "unit_tilted",
    "unit_left_bed",
    "unit_hit_headboard",
    "headboard_overloaded",
    "lashing_overloaded",
    "lashing_broke",
    "lashing_went_slack",
    "axle_overloaded",
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UnitResult(_Model):
    id: str
    friction_coefficient: float
    friction_source: FrictionSource
    max_slide_m: float = Field(description="Largest horizontal displacement on the bed [m].")
    final_slide_m: float = Field(description="Horizontal displacement at the end [m].")
    final_displacement_m: Vec3 = Field(description="Displacement at the end, bed frame [m].")
    max_tilt_deg: float = Field(description="Largest tilt away from upright [deg].")
    hit_headboard: bool = Field(description="Slid into the headboard during the event.")
    peak_headboard_force_n: float
    left_bed: bool = Field(description="Its centre left the bed footprint.")


class LashingResult(_Model):
    id: str
    unit_id: str
    kind: LashingKind
    routing: LashingRouting
    lashing_capacity_n: float
    initial_tension_n: float = Field(description="Tension when the event starts [N].")
    peak_force_n: float = Field(description="Largest tension during the event [N].")
    peak_force_ratio: float = Field(description="peak_force_n / lashing_capacity_n.")
    final_tension_n: float
    broke_at_s: float | None = None


class Finding(_Model):
    """One reason behind the verdict. The UI translates ``code``; ``message`` is English."""

    code: FindingCode
    severity: Literal["warning", "fail"]
    unit_id: str | None = None
    lashing_id: str | None = None
    axle_group_id: str | None = None
    value: float
    limit: float
    message: str


class Verdict(_Model):
    status: Status
    findings: list[Finding]


class AxleLoad(_Model):
    axle_group_id: str
    load_kg: float
    limit_kg: float
    ratio: float


class KeyframeUnit(_Model):
    id: str
    size_m: Vec3


class KeyframeStrap(_Model):
    id: str
    unit_id: str
    kind: LashingKind
    routing: LashingRouting
    lashing_capacity_n: float
    anchor_points_m: list[Vec3] = Field(description="Fixed points on the bed, bed frame.")
    unit_points_m: list[Vec3] = Field(description="Points on the unit, relative to its centre.")
    path_m: list[Vec3] = Field(description="Path as installed, bed frame.")


class KeyframePose(_Model):
    p: Vec3
    q: Quat


class KeyframeStrapState(_Model):
    tension_n: float
    slide_m: float = Field(description="How far a top-over strap moved along its unit [m].")


class Keyframe(_Model):
    t: float
    truck_speed_mps: float
    bed_accel_mps2: Vec3
    units: list[KeyframePose]
    straps: list[KeyframeStrapState]


class KeyframeBed(_Model):
    length_m: float
    width_m: float
    floor_height_m: float
    headboard_height_m: float
    side_rail_height_m: float


class KeyframeEvent(_Model):
    t: float
    kind: str


class KeyframeResult(_Model):
    status: Status
    unit_ids: list[str]


class Keyframes(_Model):
    """Replay document, version 2 (see docs/design.md for the conventions)."""

    version: Literal[2] = 2
    source: Literal["simulation"] = "simulation"
    fps: int
    duration_s: float
    bed: KeyframeBed
    units: list[KeyframeUnit]
    straps: list[KeyframeStrap]
    events: list[KeyframeEvent]
    frames: list[Keyframe]
    result: KeyframeResult


class EngineInfo(_Model):
    mujoco_version: str
    physics_model_version: str
    timestep_s: float
    bed_tracking_error_m: float = Field(
        description="Largest gap between the prescribed and the simulated bed position [m]."
    )


class SimulationResult(_Model):
    scenario_id: str
    engine: EngineInfo
    duration_s: float
    profile: dict[str, float | str] = Field(
        description="Numbers the event profile was built from (peak accelerations, limits)."
    )
    verdict: Verdict
    units: list[UnitResult]
    lashings: list[LashingResult]
    axle_loads: list[AxleLoad] = Field(default_factory=list)
    keyframes: Keyframes
