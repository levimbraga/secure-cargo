/**
 * The audit trail of an inspection: who did what, and when (`inspection_events`), and what the
 * driver changed in the load the AI read from the photo.
 *
 * Event kinds: created, photo_added, photo_removed, analyzed, invoice_read, load_confirmed,
 * simulated, fix_simulated, shared, unshared, reinspected (on the first inspection, pointing to the
 * new one), certificate_issued, country_changed (US or Brazilian rules). Each carries its facts in `detail`, never free text, so that the
 * page translates it.
 */
import { type Db, newId, now } from "./db";

export async function logEvent(
	db: Db,
	inspectionId: string,
	actorId: string | null,
	kind: string,
	detail: Record<string, unknown> = {},
	at: string = now(),
): Promise<void> {
	await db
		.prepare("INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(newId("evt"), inspectionId, actorId, at, kind, JSON.stringify(detail))
		.run();
}

interface DraftUnit {
	id: string;
	cargo?: string;
	x_m?: number;
	y_m?: number;
	on?: string | null;
	straps?: number;
	size_m?: [number, number, number] | null;
	mass_kg?: number | null;
}
interface Draft {
	truck?: { body?: string; size?: string; style?: string; headboard_height_m?: number; bed_length_m?: number };
	restraint?: string;
	units?: DraftUnit[];
}

export type DraftChange =
	| { code: "truck"; field: "size" | "style" | "body" | "headboard_height_m" | "bed_length_m"; from: unknown; to: unknown }
	| { code: "restraint"; from: unknown; to: unknown }
	| { code: "unit_added"; unit: string; cargo?: string }
	| { code: "unit_removed"; unit: string; cargo?: string }
	| { code: "unit_cargo"; unit: string; from: unknown; to: unknown }
	| { code: "unit_moved"; unit: string; distance_m: number }
	| { code: "unit_resized"; unit: string }
	| { code: "unit_stacking"; unit: string; from: unknown; to: unknown }
	| { code: "unit_straps"; unit: string; from: unknown; to: unknown };

/** Moves shorter than this are the editor snapping, not an edit. */
const MOVE_EPSILON_M = 0.05;

/**
 * What changed from one load draft to the next (the AI's reading to the confirmed load, or one
 * confirmed load to the next). Weights are left out: the AI never gives one, the driver always does.
 */
export function diffDrafts(before: unknown, after: unknown): DraftChange[] {
	const a = (before ?? {}) as Draft;
	const b = (after ?? {}) as Draft;
	const changes: DraftChange[] = [];
	for (const field of ["size", "style", "body", "headboard_height_m", "bed_length_m"] as const) {
		const from = a.truck?.[field];
		const to = b.truck?.[field];
		if ((from ?? null) !== (to ?? null)) changes.push({ code: "truck", field, from: from ?? null, to: to ?? null });
	}
	if (a.restraint !== b.restraint) changes.push({ code: "restraint", from: a.restraint ?? null, to: b.restraint ?? null });
	const beforeUnits = new Map((a.units ?? []).map((u) => [u.id, u]));
	const afterUnits = new Map((b.units ?? []).map((u) => [u.id, u]));
	for (const [id, u] of beforeUnits) if (!afterUnits.has(id)) changes.push({ code: "unit_removed", unit: id, cargo: u.cargo });
	for (const [id, u] of afterUnits) {
		const old = beforeUnits.get(id);
		if (!old) {
			changes.push({ code: "unit_added", unit: id, cargo: u.cargo });
			continue;
		}
		if (old.cargo !== u.cargo) changes.push({ code: "unit_cargo", unit: id, from: old.cargo ?? null, to: u.cargo ?? null });
		const moved = Math.hypot((u.x_m ?? 0) - (old.x_m ?? 0), (u.y_m ?? 0) - (old.y_m ?? 0));
		if (moved >= MOVE_EPSILON_M) changes.push({ code: "unit_moved", unit: id, distance_m: Math.round(moved * 100) / 100 });
		if (JSON.stringify(old.size_m ?? null) !== JSON.stringify(u.size_m ?? null)) changes.push({ code: "unit_resized", unit: id });
		if ((old.on ?? null) !== (u.on ?? null)) changes.push({ code: "unit_stacking", unit: id, from: old.on ?? null, to: u.on ?? null });
		if ((old.straps ?? 0) !== (u.straps ?? 0)) changes.push({ code: "unit_straps", unit: id, from: old.straps ?? 0, to: u.straps ?? 0 });
	}
	return changes;
}

interface AnalysisShape {
	truck?: { body?: string; size?: string; confidence?: number };
	units?: { number?: number; cargo?: string; confidence?: number }[];
	restraints?: { kind?: string; count?: number; routing?: string }[];
	overall_confidence?: number;
}

export interface ReadingRow {
	field: "truck_size" | "truck_body" | "units" | "cargo" | "straps" | "chains" | "ropes" | "restraint" | "weight";
	ai: unknown;
	driver: unknown;
	changed: boolean;
}

/**
 * The AI's reading of the photos beside the load the driver confirmed, field by field. The weight
 * is never read from a photo: its row says where the driver's number came from.
 */
export function readingVsLoad(
	analysis: unknown,
	draft: unknown,
	inspection: { cargo_weight_kg: number | null; weight_source: string | null },
): ReadingRow[] {
	const ai = (analysis ?? {}) as AnalysisShape;
	const load = (draft ?? {}) as Draft;
	const units = load.units ?? [];
	const count = (kind: string) => (ai.restraints ?? []).filter((r) => r.kind === kind).reduce((n, r) => n + (r.count ?? 0), 0);
	const cargoList = (values: (string | undefined)[]) => {
		const tally = new Map<string, number>();
		for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
		return [...tally.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([cargo, n]) => ({ cargo, n }));
	};
	const aiCargo = cargoList((ai.units ?? []).map((u) => u.cargo));
	const loadCargo = cargoList(units.map((u) => u.cargo));
	const straps = units.reduce((n, u) => n + (u.straps ?? 0), 0);
	const rows: ReadingRow[] = [
		{ field: "truck_size", ai: ai.truck?.size ?? null, driver: load.truck?.size ?? null, changed: false },
		{ field: "truck_body", ai: ai.truck?.body ?? null, driver: load.truck?.body ?? null, changed: false },
		{ field: "units", ai: (ai.units ?? []).length, driver: units.length, changed: false },
		{ field: "cargo", ai: aiCargo, driver: loadCargo, changed: false },
		// Lashings of any kind (the draft counts each strap, chain or rope over a unit).
		{ field: "straps", ai: count("strap") + count("chain") + count("rope"), driver: straps, changed: false },
		{ field: "restraint", ai: (ai.restraints ?? []).map((r) => r.kind).filter(Boolean), driver: load.restraint ?? null, changed: false },
		{ field: "weight", ai: null, driver: { kg: inspection.cargo_weight_kg, source: inspection.weight_source }, changed: false },
	];
	for (const row of rows) {
		if (row.field === "restraint" || row.field === "weight") continue;
		row.changed = JSON.stringify(row.ai) !== JSON.stringify(row.driver);
	}
	return rows;
}
