/**
 * Authorization rules. Pure functions: every endpoint asks these, and the tests pin them down.
 *
 * - a member reads and changes only the inspections they authored;
 * - an org_admin reads every inspection of the organization active in their session;
 * - nobody reads another organization's data;
 * - the platform admin reads everything.
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
}

export interface InspectionOwnership {
	author_id: string;
	org_id: string | null;
}

export type ListScope = "mine" | "org" | "all";

export function isOrgAdmin(principal: Principal): boolean {
	return principal.orgRole === "org_admin" && principal.orgId !== null;
}

export function canReadInspection(principal: Principal, inspection: InspectionOwnership): boolean {
	if (principal.isPlatformAdmin) return true;
	if (principal.blocked) return false;
	if (inspection.author_id === principal.userId) return true;
	return isOrgAdmin(principal) && inspection.org_id !== null && inspection.org_id === principal.orgId;
}

/** Only the author changes an inspection (the platform admin too, for support). */
export function canWriteInspection(principal: Principal, inspection: InspectionOwnership): boolean {
	if (principal.isPlatformAdmin) return true;
	if (principal.blocked) return false;
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
	switch (scope) {
		case "mine":
			return { where: "i.author_id = ?", params: [principal.userId] };
		case "org":
			if (principal.orgId === null) return null;
			if (!isOrgAdmin(principal) && !principal.isPlatformAdmin) return null;
			return { where: "i.org_id = ?", params: [principal.orgId] };
		case "all":
			if (!principal.isPlatformAdmin) return null;
			return { where: "1 = 1", params: [] };
	}
}
