/**
 * From a verified session to a Principal: mirror the user, the active organization and the
 * membership in D1 (fetching from Clerk only when a row is missing), and decide the platform
 * role from the verified email.
 */
import type { Principal } from "./authz";
import { type Db, now } from "./db";
import type { DemoSession } from "./demo";
import type { IdentityProvider, SessionClaims } from "./identity";

interface UserRow {
	id: string;
	email: string | null;
	name: string | null;
	is_demo: number;
	blocked: number;
	last_seen_at: string | null;
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export async function resolvePrincipal(
	db: Db,
	identity: IdentityProvider,
	claims: SessionClaims,
	platformAdminEmails: readonly string[],
): Promise<Principal> {
	const at = now();
	let user = await db
		.prepare("SELECT id, email, name, is_demo, blocked, last_seen_at FROM users WHERE id = ?")
		.bind(claims.userId)
		.first<UserRow>();

	if (!user || (user.email === null && !user.is_demo)) {
		const fetched = await identity.getUser(claims.userId);
		await db
			.prepare(
				`INSERT INTO users (id, email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = COALESCE(excluded.name, users.name),
				 last_seen_at = excluded.last_seen_at`,
			)
			.bind(claims.userId, fetched?.email ?? null, fetched?.name ?? null, at, at)
			.run();
		user = {
			id: claims.userId,
			email: fetched?.email ?? null,
			name: fetched?.name ?? user?.name ?? null,
			is_demo: user?.is_demo ?? 0,
			blocked: user?.blocked ?? 0,
			last_seen_at: at,
		};
	} else if (!user.last_seen_at || Date.parse(at) - Date.parse(user.last_seen_at) > LAST_SEEN_RESOLUTION_MS) {
		await db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(at, user.id).run();
	}

	if (claims.orgId && claims.orgRole) {
		// One read tells whether the organization and this membership are already mirrored; the
		// writes happen only the first time (or when the role changed), not on every request.
		const known = await db
			.prepare(
				`SELECT (SELECT 1 FROM organizations WHERE id = ?) AS org,
				        (SELECT role FROM memberships WHERE user_id = ? AND org_id = ?) AS role`,
			)
			.bind(claims.orgId, claims.userId, claims.orgId)
			.first<{ org: number | null; role: string | null }>();
		if (!known?.org) {
			const fetched = await identity.getOrganization(claims.orgId);
			await db
				.prepare(
					"INSERT INTO organizations (id, name, type, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
				)
				.bind(claims.orgId, fetched?.name ?? "Organization", fetched?.type ?? "carrier", at)
				.run();
		}
		if (known?.role !== claims.orgRole) {
			await db
				.prepare(
					`INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT (user_id, org_id) DO UPDATE SET role = excluded.role`,
				)
				.bind(claims.userId, claims.orgId, claims.orgRole, at)
				.run();
		}
	}

	const email = user.email?.toLowerCase() ?? null;
	const admins = platformAdminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
	return {
		userId: claims.userId,
		email,
		orgId: claims.orgId,
		orgRole: claims.orgRole,
		// Demo accounts never get the platform role, whatever their address.
		isPlatformAdmin: !user.is_demo && email !== null && admins.includes(email),
		// Demo people are D1 rows for Worker-issued demo sessions; the API refuses a Clerk session
		// for one of them (an account left from before 2026-11-21).
		isDemo: user.is_demo === 1,
		blocked: user.blocked === 1,
		sandboxId: null,
	};
}

/**
 * A demo visitor: the seeded demo driver or insurer of the Demo Fleet organization (rows in D1
 * only, no Clerk account), limited to the seeded inspections and the session's own sandbox.
 */
export async function demoPrincipal(db: Db, session: DemoSession): Promise<Principal | null> {
	const { results } = await db
		.prepare("SELECT key, value FROM settings WHERE key IN ('demo_driver_user_id', 'demo_insurer_user_id', 'demo_org_id')")
		.all<{ key: string; value: string }>();
	const settings = new Map(results.map((r) => [r.key, r.value]));
	const userId = settings.get(session.role === "driver" ? "demo_driver_user_id" : "demo_insurer_user_id");
	const orgId = settings.get("demo_org_id") ?? null;
	if (!userId || !orgId) return null;
	return {
		userId,
		email: null,
		orgId,
		orgRole: session.role === "insurer" ? "org_admin" : "member",
		isPlatformAdmin: false,
		isDemo: true,
		blocked: false,
		sandboxId: session.sbx,
	};
}

export function parseEmailList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
}
