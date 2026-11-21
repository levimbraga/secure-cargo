/**
 * The manager's overview, as pure functions over inspection rows (tested in `test/manager.test.ts`).
 *
 * Definitions (the same on the page and in `docs/dashboard.md`):
 * - an inspection counts once, as first loaded: a re-inspection ("I fixed it: take a new photo") is
 *   the proof of the first one's fix, not a new inspection;
 * - states: approved (pass), holds but out of compliance (warning), does not arrive intact (fail);
 * - "needs a fix" = out of compliance or does not arrive intact;
 * - "fixed and proven" = needs a fix and a re-inspection of it was approved;
 * - "failed with no proven fix" = needs a fix and has no approved re-inspection (yet);
 * - an alert = failed with no proven fix, older than the organization's N hours.
 */
import { unpackList } from "./summary";

export interface MetricRow {
	id: string;
	author_id: string;
	author_name: string | null;
	created_at: string;
	title?: string;
	verdict: "pass" | "warning" | "fail" | null;
	fixed_verdict?: "pass" | "warning" | "fail" | null;
	proven_by: string | null;
	reinspection_of: string | null;
	failure_codes: string | null;
}

export type State = "approved" | "holds_noncompliant" | "fails";

export function stateOf(verdict: MetricRow["verdict"]): State | null {
	return verdict === "pass" ? "approved" : verdict === "warning" ? "holds_noncompliant" : verdict === "fail" ? "fails" : null;
}

export function needsFix(row: Pick<MetricRow, "verdict">): boolean {
	return row.verdict === "fail" || row.verdict === "warning";
}

/** Failed or out of compliance, no proven fix, and older than `hours`. Re-inspections never alert. */
export function isAlert(row: MetricRow, at: Date, hours: number): boolean {
	if (row.reinspection_of || !needsFix(row) || row.proven_by) return false;
	return at.getTime() - Date.parse(row.created_at) >= hours * 3_600_000;
}

/** Brasília time (UTC-3 all year since 2019): the Monday 00:00 that starts the row's week. */
export function weekStart(iso: string): string {
	const local = new Date(Date.parse(iso) - 3 * 3_600_000);
	const day = (local.getUTCDay() + 6) % 7; // Monday = 0
	const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day);
	return new Date(monday).toISOString().slice(0, 10);
}

export interface Overview {
	period: { from: string; to: string };
	totals: {
		inspections: number;
		simulated: number;
		approved: number;
		holds_noncompliant: number;
		fails: number;
		needs_fix: number;
		fixed_and_proven: number;
		/** Share of the loads that needed a fix whose fix was proven, 0..1 (null with none). */
		fixed_and_proven_rate: number | null;
		failed_no_proven_fix: number;
		reinspections: number;
		alerts: number;
	};
	failures: { code: string; inspections: number; share: number }[];
	drivers: {
		user_id: string;
		name: string | null;
		inspections: number;
		needs_fix: number;
		failure_rate: number | null;
		fixes_proven: number;
		open: number;
	}[];
	weeks: { week: string; approved: number; holds_noncompliant: number; fails: number; pending: number }[];
}

/**
 * The overview for the rows created in [from, to). `weeksFrom` starts the weekly trend (which
 * may reach back further than the period); `alertHours` is the organization's N.
 */
export function computeOverview(
	rows: MetricRow[],
	options: { from: string; to: string; weeksFrom: string; at: Date; alertHours: number },
): Overview {
	const inPeriod = (r: MetricRow) => r.created_at >= options.from && r.created_at < options.to;
	const originals = rows.filter((r) => !r.reinspection_of);
	const period = originals.filter(inPeriod);
	const simulated = period.filter((r) => r.verdict !== null);
	const fixing = period.filter(needsFix);
	const proven = fixing.filter((r) => r.proven_by);

	const failureCounts = new Map<string, number>();
	for (const row of fixing) for (const code of unpackList(row.failure_codes)) failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);

	const drivers = new Map<string, Overview["drivers"][number]>();
	for (const row of period) {
		const d = drivers.get(row.author_id) ?? {
			user_id: row.author_id,
			name: row.author_name,
			inspections: 0,
			needs_fix: 0,
			failure_rate: null,
			fixes_proven: 0,
			open: 0,
		};
		d.inspections += 1;
		if (needsFix(row)) {
			d.needs_fix += 1;
			if (row.proven_by) d.fixes_proven += 1;
			else d.open += 1;
		}
		drivers.set(row.author_id, d);
	}
	for (const d of drivers.values()) {
		const simulatedByDriver = simulated.filter((r) => r.author_id === d.user_id).length;
		d.failure_rate = simulatedByDriver ? d.needs_fix / simulatedByDriver : null;
	}

	const weeks = new Map<string, Overview["weeks"][number]>();
	// Every week of the trend is listed, also the empty ones.
	for (let t = Date.parse(`${weekStart(options.weeksFrom)}T03:00:00.000Z`); t < Date.parse(options.to); t += 7 * 86_400_000) {
		const week = new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
		weeks.set(week, { week, approved: 0, holds_noncompliant: 0, fails: 0, pending: 0 });
	}
	for (const row of originals) {
		if (row.created_at < options.weeksFrom || row.created_at >= options.to) continue;
		const bucket = weeks.get(weekStart(row.created_at));
		if (!bucket) continue;
		const state = stateOf(row.verdict);
		if (state) bucket[state] += 1;
		else bucket.pending += 1;
	}

	return {
		period: { from: options.from, to: options.to },
		totals: {
			inspections: period.length,
			simulated: simulated.length,
			approved: simulated.filter((r) => r.verdict === "pass").length,
			holds_noncompliant: simulated.filter((r) => r.verdict === "warning").length,
			fails: simulated.filter((r) => r.verdict === "fail").length,
			needs_fix: fixing.length,
			fixed_and_proven: proven.length,
			fixed_and_proven_rate: fixing.length ? proven.length / fixing.length : null,
			failed_no_proven_fix: fixing.length - proven.length,
			reinspections: rows.filter((r) => r.reinspection_of && inPeriod(r)).length,
			// Alerts are not bound to the period: an old open failure is the most urgent one.
			alerts: originals.filter((r) => isAlert(r, options.at, options.alertHours)).length,
		},
		failures: [...failureCounts.entries()]
			.map(([code, inspections]) => ({ code, inspections, share: inspections / fixing.length }))
			.sort((a, b) => b.inspections - a.inspections || a.code.localeCompare(b.code)),
		drivers: [...drivers.values()].sort((a, b) => b.open - a.open || (b.failure_rate ?? 0) - (a.failure_rate ?? 0) || b.inspections - a.inspections),
		weeks: [...weeks.values()],
	};
}
