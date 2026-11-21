/**
 * The application API served by the Worker itself (no container involved):
 *
 *   GET    /me                     who am I, my organization and role, my analysis allowance
 *   GET    /inspections?scope=     mine | org (org_admin) | all (platform admin)
 *   POST   /inspections            create an inspection in my active organization
 *   GET    /inspections/:id        one inspection with its photos, scenarios, results, fixes
 *   PATCH  /inspections/:id        change an inspection (author only)
 *   GET    /share/:token           the public summary of a shared inspection (no sign-in)
 *   GET    /trucks ...             "My trucks" (trucks.ts)
 *   GET    /org                    my organization: members, pending invitations (org_admin)
 *   POST   /org/invitations        invite a member (org_admin)
 *   GET    /admin/overview         usage vs the monthly cap, settings (platform admin)
 *   GET    /admin/users            per-user usage and quotas (platform admin)
 *   PATCH  /admin/users/:id        block, daily quota (platform admin)
 *   PATCH  /admin/orgs/:id         daily quota (platform admin)
 *   PATCH  /admin/settings         kill switch, monthly cap, default quotas (platform admin)
 *   POST   /demo/session           a one-time sign-in ticket for the demo driver or insurer
 *
 * Every route that reads or writes a record asks `authz.ts`. Records of another organization
 * answer 404, never 403, so their ids do not leak.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import {
	canManageOrg,
	canReadInspection,
	canWriteInspection,
	inspectionListFilter,
	type ListScope,
	type Principal,
} from "./authz";
import { type Db, newId, now, periodStarts } from "./db";
import { type FlowDeps, registerFlow } from "./flow";
import { ApiError, fail, field, forbidden, jsonBody, notFound } from "./http";
import type { IdentityProvider } from "./identity";
import { resolvePrincipal } from "./principal";
import { registerTrucks } from "./trucks";
import { analysisAllowance, monthSpendUsd, readSettings } from "./quota";

export interface AppDeps extends FlowDeps {
	db: Db;
	identity: IdentityProvider;
	platformAdminEmails: readonly string[];
	corsOrigins: readonly string[];
	/** Site origin, for invitation links. */
	siteUrl: string;
	/** Rate limit for anonymous endpoints; resolves false when the caller is over the limit. */
	limitAnonymous(key: string): Promise<boolean>;
}

type Env = { Variables: { principal: Principal } };

export const APP_ROUTE_PREFIXES = ["/me", "/inspections", "/org", "/admin", "/demo", "/trucks", "/share"] as const;

export function isAppRoute(pathname: string): boolean {
	return APP_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const BODIES = ["flatbed", "box", "curtain_sider"] as const;
const SIZES = ["vuc", "toco", "truck", "semi"] as const;
const STATUSES = ["draft", "analyzed", "confirmed", "simulated"] as const;
const ROLES = ["member", "org_admin"] as const;
const DEMO_ROLES = ["driver", "insurer"] as const;
type DemoRole = (typeof DEMO_ROLES)[number];
/** Pre-minted demo tickets: how many per account, how long each is valid, and the margin kept. */
const DEMO_POOL_SIZE = 3;
const DEMO_TICKET_TTL_S = 24 * 60 * 60;
const DEMO_TICKET_MARGIN_MS = 10 * 60 * 1000;

const INSPECTION_COLUMNS = `i.id, i.org_id, i.author_id, i.created_at, i.updated_at, i.status, i.title,
	i.truck_body, i.truck_size, i.cargo_weight_kg, i.notes, i.plate, i.situations_passed,
	i.situations_total, i.verdict, i.fixed_verdict, i.sample, i.truck_json, i.weight_source, i.weight_range_json,
	i.invoice_json, i.reinspection_of, i.share_token, u.name AS author_name, o.name AS org_name,
	(SELECT r.id FROM inspections r WHERE r.reinspection_of = i.id AND r.verdict = 'pass' ORDER BY r.created_at DESC LIMIT 1) AS proven_by,
	(SELECT p.r2_key FROM photos p WHERE p.inspection_id = i.id ORDER BY p.created_at LIMIT 1) AS cover_photo,
	(SELECT p.id FROM photos p WHERE p.inspection_id = i.id ORDER BY p.created_at LIMIT 1) AS cover_photo_id`;

interface InspectionRow {
	id: string;
	org_id: string | null;
	author_id: string;
	[key: string]: unknown;
}

export function createApp(deps: AppDeps): Hono<Env> {
	const { db, identity } = deps;
	const app = new Hono<Env>();

	app.use(
		"*",
		cors({
			origin: (origin) => (deps.corsOrigins.includes(origin) ? origin : null),
			allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["Authorization", "Content-Type"],
			maxAge: 600,
		}),
	);

	app.onError((error, c) => {
		// c.json keeps the CORS headers the middleware already set on the context.
		if (error instanceof ApiError) {
			return c.json({ detail: { code: error.code, message: error.message } }, error.status);
		}
		console.error("Unhandled API error:", error);
		return c.json({ detail: { code: "internal_error", message: "Something went wrong." } }, 500);
	});

	const authenticated: MiddlewareHandler<Env> = async (c, next) => {
		const header = c.req.header("Authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
		if (!token) fail(401, "unauthenticated", "Sign in first.");
		const claims = await identity.verify(token);
		if (!claims) fail(401, "unauthenticated", "Your session expired. Sign in again.");
		const principal = await resolvePrincipal(db, identity, claims, deps.platformAdminEmails);
		c.set("principal", principal);
		// A blocked user may still read /me (to see that they are blocked), nothing else.
		if (principal.blocked && !principal.isPlatformAdmin && c.req.path !== "/me") {
			fail(403, "blocked", "This account is blocked. Contact the platform admin.");
		}
		await next();
	};

	const platformAdminOnly: MiddlewareHandler<Env> = async (c, next) => {
		if (!c.get("principal").isPlatformAdmin) notFound();
		await next();
	};

	// ---- me ---------------------------------------------------------------------------------

	app.get("/me", authenticated, async (c) => {
		const p = c.get("principal");
		const [user, org, analysis] = await Promise.all([
			db
				.prepare("SELECT id, email, name, is_demo FROM users WHERE id = ?")
				.bind(p.userId)
				.first<{ id: string; email: string | null; name: string | null; is_demo: number }>(),
			p.orgId
				? db
						.prepare("SELECT id, name, type, is_demo FROM organizations WHERE id = ?")
						.bind(p.orgId)
						.first<{ id: string; name: string; type: string; is_demo: number }>()
				: Promise.resolve(null),
			analysisAllowance(db, p),
		]);
		return c.json({
			user: { id: p.userId, email: user?.email ?? null, name: user?.name ?? null, is_demo: p.isDemo },
			org: org ? { id: org.id, name: org.name, type: org.type, role: p.orgRole, is_demo: org.is_demo === 1 } : null,
			is_platform_admin: p.isPlatformAdmin,
			blocked: p.blocked,
			analysis,
		});
	});

	// ---- inspections ------------------------------------------------------------------------

	app.get("/inspections", authenticated, async (c) => {
		const p = c.get("principal");
		const scope = (c.req.query("scope") ?? "mine") as ListScope;
		if (!["mine", "org", "all"].includes(scope)) fail(422, "invalid_scope", "scope must be mine, org or all.");
		const filter = inspectionListFilter(p, scope);
		if (!filter) forbidden();
		const { results } = await db
			.prepare(
				`SELECT ${INSPECTION_COLUMNS} FROM inspections i
				 JOIN users u ON u.id = i.author_id LEFT JOIN organizations o ON o.id = i.org_id
				 WHERE ${filter.where} ORDER BY i.created_at DESC LIMIT 200`,
			)
			.bind(...filter.params)
			.all<InspectionRow>();
		return c.json({ scope, inspections: results });
	});

	app.post("/inspections", authenticated, async (c) => {
		const p = c.get("principal");
		const body = await jsonBody(c);
		const at = now();
		const id = newId("insp");
		const sampleId = field.optionalString(body, "sample", 40);
		const sample = sampleId ? deps.samples[sampleId] : undefined;
		if (sampleId && !sample) fail(422, "unknown_sample", "No such sample photo.");
		// "I fixed it: take a new photo": only the author of an inspection re-inspects it.
		const parentId = field.optionalString(body, "reinspection_of", 60);
		if (parentId) {
			const parent = await db.prepare("SELECT id, org_id, author_id FROM inspections WHERE id = ?").bind(parentId).first<InspectionRow>();
			if (!parent || !canReadInspection(p, parent)) notFound();
			if (!canWriteInspection(p, parent)) forbidden();
		}
		await db
			.prepare(
				`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, status, title,
				 truck_body, truck_size, cargo_weight_kg, notes, plate, sample, reinspection_of)
				 VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				p.orgId,
				p.userId,
				at,
				at,
				field.optionalString(body, "title", 120) ?? "",
				field.optionalEnum(body, "truck_body", BODIES) ?? null,
				field.optionalEnum(body, "truck_size", SIZES) ?? null,
				field.optionalNumber(body, "cargo_weight_kg", 1, 80_000) ?? null,
				field.optionalString(body, "notes", 2000) ?? "",
				field.optionalString(body, "plate", 10) ?? null,
				sample?.id ?? null,
				parentId ?? null,
			)
			.run();
		// A sample inspection starts with the sample's photos (public files on the site).
		if (sample) {
			await db.batch(
				sample.photos.map((photo, n) =>
					db
						.prepare(
							`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
							 VALUES (?, ?, ?, ?, ?, 'image/jpeg', 0, 1, ?)`,
						)
						.bind(`${id}_p${n + 1}`, id, photo.position, `sample:${photo.path}`, photo.sha256, at),
				),
			);
		}
		return c.json(await loadInspection(db, id), 201);
	});

	app.get("/inspections/:id", authenticated, async (c) => {
		const inspection = await readableInspection(c);
		return c.json(await loadInspection(db, inspection.id));
	});

	app.patch("/inspections/:id", authenticated, async (c) => {
		const p = c.get("principal");
		const inspection = await readableInspection(c);
		if (!canWriteInspection(p, inspection)) forbidden();
		const body = await jsonBody(c);
		const updates: [string, unknown][] = [];
		const set = (column: string, value: unknown) => {
			if (value !== undefined) updates.push([column, value]);
		};
		set("title", field.optionalString(body, "title", 120));
		set("status", field.optionalEnum(body, "status", STATUSES));
		set("truck_body", field.optionalEnum(body, "truck_body", BODIES));
		set("truck_size", field.optionalEnum(body, "truck_size", SIZES));
		set("cargo_weight_kg", field.optionalNumber(body, "cargo_weight_kg", 1, 80_000));
		set("notes", field.optionalString(body, "notes", 2000));
		set("plate", field.optionalString(body, "plate", 10));
		if (updates.length > 0) {
			updates.push(["updated_at", now()]);
			await db
				.prepare(`UPDATE inspections SET ${updates.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
				.bind(...updates.map(([, v]) => v), inspection.id)
				.run();
		}
		return c.json(await loadInspection(db, inspection.id));
	});

	async function readableInspection(c: Context<Env>): Promise<InspectionRow> {
		const row = await db
			.prepare("SELECT id, org_id, author_id FROM inspections WHERE id = ?")
			.bind(c.req.param("id"))
			.first<InspectionRow>();
		if (!row || !canReadInspection(c.get("principal"), row)) notFound();
		return row;
	}

	registerFlow(app, deps, authenticated, readableInspection);
	registerTrucks(app, db, authenticated);

	// ---- public summary ---------------------------------------------------------------------

	app.get("/share/:token", async (c) => {
		const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
		if (!(await deps.limitAnonymous(`share:${ip}`))) fail(429, "rate_limited", "Too many requests. Try again in a minute.");
		const token = c.req.param("token");
		if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
		const row = await db
			.prepare(
				`SELECT i.id, i.title, i.created_at, i.verdict, i.fixed_verdict, i.situations_passed, i.situations_total,
				 i.truck_json, i.truck_body, i.truck_size, i.cargo_weight_kg, i.weight_source, i.sample,
				 u.name AS author_name, o.name AS org_name, o.share_driver_name,
				 (SELECT r.id FROM inspections r WHERE r.reinspection_of = i.id AND r.verdict = 'pass' LIMIT 1) AS proven_by
				 FROM inspections i JOIN users u ON u.id = i.author_id LEFT JOIN organizations o ON o.id = i.org_id
				 WHERE i.share_token = ?`,
			)
			.bind(token)
			.first<Record<string, unknown> & { id: string; share_driver_name: number | null; author_name: string | null }>();
		if (!row) notFound();
		const photo = await db
			.prepare("SELECT r2_key FROM photos WHERE inspection_id = ? ORDER BY created_at LIMIT 1")
			.bind(row.id)
			.first<{ r2_key: string }>();
		const scenario = await db
			.prepare("SELECT battery_ref FROM scenarios WHERE inspection_id = ? AND kind = 'as_loaded' ORDER BY created_at DESC LIMIT 1")
			.bind(row.id)
			.first<{ battery_ref: string | null }>();
		let checks: unknown = null;
		if (scenario?.battery_ref && deps.photos) {
			const object = await deps.photos.get(scenario.battery_ref);
			if (object) {
				const battery = JSON.parse(new TextDecoder().decode(object.bytes)) as Record<string, unknown>;
				checks = {
					situations: (battery.situations as { id: string; status: string; findings: unknown[] }[] | undefined)?.map((s) => ({
						id: s.id,
						status: s.status,
						findings: s.findings,
					})),
					contran_945: battery.contran_945,
					checklist: battery.checklist ?? null,
					axle_loads: battery.axle_loads,
				};
			}
		}
		const { share_driver_name, author_name, id, ...rest } = row;
		return c.json(
			{
				...rest,
				driver_name: share_driver_name === 1 ? author_name : null,
				photo: photo ? (photo.r2_key.startsWith("sample:") ? { path: photo.r2_key.slice(7) } : { path: `/share/${token}/photo` }) : null,
				checks,
			},
			200,
			{ "Cache-Control": "no-store" },
		);
	});

	app.get("/share/:token/photo", async (c) => {
		const token = c.req.param("token");
		if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !deps.photos) notFound();
		const photo = await db
			.prepare(
				`SELECT p.r2_key, p.content_type FROM photos p JOIN inspections i ON i.id = p.inspection_id
				 WHERE i.share_token = ? ORDER BY p.created_at LIMIT 1`,
			)
			.bind(token)
			.first<{ r2_key: string; content_type: string }>();
		if (!photo || photo.r2_key.startsWith("sample:")) notFound();
		const object = await deps.photos.get(photo.r2_key);
		if (!object) notFound();
		return c.body(object.bytes as Uint8Array<ArrayBuffer>, 200, { "Content-Type": object.contentType, "Cache-Control": "private, max-age=600" });
	});

	// ---- organization -----------------------------------------------------------------------

	app.get("/org", authenticated, async (c) => {
		const p = c.get("principal");
		if (!p.orgId || !canManageOrg(p, p.orgId)) forbidden();
		const org = await db.prepare("SELECT id, name, type, is_demo FROM organizations WHERE id = ?").bind(p.orgId).first();
		const counts = await db
			.prepare(
				`SELECT author_id, COUNT(*) AS inspections, MAX(created_at) AS last_inspection_at
				 FROM inspections WHERE org_id = ? GROUP BY author_id`,
			)
			.bind(p.orgId)
			.all<{ author_id: string; inspections: number; last_inspection_at: string }>();
		const byAuthor = new Map(counts.results.map((r) => [r.author_id, r]));
		const members = await membersOf(p.orgId);
		const invitations = await identity.listInvitations(p.orgId).catch(() => []);
		return c.json({
			org,
			members: members.map((m) => ({
				...m,
				inspections: byAuthor.get(m.userId)?.inspections ?? 0,
				last_inspection_at: byAuthor.get(m.userId)?.last_inspection_at ?? null,
			})),
			invitations,
		});
	});

	/** Members from Clerk; the D1 mirror answers when Clerk is unreachable. */
	async function membersOf(orgId: string) {
		try {
			return await identity.listMembers(orgId);
		} catch {
			const { results } = await db
				.prepare(
					`SELECT m.user_id AS userId, u.name, u.email, m.role, m.created_at AS joinedAt
					 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.name`,
				)
				.bind(orgId)
				.all<{ userId: string; name: string | null; email: string | null; role: "member" | "org_admin"; joinedAt: string }>();
			return results;
		}
	}

	app.post("/org/invitations", authenticated, async (c) => {
		const p = c.get("principal");
		if (!p.orgId || !canManageOrg(p, p.orgId)) forbidden();
		if (p.isDemo) fail(403, "demo_read_only", "Demo accounts cannot send invitations.");
		const body = await jsonBody(c);
		const email = field.optionalString(body, "email", 254)?.trim().toLowerCase();
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, "invalid_email", "Enter a valid email.");
		const role = field.optionalEnum(body, "role", ROLES) ?? "member";
		const invitation = await identity.invite({
			orgId: p.orgId,
			email,
			role,
			inviterUserId: p.userId,
			redirectUrl: `${deps.siteUrl}/app/sign-up`,
		});
		return c.json(invitation, 201);
	});

	// ---- platform admin ---------------------------------------------------------------------

	app.get("/admin/overview", authenticated, platformAdminOnly, async (c) => {
		const settings = await readSettings(db);
		const spend = await monthSpendUsd(db);
		const { day, month } = periodStarts();
		const totals = await db
			.prepare(
				`SELECT
				   (SELECT COUNT(*) FROM users) AS users,
				   (SELECT COUNT(*) FROM organizations) AS organizations,
				   (SELECT COUNT(*) FROM inspections) AS inspections,
				   (SELECT COUNT(*) FROM usage WHERE created_at >= ? AND cached = 0) AS analyses_month,
				   (SELECT COUNT(*) FROM usage WHERE created_at >= ? AND cached = 1) AS cached_month,
				   (SELECT COUNT(*) FROM usage WHERE created_at >= ? AND cached = 0) AS analyses_today`,
			)
			.bind(month, month, day)
			.first();
		const { results: daily } = await db
			.prepare(
				`SELECT substr(created_at, 1, 10) AS date, ROUND(SUM(cost_usd), 4) AS cost_usd, COUNT(*) AS calls
				 FROM usage WHERE created_at >= ? GROUP BY date ORDER BY date`,
			)
			.bind(month)
			.all();
		const { results: orgs } = await db
			.prepare(
				`SELECT o.id, o.name, o.type, o.is_demo, o.daily_analysis_quota,
				   (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
				   (SELECT COUNT(*) FROM inspections i WHERE i.org_id = o.id) AS inspections,
				   (SELECT ROUND(COALESCE(SUM(cost_usd), 0), 4) FROM usage g WHERE g.org_id = o.id AND g.created_at >= ?) AS month_cost_usd
				 FROM organizations o ORDER BY o.name`,
			)
			.bind(month)
			.all();
		return c.json({
			month_start: month,
			month_spend_usd: Math.round(spend * 10000) / 10000,
			settings: {
				kill_switch: settings.killSwitch,
				monthly_cap_usd: settings.monthlyCapUsd,
				default_daily_quota: settings.defaultDailyQuota,
				demo_shared_daily_quota: settings.demoSharedDailyQuota,
			},
			totals,
			daily,
			organizations: orgs,
		});
	});

	app.get("/admin/users", authenticated, platformAdminOnly, async (c) => {
		const { day, month } = periodStarts();
		const { results } = await db
			.prepare(
				`SELECT u.id, u.email, u.name, u.is_demo, u.blocked, u.daily_analysis_quota, u.last_seen_at,
				   (SELECT GROUP_CONCAT(o.name, ', ') FROM memberships m JOIN organizations o ON o.id = m.org_id
				      WHERE m.user_id = u.id) AS organizations,
				   (SELECT COUNT(*) FROM inspections i WHERE i.author_id = u.id) AS inspections,
				   (SELECT COUNT(*) FROM usage g WHERE g.user_id = u.id AND g.cached = 0 AND g.created_at >= ?) AS analyses_today,
				   (SELECT COUNT(*) FROM usage g WHERE g.user_id = u.id AND g.cached = 0 AND g.created_at >= ?) AS analyses_month,
				   (SELECT ROUND(COALESCE(SUM(g.cost_usd), 0), 4) FROM usage g WHERE g.user_id = u.id AND g.created_at >= ?) AS month_cost_usd
				 FROM users u ORDER BY month_cost_usd DESC, u.last_seen_at DESC LIMIT 500`,
			)
			.bind(day, month, month)
			.all();
		return c.json({ users: results });
	});

	app.patch("/admin/users/:id", authenticated, platformAdminOnly, async (c) => {
		const body = await jsonBody(c);
		const blocked = field.optionalBoolean(body, "blocked");
		const quota = field.optionalNumber(body, "daily_analysis_quota", 0, 1000);
		const id = c.req.param("id");
		const exists = await db.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
		if (!exists) notFound();
		if (blocked !== undefined) {
			await db.prepare("UPDATE users SET blocked = ? WHERE id = ?").bind(blocked ? 1 : 0, id).run();
		}
		if (quota !== undefined) {
			await db.prepare("UPDATE users SET daily_analysis_quota = ? WHERE id = ?").bind(quota, id).run();
		}
		return c.json(await db.prepare("SELECT id, email, name, blocked, daily_analysis_quota FROM users WHERE id = ?").bind(id).first());
	});

	app.patch("/admin/orgs/:id", authenticated, platformAdminOnly, async (c) => {
		const body = await jsonBody(c);
		const quota = field.optionalNumber(body, "daily_analysis_quota", 0, 1000);
		const id = c.req.param("id");
		const exists = await db.prepare("SELECT id FROM organizations WHERE id = ?").bind(id).first();
		if (!exists) notFound();
		if (quota !== undefined) {
			await db.prepare("UPDATE organizations SET daily_analysis_quota = ? WHERE id = ?").bind(quota, id).run();
		}
		return c.json(await db.prepare("SELECT id, name, daily_analysis_quota FROM organizations WHERE id = ?").bind(id).first());
	});

	app.patch("/admin/settings", authenticated, platformAdminOnly, async (c) => {
		const body = await jsonBody(c);
		const values: [string, string | undefined][] = [
			["kill_switch", field.optionalBoolean(body, "kill_switch")?.toString()],
			["monthly_cap_usd", field.optionalNumber(body, "monthly_cap_usd", 0, 100)?.toString()],
			["default_daily_quota", field.optionalNumber(body, "default_daily_quota", 0, 1000)?.toString()],
			["demo_shared_daily_quota", field.optionalNumber(body, "demo_shared_daily_quota", 0, 1000)?.toString()],
		];
		const at = now();
		const statements = values
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.map(([key, value]) =>
				db
					.prepare(
						"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
					)
					.bind(key, value, at),
			);
		if (statements.length > 0) await db.batch(statements);
		const settings = await readSettings(db);
		return c.json({
			kill_switch: settings.killSwitch,
			monthly_cap_usd: settings.monthlyCapUsd,
			default_daily_quota: settings.defaultDailyQuota,
			demo_shared_daily_quota: settings.demoSharedDailyQuota,
		});
	});

	// ---- demo access ------------------------------------------------------------------------

	app.post("/demo/session", async (c) => {
		const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
		if (!(await deps.limitAnonymous(`demo:${ip}`))) {
			fail(429, "rate_limited", "Too many requests. Wait a minute and try again.");
		}
		const body = await jsonBody(c);
		const as = field.optionalEnum(body, "as", DEMO_ROLES);
		if (!as) fail(422, "invalid_field", "as must be driver or insurer.");
		const account = await demoAccount(as);
		// A ticket minted ahead of time answers at once; Clerk is asked only when the pool is empty.
		const pooled = await takeDemoTicket(db, as);
		const ticket = pooled ?? (await identity.createSignInTicket(account.userId, account.orgId, DEMO_TICKET_TTL_S));
		inBackground(c, refillDemoTickets(db, identity, as, account));
		return c.json({ ticket });
	});

	async function demoAccount(as: DemoRole): Promise<{ userId: string; orgId: string | null }> {
		const { results } = await db
			.prepare("SELECT key, value FROM settings WHERE key IN ('demo_driver_user_id', 'demo_insurer_user_id', 'demo_org_id')")
			.all<{ key: string; value: string }>();
		const settings = new Map(results.map((r) => [r.key, r.value]));
		const userId = settings.get(as === "driver" ? "demo_driver_user_id" : "demo_insurer_user_id");
		if (!userId) fail(503, "demo_unavailable", "The demo accounts are not set up yet.");
		return { userId, orgId: settings.get("demo_org_id") ?? null };
	}

	app.notFound((c) => c.json({ detail: { code: "not_found", message: "No such route." } }, 404));

	return app;
}

async function loadInspection(db: Db, id: string) {
	const inspection = await db
		.prepare(
			`SELECT ${INSPECTION_COLUMNS} FROM inspections i
			 JOIN users u ON u.id = i.author_id LEFT JOIN organizations o ON o.id = i.org_id WHERE i.id = ?`,
		)
		.bind(id)
		.first<Record<string, unknown>>();
	const [photos, scenarios, results, fixes] = await Promise.all([
		db
			.prepare("SELECT id, position, r2_key, sha256, content_type, bytes, created_at FROM photos WHERE inspection_id = ? ORDER BY created_at")
			.bind(id)
			.all(),
		db.prepare("SELECT id, kind, draft_json, battery_ref, created_by, created_at FROM scenarios WHERE inspection_id = ? ORDER BY created_at").bind(id).all<{ draft_json: string }>(),
		db.prepare("SELECT id, scenario_id, situation, verdict, metrics_json, keyframes_ref, created_at FROM results WHERE inspection_id = ? ORDER BY created_at").bind(id).all<{ metrics_json: string }>(),
		db.prepare("SELECT id, from_scenario_id, to_scenario_id, changes_json, passes, created_at FROM fixes WHERE inspection_id = ? ORDER BY created_at").bind(id).all<{ changes_json: string; passes: number }>(),
	]);
	const reinspections = await db
		.prepare("SELECT id, created_at, verdict, situations_passed, situations_total FROM inspections WHERE reinspection_of = ? ORDER BY created_at")
		.bind(id)
		.all();
	return {
		...inspection,
		reinspections: reinspections.results,
		photos: photos.results,
		scenarios: scenarios.results.map(({ draft_json, ...rest }) => ({ ...rest, draft: JSON.parse(draft_json) })),
		results: results.results.map(({ metrics_json, ...rest }) => ({ ...rest, metrics: JSON.parse(metrics_json) })),
		fixes: fixes.results.map(({ changes_json, passes, ...rest }) => ({ ...rest, passes: passes === 1, changes: JSON.parse(changes_json) })),
	};
}

/** Run `task` after the response (Workers `waitUntil`); without an execution context, just start it. */
function inBackground(c: Context, task: Promise<unknown>): void {
	const guarded = task.catch((error: unknown) => console.error("Background task failed:", error));
	try {
		c.executionCtx.waitUntil(guarded);
	} catch {
		// Tests: no execution context; the task still runs.
	}
}

/** Hand out one pre-minted ticket (each one only once), or null when none is left. */
export async function takeDemoTicket(db: Db, role: DemoRole, at: Date = new Date()): Promise<string | null> {
	const validUntil = new Date(at.getTime() + DEMO_TICKET_MARGIN_MS).toISOString();
	const row = await db
		.prepare(
			`DELETE FROM demo_tickets WHERE id = (
			   SELECT id FROM demo_tickets WHERE role = ? AND expires_at > ? ORDER BY expires_at LIMIT 1
			 ) RETURNING token`,
		)
		.bind(role, validUntil)
		.first<{ token: string }>();
	return row?.token ?? null;
}

/** Top the pool up to `DEMO_POOL_SIZE` valid tickets, and drop the expired ones. */
export async function refillDemoTickets(
	db: Db,
	identity: IdentityProvider,
	role: DemoRole,
	account: { userId: string; orgId: string | null },
	at: Date = new Date(),
): Promise<void> {
	const validUntil = new Date(at.getTime() + DEMO_TICKET_MARGIN_MS).toISOString();
	await db.prepare("DELETE FROM demo_tickets WHERE expires_at <= ?").bind(validUntil).run();
	const row = await db
		.prepare("SELECT COUNT(*) AS n FROM demo_tickets WHERE role = ?")
		.bind(role)
		.first<{ n: number }>();
	const missing = DEMO_POOL_SIZE - (row?.n ?? 0);
	if (missing <= 0) return;
	const expires = new Date(at.getTime() + DEMO_TICKET_TTL_S * 1000).toISOString();
	const tokens = await Promise.all(
		Array.from({ length: missing }, () => identity.createSignInTicket(account.userId, account.orgId, DEMO_TICKET_TTL_S)),
	);
	await db.batch(
		tokens.map((token) =>
			db
				.prepare("INSERT INTO demo_tickets (id, role, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
				.bind(newId("dtk"), role, token, expires, at.toISOString()),
		),
	);
}
