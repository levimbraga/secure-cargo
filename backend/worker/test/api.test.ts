/** Authorization through the HTTP API, against real SQLite with the production migrations. */
import { describe, expect, it, vi } from "vitest";

import { signDemoToken, verifyDemoToken } from "../src/demo";
import { as, DEMO_SECRET, demoCookieFor, setup } from "./helpers";

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
	it("gives a demo session as a signed, httpOnly cookie for 24 hours, with no account behind it", async () => {
		const { call } = setup();
		const response = await call("POST", "/demo/session", undefined, { as: "driver" });
		expect(response.status).toBe(200);
		const cookie = response.headers.get("Set-Cookie") ?? "";
		expect(cookie).toMatch(/^sc_demo=v1\.[\w-]+\.[\w-]+;/);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Max-Age=86400");
		const me = await (await app(cookie)).json();
		expect(me).toMatchObject({ user: { id: "demo_driver", is_demo: true }, org: { id: "org_a", role: "member" }, is_platform_admin: false });
		expect((await call("POST", "/demo/session", undefined, { as: "admin" })).status).toBe(422);

		async function app(setCookie: string) {
			const { app: a } = setup();
			return a.request("/me", { headers: { Cookie: setCookie.split(";")[0] as string, Origin: "https://securecargo.app" } });
		}
	});

	it("keeps the sandbox when the same browser switches between driver and insurer", async () => {
		const { app } = setup();
		const first = await app.request("/demo/session", { method: "POST", body: JSON.stringify({ as: "driver" }), headers: { "Content-Type": "application/json" } });
		const driverCookie = (first.headers.get("Set-Cookie") ?? "").split(";")[0] as string;
		const second = await app.request("/demo/session", {
			method: "POST",
			body: JSON.stringify({ as: "insurer" }),
			headers: { "Content-Type": "application/json", Cookie: driverCookie },
		});
		const insurerCookie = (second.headers.get("Set-Cookie") ?? "").split(";")[0] as string;
		const sandbox = (cookie: string) => JSON.parse(Buffer.from((cookie.split("=")[1] as string).split(".")[1] as string, "base64url").toString()).sbx;
		expect(sandbox(insurerCookie)).toBe(sandbox(driverCookie));
		// A fresh browser gets a new sandbox.
		const fresh = await app.request("/demo/session", { method: "POST", body: JSON.stringify({ as: "insurer" }), headers: { "Content-Type": "application/json" } });
		expect(sandbox((fresh.headers.get("Set-Cookie") ?? "").split(";")[0] as string)).not.toBe(sandbox(driverCookie));
	});

	it("refuses tampered, expired and foreign demo tokens", async () => {
		const { app } = setup();
		const me = (cookie: string) => app.request("/me", { headers: { Cookie: cookie } });
		const good = await demoCookieFor("demo:driver:sbx_one");
		expect((await me(good)).status).toBe(200);
		const [name, token] = good.split("=") as [string, string];
		const [v, payload, signature] = token.split(".") as [string, string, string];
		// Another role in the payload, the old signature.
		const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "insurer" })).toString("base64url");
		expect((await me(`${name}=${v}.${forged}.${signature}`)).status).toBe(401);
		expect((await me(`${name}=${v}.${payload}.${signature.slice(0, -2)}AA`)).status).toBe(401);
		// Signed with another secret.
		expect((await me(await demoCookieFor("demo:driver:sbx_one", "another-secret"))).status).toBe(401);
		// Expired.
		const iat = Math.floor(Date.now() / 1000) - 90_000;
		const old = await signDemoToken({ sid: "s", sbx: "sbx_one", role: "driver", iat, exp: iat + 86_400 }, DEMO_SECRET);
		expect((await me(`sc_demo=${old}`)).status).toBe(401);
		expect(await verifyDemoToken(old, DEMO_SECRET)).toBeNull();
	});

	it("never takes a demo token for a Clerk session, nor a Clerk session for a demo person", async () => {
		const { app, call } = setup();
		const cookie = await demoCookieFor("demo:driver:sbx_one");
		const token = cookie.split("=")[1] as string;
		expect((await app.request("/me", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
		// The demo people are D1 rows only: a (left-over) Clerk session for one of them is refused.
		expect((await call("GET", "/me", "token:demo_driver:org_a:member")).status).toBe(401);
	});

	it("shows a demo visitor the seeded inspections and their own sandbox only", async () => {
		const { call, db } = setup();
		db.raw.exec(`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, title, seeded) VALUES
			('seed1', 'org_a', 'demo_driver', '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00.000Z', 'Seeded', 1)`);
		const one = "demo:driver:sbx_one";
		const two = "demo:driver:sbx_two";
		const created = (await (await call("POST", "/inspections", one, { title: "Mine" })).json()) as { id: string };
		const ids = async (who: string, scope: string) =>
			((await (await call("GET", `/inspections?scope=${scope}`, who)).json()) as { inspections: { id: string }[] }).inspections.map((i) => i.id).sort();
		expect(await ids(one, "mine")).toEqual([created.id, "seed1"].sort());
		expect(await ids(two, "mine")).toEqual(["seed1"]);
		expect((await call("GET", `/inspections/${created.id}`, two)).status).toBe(404);
		// The insurer of the same browser sees it; the insurer of another browser does not.
		expect(await ids("demo:insurer:sbx_one", "org")).toEqual([created.id, "seed1"].sort());
		expect(await ids("demo:insurer:sbx_two", "org")).toEqual(["seed1"]);
		// The real people of the organization stay invisible to demo visitors.
		expect((await call("GET", "/inspections/a1", "demo:insurer:sbx_one")).status).toBe(404);
		expect((await call("GET", "/inspections/d1", "demo:insurer:sbx_one")).status).toBe(404);
		// And a visitor cannot change the seeded inspections everyone else sees.
		expect((await call("POST", "/inspections", one, { reinspection_of: "seed1" })).status).toBe(403);
		expect((await call("POST", "/inspections/seed1/share", "demo:insurer:sbx_one")).status).toBe(403);
	});

	it("keeps demo trucks per sandbox", async () => {
		const { call } = setup();
		expect((await call("POST", "/trucks", "demo:driver:sbx_one", { size: "toco", style: "box" })).status).toBe(201);
		const list = async (who: string) => ((await (await call("GET", "/trucks", who)).json()) as { trucks: unknown[] }).trucks.length;
		expect(await list("demo:driver:sbx_one")).toBe(1);
		expect(await list("demo:driver:sbx_two")).toBe(0);
	});

	it("ends the demo session", async () => {
		const { call } = setup();
		const response = await call("POST", "/demo/logout");
		expect(response.status).toBe(204);
		expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
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
