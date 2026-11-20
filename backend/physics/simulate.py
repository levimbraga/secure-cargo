"""Run a load scenario through a prescribed bed motion in MuJoCo.

The run has two phases:

1. **Pretensioning** (not recorded). The cargo settles on the bed and every lashing is
   tightened until it carries the pretension given in the scenario, like a driver working a
   ratchet until the indicator shows the standard tension force.
2. **Event** (recorded). The bed follows the acceleration profile; metrics are taken at every
   2 ms step and keyframes at 30 fps.

Everything is deterministic: fixed time step, no random numbers, no wall-clock dependence.
"""

from dataclasses import dataclass

import mujoco
import numpy as np
from numpy.typing import NDArray

from app.scenario import LashingRouting, Scenario
from physics.constants import (
    PHYSICS_MODEL_VERSION,
    REPLAY_FPS,
    STANDARD_GRAVITY_MPS2,
    TIMESTEP_S,
)
from physics.lashing_properties import LASHING_DAMPING_RATIO
from physics.profile import MotionProfile
from physics.results import (
    EngineInfo,
    Finding,
    Keyframe,
    KeyframeBed,
    KeyframeEvent,
    KeyframePose,
    KeyframeResult,
    Keyframes,
    KeyframeStrap,
    KeyframeStrapState,
    KeyframeUnit,
    LashingResult,
    SimulationResult,
    UnitResult,
)
from physics.verdict import build_verdict
from scene.mjcf import BED_BODY, BED_JOINTS, HEADBOARD_GEOM, Scene, build_scene

FloatArray = NDArray[np.float64]

# Default solver tolerance of MuJoCo; it is rescaled below because of the bed's armature.
_SOLVER_TOLERANCE = 1e-8
# Pretensioning: rounds of settling, each followed by a correction of the rest lengths.
_PRETENSION_ROUND_STEPS = 75
_PRETENSION_MAX_ROUNDS = 10
_PRETENSION_TOLERANCE = 0.002
_FINAL_SETTLE_STEPS = 100
# A lashing's natural frequency on its unit is kept below this fraction of the step rate,
# so that explicit integration of the spring stays accurate.
_MAX_SPRING_PHASE_PER_STEP = 0.5
# A unit counts as "initially against the headboard" if the gap is below this [m].
_BLOCKED_GAP_M = 0.005
# Headboard contact below this fraction of the unit's weight is ignored as noise.
_HEADBOARD_FORCE_FRACTION = 0.01


class SimulationError(RuntimeError):
    """The physics engine could not integrate the scenario."""


@dataclass
class _Lashings:
    tendon_ids: NDArray[np.intp]
    stiffness: FloatArray  # [N/m]
    damping: FloatArray  # [N s/m], applied only while the lashing is taut
    rest_length: FloatArray  # [m]
    reference_length: FloatArray  # length at the end of pretensioning [m]
    target: FloatArray  # pretension [N]
    breaking: FloatArray  # breaking strength [N], inf if it never breaks
    broken: NDArray[np.bool_]
    broke_at_s: FloatArray

    def tension(self, data: mujoco.MjData) -> FloatArray:
        """Force carried by each lashing [N]: spring plus damping, never negative."""
        stretch = data.ten_length[self.tendon_ids] - self.rest_length
        rate = data.ten_velocity[self.tendon_ids]
        force = np.where(stretch > 0, self.stiffness * stretch + self.damping * rate, 0.0)
        force[self.broken] = 0.0
        return np.maximum(force, 0.0)

    def apply(self, model: mujoco.MjModel, data: mujoco.MjData) -> None:
        """Write the current lashing parameters into the model before a step."""
        taut = data.ten_length[self.tendon_ids] > self.rest_length
        alive = ~self.broken
        model.tendon_stiffness[self.tendon_ids] = np.where(alive, self.stiffness, 0.0)
        model.tendon_damping[self.tendon_ids] = np.where(taut & alive, self.damping, 0.0)
        model.tendon_lengthspring[self.tendon_ids, 0] = 0.0
        model.tendon_lengthspring[self.tendon_ids, 1] = self.rest_length


def simulate(
    scenario: Scenario,
    profile: MotionProfile,
    *,
    surface_friction_cap: float | None = None,
    extra_findings: list[Finding] | None = None,
) -> SimulationResult:
    """Simulate ``scenario`` while the bed follows ``profile``."""
    scene = build_scene(scenario, surface_friction_cap=surface_friction_cap)
    model = mujoco.MjModel.from_xml_string(scene.xml)
    data = mujoco.MjData(model)
    model.opt.gravity[:] = (0.0, 0.0, -STANDARD_GRAVITY_MPS2)

    bed_dofs = np.array([model.joint(name).dofadr[0] for name in BED_JOINTS], dtype=np.intp)
    bed_inertia = model.dof_M0[bed_dofs].copy()
    # MuJoCo scales its convergence test by the mean inertia of the model. The bed's huge
    # armature would inflate that mean and let the solver stop early, so the tolerance is
    # scaled back to what it would be for the cargo alone.
    cargo_dofs = np.setdiff1d(np.arange(model.nv), bed_dofs)
    model.opt.tolerance = (
        _SOLVER_TOLERANCE * float(model.dof_M0[cargo_dofs].mean()) / float(model.dof_M0.mean())
    )

    bed_id = model.body(BED_BODY).id
    unit_ids = np.array([model.body(unit.body).id for unit in scene.units], dtype=np.intp)
    unit_geoms = np.array([model.geom(unit.geom).id for unit in scene.units], dtype=np.intp)
    geom_to_unit = {int(geom): index for index, geom in enumerate(unit_geoms)}
    headboard_geom = model.geom(HEADBOARD_GEOM).id if scene.has_headboard else -1
    saddle_qpos = [
        int(model.joint(lashing.saddle_joint).qposadr[0]) if lashing.saddle_joint else -1
        for lashing in scene.lashings
    ]

    mujoco.mj_forward(model, data)
    lashings = _prepare_lashings(model, data, scenario, scene)
    _pretension(model, data, lashings, bed_dofs, bed_inertia)
    _check_stable(data)
    data.time = 0.0
    data.qvel[bed_dofs] = 0.0

    # Reference state: where everything is when the event starts.
    start = (data.xpos[unit_ids] - data.xpos[bed_id]).copy()
    initial_tension = lashings.tension(data)
    half_length, half_width = scenario.bed.length_m / 2, scenario.bed.width_m / 2
    front_gap = np.array(
        [half_length - (unit.unit.position_m[0] + unit.unit.size_m[0] / 2) for unit in scene.units]
    )
    weights = np.array([unit.unit.mass_kg * STANDARD_GRAVITY_MPS2 for unit in scene.units])

    count = len(scene.units)
    max_slide = np.zeros(count)
    max_tilt = np.zeros(count)
    peak_headboard = np.zeros(count)
    left_bed = np.zeros(count, dtype=bool)
    peak_tension = initial_tension.copy()

    # The motion the bed should follow, integrated the way the engine integrates.
    bed_start = data.qpos[bed_dofs].copy()
    prescribed_velocity = np.zeros(3)
    prescribed_position = np.zeros(3)
    tracking_error = 0.0

    frames: list[Keyframe] = [
        _keyframe(0.0, profile, 0, data, bed_id, unit_ids, lashings, saddle_qpos)
    ]
    steps_per_frame = 1.0 / (REPLAY_FPS * TIMESTEP_S)
    next_frame = 1

    for step in range(profile.steps):
        _drive_bed(data, bed_dofs, bed_inertia, profile.acceleration_mps2[step])
        if profile.pretension_factor is not None:
            # Loosening: move the rest length so the lashing would carry the reduced
            # pretension at the length it had when it was installed.
            factor = profile.pretension_factor[step]
            lashings.rest_length = (
                lashings.reference_length - factor * lashings.target / lashings.stiffness
            )
        lashings.apply(model, data)
        mujoco.mj_step(model, data)

        prescribed_velocity += profile.acceleration_mps2[step] * TIMESTEP_S
        prescribed_position += prescribed_velocity * TIMESTEP_S
        tracking_error = max(
            tracking_error,
            float(np.abs(data.qpos[bed_dofs] - bed_start - prescribed_position).max()),
        )

        relative = data.xpos[unit_ids] - data.xpos[bed_id]
        displacement = relative - start
        np.maximum(max_slide, np.hypot(displacement[:, 0], displacement[:, 1]), out=max_slide)
        # xmat[:, 8] is the Z component of the unit's own Z axis: the cosine of its tilt.
        np.maximum(
            max_tilt,
            np.degrees(np.arccos(np.clip(data.xmat[unit_ids, 8], -1.0, 1.0))),
            out=max_tilt,
        )
        left_bed |= (
            (np.abs(relative[:, 0]) > half_length)
            | (np.abs(relative[:, 1]) > half_width)
            | (displacement[:, 2] < -0.05)
        )

        tension = lashings.tension(data)
        np.maximum(peak_tension, tension, out=peak_tension)
        newly_broken = (tension > lashings.breaking) & ~lashings.broken
        if newly_broken.any():
            lashings.broken |= newly_broken
            lashings.broke_at_s[newly_broken] = data.time

        if headboard_geom >= 0 and data.ncon:
            geoms = data.contact.geom
            touching = geoms[(geoms == headboard_geom).any(axis=1)]
            for other in {int(g) for g in touching.ravel() if g != headboard_geom}:
                force = _unit_headboard_force(model, data, headboard_geom, other)
                unit = geom_to_unit[other]
                peak_headboard[unit] = max(peak_headboard[unit], force)

        if step + 1 >= round(next_frame * steps_per_frame):
            frames.append(
                _keyframe(
                    next_frame / REPLAY_FPS,
                    profile,
                    step,
                    data,
                    bed_id,
                    unit_ids,
                    lashings,
                    saddle_qpos,
                )
            )
            next_frame += 1

    _check_stable(data)
    final = (data.xpos[unit_ids] - data.xpos[bed_id]) - start
    final_tension = lashings.tension(data)

    unit_results = [
        UnitResult(
            id=unit.unit.id,
            friction_coefficient=unit.floor_friction.coefficient,
            friction_source=unit.floor_friction.source,
            max_slide_m=_round(max_slide[index], 5),
            final_slide_m=_round(float(np.hypot(final[index, 0], final[index, 1])), 5),
            final_displacement_m=_vec(final[index], 5),
            max_tilt_deg=_round(max_tilt[index], 3),
            hit_headboard=bool(
                front_gap[index] > _BLOCKED_GAP_M
                and peak_headboard[index] > _HEADBOARD_FORCE_FRACTION * weights[index]
            ),
            peak_headboard_force_n=_round(peak_headboard[index], 1),
            left_bed=bool(left_bed[index]),
        )
        for index, unit in enumerate(scene.units)
    ]
    lashing_results = [
        LashingResult(
            id=model_.lashing.id,
            unit_id=model_.lashing.unit_id,
            kind=model_.lashing.kind,
            routing=model_.lashing.routing,
            lashing_capacity_n=model_.lashing.lashing_capacity_n,
            initial_tension_n=_round(initial_tension[index], 1),
            peak_force_n=_round(peak_tension[index], 1),
            peak_force_ratio=_round(peak_tension[index] / model_.lashing.lashing_capacity_n, 4),
            final_tension_n=_round(final_tension[index], 1),
            broke_at_s=_round(lashings.broke_at_s[index], 3) if lashings.broken[index] else None,
        )
        for index, model_ in enumerate(scene.lashings)
    ]
    headboard = scenario.bed.headboard
    verdict = build_verdict(
        unit_results,
        lashing_results,
        headboard_capacity_n=headboard.rated_capacity_n if headboard else None,
        extra_findings=extra_findings,
    )
    failed_units = sorted(
        {finding.unit_id for finding in verdict.findings if finding.unit_id is not None}
    )
    keyframes = Keyframes(
        fps=REPLAY_FPS,
        duration_s=_round(profile.duration_s, 3),
        bed=KeyframeBed(
            length_m=scenario.bed.length_m,
            width_m=scenario.bed.width_m,
            floor_height_m=scenario.bed.floor_height_m,
            headboard_height_m=headboard.height_m if headboard else 0.0,
            side_rail_height_m=scenario.bed.side_rail_height_m,
        ),
        units=[KeyframeUnit(id=unit.unit.id, size_m=unit.unit.size_m) for unit in scene.units],
        straps=[_keyframe_strap(scene, index) for index in range(len(scene.lashings))],
        events=[
            KeyframeEvent(t=_round(marker.t, 3), kind=marker.kind) for marker in profile.markers
        ],
        frames=frames,
        result=KeyframeResult(status=verdict.status, unit_ids=failed_units),
    )
    return SimulationResult(
        scenario_id=scenario.id,
        engine=EngineInfo(
            mujoco_version=mujoco.__version__,
            physics_model_version=PHYSICS_MODEL_VERSION,
            timestep_s=TIMESTEP_S,
            bed_tracking_error_m=float(f"{tracking_error:.2e}"),
        ),
        duration_s=_round(profile.duration_s, 3),
        profile=dict(profile.parameters),
        verdict=verdict,
        units=unit_results,
        lashings=lashing_results,
        keyframes=keyframes,
    )


def _prepare_lashings(
    model: mujoco.MjModel, data: mujoco.MjData, scenario: Scenario, scene: Scene
) -> _Lashings:
    """Initial spring parameters: rest length from the installed length and the pretension."""
    count = len(scene.lashings)
    tendon_ids = np.array([model.tendon(item.tendon).id for item in scene.lashings], dtype=np.intp)
    installed = data.ten_length[tendon_ids].copy() if count else np.zeros(0)
    per_unit = np.bincount([item.unit_index for item in scene.lashings], minlength=len(scene.units))
    stiffness = np.zeros(count)
    damping = np.zeros(count)
    target = np.zeros(count)
    breaking = np.full(count, np.inf)
    max_rate = _MAX_SPRING_PHASE_PER_STEP / TIMESTEP_S
    for index, item in enumerate(scene.lashings):
        mass = scenario.units[item.unit_index].mass_kg
        target[index] = item.lashing.pretension_n
        rest = installed[index] / (1 + target[index] / item.axial_stiffness_n)
        # Stability cap; it only binds for very light units held by very stiff lashings.
        cap = mass * max_rate**2 / per_unit[item.unit_index]
        stiffness[index] = min(item.axial_stiffness_n / rest, cap)
        damping[index] = 2 * LASHING_DAMPING_RATIO * np.sqrt(stiffness[index] * mass)
        if item.lashing.breaking_strength_n is not None:
            breaking[index] = item.lashing.breaking_strength_n
        if item.saddle_joint is not None:
            # Light damping of the strap sliding along the unit, so it does not ring.
            dof = model.joint(item.saddle_joint).dofadr[0]
            model.dof_damping[dof] = max(1.0, 0.2 * np.sqrt(target[index]))
    return _Lashings(
        tendon_ids=tendon_ids,
        stiffness=stiffness,
        damping=damping,
        rest_length=installed - target / stiffness if count else installed,
        reference_length=installed.copy(),
        target=target,
        breaking=breaking,
        broken=np.zeros(count, dtype=bool),
        broke_at_s=np.zeros(count),
    )


def _drive_bed(
    data: mujoco.MjData,
    bed_dofs: NDArray[np.intp],
    bed_inertia: FloatArray,
    acceleration: FloatArray,
) -> None:
    """Apply the force that gives the bed the prescribed acceleration in the next step.

    The cargo pushes on the bed through contacts and lashings. That reaction (taken from the
    previous step) is cancelled, so the bed moves as prescribed whatever it carries.
    """
    reaction = (
        data.qfrc_constraint[bed_dofs] + data.qfrc_passive[bed_dofs] - data.qfrc_bias[bed_dofs]
    )
    data.qfrc_applied[bed_dofs] = bed_inertia * acceleration - reaction


def _pretension(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    lashings: _Lashings,
    bed_dofs: NDArray[np.intp],
    bed_inertia: FloatArray,
) -> None:
    """Let the load settle and tighten every lashing to its pretension."""
    count = len(lashings.tendon_ids)
    at_rest = np.zeros(3)
    for _ in range(_PRETENSION_MAX_ROUNDS if count else 1):
        for _ in range(_PRETENSION_ROUND_STEPS):
            lashings.apply(model, data)
            _drive_bed(data, bed_dofs, bed_inertia, at_rest)
            mujoco.mj_step(model, data)
        if not count:
            break
        length = data.ten_length[lashings.tendon_ids]
        static = lashings.stiffness * np.maximum(length - lashings.rest_length, 0.0)
        error = np.abs(static - lashings.target) / np.maximum(lashings.target, 100.0)
        lashings.rest_length = length - lashings.target / lashings.stiffness
        if error.max() < _PRETENSION_TOLERANCE:
            break
    for _ in range(_FINAL_SETTLE_STEPS):
        lashings.apply(model, data)
        _drive_bed(data, bed_dofs, bed_inertia, at_rest)
        mujoco.mj_step(model, data)
    if count:
        lashings.reference_length = data.ten_length[lashings.tendon_ids].copy()


def _unit_headboard_force(
    model: mujoco.MjModel, data: mujoco.MjData, headboard_geom: int, unit_geom: int
) -> float:
    """Normal force between one unit and the headboard, summed over contact points [N]."""
    total = 0.0
    force = np.zeros(6)
    geoms = data.contact.geom
    for index in range(data.ncon):
        pair = geoms[index]
        if headboard_geom in pair and unit_geom in pair:
            mujoco.mj_contactForce(model, data, index, force)
            total += float(force[0])
    return total


def _keyframe(
    t: float,
    profile: MotionProfile,
    step: int,
    data: mujoco.MjData,
    bed_id: int,
    unit_ids: NDArray[np.intp],
    lashings: _Lashings,
    saddle_qpos: list[int],
) -> Keyframe:
    positions = data.xpos[unit_ids] - data.xpos[bed_id]
    quaternions = data.xquat[unit_ids]
    tension = lashings.tension(data)
    return Keyframe(
        t=_round(t, 4),
        truck_speed_mps=_round(profile.truck_speed_mps[step], 3),
        bed_accel_mps2=_vec(profile.acceleration_mps2[step], 3),
        units=[
            KeyframePose(p=_vec(positions[index], 4), q=_quat(quaternions[index]))
            for index in range(len(unit_ids))
        ],
        straps=[
            KeyframeStrapState(
                tension_n=_round(tension[index], 0),
                slide_m=_round(data.qpos[address], 4) if address >= 0 else 0.0,
            )
            for index, address in enumerate(saddle_qpos)
        ],
    )


def _keyframe_strap(scene: Scene, index: int) -> KeyframeStrap:
    item = scene.lashings[index]
    unit = scene.units[item.unit_index].unit
    centre = (unit.position_m[0], unit.position_m[1], unit.position_m[2] + unit.size_m[2] / 2)
    on_unit = [
        (centre[0] + point[0], centre[1] + point[1], centre[2] + point[2])
        for point in item.unit_points_m
    ]
    if item.lashing.routing is LashingRouting.TOP_OVER:
        path = [item.anchor_points_m[0], on_unit[0], on_unit[1], item.anchor_points_m[1]]
    else:
        path = [item.anchor_points_m[0], on_unit[0]]
    return KeyframeStrap(
        id=item.lashing.id,
        unit_id=unit.id,
        kind=item.lashing.kind,
        routing=item.lashing.routing,
        lashing_capacity_n=item.lashing.lashing_capacity_n,
        anchor_points_m=list(item.anchor_points_m),
        unit_points_m=list(item.unit_points_m),
        path_m=path,
    )


def _check_stable(data: mujoco.MjData) -> None:
    if data.warning[mujoco.mjtWarning.mjWARN_BADQACC].number or not np.isfinite(data.qpos).all():
        raise SimulationError("the simulation became unstable")


def _round(value: float, digits: int) -> float:
    # Rounding keeps the JSON small and stable; "+ 0.0" turns -0.0 into 0.0.
    return round(float(value), digits) + 0.0


def _vec(values: FloatArray, digits: int) -> tuple[float, float, float]:
    return (_round(values[0], digits), _round(values[1], digits), _round(values[2], digits))


def _quat(values: FloatArray) -> tuple[float, float, float, float]:
    return (
        _round(values[0], 5),
        _round(values[1], 5),
        _round(values[2], 5),
        _round(values[3], 5),
    )
