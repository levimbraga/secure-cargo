/**
 * Authorization rules. Pure functions: every endpoint asks these, and the tests pin them down.
 *
 * - a member reads and changes only the inspections they authored;
 * - an org_admin reads every inspection of the organization active in their session;
 * - nobody reads another organization's data;
 * - the platform admin reads everything;
 * - a demo visitor (a Worker-issued demo session, `sandboxId` set) reads the seeded demo inspections
 *   and only the ones made in their own sandbox, and changes only the latter.
 */

export type OrgRole = "member" | "org_admin";

export interface Principal {
	userId: string;
	email: string | null;
	/** Organization active in the session (Clerk `o.id`), or null for a personal account. */
	orgId: string | null;
	orgRole: OrgRole | null;
	isPlatformAdmin: boolean;
	isDemo: boolean;
	blocked: boolean;
	/** A demo session's sandbox; null for real accounts. */
	sandboxId: string | null;
}

export interface InspectionOwnership {
	author_id: string;
	org_id: string | null;
	/** 1 for the seeded demo inspections (shared by every demo visitor). */
	seeded?: number | null;
	sandbox_id?: string | null;
}

/** A demo visitor's view: seeded inspections and their own sandbox's. Real accounts: everything they own. */
function inSandbox(principal: Principal, inspection: InspectionOwnership): boolean {
	if (!principal.sandboxId) return true;
	return inspection.seeded === 1 || inspection.sandbox_id === principal.sandboxId;
}

/** The same rule as SQL, for queries over inspections aliased `alias` ("" when there is none). */
export function sandboxClause(principal: Principal, alias = "i"): { sql: string; params: unknown[] } {
	if (!principal.sandboxId) return { sql: "", params: [] };
	const a = alias ? `${alias}.` : "";
	return { sql: ` AND (${a}seeded = 1 OR ${a}sandbox_id = ?)`, params: [principal.sandboxId] };
}

export type ListScope = "mine" | "org" | "all";

export function isOrgAdmin(principal: Principal): boolean {
	return principal.orgRole === "org_admin" && principal.orgId !== null;
}

export function canReadInspection(principal: Principal, inspection: InspectionOwnership): boolean {
	if (principal.isPlatformAdmin) return true;
	if (principal.blocked) return false;
	if (!inSandbox(principal, inspection)) return false;
	if (inspection.author_id === principal.userId) return true;
	return isOrgAdmin(principal) && inspection.org_id !== null && inspection.org_id === principal.orgId;
}

/** Only the author changes an inspection (the platform admin too, for support). */
export function canWriteInspection(principal: Principal, inspection: InspectionOwnership): boolean {
	if (principal.isPlatformAdmin) return true;
	if (principal.blocked) return false;
	// A demo visitor never changes the seeded inspections every other visitor sees.
	if (principal.sandboxId && inspection.sandbox_id !== principal.sandboxId) return false;
	return inspection.author_id === principal.userId;
}

export function canManageOrg(principal: Principal, orgId: string): boolean {
	if (principal.isPlatformAdmin) return true;
	return !principal.blocked && isOrgAdmin(principal) && principal.orgId === orgId;
}

/**
 * SQL filter for a list of inspections, or null when the scope is not allowed.
 * The returned clause only ever narrows by author or organization; there is no "everything"
 * clause except for the platform admin.
 */
export function inspectionListFilter(
	principal: Principal,
	scope: ListScope,
): { where: string; params: unknown[] } | null {
	if (principal.blocked && !principal.isPlatformAdmin) return null;
	const sandbox = sandboxClause(principal);
	switch (scope) {
		case "mine":
			return { where: `i.author_id = ?${sandbox.sql}`, params: [principal.userId, ...sandbox.params] };
		case "org":
			if (principal.orgId === null) return null;
			if (!isOrgAdmin(principal) && !principal.isPlatformAdmin) return null;
			return { where: `i.org_id = ?${sandbox.sql}`, params: [principal.orgId, ...sandbox.params] };
		case "all":
			if (!principal.isPlatformAdmin) return null;
			return { where: "1 = 1", params: [] };
	}
}
