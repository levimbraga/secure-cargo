/**
 * The driver inspection flow, on top of the inspections API:
 *
 *   POST   /inspections/:id/photos?position=   add a photo (raw JPEG/PNG body; metadata stripped)
 *   GET    /inspections/:id/photos/:photoId     the photo itself (private bucket, authorized)
 *   DELETE /inspections/:id/photos/:photoId     remove a photo before the analysis
 *   POST   /inspections/:id/analyze             Claude vision on the photos (quota, cap, cache)
 *   PUT    /inspections/:id/draft               the load the user confirmed (weights required)
 *   POST   /inspections/:id/simulate            the seven-situation battery, on the server
 *   POST   /inspections/:id/fix                 the planner's fix, proven through the battery
 *   GET    /inspections/:id/battery/:kind       a stored battery (as_loaded | fixed)
 *
 * Status: draft (photos) -> analyzed -> confirmed (draft saved) -> simulated.
 * Only the author changes an inspection; readers (org_admin, platform admin) may read it.
 */
import type { Context, Hono, MiddlewareHandler } from "hono";

import { canWriteInspection, type Principal } from "./authz";
import { type Db, newId, now } from "./db";
import { fail, forbidden, jsonBody } from "./http";
import type { AnalysisCall, PhotoInput } from "./perception/claude";
import { sha256Hex, stripMetadata, toBase64, UnsupportedImage } from "./perception/metadata";
import { type PhotoAnalysis, PROMPT_VERSION } from "./perception/schema";
import { analysisAllowance } from "./quota";

export interface PhotoStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

/** A POST to the physics container (only the Worker can reach it). */
export type Physics = (path: "/battery" | "/plan", body: unknown) => Promise<Response>;

export interface Analyzer {
	model: string;
	analyze(photos: PhotoInput[]): Promise<AnalysisCall>;
}

export interface SamplePhoto {
	id: string;
	/** Public site path of each photo, and its hash. */
	photos: { position: string; path: string; sha256: string }[];
	analysis: PhotoAnalysis;
}

export interface FlowDeps {
	db: Db;
	photos: PhotoStore | null;
	physics: Physics | null;
	analyzer: Analyzer | null;
	samples: Record<string, SamplePhoto>;
}

type Env = { Variables: { principal: Principal } };
type Row = { id: string; org_id: string | null; author_id: string };

export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const POSITIONS = ["front", "left", "right", "rear", "other"] as const;
const KINDS = ["as_loaded", "fixed"] as const;
/** Weights the user gave must add up to the cargo weight, within this share (rounding). */
const WEIGHT_TOLERANCE = 0.01;

export function registerFlow(
	app: Hono<Env>,
	deps: FlowDeps,
	authenticated: MiddlewareHandler<Env>,
	readable: (c: Context<Env>) => Promise<Row>,
): void {
	const { db } = deps;

	async function writable(c: Context<Env>): Promise<Row> {
		const row = await readable(c);
		if (!canWriteInspection(c.get("principal"), row)) forbidden();
		return row;
	}

	const touch = (id: string, fields: Record<string, unknown>) => {
		const entries = Object.entries({ ...fields, updated_at: now() });
		return db
			.prepare(`UPDATE inspections SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
			.bind(...entries.map(([, v]) => v), id)
			.run();
	};

	// ---- photos ---------------------------------------------------------------------------

	app.post("/inspections/:id/photos", authenticated, async (c) => {
		const inspection = await writable(c);
		if (!deps.photos) fail(503, "photos_unavailable", "Photo storage is not configured.");
		const position = c.req.query("position") ?? "other";
		if (!POSITIONS.includes(position as (typeof POSITIONS)[number])) {
			fail(422, "invalid_field", `position must be one of ${POSITIONS.join(", ")}.`);
		}
		const count = await db.prepare("SELECT COUNT(*) AS n FROM photos WHERE inspection_id = ?").bind(inspection.id).first<{ n: number }>();
		if ((count?.n ?? 0) >= MAX_PHOTOS) fail(422, "too_many_photos", `An inspection takes at most ${MAX_PHOTOS} photos.`);
		const raw = new Uint8Array(await c.req.arrayBuffer());
		if (raw.length === 0) fail(422, "empty_photo", "Send the photo as the request body.");
		if (raw.length > MAX_PHOTO_BYTES) fail(413, "photo_too_large", "Photos must be at most 5 MB.");
		let stripped: ReturnType<typeof stripMetadata>;
		try {
			stripped = stripMetadata(raw);
		} catch (error) {
			if (error instanceof UnsupportedImage) fail(415, "unsupported_photo", error.message);
			throw error;
		}
		const sha256 = await sha256Hex(stripped.bytes);
		const key = `photos/${sha256}.${stripped.kind === "image/png" ? "png" : "jpg"}`;
		await deps.photos.put(key, stripped.bytes, stripped.kind);
		const id = newId("pho");
		const at = now();
		await db
			.prepare(
				`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
			)
			.bind(id, inspection.id, position, key, sha256, stripped.kind, stripped.bytes.length, at)
			.run();
		await touch(inspection.id, { status: "draft", analysis_id: null });
		return c.json({ id, position, sha256, content_type: stripped.kind, bytes: stripped.bytes.length, created_at: at }, 201);
	});

	app.get("/inspections/:id/photos/:photoId", authenticated, async (c) => {
		const inspection = await readable(c);
		const photo = await db
			.prepare("SELECT r2_key, content_type FROM photos WHERE id = ? AND inspection_id = ?")
			.bind(c.req.param("photoId"), inspection.id)
			.first<{ r2_key: string; content_type: string }>();
		if (!photo || photo.r2_key.startsWith("sample:") || !deps.photos) fail(404, "not_found", "No such photo.");
		const object = await deps.photos.get(photo.r2_key);
		if (!object) fail(404, "not_found", "No such photo.");
		return c.body(object.bytes as Uint8Array<ArrayBuffer>, 200, {
			"Content-Type": object.contentType,
			"Cache-Control": "private, max-age=3600",
		});
	});

	app.delete("/inspections/:id/photos/:photoId", authenticated, async (c) => {
		const inspection = await writable(c);
		await db.prepare("DELETE FROM photos WHERE id = ? AND inspection_id = ?").bind(c.req.param("photoId"), inspection.id).run();
		await touch(inspection.id, { status: "draft", analysis_id: null });
		return c.json({ deleted: true });
	});

	// ---- analysis -------------------------------------------------------------------------

	app.post("/inspections/:id/analyze", authenticated, async (c) => {
		const p = c.get("principal");
		const inspection = await writable(c);
		const meta = await db.prepare("SELECT sample FROM inspections WHERE id = ?").bind(inspection.id).first<{ sample: string | null }>();
		const { results: photos } = await db
			.prepare("SELECT id, position, r2_key, sha256, content_type FROM photos WHERE inspection_id = ? ORDER BY created_at")
			.bind(inspection.id)
			.all<{ id: string; position: string; r2_key: string; sha256: string; content_type: string }>();
		if (photos.length === 0) fail(422, "no_photos", "Add at least one photo first.");

		// A sample photo: its analysis was computed once and ships with the API. Free, always.
		const sample = meta?.sample ? deps.samples[meta.sample] : undefined;
		if (sample) {
			await touch(inspection.id, { status: "analyzed" });
			return c.json({ mode: "sample", analysis: sample.analysis, model: null });
		}

		if (!deps.analyzer) {
			return c.json({ mode: "demo", reason: "not_configured", analysis: null, allowance: await analysisAllowance(db, p) });
		}
		const setHash = await photoSetHash(photos.map((ph) => ph.sha256));
		const model = deps.analyzer.model;
		const cached = await db
			.prepare("SELECT id, output_json FROM analyses WHERE photo_sha256 = ? AND model = ? AND prompt_version = ?")
			.bind(setHash, model, PROMPT_VERSION)
			.first<{ id: string; output_json: string }>();
		if (cached) {
			await recordUsage(db, p, { model, inputTokens: 0, outputTokens: 0, costUsd: 0, cached: true });
			await touch(inspection.id, { status: "analyzed", analysis_id: cached.id });
			return c.json({ mode: "cached", analysis: JSON.parse(cached.output_json) as PhotoAnalysis, model });
		}

		// Credit protection: blocked user, kill switch, monthly cap, daily quota.
		const allowance = await analysisAllowance(db, p);
		if (!allowance.allowed) return c.json({ mode: "demo", reason: allowance.reason, analysis: null, allowance });

		if (!deps.photos) fail(503, "photos_unavailable", "Photo storage is not configured.");
		const inputs: PhotoInput[] = [];
		for (const photo of photos) {
			const object = await deps.photos.get(photo.r2_key);
			if (!object) fail(409, "photo_missing", "A photo of this inspection is missing; add it again.");
			inputs.push({
				mediaType: photo.content_type === "image/png" ? "image/png" : "image/jpeg",
				base64: toBase64(object.bytes),
				position: photo.position,
			});
		}
		let call: AnalysisCall;
		try {
			call = await deps.analyzer.analyze(inputs);
		} catch (error) {
			console.error("Photo analysis failed:", error);
			const code = (error as { code?: string }).code;
			fail(502, code === "refused" ? "analysis_refused" : "analysis_failed", "The photo analysis did not work. Fill in the load by hand, or try again.");
		}
		const analysisId = newId("ana");
		await db.batch([
			db
				.prepare(
					`INSERT INTO analyses (id, photo_sha256, model, prompt_version, output_json, input_tokens, output_tokens, cost_usd, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (photo_sha256, model, prompt_version) DO NOTHING`,
				)
				.bind(analysisId, setHash, call.model, PROMPT_VERSION, JSON.stringify(call.analysis), call.inputTokens, call.outputTokens, call.costUsd, now()),
		]);
		await recordUsage(db, p, { ...call, cached: false });
		const stored = await db
			.prepare("SELECT id FROM analyses WHERE photo_sha256 = ? AND model = ? AND prompt_version = ?")
			.bind(setHash, call.model, PROMPT_VERSION)
			.first<{ id: string }>();
		await touch(inspection.id, { status: "analyzed", analysis_id: stored?.id ?? null });
		return c.json({ mode: "live", analysis: call.analysis, model: call.model, cost_usd: round(call.costUsd) });
	});

	// ---- confirmed load -------------------------------------------------------------------

	app.put("/inspections/:id/draft", authenticated, async (c) => {
		const p = c.get("principal");
		const inspection = await writable(c);
		const body = await jsonBody(c);
		const draft = checkDraft(body.draft);
		const total = typeof body.cargo_weight_kg === "number" ? body.cargo_weight_kg : NaN;
		checkWeights(draft, total);
		const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined;
		const at = now();
		const id = newId("scn");
		// A confirmed load replaces the previous one, and with it every result and fix.
		await db.batch([
			db.prepare("DELETE FROM scenarios WHERE inspection_id = ?").bind(inspection.id),
			db
				.prepare("INSERT INTO scenarios (id, inspection_id, kind, draft_json, created_by, created_at) VALUES (?, ?, 'as_loaded', ?, ?, ?)")
				.bind(id, inspection.id, JSON.stringify(draft), p.userId, at),
		]);
		await touch(inspection.id, {
			status: "confirmed",
			truck_body: draft.truck.body,
			truck_size: draft.truck.size,
			cargo_weight_kg: total,
			situations_passed: null,
			situations_total: null,
			verdict: null,
			fixed_verdict: null,
			...(notes !== undefined ? { notes } : {}),
		});
		return c.json({ scenario_id: id, status: "confirmed" });
	});

	// ---- simulation and fix ---------------------------------------------------------------

	async function scenarioOf(inspectionId: string, kind: (typeof KINDS)[number]) {
		return db
			.prepare("SELECT id, draft_json, battery_ref FROM scenarios WHERE inspection_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1")
			.bind(inspectionId, kind)
			.first<{ id: string; draft_json: string; battery_ref: string | null }>();
	}

	async function callPhysics(path: "/battery" | "/plan", draft: unknown): Promise<BatteryJson & PlanJson> {
		if (!deps.physics) fail(503, "api_unavailable", "The physics engine is not reachable.");
		let response: Response;
		try {
			response = await deps.physics(path, { draft });
		} catch (error) {
			console.error("Physics call failed:", error);
			fail(503, "api_unavailable", "The physics engine is starting or unavailable. Try again.");
		}
		if (response.status === 422) {
			const detail = ((await response.json().catch(() => ({}))) as { detail?: { code?: string; message?: string } }).detail;
			fail(422, detail?.code ?? "invalid_load", detail?.message ?? "This load cannot be simulated.");
		}
		if (!response.ok) fail(503, "api_unavailable", "The physics engine is starting or unavailable. Try again.");
		return (await response.json()) as BatteryJson & PlanJson;
	}

	async function storeBattery(inspectionId: string, scenarioId: string, kind: string, battery: BatteryJson) {
		const at = now();
		const ref = `results/${inspectionId}/${kind}.json`;
		if (deps.photos) await deps.photos.put(ref, new TextEncoder().encode(JSON.stringify(battery)), "application/json");
		await db.batch([
			db.prepare("DELETE FROM results WHERE scenario_id = ?").bind(scenarioId),
			db.prepare("UPDATE scenarios SET battery_ref = ? WHERE id = ?").bind(deps.photos ? ref : null, scenarioId),
			...battery.situations.map((s) =>
				db
					.prepare(
						`INSERT INTO results (id, inspection_id, scenario_id, situation, verdict, metrics_json, keyframes_ref, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(
						newId("res"),
						inspectionId,
						scenarioId,
						s.id,
						s.status,
						JSON.stringify({ findings: s.findings, margins: s.margins, event: s.event, trip: s.trip, severity: s.severity }),
						s.scenario_hash,
						at,
					),
			),
		]);
	}

	app.post("/inspections/:id/simulate", authenticated, async (c) => {
		const inspection = await writable(c);
		const scenario = await scenarioOf(inspection.id, "as_loaded");
		if (!scenario) fail(409, "not_confirmed", "Confirm the load before simulating it.");
		const battery = await callPhysics("/battery", JSON.parse(scenario.draft_json));
		await storeBattery(inspection.id, scenario.id, "as_loaded", battery);
		await touch(inspection.id, {
			status: "simulated",
			situations_passed: battery.passed,
			situations_total: battery.total,
			verdict: verdictOf(battery),
		});
		return c.json(battery);
	});

	app.post("/inspections/:id/fix", authenticated, async (c) => {
		const p = c.get("principal");
		const inspection = await writable(c);
		const scenario = await scenarioOf(inspection.id, "as_loaded");
		if (!scenario) fail(409, "not_confirmed", "Confirm the load before fixing it.");
		const plan = await callPhysics("/plan", JSON.parse(scenario.draft_json));
		if (!plan.battery) fail(502, "plan_failed", "The planner did not return a battery.");
		const at = now();
		const fixedId = newId("scn");
		await db.batch([
			db.prepare("DELETE FROM fixes WHERE inspection_id = ?").bind(inspection.id),
			db.prepare("DELETE FROM scenarios WHERE inspection_id = ? AND kind = 'fixed'").bind(inspection.id),
			db
				.prepare("INSERT INTO scenarios (id, inspection_id, kind, draft_json, created_by, created_at) VALUES (?, ?, 'fixed', ?, ?, ?)")
				.bind(fixedId, inspection.id, JSON.stringify(plan.draft), p.userId, at),
			db
				.prepare(
					"INSERT INTO fixes (id, inspection_id, from_scenario_id, to_scenario_id, changes_json, passes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(newId("fix"), inspection.id, scenario.id, fixedId, JSON.stringify(plan.changes), plan.verified ? 1 : 0, at),
		]);
		await storeBattery(inspection.id, fixedId, "fixed", plan.battery);
		await touch(inspection.id, { fixed_verdict: verdictOf(plan.battery) });
		return c.json(plan);
	});

	app.get("/inspections/:id/battery/:kind", authenticated, async (c) => {
		const inspection = await readable(c);
		const kind = c.req.param("kind");
		if (!KINDS.includes(kind as (typeof KINDS)[number])) fail(404, "not_found", "No such battery.");
		const scenario = await scenarioOf(inspection.id, kind as (typeof KINDS)[number]);
		if (!scenario?.battery_ref || !deps.photos) fail(404, "not_found", "No battery stored yet.");
		const object = await deps.photos.get(scenario.battery_ref);
		if (!object) fail(404, "not_found", "No battery stored yet.");
		return c.body(object.bytes as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
	});
}

/** The parts of the physics answers the Worker reads (the rest is passed through as is). */
interface BatteryJson {
	passed: number;
	total: number;
	status: "pass" | "warning" | "fail";
	situations: {
		id: string;
		status: "pass" | "warning" | "fail";
		findings: unknown[];
		margins: unknown;
		event: unknown;
		trip: unknown;
		severity: number;
		scenario_hash: string;
	}[];
	contran_945: { status: string }[];
}
interface PlanJson {
	draft: unknown;
	changes: unknown[];
	verified: boolean;
	battery: BatteryJson | null;
}

/** "pass" only when every situation passes and no CONTRAN 945 rule is broken. */
export function verdictOf(battery: Pick<BatteryJson, "passed" | "total" | "contran_945">): "pass" | "fail" {
	const rules = battery.contran_945.every((check) => check.status !== "fail");
	return battery.passed === battery.total && rules ? "pass" : "fail";
}

/** Cache key of an analysis: the photos' hashes, in any order. */
export async function photoSetHash(hashes: string[]): Promise<string> {
	if (hashes.length === 1) return hashes[0] as string;
	return sha256Hex(new TextEncoder().encode([...hashes].sort().join(",")));
}

interface DraftShape {
	version: 1;
	truck: { body: string; size: string };
	units: { id: string; mass_kg?: number | null }[];
	[key: string]: unknown;
}

/** The shape the Worker relies on; the physics engine checks everything else. */
function checkDraft(value: unknown): DraftShape {
	const draft = value as Partial<DraftShape> | null;
	const ok =
		draft &&
		typeof draft === "object" &&
		draft.version === 1 &&
		typeof draft.truck?.body === "string" &&
		typeof draft.truck?.size === "string" &&
		Array.isArray(draft.units) &&
		draft.units.length > 0 &&
		draft.units.length <= 40 &&
		draft.units.every((u) => typeof u?.id === "string");
	if (!ok) fail(422, "invalid_draft", "Expected a load draft.");
	if (JSON.stringify(draft).length > 64_000) fail(413, "draft_too_large", "The load is too large.");
	return draft as DraftShape;
}

/**
 * Never invent weights: every unit carries a weight the user gave (from the total or one by one),
 * and together they add up to the cargo weight. A unit without one would otherwise be simulated
 * with a made-up "usual" mass.
 */
export function checkWeights(draft: DraftShape, totalKg: number): void {
	if (!Number.isFinite(totalKg) || totalKg <= 0 || totalKg > 80_000) {
		fail(422, "weight_required", "Enter the cargo weight (from the invoice): a photo cannot show it.");
	}
	const masses = draft.units.map((u) => u.mass_kg);
	if (masses.some((m) => typeof m !== "number" || !Number.isFinite(m) || m <= 0)) {
		fail(422, "unit_weight_required", "Every unit needs a weight. Split the total or enter each one.");
	}
	const sum = (masses as number[]).reduce((a, b) => a + b, 0);
	if (Math.abs(sum - totalKg) > Math.max(1, totalKg * WEIGHT_TOLERANCE)) {
		fail(422, "weights_do_not_add_up", "The units' weights must add up to the cargo weight.");
	}
}

async function recordUsage(
	db: Db,
	p: Principal,
	call: { model: string; inputTokens: number; outputTokens: number; costUsd: number; cached: boolean },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO usage (id, user_id, org_id, kind, model, input_tokens, output_tokens, cost_usd, cached, is_demo, created_at)
			 VALUES (?, ?, ?, 'photo_analysis', ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(newId("use"), p.userId, p.orgId, call.model, call.inputTokens, call.outputTokens, call.costUsd, call.cached ? 1 : 0, p.isDemo ? 1 : 0, now())
		.run();
}

function round(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}
