/**
 * Identity provider: who the caller is, and the organization data that lives in Clerk.
 *
 * The application talks to this interface only, so the tests swap in a fake and production
 * uses Clerk (`createClerkIdentity`). Clerk is the source of truth for users, organizations,
 * org roles and invitations; D1 mirrors the ids so records can be scoped.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";

import type { OrgRole } from "./authz";

export interface SessionClaims {
	userId: string;
	/** Organization active in the session, with the caller's role in it. */
	orgId: string | null;
	orgRole: OrgRole | null;
}

export interface IdentityUser {
	id: string;
	/** Primary email, only when verified (an unverified address never grants a role). */
	email: string | null;
	name: string | null;
}

export interface IdentityOrg {
	id: string;
	name: string;
	type: "insurer" | "carrier";
}

export interface OrgMember {
	userId: string;
	name: string | null;
	email: string | null;
	role: OrgRole;
	joinedAt: string;
}

export interface OrgInvitation {
	id: string;
	email: string;
	role: OrgRole;
	status: string;
	createdAt: string;
}

export interface IdentityProvider {
	verify(token: string): Promise<SessionClaims | null>;
	getUser(userId: string): Promise<IdentityUser | null>;
	getOrganization(orgId: string): Promise<IdentityOrg | null>;
	listMembers(orgId: string): Promise<OrgMember[]>;
	listInvitations(orgId: string): Promise<OrgInvitation[]>;
	invite(params: {
		orgId: string;
		email: string;
		role: OrgRole;
		inviterUserId: string;
		redirectUrl: string;
	}): Promise<OrgInvitation>;
	/** A one-time ticket that signs the given user in (demo accounts), valid for `expiresInSeconds`. */
	createSignInTicket(userId: string, orgId: string | null, expiresInSeconds: number): Promise<string>;
}

/** Clerk org roles are `org:admin` / `org:member` (session tokens v2 drop the prefix). */
export function toOrgRole(role: string | undefined | null): OrgRole | null {
	if (!role) return null;
	const bare = role.replace(/^org:/, "");
	if (bare === "admin") return "org_admin";
	if (bare === "member") return "member";
	return null;
}

export function fromOrgRole(role: OrgRole): string {
	return role === "org_admin" ? "org:admin" : "org:member";
}

interface ClerkSessionPayload {
	sub: string;
	// Session token v2: { o: { id, rol, slg } }
	o?: { id?: string; rol?: string };
	// Session token v1
	org_id?: string;
	org_role?: string;
}

/** Read the user and active organization from a verified Clerk session token payload. */
export function claimsFromPayload(payload: ClerkSessionPayload): SessionClaims {
	const orgId = payload.o?.id ?? payload.org_id ?? null;
	const orgRole = orgId ? toOrgRole(payload.o?.rol ?? payload.org_role) : null;
	return { userId: payload.sub, orgId: orgRole ? orgId : null, orgRole };
}

export function createClerkIdentity(options: {
	secretKey: string;
	publishableKey: string;
	authorizedParties: string[];
}): IdentityProvider {
	const clerk = createClerkClient({
		secretKey: options.secretKey,
		publishableKey: options.publishableKey,
	});

	const iso = (ms: number) => new Date(ms).toISOString();

	return {
		async verify(token) {
			try {
				const result: unknown = await verifyToken(token, {
					secretKey: options.secretKey,
					authorizedParties: options.authorizedParties,
				});
				// Depending on the SDK version the payload is returned directly or as { data }.
				const payload = (
					result && typeof result === "object" && "data" in result
						? (result as { data?: ClerkSessionPayload }).data
						: result
				) as ClerkSessionPayload | undefined;
				if (!payload?.sub) return null;
				return claimsFromPayload(payload);
			} catch {
				return null;
			}
		},

		async getUser(userId) {
			try {
				const user = await clerk.users.getUser(userId);
				const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
				const verified = primary?.verification?.status === "verified";
				const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
				return { id: user.id, email: verified ? primary.emailAddress.toLowerCase() : null, name };
			} catch {
				return null;
			}
		},

		async getOrganization(orgId) {
			try {
				const org = await clerk.organizations.getOrganization({ organizationId: orgId });
				const type = (org.publicMetadata as { type?: string } | null)?.type;
				return { id: org.id, name: org.name, type: type === "insurer" ? "insurer" : "carrier" };
			} catch {
				return null;
			}
		},

		async listMembers(orgId) {
			const { data } = await clerk.organizations.getOrganizationMembershipList({
				organizationId: orgId,
				limit: 100,
			});
			return data.map((m) => {
				const user = m.publicUserData;
				const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
				return {
					userId: user?.userId ?? "",
					name,
					email: user?.identifier ?? null,
					role: toOrgRole(m.role) ?? "member",
					joinedAt: iso(m.createdAt),
				};
			});
		},

		async listInvitations(orgId) {
			const { data } = await clerk.organizations.getOrganizationInvitationList({
				organizationId: orgId,
				status: ["pending"],
				limit: 100,
			});
			return data.map((i) => ({
				id: i.id,
				email: i.emailAddress,
				role: toOrgRole(i.role) ?? "member",
				status: i.status ?? "pending",
				createdAt: iso(i.createdAt),
			}));
		},

		async invite({ orgId, email, role, inviterUserId, redirectUrl }) {
			const i = await clerk.organizations.createOrganizationInvitation({
				organizationId: orgId,
				emailAddress: email,
				role: fromOrgRole(role),
				inviterUserId,
				redirectUrl,
			});
			return {
				id: i.id,
				email: i.emailAddress,
				role: toOrgRole(i.role) ?? role,
				status: i.status ?? "pending",
				createdAt: iso(i.createdAt),
			};
		},

		async createSignInTicket(userId, orgId, expiresInSeconds) {
			const token = await clerk.signInTokens.createSignInToken({
				userId,
				...(orgId ? { orgId } : {}),
				expiresInSeconds,
			});
			return token.token;
		},
	};
}
