"""Run a load scenario through a prescribed bed motion in MuJoCo.

The run has two phases:

1. **Pretensioning** (not recorded). The cargo settles on the bed and every lashing is
   tightened until it carries the pretension given in the scenario, like a driver working a
   ratchet until the indicator shows the standard tension force.
2. **Event** (recorded). The bed follows the acceleration profile; metrics are taken at every
   2 ms step and keyframes at 30 fps.

Everything is deterministic: fixed time step, no random numbers, no wall-clock dependence.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import mujoco
import numpy as np
from numpy.typing import NDArray

from app.scenario import CargoUnit, LashingRouting, Scenario
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
    KeyframeBlock,
    KeyframeContact,
    KeyframeEvent,
    KeyframePose,
    KeyframeResult,
    Keyframes,
    KeyframeStrap,
    KeyframeStrapState,
    KeyframeUnit,
    LashingResult,
    Margins,
    SimulationResult,
    UnitResult,
)
from physics.verdict import SLIDE_FAIL_M, build_verdict
from scene.mjcf import (
    BED_BODY,
    BED_JOINTS,
    BLOCK_GEOM_PREFIX,
    FLOOR_GEOM,
    HEADBOARD_GEOM,
    ROAD_GEOM,
    Scene,
    build_scene,
)

FloatArray = NDArray[np.float64]

# Default solver tolerance of MuJoCo; it is rescaled below because of the bed's armature.
_SOLVER_TOLERANCE = 1e-8
# Pretensioning: rounds of settling, each followed by a correction of the rest lengths.
# Steps before a keyframe in which contact points are also looked at (see the main loop):
# the whole interval between two keyframes.
_CONTACT_LOOKBACK_STEPS = 17
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

# The constants above, for a second engine that repeats the run (see ``physics/live.py``).
RUN_SETTINGS: dict[str, Any] = {
    "solver_tolerance": _SOLVER_TOLERANCE,
    "contact_lookback_steps": _CONTACT_LOOKBACK_STEPS,
    "pretension_round_steps": _PRETENSION_ROUND_STEPS,
    "pretension_max_rounds": _PRETENSION_MAX_ROUNDS,
    "pretension_tolerance": _PRETENSION_TOLERANCE,
    "final_settle_steps": _FINAL_SETTLE_STEPS,
    "max_spring_phase_per_step": _MAX_SPRING_PHASE_PER_STEP,
    "blocked_gap_m": _BLOCKED_GAP_M,
    "headboard_force_fraction": _HEADBOARD_FORCE_FRACTION,
}


# Called at every keyframe with the model, its state and the time of the keyframe [s].
FrameHook = Callable[[mujoco.MjModel, mujoco.MjData, float], None]


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
    taut: NDArray[np.bool_]
    # True when stiffness, rest length or broken state changed since the last ``apply``.
    dirty: bool = True

    def tension(self, data: mujoco.MjData) -> FloatArray:
        """Force carried by each lashing [N]: spring plus damping, never negative."""
        stretch = data.ten_length[self.tendon_ids] - self.rest_length
        rate = data.ten_velocity[self.tendon_ids]
        force = np.where(stretch > 0, self.stiffness * stretch + self.damping * rate, 0.0)
        force[self.broken] = 0.0
        return np.maximum(force, 0.0)

    def apply(self, model: mujoco.MjModel, data: mujoco.MjData) -> None:
        """Write the lashing parameters into the model before a step, if they changed."""
        if not len(self.tendon_ids):
            return
        # Damping only acts while the lashing is taut, so a slack one does not resist.
        taut = (data.ten_length[self.tendon_ids] > self.rest_length) & ~self.broken
        if self.dirty:
            model.tendon_stiffness[self.tendon_ids] = np.where(self.broken, 0.0, self.stiffness)
            model.tendon_lengthspring[self.tendon_ids, 0] = 0.0
            model.tendon_lengthspring[self.tendon_ids, 1] = self.rest_length
        if self.dirty or not np.array_equal(taut, self.taut):
            model.tendon_damping[self.tendon_ids] = np.where(taut, self.damping, 0.0)
            self.taut = taut
        self.dirty = False


def simulate(
    scenario: Scenario,
    profile: MotionProfile,
    *,
    surface_friction_cap: float | None = None,
    extra_findings: list[Finding] | None = None,
    visual: bool = False,
    frame_hook: FrameHook | None = None,
) -> SimulationResult:
    """Simulate ``scenario`` while the bed follows ``profile``.

    ``visual`` adds textures and lights to the model for MuJoCo's own renderer, and
    ``frame_hook`` is called with the live model and state at every keyframe; neither changes
    the simulation (a test compares the results).
    """
    scene = build_scene(scenario, surface_friction_cap=surface_friction_cap, visual=visual)
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
    floor_geom = model.geom(FLOOR_GEOM).id
    # Geom id -> unit index (-1 for geoms that are not cargo units).
    unit_of_geom = np.full(model.ngeom, -1, dtype=np.intp)
    unit_of_geom[unit_geoms] = np.arange(len(unit_geoms))
    floor_friction = np.array([unit.floor_friction.coefficient for unit in scene.units])
    contact_kinds = _contact_kinds(model, floor_geom, headboard_geom, unit_geoms)
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
    has_lashings = len(scene.lashings) > 0
    max_slide = np.zeros(count)
    peak_headboard = np.zeros(count)
    friction_use = np.zeros(count)
    stood_on_floor = np.zeros(count, dtype=bool)
    left_bed = np.zeros(count, dtype=bool)
    peak_tension = initial_tension.copy()

    # The motion the bed should follow, integrated the way the engine integrates (velocity
    # first, then position); the simulated bed is compared with it at every keyframe.
    bed_start = data.qpos[bed_dofs].copy()
    prescribed = np.cumsum(np.cumsum(profile.acceleration_mps2, axis=0), axis=0) * TIMESTEP_S**2
    tracking_error = 0.0
    half_extent = np.array([half_length, half_width])
    min_upright = np.ones(count)
    # Tilt is the angle of the unit's own Z axis from vertical, read from xmat[:, 8]. A
    # cylinder lying on its side turns about its axis when it rolls, which is not a tilt:
    # for it the tilt is how far its axis leaves the horizontal (xmat[:, 6] for an axis along
    # X, xmat[:, 7] along Y: the Z component of that axis).
    lying = np.array([unit.lying_axis is not None for unit in scene.units], dtype=bool)
    lying_column = np.array([6 + (unit.lying_axis or 0) for unit in scene.units], dtype=np.intp)
    start_quat = data.xquat[unit_ids].copy()
    min_quat_dot = np.ones(count)

    floor_force_sum = np.zeros(count)
    steps_since_frame = 0
    recent_contacts: list[KeyframeContact] = []

    def keyframe(t: float, step: int) -> Keyframe:
        nonlocal floor_force_sum, steps_since_frame, recent_contacts
        if frame_hook is not None:
            frame_hook(model, data, t)
        contacts, floor_force = _contact_points(data, bed_id, contact_kinds, unit_of_geom, count)
        if len(recent_contacts) > len(contacts):
            contacts = recent_contacts
        # The floor force of a frame is its average over the steps since the previous frame
        # (the instantaneous value at the very first one).
        if steps_since_frame:
            floor_force = floor_force_sum / steps_since_frame
        floor_force_sum = np.zeros(count)
        steps_since_frame = 0
        recent_contacts = []
        return _keyframe(
            t,
            profile,
            step,
            data,
            bed_id,
            unit_ids,
            lashings,
            saddle_qpos,
            contacts,
            floor_force,
        )

    frames: list[Keyframe] = [keyframe(0.0, 0)]
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
            lashings.dirty = True
        lashings.apply(model, data)
        mujoco.mj_step(model, data)

        relative = data.xpos[unit_ids] - data.xpos[bed_id]
        displacement = relative - start
        np.maximum(max_slide, np.hypot(displacement[:, 0], displacement[:, 1]), out=max_slide)
        # xmat[:, 8] is the Z component of the unit's own Z axis: the cosine of its tilt.
        upright = data.xmat[unit_ids, 8]
        if lying.any():
            axis_up = data.xmat[unit_ids, lying_column]
            upright = np.where(lying, np.sqrt(np.maximum(1.0 - axis_up**2, 0.0)), upright)
        np.minimum(min_upright, upright, out=min_upright)
        # |q0 . q| is the cosine of half the angle the unit turned since the start.
        np.minimum(
            min_quat_dot,
            np.abs(np.sum(start_quat * data.xquat[unit_ids], axis=1)),
            out=min_quat_dot,
        )
        left_bed |= (np.abs(relative[:, :2]) > half_extent).any(axis=1) | (
            displacement[:, 2] < -0.05
        )

        tension = lashings.tension(data) if has_lashings else initial_tension
        np.maximum(peak_tension, tension, out=peak_tension)
        newly_broken = (tension > lashings.breaking) & ~lashings.broken
        if has_lashings and newly_broken.any():
            lashings.broken |= newly_broken
            lashings.broke_at_s[newly_broken] = data.time
            lashings.dirty = True

        floor_force = (
            _friction_use(
                data,
                floor_geom,
                unit_of_geom,
                floor_friction,
                weights,
                friction_use,
                stood_on_floor,
            )
            if data.ncon
            else None
        )
        if floor_force is not None:
            floor_force_sum += floor_force
        steps_since_frame += 1
        # A sliding unit chatters on the floor, so the contacts of a single instant may be
        # missing. For the replay, keep the fullest set seen since the previous keyframe.
        frame_step = round(next_frame * steps_per_frame)
        if 0 < frame_step - (step + 1) <= _CONTACT_LOOKBACK_STEPS and data.ncon:
            snapshot, _ = _contact_points(data, bed_id, contact_kinds, unit_of_geom, count)
            if len(snapshot) >= len(recent_contacts):
                recent_contacts = snapshot

        if headboard_geom >= 0 and data.ncon:
            geoms = data.contact.geom
            touching = geoms[(geoms == headboard_geom).any(axis=1)]
            for other in {int(g) for g in touching.ravel() if g != headboard_geom}:
                force = _unit_headboard_force(model, data, headboard_geom, other)
                unit = geom_to_unit[other]
                peak_headboard[unit] = max(peak_headboard[unit], force)

        if step + 1 >= round(next_frame * steps_per_frame):
            tracking_error = max(
                tracking_error,
                float(np.abs(data.qpos[bed_dofs] - bed_start - prescribed[step]).max()),
            )
            frames.append(keyframe(next_frame / REPLAY_FPS, step))
            next_frame += 1

    _check_stable(data)
    max_tilt = np.degrees(np.arccos(np.clip(min_upright, -1.0, 1.0)))
    max_rotation = np.degrees(2 * np.arccos(np.clip(min_quat_dot, 0.0, 1.0)))
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
            max_rotation_deg=_round(max_rotation[index], 3),
            can_roll=bool(lying[index]),
            peak_friction_use=(
                _round(min(friction_use[index], 1.0), 3) if stood_on_floor[index] else None
            ),
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
        bed=keyframe_bed(scenario),
        units=[keyframe_unit(unit.unit, unit.floor_friction.coefficient) for unit in scene.units],
        straps=[keyframe_strap(scene, index) for index in range(len(scene.lashings))],
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
        margins=_margins(unit_results, lashing_results),
        keyframes=keyframes,
    )


def keyframe_bed(scenario: Scenario) -> KeyframeBed:
    """What the replay needs to draw the truck body, with the simulation's dimensions."""
    bed = scenario.bed
    return KeyframeBed(
        length_m=bed.length_m,
        width_m=bed.width_m,
        floor_height_m=bed.floor_height_m,
        headboard_height_m=bed.headboard.height_m if bed.headboard else 0.0,
        side_rail_height_m=bed.side_rail_height_m,
        body=bed.body,
        rear_wall_height_m=bed.rear_wall_height_m,
        blocks=[
            KeyframeBlock(
                id=block.id, kind=block.kind, size_m=block.size_m, position_m=block.position_m
            )
            for block in bed.blocks
        ],
    )


def keyframe_unit(unit: CargoUnit, friction: float) -> KeyframeUnit:
    return KeyframeUnit(
        id=unit.id,
        size_m=unit.size_m,
        mass_kg=unit.mass_kg,
        friction_coefficient=friction,
        shape=unit.shape,
        axis=unit.axis,
        inner_diameter_m=unit.inner_diameter_m,
    )


def _margins(units: list[UnitResult], lashings: list[LashingResult]) -> Margins:
    friction = [unit.peak_friction_use for unit in units if unit.peak_friction_use is not None]
    busiest = max(lashings, key=lambda lashing: lashing.peak_force_ratio, default=None)
    return Margins(
        max_slide_m=max(unit.max_slide_m for unit in units),
        slide_limit_m=SLIDE_FAIL_M,
        max_tilt_deg=max(unit.max_tilt_deg for unit in units),
        peak_friction_use=max(friction, default=None),
        peak_lashing_force_n=max((lashing.peak_force_n for lashing in lashings), default=None),
        peak_lashing_force_ratio=busiest.peak_force_ratio if busiest else None,
        lashing_capacity_reserve=_round(1 - busiest.peak_force_ratio, 4) if busiest else None,
    )


def _friction_use(
    data: mujoco.MjData,
    floor_geom: int,
    unit_of_geom: NDArray[np.intp],
    friction: FloatArray,
    weights: FloatArray,
    peak: FloatArray,
    stood_on_floor: NDArray[np.bool_],
) -> FloatArray | None:
    """Update each unit's peak friction use: friction force / (friction factor x normal force).

    Returns the force of the floor on each unit at this step [N], or None if nothing touches
    the floor.

    With an elliptic friction cone the solver stores each contact's force in the contact
    frame: normal first, then the two tangential components.
    """
    contact = data.contact
    geoms = contact.geom
    address = contact.efc_address
    on_floor = ((geoms[:, 0] == floor_geom) | (geoms[:, 1] == floor_geom)) & (address >= 0)
    if not on_floor.any():
        return None
    address = address[on_floor]
    pair = geoms[on_floor]
    units = unit_of_geom[np.where(pair[:, 0] == floor_geom, pair[:, 1], pair[:, 0])]
    count = len(peak)
    normal: FloatArray = np.asarray(
        np.bincount(units, weights=data.efc_force[address], minlength=count), dtype=np.float64
    )
    along = np.bincount(units, weights=data.efc_force[address + 1], minlength=count)
    across = np.bincount(units, weights=data.efc_force[address + 2], minlength=count)
    # Ignore instants when a unit barely touches the floor (bouncing): the ratio is noise.
    loaded = normal > 0.05 * weights
    stood_on_floor |= loaded
    use = np.hypot(along, across)[loaded] / (friction[loaded] * normal[loaded])
    peak[loaded] = np.maximum(peak[loaded], use)
    return normal


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
        taut=np.zeros(count, dtype=bool),
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
        lashings.dirty = True
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


def _contact_kinds(
    model: mujoco.MjModel, floor_geom: int, headboard_geom: int, unit_geoms: NDArray[np.intp]
) -> list[str]:
    """What each geom is, for labelling contact points: indexed by geom id."""
    kinds = ["rail"] * model.ngeom
    kinds[floor_geom] = "floor"
    kinds[model.geom(ROAD_GEOM).id] = "road"
    if headboard_geom >= 0:
        kinds[headboard_geom] = "headboard"
    for geom in range(model.ngeom):
        if (model.geom(geom).name or "").startswith(BLOCK_GEOM_PREFIX):
            kinds[geom] = "block"
    for geom in unit_geoms:
        kinds[int(geom)] = "unit"
    return kinds


def _contact_points(
    data: mujoco.MjData,
    bed_id: int,
    contact_kinds: list[str],
    unit_of_geom: NDArray[np.intp],
    units: int,
) -> tuple[list[KeyframeContact], FloatArray]:
    """Contact points with their normal force, and the floor's push on each unit, right now."""
    bed = data.xpos[bed_id]
    floor_force = np.zeros(units)
    contacts: list[KeyframeContact] = []
    geoms = data.contact.geom
    address = data.contact.efc_address
    points = data.contact.pos
    for index in range(data.ncon):
        if address[index] < 0:
            continue
        force = float(data.efc_force[address[index]])
        if force < 1.0:
            continue
        first, second = int(geoms[index, 0]), int(geoms[index, 1])
        # A contact is named after what the unit touches; unit against unit is "unit".
        other = first if contact_kinds[second] == "unit" else second
        kind = contact_kinds[other]
        if kind == "floor":
            floor_force[unit_of_geom[second if other == first else first]] += force
        position = points[index] - bed
        contacts.append(
            (
                _round(position[0], 3),
                _round(position[1], 3),
                _round(position[2], 3),
                _round(force, 0),
                kind,  # type: ignore[arg-type]
            )
        )
    return contacts, floor_force


def _keyframe(
    t: float,
    profile: MotionProfile,
    step: int,
    data: mujoco.MjData,
    bed_id: int,
    unit_ids: NDArray[np.intp],
    lashings: _Lashings,
    saddle_qpos: list[int],
    contacts: list[KeyframeContact],
    floor_force: FloatArray,
) -> Keyframe:
    positions = data.xpos[unit_ids] - data.xpos[bed_id]
    quaternions = data.xquat[unit_ids]
    tension = lashings.tension(data)
    return Keyframe(
        t=_round(t, 4),
        truck_speed_mps=_round(profile.truck_speed_mps[step], 3),
        bed_accel_mps2=_vec(profile.acceleration_mps2[step], 3),
        units=[
            KeyframePose(
                p=_vec(positions[index], 4),
                q=_quat(quaternions[index]),
                n=_round(floor_force[index], 0),
            )
            for index in range(len(unit_ids))
        ],
        straps=[
            KeyframeStrapState(
                tension_n=_round(tension[index], 0),
                slide_m=_round(data.qpos[address], 4) if address >= 0 else 0.0,
            )
            for index, address in enumerate(saddle_qpos)
        ],
        contacts=contacts,
    )


def keyframe_strap(scene: Scene, index: int) -> KeyframeStrap:
    """Geometry of one lashing for the replay."""
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
