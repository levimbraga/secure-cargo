/**
 * The manager's dashboard, the certificate and real organizations:
 *
 *   GET    /org/overview?days=          numbers for the period, failures, drivers, weekly trend (org_admin)
 *   GET    /org/alerts                  failed or out of compliance, no proven fix after N hours (org_admin)
 *   PATCH  /org/policies                require 2 photos, no certificate when out of compliance, N (org_admin)
 *   GET    /inspections/export.csv?…    the table's rows as CSV, same filters as GET /inspections
 *   GET    /inspections/:id/audit       the audit trail and the AI reading vs the confirmed load
 *   POST   /inspections/:id/certificate issue (or return) the certificate of an eligible inspection
 *   GET    /certificates/:id            a certificate, for whoever may read its inspection
 *   GET    /verify/:id                  public: is it authentic, and a minimal summary
 *   POST   /orgs                        a signed-in user without an organization creates one
 *
 * Authorization as everywhere (`authz.ts`): another organization's records answer 404.
 * Demo accounts read everything of the demo organization but change no policy and create no
 * organization (as they send no invitation).
 */
import type { Context, Hono, MiddlewareHandler } from "hono";

import { canManageOrg, canReadInspection, inspectionListFilter, type ListScope, type Principal, sandboxClause } from "./authz";
import {
	CERTIFICATE_ID,
	certificateBody,
	certificateEligibility,
	certificateId,
	canonicalJson,
	contentHash,
	DISCLAIMER,
	type InspectionFacts,
	publicSummary,
	verifyContent,
} from "./certificate";
import { type Db, now } from "./db";
import { diffDrafts, logEvent, readingVsLoad, type DraftChange } from "./events";
import type { SamplePhoto } from "./flow";
import { fail, field, forbidden, jsonBody, notFound } from "./http";
import type { IdentityProvider } from "./identity";
import { brtStart, type CsvRow, filterClauses, parseFilters, toCsv } from "./listing";
import { computeOverview, isAlert, type MetricRow } from "./metrics";
import { backfillSummaries, type BatteryReader, unpackList } from "./summary";

type Env = { Variables: { principal: Principal } };
type Row = { id: string; org_id: string | null; author_id: string };

export interface ManagerDeps {
	db: Db;
	identity: IdentityProvider;
	readBattery: BatteryReader;
	samples: Record<string, SamplePhoto>;
	limitAnonymous(key: string): Promise<boolean>;
}

export interface OrgPolicies {
	require_two_photos: boolean;
	certificate_requires_compliance: boolean;
	alert_after_hours: number;
}

export async function orgPolicies(db: Db, orgId: string | null): Promise<OrgPolicies> {
	const row = orgId
		? await db
				.prepare("SELECT require_two_photos, certificate_requires_compliance, alert_after_hours FROM organizations WHERE id = ?")
				.bind(orgId)
				.first<{ require_two_photos: number; certificate_requires_compliance: number; alert_after_hours: number }>()
		: null;
	return {
		require_two_photos: row?.require_two_photos === 1,
		certificate_requires_compliance: row ? row.certificate_requires_compliance === 1 : true,
		alert_after_hours: row?.alert_after_hours ?? 24,
	};
}

const PROVEN_BY =
	"(SELECT r.id FROM inspections r WHERE r.reinspection_of = i.id AND r.verdict = 'pass' ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1)";

/** How many open alerts an organization has now (the menu badge). Same rule as `metrics.isAlert`. */
export async function alertCount(db: Db, p: Principal, orgId: string, hours: number, at: Date = new Date()): Promise<number> {
	const cutoff = new Date(at.getTime() - hours * 3_600_000).toISOString();
	const sandbox = sandboxClause(p);
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM inspections i
			 WHERE i.org_id = ?${sandbox.sql} AND i.reinspection_of IS NULL AND i.verdict IN ('fail', 'warning') AND i.created_at <= ?
			   AND NOT EXISTS (SELECT 1 FROM inspections r WHERE r.reinspection_of = i.id AND r.verdict = 'pass')`,
		)
		.bind(orgId, ...sandbox.params, cutoff)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

const ORG_TYPES = ["insurer", "carrier"] as const;

export function registerManager(
	app: Hono<Env>,
	deps: ManagerDeps,
	authenticated: MiddlewareHandler<Env>,
	readable: (c: Context<Env>) => Promise<Row>,
): void {
	const { db } = deps;

	function managedOrg(c: Context<Env>): string {
		const p = c.get("principal");
		if (!p.orgId || !canManageOrg(p, p.orgId)) forbidden();
		return p.orgId;
	}

	/** The organization's inspections a manager may see (a demo visitor: seeded and their sandbox). */
	async function orgRows(p: Principal, orgId: string): Promise<(MetricRow & Record<string, unknown>)[]> {
		const sandbox = sandboxClause(p);
		const { results } = await db
			.prepare(
				`SELECT i.id, i.author_id, u.name AS author_name, i.created_at, i.title, i.verdict, i.fixed_verdict,
				   i.reinspection_of, i.failure_codes, i.truck_json, i.truck_size, i.truck_body, i.cargo_weight_kg,
				   i.situations_passed, i.situations_total, ${PROVEN_BY} AS proven_by
				 FROM inspections i JOIN users u ON u.id = i.author_id
				 WHERE i.org_id = ?${sandbox.sql} ORDER BY i.created_at DESC, i.rowid DESC LIMIT 10000`,
			)
			.bind(orgId, ...sandbox.params)
			.all<MetricRow & Record<string, unknown>>();
		return results;
	}

	// ---- overview and alerts --------------------------------------------------------------

	app.get("/org/overview", authenticated, async (c) => {
		const orgId = managedOrg(c);
		const days = Number(c.req.query("days") ?? "30");
		if (!Number.isInteger(days) || days < 1 || days > 366) fail(422, "invalid_filter", "days must be from 1 to 366.");
		// Rows from before the summaries get their failure types now, a few at a time.
		await backfillSummaries(db, deps.readBattery, 25).catch((error: unknown) => console.error("Backfill failed:", error));
		const at = new Date();
		const policies = await orgPolicies(db, orgId);
		const to = at.toISOString();
		const from = new Date(at.getTime() - days * 86_400_000).toISOString();
		const weeksFrom = new Date(at.getTime() - Math.max(days, 56) * 86_400_000).toISOString();
		const overview = computeOverview(await orgRows(c.get("principal"), orgId), { from, to, weeksFrom, at, alertHours: policies.alert_after_hours });
		return c.json({ ...overview, days, policies });
	});

	app.get("/org/alerts", authenticated, async (c) => {
		const orgId = managedOrg(c);
		const at = new Date();
		const policies = await orgPolicies(db, orgId);
		const rows = (await orgRows(c.get("principal"), orgId)).filter((r) => isAlert(r, at, policies.alert_after_hours));
		return c.json({
			alert_after_hours: policies.alert_after_hours,
			alerts: rows
				.map((r) => ({
					id: r.id,
					title: r.title,
					author_id: r.author_id,
					author_name: r.author_name,
					created_at: r.created_at,
					verdict: r.verdict,
					fixed_verdict: r.fixed_verdict,
					truck_json: r.truck_json,
					truck_size: r.truck_size,
					truck_body: r.truck_body,
					failure_codes: unpackList(r.failure_codes),
					hours_open: Math.floor((at.getTime() - Date.parse(r.created_at)) / 3_600_000),
				}))
				.sort((a, b) => b.hours_open - a.hours_open),
		});
	});

	app.patch("/org/policies", authenticated, async (c) => {
		const p = c.get("principal");
		const orgId = managedOrg(c);
		if (p.isDemo) fail(403, "demo_read_only", "Demo accounts cannot change the organization's policies.");
		const body = await jsonBody(c);
		const updates: [string, number][] = [];
		const twoPhotos = field.optionalBoolean(body, "require_two_photos");
		const compliance = field.optionalBoolean(body, "certificate_requires_compliance");
		const hours = field.optionalNumber(body, "alert_after_hours", 1, 720);
		if (twoPhotos !== undefined) updates.push(["require_two_photos", twoPhotos ? 1 : 0]);
		if (compliance !== undefined) updates.push(["certificate_requires_compliance", compliance ? 1 : 0]);
		if (hours !== undefined && hours !== null) {
			if (!Number.isInteger(hours)) fail(422, "invalid_field", "alert_after_hours must be a whole number of hours.");
			updates.push(["alert_after_hours", hours]);
		}
		if (updates.length) {
			await db
				.prepare(`UPDATE organizations SET ${updates.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
				.bind(...updates.map(([, v]) => v), orgId)
				.run();
		}
		return c.json(await orgPolicies(db, orgId));
	});

	// ---- CSV export -----------------------------------------------------------------------

	app.get("/inspections/export.csv", authenticated, async (c) => {
		const p = c.get("principal");
		const scope = (c.req.query("scope") ?? "mine") as ListScope;
		if (!["mine", "org", "all"].includes(scope)) fail(422, "invalid_scope", "scope must be mine, org or all.");
		const auth = inspectionListFilter(p, scope);
		if (!auth) forbidden();
		const filters = parseFilters((k) => c.req.query(k));
		const extra = filterClauses(filters);
		const { results } = await db
			.prepare(
				`SELECT i.id, i.created_at, u.name AS author_name, i.title, i.truck_json, i.truck_size, i.truck_body,
				   i.cargo_types, i.cargo_weight_kg, i.weight_source, i.verdict, i.fixed_verdict, ${PROVEN_BY} AS proven_by,
				   i.situations_passed, i.situations_total, i.failure_codes, i.reinspection_of
				 FROM inspections i JOIN users u ON u.id = i.author_id
				 WHERE ${[auth.where, ...extra.where].join(" AND ")} ORDER BY i.created_at DESC, i.rowid DESC LIMIT 5000`,
			)
			.bind(...auth.params, ...extra.params)
			.all<CsvRow>();
		const day = new Date().toISOString().slice(0, 10);
		return c.body(toCsv(results), 200, {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="securecargo-inspections-${day}.csv"`,
			"Cache-Control": "private, no-store",
		});
	});

	// ---- audit trail ----------------------------------------------------------------------

	app.get("/inspections/:id/audit", authenticated, async (c) => {
		const row = await readable(c);
		const { results: events } = await db
			.prepare(
				`SELECT e.id, e.at, e.kind, e.actor_id, u.name AS actor_name, e.detail_json
				 FROM inspection_events e LEFT JOIN users u ON u.id = e.actor_id
				 WHERE e.inspection_id = ? ORDER BY e.at, e.rowid`,
			)
			.bind(row.id)
			.all<{ id: string; at: string; kind: string; actor_id: string | null; actor_name: string | null; detail_json: string }>();
		const meta = await db
			.prepare("SELECT analysis_id, sample, cargo_weight_kg, weight_source FROM inspections WHERE id = ?")
			.bind(row.id)
			.first<{ analysis_id: string | null; sample: string | null; cargo_weight_kg: number | null; weight_source: string | null }>();
		let analysis: unknown = null;
		let model: string | null = null;
		if (meta?.sample && deps.samples[meta.sample]) {
			analysis = deps.samples[meta.sample]?.analysis ?? null;
			model = "sample";
		} else if (meta?.analysis_id) {
			const stored = await db.prepare("SELECT output_json, model FROM analyses WHERE id = ?").bind(meta.analysis_id).first<{ output_json: string; model: string }>();
			if (stored) {
				analysis = JSON.parse(stored.output_json);
				model = stored.model;
			}
		}
		const scenario = await db
			.prepare("SELECT draft_json FROM scenarios WHERE inspection_id = ? AND kind = 'as_loaded' ORDER BY created_at DESC, rowid DESC LIMIT 1")
			.bind(row.id)
			.first<{ draft_json: string }>();
		const draft = scenario ? JSON.parse(scenario.draft_json) : null;
		// The driver's edits to the AI's reading, as recorded when the load was first confirmed.
		const confirmations = events.filter((e) => e.kind === "load_confirmed");
		const firstEdits = confirmations.length ? ((JSON.parse(confirmations[0]!.detail_json) as { edits?: DraftChange[] }).edits ?? null) : null;
		return c.json({
			events: events.map(({ detail_json, ...e }) => ({ ...e, detail: JSON.parse(detail_json) as unknown })),
			reading: analysis && draft && meta ? { model, rows: readingVsLoad(analysis, draft, meta) } : null,
			edits: firstEdits,
		});
	});

	// ---- certificate ----------------------------------------------------------------------

	async function facts(id: string): Promise<InspectionFacts & { verdict: string | null; proven_by: string | null; reinspection_of: string | null }> {
		const row = await db
			.prepare(
				`SELECT i.id, i.created_at, i.org_id, o.name AS org_name, o.type AS org_type, i.truck_json, i.truck_body, i.truck_size,
				   i.cargo_weight_kg, i.weight_source, i.cargo_types, i.verdict, i.reinspection_of, ${PROVEN_BY} AS proven_by,
				   (SELECT json_array_length(s.draft_json, '$.units') FROM scenarios s WHERE s.inspection_id = i.id AND s.kind = 'as_loaded'
				      ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1) AS units
				 FROM inspections i LEFT JOIN organizations o ON o.id = i.org_id WHERE i.id = ?`,
			)
			.bind(id)
			.first<InspectionFacts & { verdict: string | null; proven_by: string | null; reinspection_of: string | null }>();
		if (!row) notFound();
		return { ...row, units: row.units ?? 0 };
	}

	async function batteryOf(inspectionId: string): Promise<Record<string, unknown> | null> {
		const scenario = await db
			.prepare("SELECT battery_ref FROM scenarios WHERE inspection_id = ? AND kind = 'as_loaded' ORDER BY created_at DESC, rowid DESC LIMIT 1")
			.bind(inspectionId)
			.first<{ battery_ref: string | null }>();
		if (!scenario?.battery_ref) return null;
		return ((await deps.readBattery(scenario.battery_ref)) as Record<string, unknown> | null) ?? null;
	}

	async function firstPhoto(inspectionId: string) {
		return db
			.prepare("SELECT id, position, sha256, r2_key FROM photos WHERE inspection_id = ? ORDER BY created_at, rowid LIMIT 1")
			.bind(inspectionId)
			.first<{ id: string; position: string; sha256: string; r2_key: string }>();
	}

	app.post("/inspections/:id/certificate", authenticated, async (c) => {
		const p = c.get("principal");
		const row = await readable(c);
		const inspection = await facts(row.id);
		const policies = await orgPolicies(db, inspection.org_id);
		const eligibility = certificateEligibility(inspection, policies);
		if (!eligibility.ok) {
			const messages = {
				not_simulated: "Simulate the load first.",
				fails_no_proven_fix: "This load does not arrive intact. Fix it and prove the fix with a new photo first.",
				out_of_compliance: "This load is out of compliance, and the organization issues no certificate for that.",
			};
			fail(409, `certificate_${eligibility.code}`, messages[eligibility.code]);
		}
		// Fixed and proven: the record is the re-inspection's (the proof), pointing to this one.
		const proofId = eligibility.state === "fixed_and_proven" ? inspection.proven_by : null;
		const proof = proofId ? await facts(proofId) : null;
		const battery = await batteryOf(proofId ?? row.id);
		if (!battery) fail(409, "certificate_no_result", "The simulation result is not stored; simulate the load again.");
		const photo = await firstPhoto(proofId ?? row.id);
		const fix = await db.prepare("SELECT changes_json FROM fixes WHERE inspection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(row.id).first<{ changes_json: string }>();
		const body = certificateBody({
			state: eligibility.state,
			inspection: proof ? { ...inspection, cargo_types: proof.cargo_types ?? inspection.cargo_types, units: proof.units || inspection.units } : inspection,
			proof: proof ? { id: proof.id, created_at: proof.created_at } : null,
			battery,
			photo: photo ? { sha256: photo.sha256, position: photo.position } : null,
			fixChanges: eligibility.state === "fixed_and_proven" && fix ? (JSON.parse(fix.changes_json) as { code?: string }[]) : [],
		});
		// The same record again: the certificate already issued, not a new one.
		const { results: existing } = await db
			.prepare("SELECT id, content_json FROM certificates WHERE inspection_id = ? AND revoked_at IS NULL ORDER BY issued_at DESC, rowid DESC")
			.bind(row.id)
			.all<{ id: string; content_json: string }>();
		const same = existing.find((cert) => {
			const { certificate_id: _id, issued_at: _at, ...rest } = JSON.parse(cert.content_json) as Record<string, unknown>;
			return canonicalJson(rest) === canonicalJson(body);
		});
		if (same) return c.json(await loadCertificate(same.id), 200);
		const id = certificateId();
		const issuedAt = now();
		const content = { certificate_id: id, issued_at: issuedAt, ...body };
		const hash = await contentHash(content);
		await db.batch([
			db.prepare("UPDATE certificates SET revoked_at = ? WHERE inspection_id = ? AND revoked_at IS NULL").bind(issuedAt, row.id),
			db
				.prepare(
					"INSERT INTO certificates (id, inspection_id, org_id, issued_by, issued_at, content_json, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(id, row.id, inspection.org_id, p.userId, issuedAt, canonicalJson(content), hash),
		]);
		await logEvent(db, row.id, p.userId, "certificate_issued", { certificate_id: id, hash });
		return c.json(await loadCertificate(id), 201);
	});

	async function loadCertificate(id: string) {
		const cert = await db
			.prepare(
				`SELECT c.id, c.inspection_id, c.issued_at, c.content_json, c.content_hash, c.revoked_at, u.name AS issued_by_name
				 FROM certificates c JOIN users u ON u.id = c.issued_by WHERE c.id = ?`,
			)
			.bind(id)
			.first<{ id: string; inspection_id: string; issued_at: string; content_json: string; content_hash: string; revoked_at: string | null; issued_by_name: string | null }>();
		if (!cert) notFound();
		const content = JSON.parse(cert.content_json) as Record<string, unknown>;
		const photoOf = (content.proof_inspection_id as string | null) ?? cert.inspection_id;
		const photo = await firstPhoto(photoOf);
		const { content_json, ...rest } = cert;
		return {
			...rest,
			content,
			authentic: await verifyContent(content_json, cert.content_hash),
			disclaimer: DISCLAIMER,
			photo: photo
				? { inspection_id: photoOf, photo_id: photo.id, path: photo.r2_key.startsWith("sample:") ? photo.r2_key.slice(7) : null }
				: null,
		};
	}

	app.get("/certificates/:id", authenticated, async (c) => {
		const id = c.req.param("id");
		if (!CERTIFICATE_ID.test(id)) notFound();
		const owner = await db
			.prepare("SELECT i.id, i.org_id, i.author_id, i.seeded, i.sandbox_id FROM certificates c JOIN inspections i ON i.id = c.inspection_id WHERE c.id = ?")
			.bind(id)
			.first<Row>();
		if (!owner || !canReadInspection(c.get("principal"), owner)) notFound();
		return c.json(await loadCertificate(id));
	});

	app.get("/inspections/:id/certificate", authenticated, async (c) => {
		const row = await readable(c);
		const latest = await db
			.prepare("SELECT id FROM certificates WHERE inspection_id = ? AND revoked_at IS NULL ORDER BY issued_at DESC, rowid DESC LIMIT 1")
			.bind(row.id)
			.first<{ id: string }>();
		const inspection = await facts(row.id);
		const eligibility = certificateEligibility(inspection, await orgPolicies(db, inspection.org_id));
		return c.json({ certificate_id: latest?.id ?? null, eligibility });
	});

	app.get("/verify/:id", async (c) => {
		const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
		if (!(await deps.limitAnonymous(`verify:${ip}`))) fail(429, "rate_limited", "Too many requests. Try again in a minute.");
		const id = c.req.param("id").toUpperCase();
		if (!CERTIFICATE_ID.test(id)) notFound();
		const cert = await db
			.prepare("SELECT id, issued_at, content_json, content_hash, revoked_at FROM certificates WHERE id = ?")
			.bind(id)
			.first<{ id: string; issued_at: string; content_json: string; content_hash: string; revoked_at: string | null }>();
		if (!cert) notFound();
		const authentic = await verifyContent(cert.content_json, cert.content_hash);
		return c.json(
			{
				id: cert.id,
				issued_at: cert.issued_at,
				content_hash: cert.content_hash,
				authentic,
				revoked_at: cert.revoked_at,
				valid: authentic && cert.revoked_at === null,
				summary: authentic ? publicSummary(JSON.parse(cert.content_json) as Record<string, unknown>) : null,
				disclaimer: DISCLAIMER,
			},
			200,
			{ "Cache-Control": "no-store" },
		);
	});

	// ---- real organizations ---------------------------------------------------------------

	app.post("/orgs", authenticated, async (c) => {
		const p = c.get("principal");
		if (p.isDemo) fail(403, "demo_read_only", "Demo accounts cannot create organizations.");
		if (p.orgId) fail(409, "already_in_org", "You already belong to an organization.");
		if (!(await deps.limitAnonymous(`orgs:${p.userId}`))) fail(429, "rate_limited", "Too many requests. Try again in a minute.");
		const body = await jsonBody(c);
		const name = field.optionalString(body, "name", 80)?.trim();
		if (!name || name.length < 2) fail(422, "invalid_name", "Enter the organization's name.");
		const type = field.optionalEnum(body, "type", ORG_TYPES);
		if (!type) fail(422, "invalid_type", "type must be insurer or carrier.");
		const org = await deps.identity.createOrganization({ name, type, createdBy: p.userId });
		const at = now();
		await db.batch([
			db.prepare("INSERT INTO organizations (id, name, type, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING").bind(org.id, org.name, org.type, at),
			db
				.prepare(
					`INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, 'org_admin', ?)
					 ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'org_admin'`,
				)
				.bind(p.userId, org.id, at),
		]);
		return c.json(org, 201);
	});
}

/** For the flow: the driver's edits to the AI's reading, kept with the "load confirmed" event. */
export function confirmationDetail(prefill: unknown, previous: unknown, draft: unknown): Record<string, unknown> {
	const units = ((draft as { units?: unknown[] } | null)?.units ?? []).length;
	return {
		units,
		...(prefill ? { edits: diffDrafts(prefill, draft) } : {}),
		...(previous ? { changes: diffDrafts(previous, draft) } : {}),
	};
}

export { brtStart };
