/** The verdict of a run: the same rules as `backend/physics/verdict.py`, with thresholds from the live model. */

import type { Finding, Status } from "@/lib/demo";

import type { LiveThresholds } from "./model";

export type LiveUnitResult = {
  id: string;
  friction_coefficient: number;
  max_slide_m: number;
  final_slide_m: number;
  max_tilt_deg: number;
  /** Largest angle the unit turned, about any axis [deg]. */
  max_rotation_deg: number;
  /** A cylinder lying on its side. */
  can_roll: boolean;
  peak_friction_use: number | null;
  hit_headboard: boolean;
  peak_headboard_force_n: number;
  left_bed: boolean;
};

export type LiveLashingResult = {
  id: string;
  unit_id: string;
  lashing_capacity_n: number;
  initial_tension_n: number;
  peak_force_n: number;
  peak_force_ratio: number;
  final_tension_n: number;
  broke_at_s: number | null;
};

function finding(
  code: Finding["code"],
  severity: Finding["severity"],
  value: number,
  limit: number,
  message: string,
  ids: { unit_id?: string; lashing_id?: string } = {},
): Finding {
  return {
    code,
    severity,
    unit_id: ids.unit_id ?? null,
    lashing_id: ids.lashing_id ?? null,
    axle_group_id: null,
    value,
    limit,
    message,
  };
}

export function buildVerdict(
  units: LiveUnitResult[],
  lashings: LiveLashingResult[],
  thresholds: LiveThresholds,
  extraFindings: Finding[],
): { status: Status; findings: Finding[] } {
  const findings: Finding[] = [];
  for (const unit of units) {
    const ids = { unit_id: unit.id };
    if (unit.left_bed) {
      findings.push(finding("unit_left_bed", "fail", unit.max_slide_m, 0, `Unit ${unit.id} left the truck bed.`, ids));
    }
    const rolled =
      unit.can_roll && unit.max_rotation_deg > thresholds.roll_fail_deg && unit.max_slide_m > thresholds.slide_fail_m;
    if (rolled) {
      findings.push(
        finding(
          "unit_rolled",
          "fail",
          unit.max_slide_m,
          thresholds.slide_fail_m,
          `Unit ${unit.id} rolled ${(unit.max_slide_m * 100).toFixed(1)} cm.`,
          ids,
        ),
      );
    } else if (unit.max_slide_m > thresholds.slide_warning_m) {
      const failed = unit.max_slide_m > thresholds.slide_fail_m;
      findings.push(
        finding(
          "unit_slid",
          failed ? "fail" : "warning",
          unit.max_slide_m,
          failed ? thresholds.slide_fail_m : thresholds.slide_warning_m,
          `Unit ${unit.id} slid ${(unit.max_slide_m * 100).toFixed(1)} cm.`,
          ids,
        ),
      );
    }
    if (unit.max_tilt_deg > thresholds.tilt_warning_deg) {
      const failed = unit.max_tilt_deg > thresholds.tilt_fail_deg;
      findings.push(
        finding(
          "unit_tilted",
          failed ? "fail" : "warning",
          unit.max_tilt_deg,
          failed ? thresholds.tilt_fail_deg : thresholds.tilt_warning_deg,
          `Unit ${unit.id} tilted ${unit.max_tilt_deg.toFixed(1)} degrees.`,
          ids,
        ),
      );
    }
    if (unit.hit_headboard) {
      findings.push(
        finding(
          "unit_hit_headboard",
          "fail",
          unit.peak_headboard_force_n,
          0,
          `Unit ${unit.id} slid into the headboard with ${(unit.peak_headboard_force_n / 1000).toFixed(1)} kN.`,
          ids,
        ),
      );
    }
  }
  if (thresholds.headboard_capacity_n !== null) {
    const total = units.reduce((sum, unit) => sum + unit.peak_headboard_force_n, 0);
    if (total > thresholds.headboard_capacity_n) {
      findings.push(
        finding(
          "headboard_overloaded",
          "fail",
          total,
          thresholds.headboard_capacity_n,
          `The headboard took ${(total / 1000).toFixed(1)} kN; it is rated for ${(thresholds.headboard_capacity_n / 1000).toFixed(1)} kN.`,
        ),
      );
    }
  }
  for (const lashing of lashings) {
    const ids = { unit_id: lashing.unit_id, lashing_id: lashing.id };
    if (lashing.broke_at_s !== null) {
      findings.push(
        finding(
          "lashing_broke",
          "fail",
          lashing.peak_force_n,
          lashing.lashing_capacity_n,
          `Lashing ${lashing.id} broke at ${lashing.broke_at_s.toFixed(2)} s.`,
          ids,
        ),
      );
    } else if (lashing.peak_force_ratio > thresholds.lashing_warning_ratio) {
      const failed = lashing.peak_force_ratio > thresholds.lashing_fail_ratio;
      findings.push(
        finding(
          "lashing_overloaded",
          failed ? "fail" : "warning",
          lashing.peak_force_n,
          lashing.lashing_capacity_n * (failed ? thresholds.lashing_fail_ratio : thresholds.lashing_warning_ratio),
          `Lashing ${lashing.id} reached ${(lashing.peak_force_ratio * 100).toFixed(0)} % of its rated capacity.`,
          ids,
        ),
      );
    }
  }
  findings.push(...extraFindings);

  let status: Status = "pass";
  if (findings.some((item) => item.severity === "fail")) status = "fail";
  else if (findings.length > 0) status = "warning";
  return { status, findings };
}
