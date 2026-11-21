/**
 * Test doubles: D1 over `node:sqlite` (same SQL migrations as production) and a fake Clerk.
 *
 * Fake session tokens read `token:<userId>[:<orgId>:<member|org_admin>]`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { createApp } from "../src/app";
import type { OrgRole } from "../src/authz";
import type { Db, Statement } from "../src/db";
import type { FlowDeps } from "../src/flow";
import type { IdentityProvider, IdentityUser, OrgInvitation } from "../src/identity";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

export function createTestDb(): Db & { raw: DatabaseSync } {
	const raw = new DatabaseSync(":memory:");
	raw.exec("PRAGMA foreign_keys = ON");
	for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
		raw.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
	}
	const statement = (sql: string, values: unknown[] = []): Statement => ({
		bind: (...next) => statement(sql, next),
		first: async <T>() => (raw.prepare(sql).get(...(values as SQLInputValue[])) as T | undefined) ?? null,
		all: async <T>() => ({ results: raw.prepare(sql).all(...(values as SQLInputValue[])) as T[] }),
		run: async () => raw.prepare(sql).run(...(values as SQLInputValue[])),
	});
	return {
		raw,
		prepare: (sql) => statement(sql),
		batch: async (statements) => Promise.all(statements.map((s) => s.run())),
	};
}

export class FakeIdentity implements IdentityProvider {
	users = new Map<string, IdentityUser>();
	orgs = new Map<string, { id: string; name: string; type: "insurer" | "carrier" }>();
	invitations: OrgInvitation[] = [];
	tickets: { userId: string; orgId: string | null; expiresInSeconds: number }[] = [];

	async verify(token: string) {
		const [kind, userId, orgId, role] = token.split(":");
		if (kind !== "token" || !userId) return null;
		return { userId, orgId: orgId || null, orgRole: (role as OrgRole) || null };
	}
	async getUser(id: string) {
		return this.users.get(id) ?? null;
	}
	async getOrganization(id: string) {
		return this.orgs.get(id) ?? null;
	}
	async listMembers(orgId: string) {
		return [{ userId: `member-of-${orgId}`, name: "Someone", email: null, role: "member" as const, joinedAt: "2026-11-20T00:00:00.000Z" }];
	}
	async listInvitations() {
		return this.invitations;
	}
	async invite(params: { email: string; role: OrgRole }) {
		const invitation = { id: `inv_${this.invitations.length}`, email: params.email, role: params.role, status: "pending", createdAt: "2026-11-20T00:00:00.000Z" };
		this.invitations.push(invitation);
		return invitation;
	}
	async createSignInTicket(userId: string, orgId: string | null, expiresInSeconds: number) {
		this.tickets.push({ userId, orgId, expiresInSeconds });
		return `ticket-${this.tickets.length}-for-${userId}`;
	}
}

export const ADMIN_EMAIL = "owner@example.com";

/**
 * Two organizations and their people:
 *   org_a (insurer): alice, bob (members), carol (org_admin), demo driver/insurer
 *   org_b (carrier): dave (member), erin (org_admin)
 *   owner: platform admin, no organization
 * Inspections: a1, a2 by alice; b1 by bob (all org_a); d1 by dave (org_b); o1 owner's personal.
 */
export function seed(db: ReturnType<typeof createTestDb>, identity: FakeIdentity) {
	const t = "2026-11-20T12:00:00.000Z";
	db.raw.exec(`
		INSERT INTO organizations (id, name, type, created_at, is_demo) VALUES
			('org_a', 'Alpha Insurance', 'insurer', '${t}', 0),
			('org_b', 'Beta Freight', 'carrier', '${t}', 0);
		INSERT INTO users (id, email, name, is_demo, created_at) VALUES
			('alice', 'alice@example.com', 'Alice', 0, '${t}'),
			('bob', 'bob@example.com', 'Bob', 0, '${t}'),
			('carol', 'carol@example.com', 'Carol', 0, '${t}'),
			('dave', 'dave@example.com', 'Dave', 0, '${t}'),
			('erin', 'erin@example.com', 'Erin', 0, '${t}'),
			('owner', '${ADMIN_EMAIL}', 'Owner', 0, '${t}'),
			('demo_driver', '${ADMIN_EMAIL}', 'Demo driver', 1, '${t}'),
			('demo_insurer', 'insurer@demo.invalid', 'Demo insurer', 1, '${t}');
		INSERT INTO memberships (user_id, org_id, role, created_at) VALUES
			('alice', 'org_a', 'member', '${t}'), ('bob', 'org_a', 'member', '${t}'),
			('carol', 'org_a', 'org_admin', '${t}'), ('dave', 'org_b', 'member', '${t}'),
			('erin', 'org_b', 'org_admin', '${t}');
		INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, title) VALUES
			('a1', 'org_a', 'alice', '${t}', '${t}', 'Alice 1'),
			('a2', 'org_a', 'alice', '2026-11-20T13:00:00.000Z', '${t}', 'Alice 2'),
			('b1', 'org_a', 'bob', '${t}', '${t}', 'Bob 1'),
			('d1', 'org_b', 'dave', '${t}', '${t}', 'Dave 1'),
			('o1', NULL, 'owner', '${t}', '${t}', 'Owner 1');
		INSERT INTO settings (key, value, updated_at) VALUES
			('demo_driver_user_id', 'demo_driver', '${t}'),
			('demo_insurer_user_id', 'demo_insurer', '${t}'),
			('demo_org_id', 'org_a', '${t}');
	`);
	identity.orgs.set("org_new", { id: "org_new", name: "New Carrier", type: "carrier" });
	identity.users.set("newcomer", { id: "newcomer", email: "NewComer@Example.com".toLowerCase(), name: "Newcomer" });
}

export function setup(options: { rateLimitAllows?: () => boolean; flow?: Partial<FlowDeps> } = {}) {
	const db = createTestDb();
	const identity = new FakeIdentity();
	seed(db, identity);
	const app = createApp({
		db,
		identity,
		platformAdminEmails: [ADMIN_EMAIL],
		corsOrigins: ["https://securecargo.app"],
		siteUrl: "https://securecargo.app",
		limitAnonymous: async () => options.rateLimitAllows?.() ?? true,
		photos: null,
		physics: null,
		analyzer: null,
		samples: {},
		...options.flow,
	});
	const call = (method: string, path: string, token?: string, body?: unknown) =>
		app.request(path, {
			method,
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				Origin: "https://securecargo.app",
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	return { db, identity, app, call };
}

/** Session tokens of the seeded people, each in their own organization. */
export const as = {
	alice: "token:alice:org_a:member",
	bob: "token:bob:org_a:member",
	carol: "token:carol:org_a:org_admin",
	dave: "token:dave:org_b:member",
	erin: "token:erin:org_b:org_admin",
	owner: "token:owner",
	demoDriver: "token:demo_driver:org_a:member",
	demoInsurer: "token:demo_insurer:org_a:org_admin",
};
