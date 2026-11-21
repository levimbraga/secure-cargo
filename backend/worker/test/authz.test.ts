import { describe, expect, it } from "vitest";

import { canReadInspection, canWriteInspection, inspectionListFilter, type Principal } from "../src/authz";

const base: Principal = {
	userId: "alice",
	email: "alice@example.com",
	orgId: "org_a",
	orgRole: "member",
	isPlatformAdmin: false,
	isDemo: false,
	blocked: false,
	sandboxId: null,
};
const mine = { author_id: "alice", org_id: "org_a" };
const colleague = { author_id: "bob", org_id: "org_a" };
const otherOrg = { author_id: "dave", org_id: "org_b" };
const personal = { author_id: "zoe", org_id: null };

describe("canReadInspection", () => {
	it("lets a member read only their own inspections", () => {
		expect(canReadInspection(base, mine)).toBe(true);
		expect(canReadInspection(base, colleague)).toBe(false);
		expect(canReadInspection(base, otherOrg)).toBe(false);
	});

	it("lets an org_admin read every inspection of their organization and no other", () => {
		const admin = { ...base, userId: "carol", orgRole: "org_admin" as const };
		expect(canReadInspection(admin, mine)).toBe(true);
		expect(canReadInspection(admin, colleague)).toBe(true);
		expect(canReadInspection(admin, otherOrg)).toBe(false);
		expect(canReadInspection(admin, personal)).toBe(false);
	});

	it("scopes an org_admin to the organization active in the session", () => {
		const adminElsewhere = { ...base, userId: "carol", orgId: "org_b", orgRole: "org_admin" as const };
		expect(canReadInspection(adminElsewhere, colleague)).toBe(false);
	});

	it("lets the platform admin read everything", () => {
		const owner = { ...base, userId: "owner", orgId: null, orgRole: null, isPlatformAdmin: true };
		for (const inspection of [mine, colleague, otherOrg, personal]) {
			expect(canReadInspection(owner, inspection)).toBe(true);
		}
	});

	it("lets a blocked user read nothing", () => {
		expect(canReadInspection({ ...base, blocked: true }, mine)).toBe(false);
	});
});

describe("canWriteInspection", () => {
	it("allows only the author, even for an org_admin", () => {
		const admin = { ...base, userId: "carol", orgRole: "org_admin" as const };
		expect(canWriteInspection(base, mine)).toBe(true);
		expect(canWriteInspection(base, colleague)).toBe(false);
		expect(canWriteInspection(admin, colleague)).toBe(false);
	});
});

describe("inspectionListFilter", () => {
	it("narrows a member to their own and refuses the org and all scopes", () => {
		expect(inspectionListFilter(base, "mine")).toEqual({ where: "i.author_id = ?", params: ["alice"] });
		expect(inspectionListFilter(base, "org")).toBeNull();
		expect(inspectionListFilter(base, "all")).toBeNull();
	});

	it("gives an org_admin their organization only", () => {
		const admin = { ...base, orgRole: "org_admin" as const };
		expect(inspectionListFilter(admin, "org")).toEqual({ where: "i.org_id = ?", params: ["org_a"] });
		expect(inspectionListFilter(admin, "all")).toBeNull();
	});

	it("gives the platform admin everything", () => {
		const owner = { ...base, isPlatformAdmin: true };
		expect(inspectionListFilter(owner, "all")).toEqual({ where: "1 = 1", params: [] });
	});
});

describe("demo sandboxes", () => {
	const visitor: Principal = { ...base, userId: "demo_driver", isDemo: true, sandboxId: "sbx_one" };
	const seeded = { author_id: "demo_driver", org_id: "org_a", seeded: 1, sandbox_id: null };
	const own = { author_id: "demo_driver", org_id: "org_a", seeded: 0, sandbox_id: "sbx_one" };
	const other = { author_id: "demo_driver", org_id: "org_a", seeded: 0, sandbox_id: "sbx_two" };

	it("reads the seeded inspections and the own sandbox's, nothing else", () => {
		expect(canReadInspection(visitor, seeded)).toBe(true);
		expect(canReadInspection(visitor, own)).toBe(true);
		expect(canReadInspection(visitor, other)).toBe(false);
		// A row read without its sandbox columns is refused, not assumed shared.
		expect(canReadInspection(visitor, { author_id: "demo_driver", org_id: "org_a" })).toBe(false);
	});

	it("changes only the own sandbox's inspections", () => {
		expect(canWriteInspection(visitor, own)).toBe(true);
		expect(canWriteInspection(visitor, seeded)).toBe(false);
		expect(canWriteInspection(visitor, other)).toBe(false);
	});

	it("narrows every list to the seeded inspections and the sandbox", () => {
		expect(inspectionListFilter(visitor, "mine")).toEqual({
			where: "i.author_id = ? AND (i.seeded = 1 OR i.sandbox_id = ?)",
			params: ["demo_driver", "sbx_one"],
		});
		expect(inspectionListFilter({ ...visitor, orgRole: "org_admin" }, "org")?.params).toEqual(["org_a", "sbx_one"]);
		expect(inspectionListFilter(visitor, "all")).toBeNull();
	});
});
