/**
 * The live model: the MJCF and run plan the server simulates, as served by `POST /mjcf` and
 * `GET /scenarios/{id}/mjcf` (see `backend/physics/live.py`). The browser loads it into MuJoCo
 * WebAssembly and repeats the server's run step for step.
 */

import type { AxleLoad, Finding } from "@/lib/demo";
import type { CylinderAxis, KeyframesDoc, KeyframeStrap, UnitShape, Vec3 } from "@/lib/keyframes";

export type DirectionCheck = {
  direction: "forward" | "rearward" | "sideways";
  mode: "sliding" | "tilting";
  quantity: "lashings" | "force_n";
  required: number;
  provided: number;
  ok: boolean;
};

export type LiveStandardCheck = {
  unit_id: string;
  method: "top_over" | "direct" | "unsecured" | "not_assessed";
  installed_lashings: number;
  required_lashings: number | null;
  meets_standard: boolean | null;
  checks: DirectionCheck[];
  note: string;
};

export type LiveUnit = {
  id: string;
  body: string;
  geom: string;
  size_m: Vec3;
  mass_kg: number;
  position_m: Vec3;
  friction_coefficient: number;
  friction_source: string;
  shape: UnitShape;
  axis: CylinderAxis | null;
  inner_diameter_m: number | null;
  /** 0 (X) or 1 (Y) for a cylinder lying on its side: it can roll. */
  lying_axis: 0 | 1 | null;
};

export type LiveLashing = {
  id: string;
  unit_index: number;
  tendon: string;
  saddle_joint: string | null;
  kind: "strap" | "chain" | "rope";
  routing: "top_over" | "direct";
  axial_stiffness_n: number;
  pretension_n: number;
  lashing_capacity_n: number;
  breaking_strength_n: number | null;
  strap: Required<KeyframeStrap>;
};

export type LiveSettings = {
  timestep_s: number;
  replay_fps: number;
  gravity_mps2: number;
  lashing_damping_ratio: number;
  solver_tolerance: number;
  contact_lookback_steps: number;
  pretension_round_steps: number;
  pretension_max_rounds: number;
  pretension_tolerance: number;
  final_settle_steps: number;
  max_spring_phase_per_step: number;
  blocked_gap_m: number;
  headboard_force_fraction: number;
};

export type LiveThresholds = {
  slide_warning_m: number;
  slide_fail_m: number;
  tilt_warning_deg: number;
  tilt_fail_deg: number;
  roll_fail_deg: number;
  lashing_warning_ratio: number;
  lashing_fail_ratio: number;
  headboard_capacity_n: number | null;
};

export type LiveModel = {
  version: 1;
  scenario_id: string;
  scenario_hash: string;
  engine: { mujoco_version: string; physics_model_version: string };
  mjcf: string;
  names: {
    bed_body: string;
    bed_joints: [string, string, string];
    floor_geom: string;
    headboard_geom: string | null;
    road_geom: string;
    /** Geoms whose name starts with it are blocks (chocks, beams, cradles). */
    block_geom_prefix: string;
  };
  bed: Required<KeyframesDoc["bed"]>;
  units: LiveUnit[];
  lashings: LiveLashing[];
  profile: {
    steps: number;
    /** Three values (x, y, z) per time step. */
    acceleration_mps2: number[];
    truck_speed_mps: number[];
    pretension_factor: number[] | null;
    markers: { t: number; kind: string }[];
    parameters: Record<string, number | string>;
  };
  settings: LiveSettings;
  thresholds: LiveThresholds;
  axle_loads: AxleLoad[];
  axle_findings: Finding[];
  en_12195_1: LiveStandardCheck[];
};

export class LiveModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveModelError";
  }
}

/** Checks the parts of a live model the engine relies on, and returns it typed. */
export function parseLiveModel(raw: unknown): LiveModel {
  const live = raw as Partial<LiveModel> | null;
  if (typeof live !== "object" || live === null || live.version !== 1) {
    throw new LiveModelError("Unsupported live model");
  }
  const { profile, units, lashings, mjcf } = live;
  if (typeof mjcf !== "string" || !Array.isArray(units) || !Array.isArray(lashings) || !profile) {
    throw new LiveModelError("Live model is incomplete");
  }
  if (
    profile.acceleration_mps2?.length !== 3 * profile.steps ||
    profile.truck_speed_mps?.length !== profile.steps
  ) {
    throw new LiveModelError("Live model profile does not match its step count");
  }
  return live as LiveModel;
}
