/** Authorization through the HTTP API, against real SQLite with the production migrations. */
import { describe, expect, it, vi } from "vitest";

import { takeDemoTicket } from "../src/app";
import { as, setup } from "./helpers";

async function ids(response: Response): Promise<string[]> {
	const body = (await response.json()) as { inspections: { id: string }[] };
	return body.inspections.map((i) => i.id).sort();
}

describe("authentication", () => {
	it("refuses calls without a valid session", async () => {
		const { call } = setup();
		expect((await call("GET", "/inspections")).status).toBe(401);
		expect((await call("GET", "/inspections", "garbage")).status).toBe(401);
	});

	it("mirrors a first-time user and their organization from the identity provider", async () => {
		const { call, db } = setup();
		const response = await call("GET", "/me", "token:newcomer:org_new:org_admin");
		expect(response.status).toBe(200);
		const me = (await response.json()) as { user: { email: string }; org: { name: string; role: string } };
		expect(me.user.email).toBe("newcomer@example.com");
		expect(me.org).toMatchObject({ name: "New Carrier", role: "org_admin" });
		const membership = await db.prepare("SELECT role FROM memberships WHERE user_id = 'newcomer'").first();
		expect(membership).toEqual({ role: "org_admin" });
	});
});

describe("members", () => {
	it("list only their own inspections", async () => {
		const { call } = setup();
		expect(await ids(await call("GET", "/inspections", as.alice))).toEqual(["a1", "a2"]);
		expect(await ids(await call("GET", "/inspections?scope=mine", as.bob))).toEqual(["b1"]);
	});

	it("cannot list their organization or everything", async () => {
		const { call } = setup();
		expect((await call("GET", "/inspections?scope=org", as.alice)).status).toBe(403);
		expect((await call("GET", "/inspections?scope=all", as.alice)).status).toBe(403);
	});

	it("cannot read another member's inspection, in or out of their organization", async () => {
		const { call } = setup();
		expect((await call("GET", "/inspections/a1", as.alice)).status).toBe(200);
		expect((await call("GET", "/inspections/b1", as.alice)).status).toBe(404);
		expect((await call("GET", "/inspections/d1", as.alice)).status).toBe(404);
		expect((await call("GET", "/inspections/a1", as.bob)).status).toBe(404);
	});

	it("cannot change another member's inspection", async () => {
		const { call } = setup();
		expect((await call("PATCH", "/inspections/b1", as.alice, { notes: "x" })).status).toBe(404);
		const own = await call("PATCH", "/inspections/a1", as.alice, { notes: "Checked straps", status: "confirmed" });
		expect(own.status).toBe(200);
		expect(await own.json()).toMatchObject({ notes: "Checked straps", status: "confirmed" });
	});

	it("create inspections in their active organization", async () => {
		const { call } = setup();
		const created = await call("POST", "/inspections", as.alice, { title: "New", truck_body: "flatbed", cargo_weight_kg: 2700 });
		expect(created.status).toBe(201);
		const body = (await created.json()) as { id: string; org_id: string; author_id: string; status: string };
		expect(body).toMatchObject({ org_id: "org_a", author_id: "alice", status: "draft" });
		expect((await call("GET", `/inspections/${body.id}`, as.bob)).status).toBe(404);
		expect((await call("GET", `/inspections/${body.id}`, as.carol)).status).toBe(200);
	});

	it("are rejected on invalid fields", async () => {
		const { call } = setup();
		expect((await call("POST", "/inspections", as.alice, { truck_body: "rocket" })).status).toBe(422);
		expect((await call("POST", "/inspections", as.alice, { cargo_weight_kg: -5 })).status).toBe(422);
	});

	it("cannot open the organization or admin views", async () => {
		const { call } = setup();
		expect((await call("GET", "/org", as.alice)).status).toBe(403);
		expect((await call("POST", "/org/invitations", as.alice, { email: "x@example.com" })).status).toBe(403);
		expect((await call("GET", "/admin/overview", as.alice)).status).toBe(404);
		expect((await call("PATCH", "/admin/settings", as.alice, { kill_switch: true })).status).toBe(404);
	});
});

describe("org admins", () => {
	it("see every inspection of their organization and nothing of another", async () => {
		const { call } = setup();
		expect(await ids(await call("GET", "/inspections?scope=org", as.carol))).toEqual(["a1", "a2", "b1"]);
		expect(await ids(await call("GET", "/inspections?scope=org", as.erin))).toEqual(["d1"]);
		expect((await call("GET", "/inspections/b1", as.carol)).status).toBe(200);
		expect((await call("GET", "/inspections/d1", as.carol)).status).toBe(404);
		expect((await call("GET", "/inspections/o1", as.carol)).status).toBe(404);
	});

	it("cannot change a member's inspection", async () => {
		const { call } = setup();
		expect((await call("PATCH", "/inspections/a1", as.carol, { notes: "x" })).status).toBe(403);
	});

	it("see members and invite new ones", async () => {
		const { call, identity } = setup();
		const org = await call("GET", "/org", as.carol);
		expect(org.status).toBe(200);
		const invited = await call("POST", "/org/invitations", as.carol, { email: "new@example.com", role: "member" });
		expect(invited.status).toBe(201);
		expect(identity.invitations).toHaveLength(1);
		expect((await call("POST", "/org/invitations", as.carol, { email: "not-an-email" })).status).toBe(422);
	});

	it("cannot open the platform admin views", async () => {
		const { call } = setup();
		expect((await call("GET", "/admin/users", as.carol)).status).toBe(404);
		expect((await call("GET", "/inspections?scope=all", as.carol)).status).toBe(403);
	});
});

describe("the platform admin", () => {
	it("reads everything", async () => {
		const { call } = setup();
		expect(await ids(await call("GET", "/inspections?scope=all", as.owner))).toEqual(["a1", "a2", "b1", "d1", "o1"]);
		for (const id of ["a1", "b1", "d1", "o1"]) {
			expect((await call("GET", `/inspections/${id}`, as.owner)).status).toBe(200);
		}
	});

	it("sees usage against the cap and every user", async () => {
		const { call, db } = setup();
		db.raw.exec(`INSERT INTO usage (id, user_id, org_id, kind, model, cost_usd, created_at)
			VALUES ('u1', 'alice', 'org_a', 'photo_analysis', 'claude', 0.0123, '${new Date().toISOString()}')`);
		const overview = (await (await call("GET", "/admin/overview", as.owner)).json()) as {
			month_spend_usd: number;
			settings: { monthly_cap_usd: number; kill_switch: boolean };
		};
		expect(overview.month_spend_usd).toBeCloseTo(0.0123);
		expect(overview.settings).toMatchObject({ monthly_cap_usd: 80, kill_switch: false });
		const users = (await (await call("GET", "/admin/users", as.owner)).json()) as { users: { id: string; month_cost_usd: number }[] };
		expect(users.users.find((u) => u.id === "alice")?.month_cost_usd).toBeCloseTo(0.0123);
	});

	it("blocks users, sets quotas and flips the kill switch", async () => {
		const { call } = setup();
		expect((await call("PATCH", "/admin/users/bob", as.owner, { blocked: true, daily_analysis_quota: 2 })).status).toBe(200);
		expect((await call("GET", "/inspections", as.bob)).status).toBe(403);
		const me = (await (await call("GET", "/me", as.bob)).json()) as { blocked: boolean; analysis: { reason: string } };
		expect(me).toMatchObject({ blocked: true, analysis: { reason: "blocked" } });
		const settings = await call("PATCH", "/admin/settings", as.owner, { kill_switch: true, monthly_cap_usd: 50 });
		expect(await settings.json()).toMatchObject({ kill_switch: true, monthly_cap_usd: 50 });
		const alice = (await (await call("GET", "/me", as.alice)).json()) as { analysis: { allowed: boolean; mode: string; reason: string } };
		expect(alice.analysis).toMatchObject({ allowed: false, mode: "demo", reason: "kill_switch" });
		expect((await call("PATCH", "/admin/settings", as.owner, { monthly_cap_usd: 1000 })).status).toBe(422);
	});

	it("is recognised only by a verified email, and never on a demo account", async () => {
		const { call } = setup();
		const owner = (await (await call("GET", "/me", as.owner)).json()) as { is_platform_admin: boolean };
		expect(owner.is_platform_admin).toBe(true);
		// The demo driver was seeded with the admin's address: it must not get the role.
		const demo = (await (await call("GET", "/me", as.demoDriver)).json()) as { is_platform_admin: boolean };
		expect(demo.is_platform_admin).toBe(false);
		expect((await call("GET", "/admin/overview", as.demoDriver)).status).toBe(404);
	});
});

describe("demo access", () => {
	it("mints a sign-in ticket for the demo driver and insurer, in the demo organization", async () => {
		const { call, identity } = setup();
		const driver = (await (await call("POST", "/demo/session", undefined, { as: "driver" })).json()) as { ticket: string };
		expect(driver.ticket).toBe("ticket-1-for-demo_driver");
		await call("POST", "/demo/session", undefined, { as: "insurer" });
		expect(identity.tickets.filter((t) => t.userId === "demo_insurer")[0]).toMatchObject({ orgId: "org_a" });
		expect(identity.tickets.every((t) => t.orgId === "org_a")).toBe(true);
		expect((await call("POST", "/demo/session", undefined, { as: "admin" })).status).toBe(422);
	});

	it("answers from tickets minted ahead of time, each handed out once", async () => {
		const { call, db, identity } = setup();
		await call("POST", "/demo/session", undefined, { as: "driver" });
		// The pool fills in the background after the first request.
		await vi.waitFor(async () => {
			const row = await db.prepare("SELECT COUNT(*) AS n FROM demo_tickets WHERE role = 'driver'").first<{ n: number }>();
			expect(row?.n).toBe(3);
		});
		const minted = identity.tickets.length;
		const seen = new Set<string>();
		for (let i = 0; i < 3; i++) {
			const { ticket } = (await (await call("POST", "/demo/session", undefined, { as: "driver" })).json()) as { ticket: string };
			expect(seen.has(ticket)).toBe(false);
			seen.add(ticket);
		}
		// Three answers, and none of them waited for Clerk: every ticket came from the pool.
		expect([...seen].every((ticket) => Number(ticket.split("-")[1]) <= minted)).toBe(true);
	});

	it("never hands out a ticket that is about to expire", async () => {
		const { db } = setup();
		db.raw.exec(`INSERT INTO demo_tickets (id, role, token, expires_at, created_at) VALUES
			('old', 'driver', 'stale', '2026-11-20T12:05:00.000Z', '2026-11-20T00:00:00.000Z')`);
		expect(await takeDemoTicket(db, "driver", new Date("2026-11-20T12:00:00.000Z"))).toBeNull();
		expect(await takeDemoTicket(db, "driver", new Date("2026-11-20T11:00:00.000Z"))).toBe("stale");
		expect(await takeDemoTicket(db, "driver", new Date("2026-11-20T11:00:00.000Z"))).toBeNull();
	});

	it("is rate-limited per IP", async () => {
		const { call } = setup({ rateLimitAllows: () => false });
		expect((await call("POST", "/demo/session", undefined, { as: "driver" })).status).toBe(429);
	});

	it("keeps the demo insurer out of invitations", async () => {
		const { call } = setup();
		expect((await call("GET", "/org", as.demoInsurer)).status).toBe(200);
		expect((await call("POST", "/org/invitations", as.demoInsurer, { email: "x@example.com" })).status).toBe(403);
	});
});

describe("CORS", () => {
	it("answers the site's origin, also on errors", async () => {
		const { call } = setup();
		const response = await call("GET", "/inspections/nope", as.alice);
		expect(response.status).toBe(404);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://securecargo.app");
	});
});
