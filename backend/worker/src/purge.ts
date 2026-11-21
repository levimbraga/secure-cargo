/**
 * Demo reset, run by the Worker's cron (`wrangler.jsonc` triggers, every hour): inspections that
 * demo accounts made are deleted 24 hours after they were created, with their photos and stored
 * battery results in R2. The seeded inspections of the demo organization (`seeded = 1`, written by
 * `seed/demo.ts`) are never deleted, and nothing made by a real account is touched.
 *
 * Photos are stored once per content hash (`photos/<sha256>.jpg`), so a photo is deleted from R2
 * only when no remaining inspection uses it. Sample photos (`sample:` keys) are static files of
 * the site, not R2 objects.
 */
import type { Db } from "./db";

export const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
/**
 * Inspections per run. D1 allows 100 bound parameters per query, and each inspection has at most
 * 4 photos (80 keys). The cron runs every hour, so a backlog drains over a few runs.
 */
const BATCH = 20;

/** The part of an R2 bucket the purge uses. */
export interface PurgeBucket {
	delete(keys: string[]): Promise<void>;
	list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

export interface PurgeReport {
	inspections: string[];
	objects: number;
}

function placeholders(n: number): string {
	return Array.from({ length: n }, () => "?").join(", ");
}

async function keysWithPrefix(bucket: PurgeBucket, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		keys.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return keys;
}

export async function purgeDemoInspections(db: Db, bucket: PurgeBucket | null, now: Date = new Date()): Promise<PurgeReport> {
	const cutoff = new Date(now.getTime() - DEMO_LIFETIME_MS).toISOString();
	const { results: rows } = await db
		.prepare(
			`SELECT i.id FROM inspections i JOIN users u ON u.id = i.author_id
			 WHERE u.is_demo = 1 AND i.seeded = 0 AND i.created_at < ?
			 ORDER BY i.created_at LIMIT ${BATCH}`,
		)
		.bind(cutoff)
		.all<{ id: string }>();
	const ids = rows.map((r) => r.id);
	if (ids.length === 0) return { inspections: [], objects: 0 };

	const marks = placeholders(ids.length);
	const { results: photoRows } = await db
		.prepare(`SELECT DISTINCT r2_key FROM photos WHERE inspection_id IN (${marks})`)
		.bind(...ids)
		.all<{ r2_key: string }>();

	// Children first: D1 enforces the foreign keys, and this does not rely on the cascades.
	await db.batch(
		["fixes", "results", "scenarios", "photos"]
			.map((table) => db.prepare(`DELETE FROM ${table} WHERE inspection_id IN (${marks})`).bind(...ids))
			.concat(db.prepare(`DELETE FROM inspections WHERE id IN (${marks})`).bind(...ids)),
	);

	if (!bucket) return { inspections: ids, objects: 0 };
	const candidates = photoRows.map((r) => r.r2_key).filter((key) => key.startsWith("photos/"));
	let unused: string[] = [];
	if (candidates.length) {
		const { results: still } = await db
			.prepare(`SELECT DISTINCT r2_key FROM photos WHERE r2_key IN (${placeholders(candidates.length)})`)
			.bind(...candidates)
			.all<{ r2_key: string }>();
		const kept = new Set(still.map((r) => r.r2_key));
		unused = candidates.filter((key) => !kept.has(key));
	}
	const stored = (await Promise.all(ids.map((id) => keysWithPrefix(bucket, `results/${id}/`)))).flat();
	const objects = [...unused, ...stored];
	// R2 deletes up to 1,000 keys per call.
	for (let i = 0; i < objects.length; i += 1000) await bucket.delete(objects.slice(i, i + 1000));
	return { inspections: ids, objects: objects.length };
}
