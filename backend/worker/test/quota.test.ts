import { describe, expect, it } from "vitest";

import type { Principal } from "../src/authz";
import { periodStarts } from "../src/db";
import { analysisAllowance, decideAnalysis, effectiveDailyQuota } from "../src/quota";
import { createTestDb, FakeIdentity, seed } from "./helpers";

const open = {
	blocked: false,
	killSwitch: false,
	monthSpendUsd: 1,
	monthlyCapUsd: 80,
	isDemo: false,
	usedToday: 0,
	dailyQuota: 5,
};

describe("decideAnalysis", () => {
	it("allows a live analysis within quota and budget", () => {
		expect(decideAnalysis(open)).toMatchObject({ allowed: true, mode: "live", reason: null });
	});

	it("checks block, kill switch, budget cap and quota, in that order", () => {
		const everything = { ...open, blocked: true, killSwitch: true, monthSpendUsd: 80, usedToday: 5 };
		expect(decideAnalysis(everything).reason).toBe("blocked");
		expect(decideAnalysis({ ...everything, blocked: false }).reason).toBe("kill_switch");
		expect(decideAnalysis({ ...everything, blocked: false, killSwitch: false }).reason).toBe("budget_cap");
		expect(decideAnalysis({ ...open, usedToday: 5 }).reason).toBe("quota_exceeded");
		expect(decideAnalysis({ ...open, usedToday: 5 }).mode).toBe("demo");
	});

	it("stops exactly at the monthly cap", () => {
		expect(decideAnalysis({ ...open, monthSpendUsd: 79.99 }).allowed).toBe(true);
		expect(decideAnalysis({ ...open, monthSpendUsd: 80 }).allowed).toBe(false);
	});
});

describe("effectiveDailyQuota", () => {
	it("prefers the user's override, then the organization's, then the default", () => {
		expect(effectiveDailyQuota(2, 9, 5)).toBe(2);
		expect(effectiveDailyQuota(null, 9, 5)).toBe(9);
		expect(effectiveDailyQuota(null, null, 5)).toBe(5);
		expect(effectiveDailyQuota(0, 9, 5)).toBe(0);
	});
});

describe("periodStarts", () => {
	it("uses Brasília days (UTC-3)", () => {
		// 01:00 UTC on Nov 21 is still Nov 20 in Brasília.
		expect(periodStarts(new Date("2026-11-21T01:00:00Z"))).toEqual({
			day: "2026-11-20T03:00:00.000Z",
			month: "2026-11-01T03:00:00.000Z",
		});
	});
});

describe("analysisAllowance", () => {
	const principal = (overrides: Partial<Principal> = {}): Principal => ({
		userId: "alice",
		email: "alice@example.com",
		orgId: "org_a",
		orgRole: "member",
		isPlatformAdmin: false,
		isDemo: false,
		blocked: false,
		...overrides,
	});

	function withUsage(rows: { user: string; cached?: boolean; demo?: boolean; cost?: number }[]) {
		const db = createTestDb();
		seed(db, new FakeIdentity());
		const at = new Date().toISOString();
		rows.forEach((r, i) =>
			db.raw
				.prepare(
					"INSERT INTO usage (id, user_id, kind, cost_usd, cached, is_demo, created_at) VALUES (?, ?, 'photo_analysis', ?, ?, ?, ?)",
				)
				.run(`u${i}`, r.user, r.cost ?? 0.01, r.cached ? 1 : 0, r.demo ? 1 : 0, at),
		);
		return db;
	}

	it("counts only billed analyses against the daily quota", async () => {
		const db = withUsage([
			...Array.from({ length: 4 }, () => ({ user: "alice" })),
			...Array.from({ length: 3 }, () => ({ user: "alice", cached: true })),
			{ user: "bob" },
		]);
		expect(await analysisAllowance(db, principal())).toMatchObject({ allowed: true, usedToday: 4, dailyQuota: 5 });
		db.raw.exec("INSERT INTO usage (id, user_id, kind, created_at) VALUES ('x', 'alice', 'photo_analysis', '" + new Date().toISOString() + "')");
		expect(await analysisAllowance(db, principal())).toMatchObject({ allowed: false, reason: "quota_exceeded" });
	});

	it("applies the organization's quota override", async () => {
		const db = withUsage([{ user: "alice" }, { user: "alice" }]);
		db.raw.exec("UPDATE organizations SET daily_analysis_quota = 2 WHERE id = 'org_a'");
		expect(await analysisAllowance(db, principal())).toMatchObject({ allowed: false, dailyQuota: 2 });
		db.raw.exec("UPDATE users SET daily_analysis_quota = 10 WHERE id = 'alice'");
		expect(await analysisAllowance(db, principal())).toMatchObject({ allowed: true, dailyQuota: 10 });
	});

	it("makes the demo accounts share one small pool", async () => {
		const db = withUsage(Array.from({ length: 10 }, (_, i) => ({ user: i % 2 ? "demo_driver" : "demo_insurer", demo: true })));
		const demo = principal({ userId: "demo_driver", isDemo: true });
		expect(await analysisAllowance(db, demo)).toMatchObject({ allowed: false, sharedPool: true, usedToday: 10, dailyQuota: 10 });
		// A real user is not affected by the demo pool.
		expect((await analysisAllowance(db, principal())).allowed).toBe(true);
	});

	it("switches everyone to demo mode at the monthly cap", async () => {
		const db = withUsage([{ user: "bob", cost: 80 }]);
		expect(await analysisAllowance(db, principal())).toMatchObject({ allowed: false, reason: "budget_cap", mode: "demo" });
	});
});
