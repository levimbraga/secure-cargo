"""The "live model": everything a second MuJoCo needs to repeat a run step for step.

The browser loads this document into the official MuJoCo WebAssembly build and steps it at the
same 2 ms, with the same prescribed bed motion, lashing parameters and thresholds the server
uses (``frontend/lib/live`` mirrors ``physics/simulate.py``). Nothing here is computed
differently from a server run: the MJCF comes from the same ``build_scene`` call and the
profile from the same ``build_profile`` call that ``run_event`` makes.
"""

from typing import Literal

import mujoco
from pydantic import BaseModel, ConfigDict, Field

from app.scenario import CylinderAxis, LashingKind, LashingRouting, Scenario, TripEvent, UnitShape
from physics.conditions import build_profile
from physics.constants import (
    PHYSICS_MODEL_VERSION,
    REPLAY_FPS,
    STANDARD_GRAVITY_MPS2,
    TIMESTEP_S,
)
from physics.friction import FrictionSource
from physics.lashing_properties import LASHING_DAMPING_RATIO
from physics.results import (
    AxleLoad,
    Finding,
    KeyframeBed,
    KeyframeEvent,
    KeyframeStrap,
    StandardCheck,
    Vec3,
)
from physics.run import scenario_hash
from physics.simulate import RUN_SETTINGS, keyframe_bed, keyframe_strap
from physics.verdict import (
    LASHING_FAIL_RATIO,
    LASHING_WARNING_RATIO,
    ROLL_FAIL_DEG,
    SLIDE_FAIL_M,
    SLIDE_WARNING_M,
    TILT_FAIL_DEG,
    TILT_WARNING_DEG,
)
from rules.axle_loads import axle_findings, axle_loads
from rules.en12195 import check_scenario
from scene.mjcf import (
    BED_BODY,
    BED_JOINTS,
    BLOCK_GEOM_PREFIX,
    FLOOR_GEOM,
    HEADBOARD_GEOM,
    ROAD_GEOM,
    build_scene,
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LiveEngine(_Model):
    mujoco_version: str = Field(description="Version the server runs; the browser must match it.")
    physics_model_version: str


class LiveNames(_Model):
    """Names of the model elements the run loop reads and writes."""

    bed_body: str
    bed_joints: tuple[str, str, str]
    floor_geom: str
    headboard_geom: str | None
    road_geom: str
    block_geom_prefix: str = Field(description="Geoms whose name starts with it are blocks.")


class LiveUnit(_Model):
    id: str
    body: str
    geom: str
    size_m: Vec3
    mass_kg: float
    position_m: Vec3 = Field(description="Centre of the bottom face as loaded, bed frame [m].")
    friction_coefficient: float
    friction_source: FrictionSource
    shape: UnitShape
    axis: CylinderAxis | None
    inner_diameter_m: float | None
    lying_axis: int | None = Field(
        description="0 (X) or 1 (Y) for a cylinder lying on its side: it can roll."
    )


class LiveLashing(_Model):
    id: str
    unit_index: int
    tendon: str
    saddle_joint: str | None
    extra_saddle_joints: list[str] = Field(
        default_factory=list,
        description="A strap over a row of units: the other units' saddles, damped the same.",
    )
    kind: LashingKind
    routing: LashingRouting
    axial_stiffness_n: float = Field(description="EA [N]: force per unit strain.")
    pretension_n: float
    lashing_capacity_n: float
    breaking_strength_n: float | None
    strap: KeyframeStrap = Field(description="Geometry the replay draws.")


class LiveProfile(_Model):
    steps: int
    acceleration_mps2: list[float] = Field(
        description="Bed acceleration, 3 values (x, y, z) per time step, flattened."
    )
    truck_speed_mps: list[float]
    pretension_factor: list[float] | None
    markers: list[KeyframeEvent]
    parameters: dict[str, float | str]


class LiveSettings(_Model):
    """Constants of the run loop, so the browser never hard-codes them."""

    timestep_s: float
    replay_fps: int
    gravity_mps2: float
    lashing_damping_ratio: float
    solver_tolerance: float
    contact_lookback_steps: int
    pretension_round_steps: int
    pretension_max_rounds: int
    pretension_tolerance: float
    final_settle_steps: int
    max_spring_phase_per_step: float
    blocked_gap_m: float
    headboard_force_fraction: float


class LiveThresholds(_Model):
    slide_warning_m: float
    slide_fail_m: float
    tilt_warning_deg: float
    tilt_fail_deg: float
    roll_fail_deg: float
    lashing_warning_ratio: float
    lashing_fail_ratio: float
    headboard_capacity_n: float | None


class LiveModel(_Model):
    version: Literal[1] = 1
    scenario_id: str
    scenario_hash: str = Field(description="Same key POST /simulate reports for these inputs.")
    engine: LiveEngine
    mjcf: str = Field(description="The MJCF document the server simulates, unchanged.")
    names: LiveNames
    bed: KeyframeBed
    units: list[LiveUnit]
    lashings: list[LiveLashing]
    profile: LiveProfile
    settings: LiveSettings
    thresholds: LiveThresholds
    axle_loads: list[AxleLoad]
    axle_findings: list[Finding]
    en_12195_1: list[StandardCheck]


def build_live_model(scenario: Scenario, event: TripEvent) -> LiveModel:
    """The MJCF and run plan of ``scenario`` through ``event``."""
    profile, surface = build_profile(event)
    scene = build_scene(scenario, surface_friction_cap=surface.cargo_friction_cap)
    loads = axle_loads(scenario)
    headboard = scenario.bed.headboard
    return LiveModel(
        scenario_id=scenario.id,
        scenario_hash=scenario_hash(scenario, event),
        engine=LiveEngine(
            mujoco_version=mujoco.__version__, physics_model_version=PHYSICS_MODEL_VERSION
        ),
        mjcf=scene.xml,
        names=LiveNames(
            bed_body=BED_BODY,
            bed_joints=BED_JOINTS,
            floor_geom=FLOOR_GEOM,
            headboard_geom=HEADBOARD_GEOM if scene.has_headboard else None,
            road_geom=ROAD_GEOM,
            block_geom_prefix=BLOCK_GEOM_PREFIX,
        ),
        bed=keyframe_bed(scenario),
        units=[
            LiveUnit(
                id=item.unit.id,
                body=item.body,
                geom=item.geom,
                size_m=item.unit.size_m,
                mass_kg=item.unit.mass_kg,
                position_m=item.unit.position_m,
                friction_coefficient=item.floor_friction.coefficient,
                friction_source=item.floor_friction.source,
                shape=item.unit.shape,
                axis=item.unit.axis,
                inner_diameter_m=item.unit.inner_diameter_m,
                lying_axis=item.lying_axis,
            )
            for item in scene.units
        ],
        lashings=[
            LiveLashing(
                id=item.lashing.id,
                unit_index=item.unit_index,
                tendon=item.tendon,
                saddle_joint=item.saddle_joint,
                extra_saddle_joints=list(item.extra_saddle_joints),
                kind=item.lashing.kind,
                routing=item.lashing.routing,
                axial_stiffness_n=item.axial_stiffness_n,
                pretension_n=item.lashing.pretension_n,
                lashing_capacity_n=item.lashing.lashing_capacity_n,
                breaking_strength_n=item.lashing.breaking_strength_n,
                strap=keyframe_strap(scene, index),
            )
            for index, item in enumerate(scene.lashings)
        ],
        profile=LiveProfile(
            steps=profile.steps,
            acceleration_mps2=profile.acceleration_mps2.ravel().tolist(),
            truck_speed_mps=profile.truck_speed_mps.tolist(),
            pretension_factor=(
                profile.pretension_factor.tolist()
                if profile.pretension_factor is not None
                else None
            ),
            markers=[
                KeyframeEvent(t=round(marker.t, 3), kind=marker.kind) for marker in profile.markers
            ],
            parameters=dict(profile.parameters),
        ),
        settings=LiveSettings(
            timestep_s=TIMESTEP_S,
            replay_fps=REPLAY_FPS,
            gravity_mps2=STANDARD_GRAVITY_MPS2,
            lashing_damping_ratio=LASHING_DAMPING_RATIO,
            **RUN_SETTINGS,
        ),
        thresholds=LiveThresholds(
            slide_warning_m=SLIDE_WARNING_M,
            slide_fail_m=SLIDE_FAIL_M,
            tilt_warning_deg=TILT_WARNING_DEG,
            tilt_fail_deg=TILT_FAIL_DEG,
            roll_fail_deg=ROLL_FAIL_DEG,
            lashing_warning_ratio=LASHING_WARNING_RATIO,
            lashing_fail_ratio=LASHING_FAIL_RATIO,
            headboard_capacity_n=headboard.rated_capacity_n if headboard else None,
        ),
        axle_loads=loads,
        axle_findings=axle_findings(loads),
        en_12195_1=check_scenario(scenario),
    )
