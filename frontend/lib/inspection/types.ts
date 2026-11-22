/**
 * The inspection flow's documents, as the API sends them: the photo analysis (the Worker's
 * `perception/schema.ts`), the load draft made of it (`backend/perception/draft.py`), the
 * battery of seven situations (`backend/app/inspection/battery.py`) and the planner's fix
 * (`backend/planner/plan.py`).
 */

import type { Country } from "@/lib/country";
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
  code:
    | "devices_allowed"
    | "safety_factor"
    | "four_terminals"
    | "anchoring"
    | "diagonals_for_gaps"
    | "diagonals_open_body"
    | "headboard_strength"
    | "above_headboard";
  article: string;
  status: "pass" | "fail" | "not_applicable" | "to_confirm";
  unit_ids: string[];
  values?: Record<string, number>;
  message: string;
};

/** A securing check of either country (`backend/rules/fmcsa393.py`, `rules/country.py`). */
export type RuleCheck = {
  code: string;
  article: string;
  status: "pass" | "fail" | "not_applicable" | "to_confirm";
  unit_ids: string[];
  values?: Record<string, number>;
  message: string;
  /** EU only: the roadside deficiency class of a failing check (Directive 2014/47/EU Annex III). */
  deficiency?: "minor" | "major" | "dangerous" | null;
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

export type RuleSet = { country: Country; securing: RuleCheck[]; checklist: Checklist };

export type ChangeCode =
  | "replace_rope"
  | "reanchor"
  | "close_gaps"
  | "balance_axles"
  | "straps"
  | "restraint"
  | "diagonal_sets"
  | "spread"
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
  /** The Brazilian checks; with `activeBattery`, the shown country's securing checks. */
  contran_945: (ContranCheck | RuleCheck)[];
  /** Absent on batteries stored before 2026-11-21. */
  checklist?: Checklist | null;
  /** Whose rules the verdict uses, and every country's rule checks (since US mode, 2026-11-21). */
  country?: Country;
  rules?: Partial<Record<Country, RuleSet>> | null;
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

/**
 * The battery as one country's rules see it: that country's securing checks in `contran_945`'s
 * place and its checklist. The physics (situations, keyframes) is the same object. A battery
 * without rule sets (stored before US mode) can only be shown under Brazil's rules.
 */
export function activeBattery(battery: Battery, country?: Country | null): Battery {
  const chosen = country ?? battery.country ?? "BR";
  const rules = battery.rules?.[chosen];
  if (!rules) return { ...battery, country: "BR" };
  return { ...battery, country: chosen, contran_945: rules.securing, checklist: rules.checklist };
}

/** Whether a battery can be shown under a country's rules without asking the API (a battery
 * stored before EU mode has no EU rule set: the API adds it, simulating nothing). */
export function hasRules(battery: Battery, country: Country): boolean {
  return country === "BR" || Boolean(battery.rules?.[country]);
}
