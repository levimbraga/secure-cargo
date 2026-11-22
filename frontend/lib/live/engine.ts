/**
 * Runs a live model in MuJoCo WebAssembly: the browser's copy of `backend/physics/simulate.py`.
 *
 * Same MJCF, same 2 ms step, same prescribed bed motion, same pretensioning, same metrics. The
 * two files are kept step for step alike on purpose; when one changes, change the other and
 * keep the parity tests green (`lib/live/engine.test.ts`, `e2e/parity.spec.ts`).
 *
 * A run has three uses:
 *  - `advance()` until `done`: the whole event with its metrics, keyframes and verdict;
 *  - `seek()` + `stepLive()`: stepping again from any keyframe in real time, optionally with a
 *    force the visitor applies to a unit (nothing is measured in this mode);
 *  - `sample()`: the state right now, for the 3D scene.
 */

import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";

import type { Finding, Margins, Status } from "@/lib/demo";
import type { KeyframeContact, KeyframeFrame, KeyframesDoc, Quat, Sample, Vec3 } from "@/lib/keyframes";

import type { LiveModel } from "./model";
import { buildVerdict, type LiveLashingResult, type LiveUnitResult } from "./verdict";

type F64 = Float64Array;
type I32 = Int32Array;

export class LiveRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveRunError";
  }
}

export type LiveResult = {
  scenario_id: string;
  duration_s: number;
  engine: { mujoco_version: string; timestep_s: number; bed_tracking_error_m: number };
  profile: Record<string, number | string>;
  verdict: { status: Status; findings: Finding[] };
  units: LiveUnitResult[];
  lashings: LiveLashingResult[];
  margins: Margins;
  keyframes: KeyframesDoc;
};

type Snapshot = {
  step: number;
  time: number;
  qpos: F64;
  qvel: F64;
  warmstart: F64;
  restLength: F64;
  broken: Uint8Array;
};

/** Typed-array views into the engine's memory. They die when the memory grows, so they are re-made on demand. */
type Views = {
  qpos: F64;
  qvel: F64;
  warmstart: F64;
  xpos: F64;
  xquat: F64;
  xmat: F64;
  tenLength: F64;
  tenVelocity: F64;
  qfrcApplied: F64;
  qfrcConstraint: F64;
  qfrcPassive: F64;
  qfrcBias: F64;
  xfrcApplied: F64;
  tendonStiffness: F64;
  tendonDamping: F64;
  tendonLengthspring: F64;
};

const CONTACT_KIND = ["rail", "floor", "road", "headboard", "unit", "block"] as const;
const RAIL = 0;
const FLOOR = 1;
const ROAD = 2;
const HEADBOARD = 3;
const UNIT = 4;
const BLOCK = 5;

function round(value: number, digits: number): number {
  // The backend rounds the same way; "+ 0" turns -0 into 0.
  return Number(value.toFixed(digits)) + 0;
}

export class LiveRun {
  readonly live: LiveModel;
  /** Keyframes recorded so far, 30 per second of the event. */
  readonly frames: KeyframeFrame[] = [];

  private readonly mujoco: MainModule;
  private model: MjModel | null;
  private data: MjData | null;
  private views!: Views;

  private readonly steps: number;
  private readonly dt: number;
  private readonly stepsPerFrame: number;
  private readonly acceleration: number[];

  private readonly bedDofs: number[];
  private readonly bedInertia: number[];
  private readonly bedQpos: number[];
  private readonly bedId: number;
  private readonly unitIds: number[];
  private readonly unitOfGeom: I32;
  private readonly kindOfGeom: Uint8Array;
  private readonly floorGeom: number;
  private readonly headboardGeom: number;
  private readonly saddleQpos: number[];
  private readonly count: number;
  private readonly lashingCount: number;

  // Lashings (see `_Lashings` in the backend).
  private readonly tendonIds: number[];
  private readonly stiffness: F64;
  private readonly damping: F64;
  private restLength: F64;
  private referenceLength: F64;
  private readonly target: F64;
  private readonly breaking: F64;
  private broken: Uint8Array;
  private readonly brokeAt: F64;
  private taut: Uint8Array;
  private dirty = true;
  private readonly tension: F64;

  // Reference state and metrics of the event.
  private readonly start: F64;
  private readonly bedStart: number[];
  private readonly initialTension: F64;
  private readonly frontGap: F64;
  private readonly weights: F64;
  private readonly friction: F64;
  private readonly maxSlide: F64;
  private readonly peakHeadboard: F64;
  private readonly frictionUse: F64;
  private readonly stoodOnFloor: Uint8Array;
  private readonly leftBed: Uint8Array;
  private readonly peakTension: F64;
  private readonly minUpright: F64;
  /** xmat column whose Z component gives the tilt: 8 (own Z axis), or 6 / 7 for a lying cylinder's axis. */
  private readonly tiltColumn: Int32Array;
  private readonly startQuat: F64;
  private readonly minQuatDot: F64;
  private trackingError = 0;
  private readonly prescribedVelocity = [0, 0, 0];
  private readonly prescribedPosition = [0, 0, 0];

  private readonly floorForceSum: F64;
  private stepsSinceFrame = 0;
  private recentContacts: KeyframeContact[] = [];
  private nextFrame = 1;
  private stepIndex = 0;
  private readonly snapshots: Snapshot[] = [];

  // Contacts of the current step, read once from the engine.
  private contactCount = 0;
  private contactGeom1 = new Int32Array(64);
  private contactGeom2 = new Int32Array(64);
  private contactForce = new Float64Array(64);
  private contactAlong = new Float64Array(64);
  private contactAcross = new Float64Array(64);
  private contactPos = new Float64Array(192);
  private readonly scratch: F64;
  private readonly scratch2: F64;
  private readonly scratch3: F64;

  /** Force the visitor applies to a unit [N], bed frame; only used by `stepLive`. */
  private push: { unit: number; force: Vec3 } | null = null;
  /** Steps taken by `stepLive` since the last `seek`. */
  private liveStep = 0;

  constructor(mujoco: MainModule, live: LiveModel) {
    this.mujoco = mujoco;
    this.live = live;
    const { settings, names, profile } = live;
    this.steps = profile.steps;
    this.dt = settings.timestep_s;
    this.stepsPerFrame = 1 / (settings.replay_fps * settings.timestep_s);
    this.acceleration = profile.acceleration_mps2;

    let model: MjModel;
    try {
      model = mujoco.MjModel.from_xml_string(live.mjcf);
    } catch (cause) {
      throw new LiveRunError(`MuJoCo could not load the model: ${String(cause)}`);
    }
    const data = new mujoco.MjData(model);
    this.model = model;
    this.data = data;
    this.refreshViews();

    const id = (type: { value: number }, name: string): number => {
      const found = mujoco.mj_name2id(model, type.value, name);
      if (found < 0) throw new LiveRunError(`The model has no element named ${name}`);
      return found;
    };
    const { mjOBJ_BODY, mjOBJ_GEOM, mjOBJ_JOINT, mjOBJ_TENDON } = mujoco.mjtObj;

    (model.opt.gravity as F64).set([0, 0, -settings.gravity_mps2]);

    const dofAddress = model.jnt_dofadr as I32;
    const qposAddress = model.jnt_qposadr as I32;
    const inertia = model.dof_M0 as F64;
    const bedJoints = names.bed_joints.map((name) => id(mjOBJ_JOINT, name));
    this.bedDofs = bedJoints.map((joint) => dofAddress[joint] as number);
    this.bedQpos = bedJoints.map((joint) => qposAddress[joint] as number);
    this.bedInertia = this.bedDofs.map((dof) => inertia[dof] as number);
    // MuJoCo scales its convergence test by the mean inertia of the model. The bed's huge
    // armature would inflate that mean and let the solver stop early, so the tolerance is
    // scaled back to what it would be for the cargo alone.
    let total = 0;
    let cargo = 0;
    for (let dof = 0; dof < model.nv; dof++) {
      total += inertia[dof] as number;
      if (!this.bedDofs.includes(dof)) cargo += inertia[dof] as number;
    }
    model.opt.tolerance =
      (settings.solver_tolerance * (cargo / (model.nv - this.bedDofs.length))) / (total / model.nv);

    this.bedId = id(mjOBJ_BODY, names.bed_body);
    this.count = live.units.length;
    this.unitIds = live.units.map((unit) => id(mjOBJ_BODY, unit.body));
    this.floorGeom = id(mjOBJ_GEOM, names.floor_geom);
    this.headboardGeom = names.headboard_geom ? id(mjOBJ_GEOM, names.headboard_geom) : -1;
    this.unitOfGeom = new Int32Array(model.ngeom).fill(-1);
    this.kindOfGeom = new Uint8Array(model.ngeom).fill(RAIL);
    this.kindOfGeom[this.floorGeom] = FLOOR;
    this.kindOfGeom[id(mjOBJ_GEOM, names.road_geom)] = ROAD;
    if (this.headboardGeom >= 0) this.kindOfGeom[this.headboardGeom] = HEADBOARD;
    for (let geom = 0; geom < model.ngeom; geom++) {
      const name = mujoco.mj_id2name(model, mjOBJ_GEOM.value, geom);
      if (name?.startsWith(names.block_geom_prefix)) this.kindOfGeom[geom] = BLOCK;
    }
    live.units.forEach((unit, index) => {
      const geom = id(mjOBJ_GEOM, unit.geom);
      this.unitOfGeom[geom] = index;
      this.kindOfGeom[geom] = UNIT;
    });
    this.friction = Float64Array.from(live.units, (unit) => unit.friction_coefficient);
    this.weights = Float64Array.from(live.units, (unit) => unit.mass_kg * settings.gravity_mps2);
    const halfLength = live.bed.length_m / 2;
    this.frontGap = Float64Array.from(
      live.units,
      (unit) => halfLength - (unit.position_m[0] + unit.size_m[0] / 2),
    );

    // Lashings: rest length from the installed length and the pretension.
    const count = live.lashings.length;
    this.lashingCount = count;
    this.tendonIds = live.lashings.map((lashing) => id(mjOBJ_TENDON, lashing.tendon));
    this.saddleQpos = live.lashings.map((lashing) =>
      lashing.saddle_joint ? (qposAddress[id(mjOBJ_JOINT, lashing.saddle_joint)] as number) : -1,
    );
    this.stiffness = new Float64Array(count);
    this.damping = new Float64Array(count);
    this.target = new Float64Array(count);
    this.breaking = new Float64Array(count).fill(Infinity);
    this.broken = new Uint8Array(count);
    this.brokeAt = new Float64Array(count);
    this.taut = new Uint8Array(count);
    this.tension = new Float64Array(count);
    this.restLength = new Float64Array(count);
    this.referenceLength = new Float64Array(count);
    this.scratch = new Float64Array(Math.max(this.count, 1));
    this.scratch2 = new Float64Array(Math.max(this.count, 1));
    this.scratch3 = new Float64Array(Math.max(this.count, 1));

    mujoco.mj_forward(model, data);
    this.refreshViews();
    const perUnit = new Int32Array(this.count);
    for (const lashing of live.lashings) perUnit[lashing.unit_index] = (perUnit[lashing.unit_index] ?? 0) + 1;
    const maxRate = settings.max_spring_phase_per_step / this.dt;
    const dofDamping = model.dof_damping as F64;
    live.lashings.forEach((lashing, index) => {
      const mass = (live.units[lashing.unit_index] as LiveModel["units"][number]).mass_kg;
      const installed = this.views.tenLength[this.tendonIds[index] as number] as number;
      const target = lashing.pretension_n;
      const rest = installed / (1 + target / lashing.axial_stiffness_n);
      // Stability cap; it only binds for very light units held by very stiff lashings.
      const cap = (mass * maxRate ** 2) / (perUnit[lashing.unit_index] as number);
      const stiffness = Math.min(lashing.axial_stiffness_n / rest, cap);
      this.target[index] = target;
      this.stiffness[index] = stiffness;
      this.damping[index] = 2 * settings.lashing_damping_ratio * Math.sqrt(stiffness * mass);
      if (lashing.breaking_strength_n !== null) this.breaking[index] = lashing.breaking_strength_n;
      for (const saddle of [lashing.saddle_joint, ...(lashing.extra_saddle_joints ?? [])]) {
        if (!saddle) continue;
        // Light damping of the strap sliding along the unit, so it does not ring.
        const dof = dofAddress[id(mjOBJ_JOINT, saddle)] as number;
        dofDamping[dof] = Math.max(1, 0.2 * Math.sqrt(target));
      }
      this.restLength[index] = installed - target / stiffness;
      this.referenceLength[index] = installed;
    });

    this.pretension();
    this.checkStable();
    data.time = 0;
    for (const dof of this.bedDofs) this.views.qvel[dof] = 0;

    // Reference state: where everything is when the event starts.
    const { xpos } = this.views;
    this.start = new Float64Array(3 * this.count);
    this.unitIds.forEach((body, index) => {
      for (let axis = 0; axis < 3; axis++) {
        this.start[3 * index + axis] =
          (xpos[3 * body + axis] as number) - (xpos[3 * this.bedId + axis] as number);
      }
    });
    this.bedStart = this.bedQpos.map((address) => this.views.qpos[address] as number);
    this.updateTension();
    this.initialTension = this.tension.slice();
    this.peakTension = this.tension.slice();
    this.maxSlide = new Float64Array(this.count);
    this.peakHeadboard = new Float64Array(this.count);
    this.frictionUse = new Float64Array(this.count);
    this.stoodOnFloor = new Uint8Array(this.count);
    this.leftBed = new Uint8Array(this.count);
    this.minUpright = new Float64Array(this.count).fill(1);
    // Tilt is the angle of the unit's own Z axis from vertical. A cylinder lying on its side
    // turns about its axis when it rolls, which is not a tilt: for it the tilt is how far its
    // axis leaves the horizontal (the Z component of that axis: xmat column 6 for X, 7 for Y).
    this.tiltColumn = Int32Array.from(live.units, (unit) => (unit.lying_axis === null ? 8 : 6 + unit.lying_axis));
    this.startQuat = new Float64Array(4 * this.count);
    this.unitIds.forEach((body, index) => {
      for (let k = 0; k < 4; k++) this.startQuat[4 * index + k] = this.views.xquat[4 * body + k] as number;
    });
    this.minQuatDot = new Float64Array(this.count).fill(1);
    this.floorForceSum = new Float64Array(this.count);

    this.readContacts();
    this.frames.push(this.keyframe(0, 0));
    this.snapshots.push(this.snapshot());
  }

  /** True once every step of the event has been simulated. */
  get done(): boolean {
    return this.stepIndex >= this.steps;
  }

  /** Share of the event simulated so far, 0..1. */
  get progress(): number {
    return this.steps > 0 ? this.stepIndex / this.steps : 1;
  }

  get durationS(): number {
    return this.steps * this.dt;
  }

  /** Simulates the event for at most `budgetMs` of wall time; returns `done`. */
  advance(budgetMs = Infinity): boolean {
    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    while (this.stepIndex < this.steps) {
      this.stepEvent();
      if ((this.stepIndex & 15) === 0 && performance.now() >= deadline) break;
    }
    return this.done;
  }

  /** Releases the engine's memory. The run cannot be used afterwards. */
  dispose(): void {
    this.data?.delete();
    this.model?.delete();
    this.data = null;
    this.model = null;
  }

  // --- The event --------------------------------------------------------------------------

  private stepEvent(): void {
    const model = this.model as MjModel;
    const data = this.data as MjData;
    const step = this.stepIndex;
    const settings = this.live.settings;

    this.driveBed(step);
    this.loosen(step);
    this.applyLashings();
    this.mujoco.mj_step(model, data);
    this.ensureViews();

    const { xpos, xmat, xquat } = this.views;
    const bed = 3 * this.bedId;
    const halfLength = this.live.bed.length_m / 2;
    const halfWidth = this.live.bed.width_m / 2;
    for (let index = 0; index < this.count; index++) {
      const body = 3 * (this.unitIds[index] as number);
      const rx = (xpos[body] as number) - (xpos[bed] as number);
      const ry = (xpos[body + 1] as number) - (xpos[bed + 1] as number);
      const rz = (xpos[body + 2] as number) - (xpos[bed + 2] as number);
      const dx = rx - (this.start[3 * index] as number);
      const dy = ry - (this.start[3 * index + 1] as number);
      const dz = rz - (this.start[3 * index + 2] as number);
      this.maxSlide[index] = Math.max(this.maxSlide[index] as number, Math.hypot(dx, dy));
      // xmat[8] is the Z component of the unit's own Z axis: the cosine of its tilt.
      const unitBody = this.unitIds[index] as number;
      const column = this.tiltColumn[index] as number;
      const axisUp = xmat[9 * unitBody + column] as number;
      const upright = column === 8 ? axisUp : Math.sqrt(Math.max(1 - axisUp * axisUp, 0));
      this.minUpright[index] = Math.min(this.minUpright[index] as number, upright);
      // |q0 . q| is the cosine of half the angle the unit turned since the start.
      let dot = 0;
      for (let k = 0; k < 4; k++) dot += (this.startQuat[4 * index + k] as number) * (xquat[4 * unitBody + k] as number);
      this.minQuatDot[index] = Math.min(this.minQuatDot[index] as number, Math.abs(dot));
      if (Math.abs(rx) > halfLength || Math.abs(ry) > halfWidth || dz < -0.05) this.leftBed[index] = 1;
    }

    if (this.lashingCount > 0) {
      this.updateTension();
      for (let index = 0; index < this.lashingCount; index++) {
        const tension = this.tension[index] as number;
        this.peakTension[index] = Math.max(this.peakTension[index] as number, tension);
        if (tension > (this.breaking[index] as number) && !this.broken[index]) {
          this.broken[index] = 1;
          this.brokeAt[index] = data.time;
          this.dirty = true;
        }
      }
    }

    this.readContacts();
    if (this.contactCount > 0) {
      const floorForce = this.measureFriction();
      if (floorForce) {
        for (let index = 0; index < this.count; index++) {
          this.floorForceSum[index] = (this.floorForceSum[index] as number) + (floorForce[index] as number);
        }
      }
    }
    this.stepsSinceFrame += 1;
    // A sliding unit chatters on the floor, so the contacts of a single instant may be
    // missing. For the replay, keep the fullest set seen since the previous keyframe.
    const frameStep = Math.round(this.nextFrame * this.stepsPerFrame);
    const ahead = frameStep - (step + 1);
    if (ahead > 0 && ahead <= settings.contact_lookback_steps && this.contactCount > 0) {
      const snapshot = this.contactPoints(null);
      if (snapshot.length >= this.recentContacts.length) this.recentContacts = snapshot;
    }

    if (this.headboardGeom >= 0 && this.contactCount > 0) {
      const force = this.scratch.fill(0);
      let touching = false;
      for (let index = 0; index < this.contactCount; index++) {
        const first = this.contactGeom1[index] as number;
        const second = this.contactGeom2[index] as number;
        if (first !== this.headboardGeom && second !== this.headboardGeom) continue;
        const unit = this.unitOfGeom[first === this.headboardGeom ? second : first] as number;
        if (unit < 0) continue;
        force[unit] = (force[unit] as number) + (this.contactForce[index] as number);
        touching = true;
      }
      if (touching) {
        for (let index = 0; index < this.count; index++) {
          this.peakHeadboard[index] = Math.max(this.peakHeadboard[index] as number, force[index] as number);
        }
      }
    }

    // The motion the bed should follow, integrated the way the engine integrates (velocity
    // first, then position); the simulated bed is compared with it at every keyframe.
    for (let axis = 0; axis < 3; axis++) {
      this.prescribedVelocity[axis] =
        (this.prescribedVelocity[axis] as number) + (this.acceleration[3 * step + axis] as number);
      this.prescribedPosition[axis] =
        (this.prescribedPosition[axis] as number) + (this.prescribedVelocity[axis] as number);
    }

    this.stepIndex = step + 1;
    if (step + 1 >= frameStep) {
      for (let axis = 0; axis < 3; axis++) {
        const expected = (this.prescribedPosition[axis] as number) * this.dt ** 2;
        const actual =
          (this.views.qpos[this.bedQpos[axis] as number] as number) - (this.bedStart[axis] as number);
        this.trackingError = Math.max(this.trackingError, Math.abs(actual - expected));
      }
      this.frames.push(this.keyframe(this.nextFrame / settings.replay_fps, step));
      this.snapshots.push(this.snapshot());
      this.nextFrame += 1;
    }
  }

  /** Applies the force that gives the bed the prescribed acceleration in the next step. */
  private driveBed(step: number): void {
    const { qfrcApplied, qfrcConstraint, qfrcPassive, qfrcBias } = this.views;
    const inEvent = step < this.steps;
    for (let axis = 0; axis < 3; axis++) {
      const dof = this.bedDofs[axis] as number;
      // The cargo pushes on the bed through contacts and lashings. That reaction (taken from
      // the previous step) is cancelled, so the bed moves as prescribed whatever it carries.
      const reaction =
        (qfrcConstraint[dof] as number) + (qfrcPassive[dof] as number) - (qfrcBias[dof] as number);
      const acceleration = inEvent ? (this.acceleration[3 * step + axis] as number) : 0;
      qfrcApplied[dof] = (this.bedInertia[axis] as number) * acceleration - reaction;
    }
  }

  /** Vibration loosens lashings: move the rest length to the reduced pretension. */
  private loosen(step: number): void {
    const factors = this.live.profile.pretension_factor;
    if (!factors || step >= this.steps) return;
    const factor = factors[step] as number;
    for (let index = 0; index < this.lashingCount; index++) {
      this.restLength[index] =
        (this.referenceLength[index] as number) -
        (factor * (this.target[index] as number)) / (this.stiffness[index] as number);
    }
    this.dirty = true;
  }

  /** Writes the lashing parameters into the model before a step, if they changed. */
  private applyLashings(): void {
    if (this.lashingCount === 0) return;
    const { tenLength, tendonStiffness, tendonDamping, tendonLengthspring } = this.views;
    let tautChanged = false;
    for (let index = 0; index < this.lashingCount; index++) {
      const tendon = this.tendonIds[index] as number;
      // Damping only acts while the lashing is taut, so a slack one does not resist.
      const taut =
        (tenLength[tendon] as number) > (this.restLength[index] as number) && !this.broken[index] ? 1 : 0;
      if (taut !== this.taut[index]) tautChanged = true;
      this.taut[index] = taut;
    }
    if (!this.dirty && !tautChanged) return;
    for (let index = 0; index < this.lashingCount; index++) {
      const tendon = this.tendonIds[index] as number;
      if (this.dirty) {
        tendonStiffness[tendon] = this.broken[index] ? 0 : (this.stiffness[index] as number);
        tendonLengthspring[2 * tendon] = 0;
        tendonLengthspring[2 * tendon + 1] = this.restLength[index] as number;
      }
      tendonDamping[tendon] = this.taut[index] ? (this.damping[index] as number) : 0;
    }
    this.dirty = false;
  }

  /** Force carried by each lashing [N]: spring plus damping, never negative. */
  private updateTension(): void {
    const { tenLength, tenVelocity } = this.views;
    for (let index = 0; index < this.lashingCount; index++) {
      const tendon = this.tendonIds[index] as number;
      const stretch = (tenLength[tendon] as number) - (this.restLength[index] as number);
      const force =
        stretch > 0 && !this.broken[index]
          ? (this.stiffness[index] as number) * stretch +
            (this.damping[index] as number) * (tenVelocity[tendon] as number)
          : 0;
      this.tension[index] = Math.max(force, 0);
    }
  }

  /** Lets the load settle and tightens every lashing to its pretension. */
  private pretension(): void {
    const model = this.model as MjModel;
    const data = this.data as MjData;
    const settings = this.live.settings;
    const settle = (steps: number) => {
      for (let step = 0; step < steps; step++) {
        this.applyLashings();
        this.driveBed(this.steps); // at rest
        this.mujoco.mj_step(model, data);
        this.ensureViews();
      }
    };
    const rounds = this.lashingCount > 0 ? settings.pretension_max_rounds : 1;
    for (let attempt = 0; attempt < rounds; attempt++) {
      settle(settings.pretension_round_steps);
      if (this.lashingCount === 0) break;
      let worst = 0;
      for (let index = 0; index < this.lashingCount; index++) {
        const length = this.views.tenLength[this.tendonIds[index] as number] as number;
        const target = this.target[index] as number;
        const stiffness = this.stiffness[index] as number;
        const held = stiffness * Math.max(length - (this.restLength[index] as number), 0);
        worst = Math.max(worst, Math.abs(held - target) / Math.max(target, 100));
        this.restLength[index] = length - target / stiffness;
      }
      this.dirty = true;
      if (worst < settings.pretension_tolerance) break;
    }
    settle(settings.final_settle_steps);
    for (let index = 0; index < this.lashingCount; index++) {
      this.referenceLength[index] = this.views.tenLength[this.tendonIds[index] as number] as number;
    }
  }

  // --- Contacts ---------------------------------------------------------------------------

  /**
   * Copies the contacts of this instant out of the engine: geoms, position, and the force the
   * solver found (normal first, then the two tangential components, in the contact frame).
   */
  private readContacts(): void {
    const data = this.data as MjData;
    const total = data.ncon;
    this.contactCount = 0;
    if (total === 0) return;
    if (total > this.contactGeom1.length) {
      const size = 2 * total;
      this.contactGeom1 = new Int32Array(size);
      this.contactGeom2 = new Int32Array(size);
      this.contactForce = new Float64Array(size);
      this.contactAlong = new Float64Array(size);
      this.contactAcross = new Float64Array(size);
      this.contactPos = new Float64Array(3 * size);
    }
    const force = data.efc_force as F64;
    const contacts = data.contact;
    let count = 0;
    for (let index = 0; index < total; index++) {
      const contact = contacts.get(index);
      if (!contact) continue;
      const address = contact.efc_address;
      // A contact the solver left out carries no force.
      if (address >= 0) {
        this.contactGeom1[count] = contact.geom1;
        this.contactGeom2[count] = contact.geom2;
        this.contactForce[count] = force[address] as number;
        const frictional = contact.dim >= 3;
        this.contactAlong[count] = frictional ? (force[address + 1] as number) : 0;
        this.contactAcross[count] = frictional ? (force[address + 2] as number) : 0;
        const position = contact.pos as F64;
        this.contactPos[3 * count] = position[0] as number;
        this.contactPos[3 * count + 1] = position[1] as number;
        this.contactPos[3 * count + 2] = position[2] as number;
        count += 1;
      }
      contact.delete();
    }
    contacts.delete();
    this.contactCount = count;
  }

  /**
   * Updates each unit's peak friction use: friction force / (friction factor x normal force).
   * Returns the force of the floor on each unit at this step [N], or null if nothing touches
   * the floor.
   */
  private measureFriction(): F64 | null {
    const normal = this.scratch.fill(0);
    const along = this.scratch2.fill(0);
    const across = this.scratch3.fill(0);
    let onFloor = false;
    for (let index = 0; index < this.contactCount; index++) {
      const first = this.contactGeom1[index] as number;
      const second = this.contactGeom2[index] as number;
      if (first !== this.floorGeom && second !== this.floorGeom) continue;
      const unit = this.unitOfGeom[first === this.floorGeom ? second : first] as number;
      if (unit < 0) continue;
      onFloor = true;
      normal[unit] = (normal[unit] as number) + (this.contactForce[index] as number);
      along[unit] = (along[unit] as number) + (this.contactAlong[index] as number);
      across[unit] = (across[unit] as number) + (this.contactAcross[index] as number);
    }
    if (!onFloor) return null;
    for (let unit = 0; unit < this.count; unit++) {
      // Ignore instants when a unit barely touches the floor (bouncing): the ratio is noise.
      if ((normal[unit] as number) <= 0.05 * (this.weights[unit] as number)) continue;
      this.stoodOnFloor[unit] = 1;
      const use =
        Math.hypot(along[unit] as number, across[unit] as number) /
        ((this.friction[unit] as number) * (normal[unit] as number));
      this.frictionUse[unit] = Math.max(this.frictionUse[unit] as number, use);
    }
    return normal;
  }

  /** Contact points with their normal force; adds the floor's push on each unit to `floorForce`. */
  private contactPoints(floorForce: F64 | null): KeyframeContact[] {
    const { xpos } = this.views;
    const bed = 3 * this.bedId;
    const contacts: KeyframeContact[] = [];
    for (let index = 0; index < this.contactCount; index++) {
      const force = this.contactForce[index] as number;
      if (force < 1) continue;
      const first = this.contactGeom1[index] as number;
      const second = this.contactGeom2[index] as number;
      // A contact is named after what the unit touches; unit against unit is "unit".
      const other = this.kindOfGeom[second] === UNIT ? first : second;
      const kind = this.kindOfGeom[other] as number;
      if (kind === FLOOR && floorForce) {
        const unit = this.unitOfGeom[other === first ? second : first] as number;
        if (unit >= 0) floorForce[unit] = (floorForce[unit] as number) + force;
      }
      contacts.push([
        round((this.contactPos[3 * index] as number) - (xpos[bed] as number), 3),
        round((this.contactPos[3 * index + 1] as number) - (xpos[bed + 1] as number), 3),
        round((this.contactPos[3 * index + 2] as number) - (xpos[bed + 2] as number), 3),
        round(force, 0),
        CONTACT_KIND[kind] as KeyframeContact[4],
      ]);
    }
    return contacts;
  }

  // --- Keyframes --------------------------------------------------------------------------

  private keyframe(t: number, step: number): KeyframeFrame {
    const floorForce = new Float64Array(this.count);
    let contacts = this.contactPoints(floorForce);
    if (this.recentContacts.length > contacts.length) contacts = this.recentContacts;
    // The floor force of a frame is its average over the steps since the previous frame
    // (the instantaneous value at the very first one).
    if (this.stepsSinceFrame > 0) {
      for (let index = 0; index < this.count; index++) {
        floorForce[index] = (this.floorForceSum[index] as number) / this.stepsSinceFrame;
      }
    }
    this.floorForceSum.fill(0);
    this.stepsSinceFrame = 0;
    this.recentContacts = [];
    this.updateTension();
    return this.frame(t, step, floorForce, contacts);
  }

  private frame(t: number, step: number, floorForce: F64, contacts: KeyframeContact[]): KeyframeFrame {
    const { xpos, xquat, qpos } = this.views;
    const bed = 3 * this.bedId;
    const speeds = this.live.profile.truck_speed_mps;
    const at = Math.min(step, this.steps - 1);
    return {
      t: round(t, 4),
      truck_speed_mps: round(speeds[at] ?? 0, 3),
      bed_accel_mps2:
        step < this.steps
          ? [
              round(this.acceleration[3 * at] as number, 3),
              round(this.acceleration[3 * at + 1] as number, 3),
              round(this.acceleration[3 * at + 2] as number, 3),
            ]
          : [0, 0, 0],
      units: this.unitIds.map((body, index) => ({
        p: [
          round((xpos[3 * body] as number) - (xpos[bed] as number), 4),
          round((xpos[3 * body + 1] as number) - (xpos[bed + 1] as number), 4),
          round((xpos[3 * body + 2] as number) - (xpos[bed + 2] as number), 4),
        ] as Vec3,
        q: [
          round(xquat[4 * body] as number, 5),
          round(xquat[4 * body + 1] as number, 5),
          round(xquat[4 * body + 2] as number, 5),
          round(xquat[4 * body + 3] as number, 5),
        ] as Quat,
        n: round(floorForce[index] as number, 0),
      })),
      straps: this.saddleQpos.map((address, index) => ({
        tension_n: round(this.tension[index] as number, 0),
        slide_m: address >= 0 ? round(qpos[address] as number, 4) : 0,
      })),
      contacts,
    };
  }

  /** The keyframes document of the event; complete once the run is `done`. */
  keyframes(status: Status = "pass", unitIds: string[] = []): KeyframesDoc {
    const { live } = this;
    return {
      version: 2,
      source: "simulation",
      fps: live.settings.replay_fps,
      duration_s: round(this.durationS, 3),
      bed: live.bed,
      units: live.units.map((unit) => ({
        id: unit.id,
        size_m: unit.size_m,
        mass_kg: unit.mass_kg,
        friction_coefficient: unit.friction_coefficient,
        shape: unit.shape,
        axis: unit.axis,
        inner_diameter_m: unit.inner_diameter_m,
      })),
      straps: live.lashings.map((lashing) => lashing.strap),
      events: live.profile.markers,
      frames: this.frames,
      result: { status, unit_ids: unitIds },
    };
  }

  /** Metrics, verdict and keyframes of the finished event. */
  result(): LiveResult {
    if (!this.done) throw new LiveRunError("The event has not been simulated to its end");
    this.checkStable();
    const { live } = this;
    const { settings, thresholds } = live;
    const { xpos } = this.views;
    const bed = 3 * this.bedId;
    this.updateTension();

    const units: LiveUnitResult[] = live.units.map((unit, index) => {
      const body = 3 * (this.unitIds[index] as number);
      const dx = (xpos[body] as number) - (xpos[bed] as number) - (this.start[3 * index] as number);
      const dy = (xpos[body + 1] as number) - (xpos[bed + 1] as number) - (this.start[3 * index + 1] as number);
      const upright = Math.min(Math.max(this.minUpright[index] as number, -1), 1);
      return {
        id: unit.id,
        friction_coefficient: unit.friction_coefficient,
        max_slide_m: round(this.maxSlide[index] as number, 5),
        final_slide_m: round(Math.hypot(dx, dy), 5),
        max_tilt_deg: round((Math.acos(upright) * 180) / Math.PI, 3),
        max_rotation_deg: round(
          (2 * Math.acos(Math.min(Math.max(this.minQuatDot[index] as number, 0), 1)) * 180) / Math.PI,
          3,
        ),
        can_roll: unit.lying_axis !== null,
        peak_friction_use: this.stoodOnFloor[index]
          ? round(Math.min(this.frictionUse[index] as number, 1), 3)
          : null,
        hit_headboard:
          (this.frontGap[index] as number) > settings.blocked_gap_m &&
          (this.peakHeadboard[index] as number) >
            settings.headboard_force_fraction * (this.weights[index] as number),
        peak_headboard_force_n: round(this.peakHeadboard[index] as number, 1),
        left_bed: Boolean(this.leftBed[index]),
      };
    });
    const lashings: LiveLashingResult[] = live.lashings.map((lashing, index) => ({
      id: lashing.id,
      unit_id: (live.units[lashing.unit_index] as LiveModel["units"][number]).id,
      lashing_capacity_n: lashing.lashing_capacity_n,
      initial_tension_n: round(this.initialTension[index] as number, 1),
      peak_force_n: round(this.peakTension[index] as number, 1),
      peak_force_ratio: round((this.peakTension[index] as number) / lashing.lashing_capacity_n, 4),
      final_tension_n: round(this.tension[index] as number, 1),
      broke_at_s: this.broken[index] ? round(this.brokeAt[index] as number, 3) : null,
    }));
    const verdict = buildVerdict(units, lashings, thresholds, live.axle_findings);
    const failed = [...new Set(verdict.findings.flatMap((item) => (item.unit_id ? [item.unit_id] : [])))].sort();

    const frictionUses = units.flatMap((unit) => (unit.peak_friction_use === null ? [] : [unit.peak_friction_use]));
    const busiest = lashings.reduce<LiveLashingResult | null>(
      (best, lashing) => (!best || lashing.peak_force_ratio > best.peak_force_ratio ? lashing : best),
      null,
    );
    return {
      scenario_id: live.scenario_id,
      duration_s: round(this.durationS, 3),
      engine: {
        mujoco_version: live.engine.mujoco_version,
        timestep_s: settings.timestep_s,
        bed_tracking_error_m: Number(this.trackingError.toExponential(2)),
      },
      profile: live.profile.parameters,
      verdict,
      units,
      lashings,
      margins: {
        max_slide_m: Math.max(...units.map((unit) => unit.max_slide_m)),
        slide_limit_m: thresholds.slide_fail_m,
        max_tilt_deg: Math.max(...units.map((unit) => unit.max_tilt_deg)),
        peak_friction_use: frictionUses.length ? Math.max(...frictionUses) : null,
        peak_lashing_force_n: lashings.length ? Math.max(...lashings.map((item) => item.peak_force_n)) : null,
        peak_lashing_force_ratio: busiest ? busiest.peak_force_ratio : null,
        lashing_capacity_reserve: busiest ? round(1 - busiest.peak_force_ratio, 4) : null,
      },
      keyframes: this.keyframes(verdict.status, failed),
    };
  }

  // --- Stepping again, live ---------------------------------------------------------------

  private snapshot(): Snapshot {
    const data = this.data as MjData;
    return {
      step: this.stepIndex,
      time: data.time,
      qpos: this.views.qpos.slice(),
      qvel: this.views.qvel.slice(),
      warmstart: this.views.warmstart.slice(),
      restLength: this.restLength.slice(),
      broken: this.broken.slice(),
    };
  }

  /** Puts the engine back in the state it had at a keyframe of the finished event. */
  seek(frameIndex: number): void {
    const snapshot = this.snapshots[Math.min(Math.max(Math.round(frameIndex), 0), this.snapshots.length - 1)];
    if (!snapshot) return;
    const data = this.data as MjData;
    this.ensureViews();
    this.views.qpos.set(snapshot.qpos);
    this.views.qvel.set(snapshot.qvel);
    this.views.warmstart.set(snapshot.warmstart);
    this.views.xfrcApplied.fill(0);
    data.time = snapshot.time;
    this.restLength = snapshot.restLength.slice();
    this.broken = snapshot.broken.slice();
    this.dirty = true;
    this.liveStep = snapshot.step;
    this.push = null;
    this.mujoco.mj_forward(this.model as MjModel, data);
    this.ensureViews();
    this.applyLashings();
  }

  /** Event time the live stepping has reached [s]; it keeps growing after the event ends. */
  get liveTime(): number {
    return this.liveStep * this.dt;
  }

  /** A force on a unit's centre [N] in the bed frame, held until changed; `null` removes it. */
  setPush(unit: number, force: Vec3 | null): void {
    this.push = force ? { unit, force } : null;
  }

  /**
   * Steps the engine `steps` times from where `seek` (or the previous call) left it. After the
   * end of the event the bed stays at rest, so the visitor can keep pushing the cargo.
   */
  stepLive(steps: number): void {
    const model = this.model as MjModel;
    const data = this.data as MjData;
    for (let count = 0; count < steps; count++) {
      const step = this.liveStep;
      this.driveBed(step);
      this.loosen(step);
      this.applyLashings();
      const { xfrcApplied } = this.views;
      xfrcApplied.fill(0);
      if (this.push) {
        const body = 6 * (this.unitIds[this.push.unit] as number);
        xfrcApplied[body] = this.push.force[0];
        xfrcApplied[body + 1] = this.push.force[1];
        xfrcApplied[body + 2] = this.push.force[2];
      }
      this.mujoco.mj_step(model, data);
      this.ensureViews();
      if (this.lashingCount > 0) {
        this.updateTension();
        for (let index = 0; index < this.lashingCount; index++) {
          if ((this.tension[index] as number) > (this.breaking[index] as number) && !this.broken[index]) {
            this.broken[index] = 1;
            this.dirty = true;
          }
        }
      }
      this.liveStep = step + 1;
    }
    if (!Number.isFinite(this.views.qpos[this.views.qpos.length - 1] as number)) {
      throw new LiveRunError("the simulation became unstable");
    }
  }

  /** The state of the engine right now, in the shape the 3D scene draws. */
  sample(): Sample {
    this.readContacts();
    const floorForce = new Float64Array(this.count);
    const contacts = this.contactPoints(floorForce);
    this.updateTension();
    const frame = this.frame(this.liveTime, this.liveStep, floorForce, contacts);
    return {
      truckSpeed: frame.truck_speed_mps ?? 0,
      bedAccel: frame.bed_accel_mps2 ?? [0, 0, 0],
      units: frame.units.map((unit) => ({ p: unit.p, q: unit.q, normal: unit.n ?? 0 })),
      straps: frame.straps.map((strap) => ({ tension: strap.tension_n, slide: strap.slide_m ?? 0 })),
      contacts,
    };
  }

  // --- Engine memory ----------------------------------------------------------------------

  private checkStable(): void {
    const { qpos } = this.views;
    for (let index = 0; index < qpos.length; index++) {
      if (!Number.isFinite(qpos[index] as number)) throw new LiveRunError("the simulation became unstable");
    }
    const warnings = (this.data as MjData).warning as { get(index: number): { number: number; delete(): void } | undefined };
    const bad = warnings.get(this.mujoco.mjtWarning.mjWARN_BADQACC.value);
    const count = bad?.number ?? 0;
    bad?.delete();
    if (count > 0) throw new LiveRunError("the simulation became unstable");
  }

  private ensureViews(): void {
    // A view whose memory was replaced has length 0.
    if (this.views.qpos.length === 0) this.refreshViews();
  }

  private refreshViews(): void {
    const model = this.model as MjModel;
    const data = this.data as MjData;
    this.views = {
      qpos: data.qpos as F64,
      qvel: data.qvel as F64,
      warmstart: data.qacc_warmstart as F64,
      xpos: data.xpos as F64,
      xquat: data.xquat as F64,
      xmat: data.xmat as F64,
      tenLength: data.ten_length as F64,
      tenVelocity: data.ten_velocity as F64,
      qfrcApplied: data.qfrc_applied as F64,
      qfrcConstraint: data.qfrc_constraint as F64,
      qfrcPassive: data.qfrc_passive as F64,
      qfrcBias: data.qfrc_bias as F64,
      xfrcApplied: data.xfrc_applied as F64,
      tendonStiffness: model.tendon_stiffness as F64,
      tendonDamping: model.tendon_damping as F64,
      tendonLengthspring: model.tendon_lengthspring as F64,
    };
  }
}
