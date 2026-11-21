/**
 * The three-state verdict of an inspection; the same rule as `backend/app/inspection/verdict.py`
 * and the Worker's `src/verdict.ts` (each with the same tests).
 *
 * - `approved`: every situation holds and every legal rule passes;
 * - `holds_noncompliant`: every situation holds, but a rule fails (CONTRAN 945, the axle,
 *   payload, gross weight or dimension limits of CONTRAN 882);
 * - `fails`: some situation fails for a physical reason. An axle overload is a rule, not
 *   physics, so the page is never red when every situation holds.
 */

import type { Finding } from "@/lib/demo";

export type VerdictState = "approved" | "holds_noncompliant" | "fails";

export type MainProblem =
  | { kind: "physics"; code: string; situation: string; unitId: string | null }
  | { kind: "rule"; code: string; unitId: string | null; article: string | null; theme: "securing" | "weight" | "dimensions" | "protection" };

type SituationLike = { id: string; severity?: number; findings?: Finding[] | { code?: string; severity?: string; unit_id?: string | null }[] };
type CheckLike = { code: string; status: string; article?: string; unit_ids?: string[] };
type ItemLike = { code: string; kind: "rule" | "advice"; status: string; article?: string; unit_ids?: string[] };
export type BatteryLike = {
  situations: SituationLike[];
  contran_945: CheckLike[];
  checklist?: { weight?: ItemLike[]; protection?: ItemLike[]; dimensions?: ItemLike[] } | null;
  axle_loads?: { axle_group_id: string; load_kg: number; limit_kg: number }[];
};

const RULE_FINDINGS = new Set(["axle_overloaded"]);
const FINDING_ORDER = [
  "unit_left_bed",
  "lashing_broke",
  "unit_tilted",
  "unit_rolled",
  "unit_hit_headboard",
  "headboard_overloaded",
  "unit_slid",
  "lashing_overloaded",
];

/** A situation's findings that are movement of the load (not the axle-load rule). */
export function physicalFindings<T extends { code?: string; severity?: string }>(findings: T[] | undefined): T[] {
  return (findings ?? []).filter((f) => !RULE_FINDINGS.has(f.code ?? ""));
}

export function holds(situation: SituationLike): boolean {
  return !physicalFindings(situation.findings as { code?: string; severity?: string }[]).some((f) => f.severity === "fail");
}

export function physicsPassed(battery: BatteryLike): number {
  return battery.situations.filter(holds).length;
}

function firstRuleFailure(battery: BatteryLike): MainProblem | null {
  const contran = battery.contran_945.find((check) => check.status === "fail");
  if (contran) {
    return { kind: "rule", code: contran.code, unitId: contran.unit_ids?.[0] ?? null, article: contran.article ?? null, theme: "securing" };
  }
  const checklist = battery.checklist;
  if (checklist) {
    for (const theme of ["weight", "dimensions", "protection"] as const) {
      const item = checklist[theme]?.find((entry) => entry.kind === "rule" && entry.status === "fail");
      if (item) return { kind: "rule", code: item.code, unitId: item.unit_ids?.[0] ?? null, article: item.article ?? null, theme };
    }
    return null;
  }
  const axle = battery.axle_loads?.find((load) => load.load_kg > load.limit_kg);
  return axle ? { kind: "rule", code: "axle", unitId: axle.axle_group_id, article: "CONTRAN 882/2021 art. 6", theme: "weight" } : null;
}

export function verdictOf(battery: BatteryLike): { state: VerdictState; problem: MainProblem | null } {
  const failing = battery.situations.filter((s) => !holds(s));
  if (failing.length) {
    const worst = failing.reduce((a, b) => ((b.severity ?? 0) > (a.severity ?? 0) ? b : a));
    const findings = physicalFindings(worst.findings as { code?: string; severity?: string; unit_id?: string | null }[]).filter(
      (f) => f.severity === "fail",
    );
    const rank = (code?: string) => {
      const index = FINDING_ORDER.indexOf(code ?? "");
      return index < 0 ? FINDING_ORDER.length : index;
    };
    const first = [...findings].sort((a, b) => rank(a.code) - rank(b.code))[0];
    return {
      state: "fails",
      problem: { kind: "physics", code: first?.code ?? "unit_slid", situation: worst.id, unitId: first?.unit_id ?? null },
    };
  }
  const rule = firstRuleFailure(battery);
  return { state: rule ? "holds_noncompliant" : "approved", problem: rule };
}

/** The stored verdict of a list row (pass / warning / fail) as a state. */
export function stateOfStored(verdict: string | null | undefined): VerdictState | null {
  if (verdict === "pass") return "approved";
  if (verdict === "warning") return "holds_noncompliant";
  if (verdict === "fail") return "fails";
  return null;
}
