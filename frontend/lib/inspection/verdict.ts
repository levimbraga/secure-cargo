/**
 * The three-state verdict of an inspection; the same rule as `backend/app/inspection/verdict.py`
 * and the Worker's `src/verdict.ts` (each with the same tests).
 *
 * - `approved`: every situation holds and every legal rule passes;
 * - `holds_noncompliant`: every situation holds, but a rule fails (the securing checks, the axle,
 *   payload, gross weight or dimension limits of the battery's country: BR, US or EU);
 * - `fails`: some situation fails for a physical reason. An axle overload is a rule, not
 *   physics, so the page is never red when every situation holds.
 */

import type { Finding } from "@/lib/demo";

export type VerdictState = "approved" | "holds_noncompliant" | "fails";

export type MainProblem =
  | { kind: "physics"; code: string; situation: string; unitId: string | null }
  | {
      kind: "rule";
      code: string;
      unitId: string | null;
      article: string | null;
      theme: "securing" | "weight" | "dimensions" | "protection";
      /** EU: the roadside deficiency class of the failing check (Directive 2014/47/EU Annex III). */
      deficiency?: Deficiency | null;
    };

export type Deficiency = "minor" | "major" | "dangerous";
const DEFICIENCY_RANK: Record<string, number> = { minor: 1, major: 2, dangerous: 3 };

type SituationLike = { id: string; severity?: number; findings?: Finding[] | { code?: string; severity?: string; unit_id?: string | null }[] };
type CheckLike = { code: string; status: string; article?: string; unit_ids?: string[]; deficiency?: Deficiency | null };
type ItemLike = { code: string; kind: "rule" | "advice"; status: string; article?: string; unit_ids?: string[] };
type ChecklistLike = { weight?: ItemLike[]; protection?: ItemLike[]; dimensions?: ItemLike[] };
export type BatteryLike = {
  situations: SituationLike[];
  contran_945: CheckLike[];
  checklist?: ChecklistLike | null;
  axle_loads?: { axle_group_id: string; load_kg: number; limit_kg: number }[];
  /** Whose rules the verdict uses, and both countries' checks (since US mode; absent: BR). */
  country?: string;
  rules?: Partial<Record<string, { securing: CheckLike[]; checklist: ChecklistLike }>> | null;
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

/**
 * A situation's findings that are movement of the load (not the axle-load rule), under one
 * country's ratings: a finding with `countries` belongs only to those (a lashing against its
 * breaking strength in the US, its LC elsewhere; `backend/app/inspection/battery.py`).
 */
export function physicalFindings<T extends { code?: string; severity?: string; countries?: string[] | null }>(
  findings: T[] | undefined,
  country = "BR",
): T[] {
  return (findings ?? []).filter((f) => !RULE_FINDINGS.has(f.code ?? "") && (!f.countries || f.countries.includes(country)));
}

export function holds(situation: SituationLike, country = "BR"): boolean {
  return !physicalFindings(situation.findings as { code?: string; severity?: string; countries?: string[] | null }[], country).some(
    (f) => f.severity === "fail",
  );
}

/** pass / warn / fail of one situation under one country's ratings. */
export function situationMark(situation: SituationLike, country = "BR"): "pass" | "warn" | "fail" {
  const findings = physicalFindings(situation.findings as { code?: string; severity?: string; countries?: string[] | null }[], country);
  if (findings.some((f) => f.severity === "fail")) return "fail";
  return findings.length ? "warn" : "pass";
}

export function physicsPassed(battery: BatteryLike): number {
  return battery.situations.filter((s) => holds(s, battery.country ?? "BR")).length;
}

function firstRuleFailure(input: BatteryLike): MainProblem | null {
  // The battery's country's rules, when it carries both countries' (the Worker and Python do the same).
  const rules = input.rules?.[input.country ?? "BR"];
  const battery = rules ? { ...input, contran_945: rules.securing, checklist: rules.checklist } : input;
  // The worst roadside class first (EU); otherwise the order of the articles.
  const contran = battery.contran_945
    .filter((check) => check.status === "fail")
    .reduce<CheckLike | null>((best, check) => (!best || (DEFICIENCY_RANK[check.deficiency ?? ""] ?? 0) > (DEFICIENCY_RANK[best.deficiency ?? ""] ?? 0) ? check : best), null);
  if (contran) {
    return {
      kind: "rule",
      code: contran.code,
      unitId: contran.unit_ids?.[0] ?? null,
      article: contran.article ?? null,
      theme: "securing",
      deficiency: contran.deficiency ?? null,
    };
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

type FindingLike = { code?: string; severity?: string; unit_id?: string | null; countries?: string[] | null };

/** Rank of a finding by how bad it is for the load (falling off first, a strap over its rating last). */
export function findingRank(code?: string): number {
  const index = FINDING_ORDER.indexOf(code ?? "");
  return index < 0 ? FINDING_ORDER.length : index;
}

/**
 * The failure a situation is told by: its worst physical finding under one country's ratings
 * (the headline, the explanation and "What went wrong" all start from it). Null when it holds.
 */
export function mainFinding(findings: FindingLike[] | undefined, country = "BR"): { code: string; unitId: string | null } | null {
  const failing = physicalFindings(findings, country).filter((f) => f.severity === "fail");
  const first = [...failing].sort((a, b) => findingRank(a.code) - findingRank(b.code))[0];
  return first ? { code: first.code ?? "unit_slid", unitId: first.unit_id ?? null } : null;
}

/** The situation the result is told by: the most severe failing one, else null. */
export function worstFailing<S extends SituationLike>(situations: S[], country = "BR"): S | null {
  const failing = situations.filter((s) => !holds(s, country));
  return failing.length ? failing.reduce((a, b) => ((b.severity ?? 0) > (a.severity ?? 0) ? b : a)) : null;
}

export function verdictOf(battery: BatteryLike): { state: VerdictState; problem: MainProblem | null } {
  const country = battery.country ?? "BR";
  const worst = worstFailing(battery.situations, country);
  if (worst) {
    const first = mainFinding(worst.findings as FindingLike[], country);
    return {
      state: "fails",
      problem: { kind: "physics", code: first?.code ?? "unit_slid", situation: worst.id, unitId: first?.unitId ?? null },
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
