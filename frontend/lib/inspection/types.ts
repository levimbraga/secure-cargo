/**
 * The inspection flow's documents, as the API sends them: the photo analysis (the Worker's
 * `perception/schema.ts`), the load draft made of it (`backend/perception/draft.py`), the
 * battery of seven situations (`backend/app/inspection/battery.py`) and the planner's fix
 * (`backend/planner/plan.py`).
 */

import type { AxleLoad, Finding, Margins, RunSummary, StandardCheck, Status } from "@/lib/demo";
import type { LoadDraft } from "@/lib/explorer/draft";
import type { ExplorerScenario } from "@/lib/explorer/draft";
import type { TripEventInput } from "@/lib/live/scenario";

import { type BatteryLike, verdictOf } from "./verdict";

export type Body = "flatbed" | "box" | "curtain_sider";
export type Size = "vuc" | "three_quarter" | "toco" | "truck" | "semi";

export type AnalysisUnit = {
  number: number;
  cargo: string;
  length_m: number;
  width_m: number;
  height_m: number;
  along: number;
  across: number;
  stacked_on: number | null;
  photo: number;
  box: [number, number, number, number];
  confidence: number;
  uncertain: string;
};

export type PhotoAnalysis = {
  is_truck_load: boolean;
  truck: { body: Body | "unknown"; size: Size | "unknown"; confidence: number; uncertain: string };
  units: AnalysisUnit[];
  restraints: {
    kind: "strap" | "chain" | "rope" | "anti_slip_mat" | "blocking" | "coil_cradle";
    count: number;
    routing: "top_over" | "diagonal" | "unknown";
    units: number[];
    confidence: number;
    uncertain: string;
  }[];
  violations: { code: "rope" | "above_headboard" | "gap_to_headboard" | "anchored_on_wood"; units: number[]; confidence: number; note: string }[];
  overall_confidence: number;
  summary: string;
};

export type AnalysisAnswer = {
  mode: "live" | "cached" | "sample" | "demo";
  analysis: PhotoAnalysis | null;
  reason?: "blocked" | "kill_switch" | "budget_cap" | "quota_exceeded" | "not_configured" | null;
  model?: string | null;
};

export type UnitLink = {
  number: number;
  unit_id: string;
  photo: number;
  box: [number, number, number, number];
  confidence: number;
  uncertain: string;
};

export type PerceptionWarning =
  | "not_a_load"
  | "no_units"
  | "unit_dropped"
  | "moved_to_fit"
  | "resized_to_fit"
  | "straps_reduced"
  | "stack_dropped"
  | "manual_start";

export type PerceptionDraft = { draft: LoadDraft; links: UnitLink[]; warnings: PerceptionWarning[] };

export const SITUATION_IDS = [
  "emergency_braking",
  "lane_change",
  "sharp_curve",
  "pothole",
  "speed_bump",
  "mountain_descent",
  "long_vibration",
] as const;
export type SituationId = (typeof SITUATION_IDS)[number];

export type SituationResult = {
  id: SituationId;
  trip: LoadDraft["trip"];
  event: TripEventInput;
  status: Status;
  passed: boolean;
  severity: number;
  findings: Finding[];
  margins: Margins;
  profile: Record<string, number | string>;
  scenario_hash: string;
};

export type ContranCheck = {
  code: "devices_allowed" | "safety_factor" | "four_terminals" | "anchoring" | "diagonals_for_gaps" | "above_headboard";
  article: string;
  status: "pass" | "fail" | "not_applicable" | "to_confirm";
  unit_ids: string[];
  message: string;
};

/** One item of the checklist themes besides CONTRAN 945 (`backend/rules/checklist.py`). */
export type ChecklistItem = {
  code: string;
  kind: "rule" | "advice";
  status: "pass" | "fail" | "not_applicable" | "to_confirm" | "advice";
  article: string;
  values: Record<string, number>;
  unit_ids: string[];
};

export type Checklist = { weight: ChecklistItem[]; protection: ChecklistItem[]; dimensions: ChecklistItem[] };

export type ChangeCode =
  | "replace_rope"
  | "reanchor"
  | "close_gaps"
  | "balance_axles"
  | "straps"
  | "restraint"
  | "overweight"
  | "edge_protectors";

export type Change = {
  code: ChangeCode;
  unit_id: string | null;
  before: string | number | null;
  after: string | number | null;
  article: string | null;
  values: Record<string, number>;
  message: string;
};

/** A server run with its keyframes (the battery's worst case, or `POST /simulate`). */
export type ServerRunResult = RunSummary & { keyframes: unknown; scenario_id?: string };

export type Battery = {
  draft: LoadDraft;
  scenario: ExplorerScenario;
  situations: SituationResult[];
  passed: number;
  total: number;
  status: Status;
  worst: SituationId;
  worst_result: ServerRunResult;
  axle_loads: AxleLoad[];
  en_12195_1: StandardCheck[];
  contran_945: ContranCheck[];
  /** Absent on batteries stored before 2026-11-21. */
  checklist?: Checklist | null;
  cpu_time_s?: number;
  recommendation?: { draft: LoadDraft; changes: Change[] } | null;
};

export type Plan = {
  draft: LoadDraft;
  changes: Change[];
  verified: boolean;
  rounds: number;
  battery: Battery | null;
};

/** A load passes when it is approved: every situation holds and every rule passes. */
export function batteryPasses(battery: BatteryLike): boolean {
  return verdictOf(battery).state === "approved";
}
