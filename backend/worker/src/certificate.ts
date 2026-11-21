/**
 * Load certificates: who may get one, what it records, and how it is verified.
 *
 * A certificate is issued only for an inspection that is approved, or fixed and proven (a
 * re-inspection of it was approved). An organization may also allow one for a load that holds but
 * is out of compliance (`certificate_requires_compliance` off); the certificate then says so.
 *
 * The record (`content`) is canonical JSON (keys sorted at every level) and its SHA-256 is the
 * certificate's hash. The public page `securecargo.app/verify/<id>` recomputes the hash from the
 * stored record: a record changed after issue no longer matches, and a revoked one is shown as such.
 */
import { sha256Hex } from "./perception/metadata";
import { unpackList } from "./summary";

export const DISCLAIMER_CODE = "decision_support_v1";
export const DISCLAIMER =
	"SecureCargo is a decision-support tool, not an engineering certification. This record states what the physics simulation and the rule checks found for the load as photographed and confirmed.";

export type CertificateState = "approved" | "fixed_and_proven" | "holds_noncompliant";

export type Eligibility =
	| { ok: true; state: CertificateState }
	| { ok: false; code: "not_simulated" | "fails_no_proven_fix" | "out_of_compliance" };

export function certificateEligibility(
	inspection: { verdict: string | null; proven_by: string | null },
	policy: { certificate_requires_compliance: boolean },
): Eligibility {
	if (inspection.verdict === null) return { ok: false, code: "not_simulated" };
	if (inspection.verdict === "pass") return { ok: true, state: "approved" };
	if (inspection.proven_by) return { ok: true, state: "fixed_and_proven" };
	if (inspection.verdict === "warning") {
		return policy.certificate_requires_compliance ? { ok: false, code: "out_of_compliance" } : { ok: true, state: "holds_noncompliant" };
	}
	return { ok: false, code: "fails_no_proven_fix" };
}

/** JSON with the keys of every object sorted: the same record always gives the same text. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function contentHash(content: unknown): Promise<string> {
	return sha256Hex(new TextEncoder().encode(canonicalJson(content)));
}

/** Does the stored record still give the stored hash? */
export async function verifyContent(contentJson: string, hash: string): Promise<boolean> {
	try {
		return (await contentHash(JSON.parse(contentJson))) === hash;
	} catch {
		return false;
	}
}

/** Unambiguous characters (no 0/O, 1/I/L): read off paper without mistakes. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** `SC-XXXX-XXXX`: 31^8 (about 8.5e11) ids, random. */
export function certificateId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
	return `SC-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export const CERTIFICATE_ID = /^SC-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

interface Battery {
	passed?: number;
	total?: number;
	situations?: { id: string; status: string }[];
	contran_945?: { code: string; article?: string; status: string }[];
	checklist?: Record<string, { code: string; kind?: string; status: string; article?: string }[]> | null;
	axle_loads?: { axle_group_id?: string; load_kg?: number; limit_kg?: number }[];
}

export interface InspectionFacts {
	id: string;
	created_at: string;
	org_id: string | null;
	org_name: string | null;
	org_type: string | null;
	truck_json: string | null;
	truck_body: string | null;
	truck_size: string | null;
	cargo_weight_kg: number | null;
	weight_source: string | null;
	cargo_types: string | null;
	units: number;
}

/**
 * The certified record, without its id and issue time (they are added around it), so that the
 * same inspection gives the same body and a repeated request returns the certificate already issued.
 */
export function certificateBody(params: {
	state: CertificateState;
	inspection: InspectionFacts;
	/** The re-inspection that proved the fix (fixed and proven), with its battery and photo. */
	proof: { id: string; created_at: string } | null;
	battery: Battery;
	photo: { sha256: string; position: string } | null;
	fixChanges: { code?: string }[];
}): Record<string, unknown> {
	const { inspection, battery } = params;
	let truck: Record<string, unknown> = {};
	try {
		truck = inspection.truck_json ? (JSON.parse(inspection.truck_json) as Record<string, unknown>) : {};
	} catch {
		// use the columns
	}
	const checks: { code: string; article: string | null; status: string }[] = [];
	for (const c of battery.contran_945 ?? []) checks.push({ code: c.code, article: c.article ?? null, status: c.status });
	for (const items of Object.values(battery.checklist ?? {})) {
		for (const item of items) {
			if (item.kind !== "rule" || checks.some((c) => c.code === item.code)) continue;
			checks.push({ code: item.code, article: item.article ?? null, status: item.status });
		}
	}
	return {
		v: 1,
		state: params.state,
		inspection_id: inspection.id,
		inspected_at: inspection.created_at,
		proof_inspection_id: params.proof?.id ?? null,
		proven_at: params.proof?.created_at ?? null,
		organization: inspection.org_id ? { id: inspection.org_id, name: inspection.org_name, type: inspection.org_type } : null,
		truck: {
			size: (truck.size as string | undefined) ?? inspection.truck_size,
			style: (truck.style as string | undefined) ?? null,
			body: (truck.body as string | undefined) ?? inspection.truck_body,
			bed_length_m: (truck.bed_length_m as number | undefined) ?? null,
			headboard_height_m: (truck.headboard_height_m as number | undefined) ?? null,
		},
		cargo: {
			weight_kg: inspection.cargo_weight_kg,
			weight_source: inspection.weight_source,
			types: unpackList(inspection.cargo_types),
			units: inspection.units,
		},
		photo: params.photo,
		results: {
			passed: battery.passed ?? (battery.situations ?? []).filter((s) => s.status !== "fail").length,
			total: battery.total ?? (battery.situations ?? []).length,
			situations: (battery.situations ?? []).map((s) => ({ id: s.id, status: s.status })),
		},
		checks,
		axle_loads: (battery.axle_loads ?? []).map((a) => ({
			group: a.axle_group_id ?? null,
			load_kg: Math.round(a.load_kg ?? 0),
			limit_kg: Math.round(a.limit_kg ?? 0),
		})),
		fix: params.fixChanges.length ? params.fixChanges.map((c) => c.code ?? "change") : null,
		disclaimer: DISCLAIMER_CODE,
	};
}

/** What the public verify page shows: authenticity and a minimal summary, nothing personal. */
export function publicSummary(content: Record<string, unknown>): Record<string, unknown> {
	const truck = (content.truck ?? {}) as Record<string, unknown>;
	const results = (content.results ?? {}) as Record<string, unknown>;
	const org = content.organization as { name?: string; type?: string } | null;
	return {
		state: content.state,
		inspected_at: content.inspected_at,
		proven_at: content.proven_at ?? null,
		organization: org ? { name: org.name ?? null, type: org.type ?? null } : null,
		truck: { size: truck.size ?? null, style: truck.style ?? null },
		situations: { passed: results.passed ?? null, total: results.total ?? null },
		checks_failed: ((content.checks ?? []) as { status: string }[]).filter((c) => c.status === "fail").length,
	};
}
