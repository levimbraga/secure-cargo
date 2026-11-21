/**
 * Summaries of an inspection for the manager's dashboard: the cargo types of the confirmed load
 * and the failure types of its battery, kept on the `inspections` row so that the filters and the
 * metrics are plain SQL (`migrations/0006_manager.sql`).
 *
 * Failure types use the codes the site already translates:
 * - physical: what happens in some situation (`unit_slid`, `unit_tilted`, `lashing_overloaded`, ...);
 *   an axle overload is a rule, not physics (as in `verdict.ts`);
 * - rules: the CONTRAN 945 checks that fail (`devices_allowed`, `diagonals_for_gaps`, ...) and the
 *   other legal checks of the checklist (`axle`, `payload`, `gross`, `height`, `width`, `overhang`).
 */
import type { Db } from "./db";

export const PHYSICAL_FAILURES = [
	"unit_slid",
	"unit_hit_headboard",
	"headboard_overloaded",
	"unit_left_bed",
	"unit_tilted",
	"unit_rolled",
	"lashing_broke",
	"lashing_overloaded",
] as const;

export const RULE_FAILURES = [
	"devices_allowed",
	"safety_factor",
	"four_terminals",
	"anchoring",
	"diagonals_for_gaps",
	"above_headboard",
	"axle",
	"payload",
	"gross",
	"height",
	"width",
	"overhang",
] as const;

export const FAILURE_CODES: readonly string[] = [...PHYSICAL_FAILURES, ...RULE_FAILURES];

interface BatteryShape {
	situations?: { findings?: { code?: string; severity?: string }[] }[];
	contran_945?: { code?: string; status?: string }[];
	checklist?: Record<string, { code?: string; kind?: string; status?: string }[]> | null;
	axle_loads?: { load_kg?: number; limit_kg?: number }[];
}

/** Every failure type of a battery, physical ones first, each once. */
export function failureCodes(battery: unknown): string[] {
	const b = (battery ?? {}) as BatteryShape;
	const found = new Set<string>();
	for (const situation of b.situations ?? []) {
		for (const finding of situation.findings ?? []) {
			if (finding.severity !== "fail" || !finding.code) continue;
			found.add(finding.code === "axle_overloaded" ? "axle" : finding.code);
		}
	}
	for (const check of b.contran_945 ?? []) {
		if (check.status === "fail" && check.code) found.add(check.code);
	}
	if (b.checklist) {
		for (const items of Object.values(b.checklist)) {
			for (const item of items) if (item.kind === "rule" && item.status === "fail" && item.code) found.add(item.code);
		}
	} else if ((b.axle_loads ?? []).some((a) => (a.load_kg ?? 0) > (a.limit_kg ?? Infinity))) {
		found.add("axle");
	}
	return [...found].filter((code) => FAILURE_CODES.includes(code)).sort((a, b) => FAILURE_CODES.indexOf(a) - FAILURE_CODES.indexOf(b));
}

/** The cargo types of a load draft, each once, sorted. */
export function cargoTypes(draft: unknown): string[] {
	const units = ((draft ?? {}) as { units?: { cargo?: unknown }[] }).units ?? [];
	return [...new Set(units.map((u) => u.cargo).filter((c): c is string => typeof c === "string" && /^[a-z_]+$/.test(c)))].sort();
}

/** A list as stored: ",a,b," ('' for none), so that `LIKE '%,a,%'` finds a member. */
export function packList(values: readonly string[]): string {
	return values.length ? `,${values.join(",")},` : "";
}

export function unpackList(value: string | null | undefined): string[] {
	return (value ?? "").split(",").filter(Boolean);
}

/** A stored battery: in the private bucket, or a static file of the site (`static:/path[#key]`). */
export type BatteryReader = (ref: string) => Promise<unknown | null>;

/**
 * Fill in the failure types of simulated inspections that have none yet (rows from before the
 * summaries, and the seeded demo). Called by the hourly cron and, a few at a time, by the overview.
 */
export async function backfillSummaries(db: Db, read: BatteryReader, limit = 25): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT i.id, (SELECT s.battery_ref FROM scenarios s WHERE s.inspection_id = i.id AND s.kind = 'as_loaded'
			   ORDER BY s.created_at DESC LIMIT 1) AS ref
			 FROM inspections i WHERE i.verdict IS NOT NULL AND i.failure_codes IS NULL LIMIT ?`,
		)
		.bind(limit)
		.all<{ id: string; ref: string | null }>();
	let done = 0;
	for (const row of results) {
		let codes: string[] = [];
		if (row.ref) {
			const battery = await read(row.ref).catch(() => undefined);
			if (battery === undefined) continue; // unreachable for now: try again later
			codes = battery ? failureCodes(battery) : [];
		}
		await db.prepare("UPDATE inspections SET failure_codes = ? WHERE id = ?").bind(packList(codes), row.id).run();
		done += 1;
	}
	return done;
}
