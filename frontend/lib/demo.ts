/**
 * The demo scenarios: the gallery's loads, each simulated "as loaded" and "fixed".
 *
 * The backend writes one JSON file per run to `public/demo/` (see `backend/scripts/precompute_demo.py`).
 * The site replays those files, so the demo does not depend on the API being up.
 */

import { type KeyframesDoc, parseKeyframes } from "./keyframes";

/** The gallery's examples, in its order (backend/app/demo/gallery.py). */
export const DEMO_IDS = [
  "emergency-braking",
  "sharp-curve",
  "rope-lashing",
  "steel-coil",
  "weigh-station",
  "box-truck",
  "dirt-road",
  "anti-slip-mat",
  "full-trip",
  "curtain-sider",
  "potholed-road",
  "overloaded-strap",
  "us-steel-coils",
] as const;
export type DemoId = (typeof DEMO_IDS)[number];

export const VARIANTS = ["as_loaded", "fixed"] as const;
export type Variant = (typeof VARIANTS)[number];

export function isDemoId(value: string): value is DemoId {
  return (DEMO_IDS as readonly string[]).includes(value);
}

export type Status = "pass" | "warning" | "fail";

export type FindingCode =
  | "unit_slid"
  | "unit_tilted"
  | "unit_rolled"
  | "unit_left_bed"
  | "unit_hit_headboard"
  | "headboard_overloaded"
  | "lashing_overloaded"
  | "lashing_broke"
  | "lashing_went_slack"
  | "axle_overloaded";

export type Finding = {
  code: FindingCode;
  severity: "warning" | "fail";
  unit_id: string | null;
  lashing_id: string | null;
  axle_group_id: string | null;
  value: number;
  limit: number;
  message: string;
};

export type UnitResult = {
  id: string;
  friction_coefficient: number;
  max_slide_m: number;
  max_tilt_deg: number;
  peak_friction_use: number | null;
  hit_headboard: boolean;
  left_bed: boolean;
};

export type StandardCheck = {
  unit_id: string;
  method: "top_over" | "direct" | "unsecured" | "not_assessed";
  installed_lashings: number;
  required_lashings: number | null;
  meets_standard: boolean | null;
};

export type Margins = {
  max_slide_m: number;
  slide_limit_m: number;
  max_tilt_deg: number;
  peak_friction_use: number | null;
  peak_lashing_force_n: number | null;
  peak_lashing_force_ratio: number | null;
  lashing_capacity_reserve: number | null;
};

export type AxleLoad = { axle_group_id: string; load_kg: number; limit_kg: number; ratio: number };

/** Everything a run reports except the keyframes: small enough to render on the server. */
export type RunSummary = {
  duration_s: number;
  engine: { mujoco_version: string; timestep_s: number };
  profile: Record<string, number | string>;
  verdict: { status: Status; findings: Finding[] };
  units: UnitResult[];
  margins: Margins;
  axle_loads: AxleLoad[];
  en_12195_1: StandardCheck[];
};

export type TripEvent = {
  kind: string;
  speed_kmh: number;
  road_surface: string;
  fog: boolean;
};

export type DemoRun = {
  id: DemoId;
  variant: Variant;
  scenario_hash: string;
  event: TripEvent;
  result: RunSummary & { keyframes: KeyframesDoc };
};

/** Reduces a run to its summary, dropping the keyframes and fields the pages do not show. */
export function summarize(run: DemoRun): RunSummary {
  const { result } = run;
  return {
    duration_s: result.duration_s,
    engine: {
      mujoco_version: result.engine.mujoco_version,
      timestep_s: result.engine.timestep_s,
    },
    profile: result.profile,
    verdict: result.verdict,
    units: result.units.map((unit) => ({
      id: unit.id,
      friction_coefficient: unit.friction_coefficient,
      max_slide_m: unit.max_slide_m,
      max_tilt_deg: unit.max_tilt_deg,
      peak_friction_use: unit.peak_friction_use,
      hit_headboard: unit.hit_headboard,
      left_bed: unit.left_bed,
    })),
    margins: result.margins,
    axle_loads: result.axle_loads,
    en_12195_1: result.en_12195_1.map((check) => ({
      unit_id: check.unit_id,
      method: check.method,
      installed_lashings: check.installed_lashings,
      required_lashings: check.required_lashings,
      meets_standard: check.meets_standard,
    })),
  };
}

export function demoFile(id: DemoId, variant: Variant): string {
  return `/demo/${id}.${variant}.json`;
}

/** Fetches the keyframes of one run from the static files. */
export async function fetchKeyframes(
  id: DemoId,
  variant: Variant,
  signal?: AbortSignal,
): Promise<KeyframesDoc> {
  const response = await fetch(demoFile(id, variant), { signal });
  if (!response.ok) throw new Error(`Demo file answered ${response.status}`);
  const run = (await response.json()) as DemoRun;
  return parseKeyframes(run.result.keyframes);
}

/** "pallet-2" -> kind "pallet", number 2; "machine" -> kind "machine", no number. */
export function unitName(unitId: string): { kind: string; number: number | null } {
  const match = /^(.*?)-(\d+)$/.exec(unitId);
  return match ? { kind: match[1] ?? unitId, number: Number(match[2]) } : { kind: unitId, number: null };
}
