/**
 * The three-state verdict of an inspection; the same rule as `backend/app/inspection/verdict.py`
 * and `frontend/lib/inspection/verdict.ts` (each with the same tests).
 *
 * - approved: every situation holds and every legal rule passes;
 * - holds_noncompliant: every situation holds, a rule fails (the securing checks, the axle,
 *   payload, gross weight or dimension limits of the battery's country: BR, US or EU);
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
	/** Whose rules the verdict uses (since 2026-11-21; absent: BR). */
	country?: string | null;
	/** Every country's rule checks (`rules/country.py`); absent on older batteries. */
	rules?: Record<string, { securing?: CheckLike[]; checklist?: Record<string, CheckLike[]> | null }> | null;
}

export type Country = "BR" | "US" | "EU";
export const COUNTRIES: readonly Country[] = ["BR", "US", "EU"];

/** A country code from a request or a draft; anything else is null. */
export function parseCountry(value: unknown): Country | null {
	return value === "BR" || value === "US" || value === "EU" ? value : null;
}

/**
 * The battery as its country's rules see it: the securing checks in `contran_945`'s place and that
 * country's checklist. A battery without rule sets (stored before US mode) is Brazilian as it is.
 */
export function activeView<T extends BatteryLike>(battery: T, country?: string | null): T {
	const chosen = country ?? battery.country ?? "BR";
	const rules = battery.rules?.[chosen];
	if (!rules) return battery;
	return { ...battery, country: chosen, contran_945: rules.securing ?? [], checklist: rules.checklist ?? null };
}

const RULE_FINDINGS = new Set(["axle_overloaded"]);

export function physicalFailure(situation: SituationLike): boolean {
	return (situation.findings ?? []).some((f) => {
		const finding = f as FindingLike;
		return finding.severity === "fail" && !RULE_FINDINGS.has(finding.code ?? "");
	});
}

export function rulesFail(input: BatteryLike): boolean {
	const battery = activeView(input);
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
