/**
 * Self-service account deletion (`DELETE /me`), for real accounts only (demo visitors have no
 * account; their sandbox is purged after 24 h anyway).
 *
 * What happens, in this order:
 * 1. Inspections the person made **outside an organization** are deleted, with their photos,
 *    invoice photos and stored results in R2 (`deleteInspections`).
 * 2. Inspections they made **inside an organization** stay with the organization, for its
 *    records, but no longer point to them: their author, the scenarios they confirmed, the events
 *    they caused and the certificates they issued are moved to an anonymous placeholder user (a new
 *    random id, no email, no name). Each kept inspection gets an `author_deleted` event, with no
 *    personal data in it.
 * 3. Usage records (the cost of photo analyses) are moved to the same placeholder, so the monthly
 *    budget still counts what was spent.
 * 4. Their saved trucks, memberships and user row are deleted.
 * 5. Last, the identity is deleted in Clerk (which also ends every session). If that call fails,
 *    the person can retry: steps 1-4 find nothing left to do.
 */
import type { Hono, MiddlewareHandler } from "hono";

import { type Db, newId, now } from "./db";
import { logEvent } from "./events";
import { fail, jsonBody } from "./http";
import type { Principal } from "./authz";
import { deleteInspections, type PurgeBucket } from "./purge";

/** The word the client must send to confirm (the page asks for it in the visitor's language). */
export const DELETE_CONFIRMATION = "DELETE";

export interface DeletionReport {
	deletedInspections: number;
	keptInspections: number;
	objects: number;
	placeholderId: string | null;
}

export async function deleteAccountData(db: Db, bucket: PurgeBucket | null, userId: string, at: string = now()): Promise<DeletionReport> {
	const { results: personal } = await db
		.prepare("SELECT id FROM inspections WHERE author_id = ? AND org_id IS NULL")
		.bind(userId)
		.all<{ id: string }>();
	const objects = await deleteInspections(db, bucket, personal.map((r) => r.id));

	const { results: kept } = await db
		.prepare("SELECT id FROM inspections WHERE author_id = ? AND org_id IS NOT NULL")
		.bind(userId)
		.all<{ id: string }>();
	const refs = await db
			.prepare(
				`SELECT (SELECT COUNT(*) FROM scenarios WHERE created_by = ?) + (SELECT COUNT(*) FROM inspection_events WHERE actor_id = ?)
				      + (SELECT COUNT(*) FROM certificates WHERE issued_by = ?) + (SELECT COUNT(*) FROM usage WHERE user_id = ?) AS n`,
			)
			.bind(userId, userId, userId, userId)
			.first<{ n: number }>();

	let placeholderId: string | null = null;
	if (kept.length > 0 || (refs?.n ?? 0) > 0) {
		placeholderId = newId("deleted");
		await db
			.prepare("INSERT INTO users (id, email, name, is_demo, blocked, created_at) VALUES (?, NULL, NULL, 0, 1, ?)")
			.bind(placeholderId, at)
			.run();
		await db.batch([
			db.prepare("UPDATE inspections SET author_id = ? WHERE author_id = ?").bind(placeholderId, userId),
			db.prepare("UPDATE scenarios SET created_by = ? WHERE created_by = ?").bind(placeholderId, userId),
			db.prepare("UPDATE inspection_events SET actor_id = ? WHERE actor_id = ?").bind(placeholderId, userId),
			db.prepare("UPDATE certificates SET issued_by = ? WHERE issued_by = ?").bind(placeholderId, userId),
			db.prepare("UPDATE usage SET user_id = ? WHERE user_id = ?").bind(placeholderId, userId),
		]);
		for (const { id } of kept) await logEvent(db, id, null, "author_deleted", {}, at);
	}

	await db.batch([
		db.prepare("DELETE FROM trucks WHERE owner_id = ?").bind(userId),
		db.prepare("DELETE FROM memberships WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
	]);
	return { deletedInspections: personal.length, keptInspections: kept.length, objects, placeholderId };
}

export interface AccountDeps {
	db: Db;
	bucket: PurgeBucket | null;
	/** Deletes the identity at the sign-in provider (Clerk). */
	deleteIdentity(userId: string): Promise<void>;
}

type Env = { Variables: { principal: Principal } };

export function registerAccount(app: Hono<Env>, deps: AccountDeps, authenticated: MiddlewareHandler<Env>): void {
	app.delete("/me", authenticated, async (c) => {
		const p = c.get("principal");
		if (p.isDemo) fail(403, "demo_account", "Demo sessions have no account to delete. Use Exit instead.");
		const body = await jsonBody(c);
		if (body.confirm !== DELETE_CONFIRMATION) fail(422, "confirmation_required", `Send {"confirm": "${DELETE_CONFIRMATION}"} to delete the account.`);

		const report = await deleteAccountData(deps.db, deps.bucket, p.userId);
		try {
			await deps.deleteIdentity(p.userId);
		} catch (error) {
			console.error("Clerk user deletion failed:", (error as Error).message);
			fail(502, "identity_delete_failed", "Your data was deleted, but signing you out of the account failed. Try again.");
		}
		console.log(`Account deleted: ${report.deletedInspections} inspections deleted, ${report.keptInspections} kept anonymized, ${report.objects} R2 objects.`);
		c.header("Cache-Control", "no-store");
		return c.json({ deleted: true, deleted_inspections: report.deletedInspections, kept_inspections: report.keptInspections });
	});
}
