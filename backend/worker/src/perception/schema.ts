/**
 * What Claude vision returns for the photos of a load: structured JSON only.
 *
 * The schema is sent as the response format (structured outputs), so the model cannot answer
 * anything else. It has **no weight field anywhere**: a photo cannot show weight, and weights
 * come only from the user. `sanitizeAnalysis` re-checks every answer anyway (and drops anything
 * that is not in the schema), so the rule holds even if the format were ever bypassed.
 *
 * Positions are fractions of the truck bed as seen in the photos, so the confirmed truck's bed
 * length and width give them a scale (see `backend/perception/draft.py`).
 */

export const PROMPT_VERSION = "2";

export const CARGO_TYPES = [
	"wood_pallet",
	"plastic_pallet",
	"crate",
	"drum",
	"steel_coil",
	"machine",
	"tall_cabinet",
	"sacks",
	"long_pipes",
	"stacked_boxes",
] as const;
export const BODIES = ["flatbed", "box", "curtain_sider", "unknown"] as const;
export const SIZES = ["vuc", "toco", "truck", "semi", "unknown"] as const;
export const RESTRAINT_KINDS = ["strap", "chain", "rope", "anti_slip_mat", "blocking", "coil_cradle"] as const;
export const ROUTINGS = ["top_over", "diagonal", "unknown"] as const;
export const VIOLATIONS = ["rope", "above_headboard", "gap_to_headboard", "anchored_on_wood"] as const;

export type CargoType = (typeof CARGO_TYPES)[number];

export interface AnalysisUnit {
	/** 1, 2, 3… : the number drawn on the photo and in the editor. */
	number: number;
	cargo: CargoType;
	/** Approximate length (along the truck), width (across), height [m]. */
	length_m: number;
	width_m: number;
	height_m: number;
	/** Centre of the unit on the bed: 0 = at the headboard, 1 = at the rear end. */
	along: number;
	/** 0 = the truck's left edge (driver's side), 1 = its right edge. */
	across: number;
	/** The number of the unit it stands on, or null on the floor. */
	stacked_on: number | null;
	/** Which photo shows it best (0-based), and where: x0, y0, x1, y1 as fractions of the photo. */
	photo: number;
	box: [number, number, number, number];
	confidence: number;
	uncertain: string;
}

export interface AnalysisRestraint {
	kind: (typeof RESTRAINT_KINDS)[number];
	count: number;
	routing: (typeof ROUTINGS)[number];
	/** Units it secures (numbers); empty when it is not clear. */
	units: number[];
	confidence: number;
	uncertain: string;
}

export interface AnalysisViolation {
	code: (typeof VIOLATIONS)[number];
	units: number[];
	confidence: number;
	note: string;
}

export interface PhotoAnalysis {
	/** False when the photos do not show cargo on a truck (the flow then asks for other photos). */
	is_truck_load: boolean;
	truck: { body: (typeof BODIES)[number]; size: (typeof SIZES)[number]; confidence: number; uncertain: string };
	units: AnalysisUnit[];
	restraints: AnalysisRestraint[];
	violations: AnalysisViolation[];
	overall_confidence: number;
	summary: string;
}

const confidence = { type: "number", description: "0 to 1: how sure you are about this item." };
const uncertain = {
	type: "string",
	description: "What is uncertain about this item, in a short English phrase; empty when nothing is.",
};
const numbers = { type: "array", items: { type: "integer" } };

/** JSON schema of `PhotoAnalysis` (structured outputs subset: no numeric or length limits). */
export const ANALYSIS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["is_truck_load", "truck", "units", "restraints", "violations", "overall_confidence", "summary"],
	properties: {
		is_truck_load: { type: "boolean" },
		truck: {
			type: "object",
			additionalProperties: false,
			required: ["body", "size", "confidence", "uncertain"],
			properties: {
				body: { type: "string", enum: BODIES },
				size: { type: "string", enum: SIZES },
				confidence,
				uncertain,
			},
		},
		units: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"number",
					"cargo",
					"length_m",
					"width_m",
					"height_m",
					"along",
					"across",
					"stacked_on",
					"photo",
					"box",
					"confidence",
					"uncertain",
				],
				properties: {
					number: { type: "integer" },
					cargo: { type: "string", enum: CARGO_TYPES },
					length_m: { type: "number" },
					width_m: { type: "number" },
					height_m: { type: "number" },
					along: { type: "number" },
					across: { type: "number" },
					stacked_on: { anyOf: [{ type: "integer" }, { type: "null" }] },
					photo: { type: "integer" },
					box: { type: "array", items: { type: "number" } },
					confidence,
					uncertain,
				},
			},
		},
		restraints: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["kind", "count", "routing", "units", "confidence", "uncertain"],
				properties: {
					kind: { type: "string", enum: RESTRAINT_KINDS },
					count: { type: "integer" },
					routing: { type: "string", enum: ROUTINGS },
					units: numbers,
					confidence,
					uncertain,
				},
			},
		},
		violations: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["code", "units", "confidence", "note"],
				properties: {
					code: { type: "string", enum: VIOLATIONS },
					units: numbers,
					confidence,
					note: { type: "string" },
				},
			},
		},
		overall_confidence: confidence,
		summary: { type: "string", description: "One English sentence: what is on the truck and how it is secured." },
	},
} as const;

const clamp = (value: unknown, low: number, high: number, fallback: number): number => {
	const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(Math.max(n, low), high);
};
const text = (value: unknown, max = 200): string => (typeof value === "string" ? value.slice(0, max) : "");
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
	options.includes(value as T) ? (value as T) : fallback;
const ints = (value: unknown): number[] =>
	Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)).slice(0, 40) : [];

export const MAX_UNITS = 40;

/**
 * Keep only what the schema allows, within sensible ranges. Every field is rebuilt from scratch,
 * so anything else the model may have written (a weight, a price, free text) is dropped.
 */
export function sanitizeAnalysis(raw: unknown, photoCount: number): PhotoAnalysis {
	const value = (raw ?? {}) as Record<string, unknown>;
	const truck = (value.truck ?? {}) as Record<string, unknown>;
	const units = (Array.isArray(value.units) ? value.units : []).slice(0, MAX_UNITS).map((item, index) => {
		const u = (item ?? {}) as Record<string, unknown>;
		const box = Array.isArray(u.box) ? u.box.slice(0, 4).map((v) => clamp(v, 0, 1, 0)) : [0, 0, 0, 0];
		while (box.length < 4) box.push(0);
		const [x0, y0, x1, y1] = box as [number, number, number, number];
		const stackedOn = Number.isInteger(u.stacked_on) ? (u.stacked_on as number) : null;
		return {
			number: Number.isInteger(u.number) ? (u.number as number) : index + 1,
			cargo: oneOf(u.cargo, CARGO_TYPES, "crate"),
			length_m: clamp(u.length_m, 0.2, 14, 1.2),
			width_m: clamp(u.width_m, 0.2, 2.6, 1.0),
			height_m: clamp(u.height_m, 0.1, 3.5, 1.0),
			along: clamp(u.along, 0, 1, 0.5),
			across: clamp(u.across, 0, 1, 0.5),
			stacked_on: stackedOn,
			photo: clamp(u.photo, 0, Math.max(photoCount - 1, 0), 0) | 0,
			box: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] as [number, number, number, number],
			confidence: clamp(u.confidence, 0, 1, 0.5),
			uncertain: text(u.uncertain),
		};
	});
	// Numbers must be unique and a unit can only stand on another listed unit (never itself).
	const seen = new Set<number>();
	for (const unit of units) {
		if (seen.has(unit.number)) unit.number = Math.max(...seen) + 1;
		seen.add(unit.number);
	}
	for (const unit of units) {
		if (unit.stacked_on !== null && (unit.stacked_on === unit.number || !seen.has(unit.stacked_on))) unit.stacked_on = null;
	}
	return {
		is_truck_load: value.is_truck_load !== false,
		truck: {
			body: oneOf(truck.body, BODIES, "unknown"),
			size: oneOf(truck.size, SIZES, "unknown"),
			confidence: clamp(truck.confidence, 0, 1, 0),
			uncertain: text(truck.uncertain),
		},
		units,
		restraints: (Array.isArray(value.restraints) ? value.restraints : []).slice(0, 20).map((item) => {
			const r = (item ?? {}) as Record<string, unknown>;
			return {
				kind: oneOf(r.kind, RESTRAINT_KINDS, "strap"),
				count: clamp(r.count, 0, 60, 0) | 0,
				routing: oneOf(r.routing, ROUTINGS, "unknown"),
				units: ints(r.units).filter((n) => seen.has(n)),
				confidence: clamp(r.confidence, 0, 1, 0.5),
				uncertain: text(r.uncertain),
			};
		}),
		violations: (Array.isArray(value.violations) ? value.violations : []).slice(0, 10).map((item) => {
			const v = (item ?? {}) as Record<string, unknown>;
			return {
				code: oneOf(v.code, VIOLATIONS, "gap_to_headboard"),
				units: ints(v.units).filter((n) => seen.has(n)),
				confidence: clamp(v.confidence, 0, 1, 0.5),
				note: text(v.note),
			};
		}),
		overall_confidence: clamp(value.overall_confidence, 0, 1, 0),
		summary: text(value.summary, 400),
	};
}
