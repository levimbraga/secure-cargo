/**
 * The three-state verdict of an inspection; the same rule as `backend/app/inspection/verdict.py`
 * and `frontend/lib/inspection/verdict.ts` (each with the same tests).
 *
 * - approved: every situation holds and every legal rule passes;
 * - holds_noncompliant: every situation holds, a rule fails (CONTRAN 945, CONTRAN 882 axle,
 *   payload, gross weight or dimension limits);
 * - fails: some situation fails for a physical reason. An axle overload is a rule, not physics.
 *
 * Stored in `inspections.verdict` as pass / warning / fail.
 */

export type VerdictState = "approved" | "holds_noncompliant" | "fails";

interface FindingLike {
	code?: string;
	severity?: string;
}
interface SituationLike {
	findings?: unknown[];
}
interface CheckLike {
	status?: string;
	kind?: string;
}
export interface BatteryLike {
	situations?: SituationLike[];
	contran_945?: CheckLike[];
	checklist?: Record<string, CheckLike[]> | null;
	axle_loads?: unknown[];
}

const RULE_FINDINGS = new Set(["axle_overloaded"]);

export function physicalFailure(situation: SituationLike): boolean {
	return (situation.findings ?? []).some((f) => {
		const finding = f as FindingLike;
		return finding.severity === "fail" && !RULE_FINDINGS.has(finding.code ?? "");
	});
}

export function rulesFail(battery: BatteryLike): boolean {
	if ((battery.contran_945 ?? []).some((check) => check.status === "fail")) return true;
	const checklist = battery.checklist;
	if (checklist) {
		return Object.values(checklist).some((items) => items.some((item) => item.kind === "rule" && item.status === "fail"));
	}
	// Batteries stored before the checklist: the axle loads alone.
	return (battery.axle_loads ?? []).some((value) => {
		const load = value as { load_kg?: number; limit_kg?: number };
		return (load.load_kg ?? 0) > (load.limit_kg ?? Infinity);
	});
}

export function verdictState(battery: BatteryLike): VerdictState {
	if ((battery.situations ?? []).some(physicalFailure)) return "fails";
	return rulesFail(battery) ? "holds_noncompliant" : "approved";
}

export const STORED: Record<VerdictState, "pass" | "warning" | "fail"> = {
	approved: "pass",
	holds_noncompliant: "warning",
	fails: "fail",
};
