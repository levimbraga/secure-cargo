import { describe, expect, it } from "vitest";

import { DEMO_LIFETIME_MS, type PurgeBucket, purgeDemoInspections } from "../src/purge";
import { createTestDb, FakeIdentity, seed } from "./helpers";

const NOW = new Date("2026-11-22T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;

class FakeBucket implements PurgeBucket {
	keys = new Set<string>();
	constructor(keys: string[]) {
		for (const key of keys) this.keys.add(key);
	}
	async delete(keys: string[]) {
		for (const key of keys) this.keys.delete(key);
	}
	async list({ prefix }: { prefix: string }) {
		return { objects: [...this.keys].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
	}
}

function world() {
	const db = createTestDb();
	seed(db, new FakeIdentity());
	const t = ago(2 * DEMO_LIFETIME_MS);
	db.raw.exec(`
		INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, title, seeded) VALUES
			('old_demo', 'org_a', 'demo_driver', '${t}', '${t}', 'Old demo', 0),
			('just_over', 'org_a', 'demo_driver', '${ago(DEMO_LIFETIME_MS + HOUR)}', '${t}', 'Just over a day', 0),
			('recent_demo', 'org_a', 'demo_driver', '${ago(HOUR)}', '${t}', 'Recent demo', 0),
			('seeded_demo', 'org_a', 'demo_driver', '${t}', '${t}', 'Seeded', 1);
		INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, created_at) VALUES
			('p1', 'old_demo', 'rear', 'photos/only-old.jpg', 'h1', 'image/jpeg', 1, '${t}'),
			('p2', 'old_demo', 'left', 'photos/shared.jpg', 'h2', 'image/jpeg', 1, '${t}'),
			('p3', 'recent_demo', 'rear', 'photos/shared.jpg', 'h2', 'image/jpeg', 1, '${t}'),
			('p4', 'just_over', 'rear', 'sample:/demo/samples/crates-ropes.jpg', 's', 'image/jpeg', 0, '${t}'),
			('p5', 'seeded_demo', 'rear', 'photos/seeded.jpg', 'h3', 'image/jpeg', 1, '${t}'),
			('p6', 'a1', 'rear', 'photos/alice.jpg', 'h4', 'image/jpeg', 1, '${t}');
		INSERT INTO scenarios (id, inspection_id, kind, draft_json, created_by, created_at) VALUES
			('s1', 'old_demo', 'as_loaded', '{}', 'demo_driver', '${t}');
		INSERT INTO results (id, inspection_id, scenario_id, situation, verdict, created_at) VALUES
			('r1', 'old_demo', 's1', 'emergency_braking', 'fail', '${t}');
	`);
	// Alice's inspections are older than a day too, but she is a real account.
	db.raw.exec(`UPDATE inspections SET created_at = '${t}' WHERE author_id = 'alice'`);
	const bucket = new FakeBucket([
		"photos/only-old.jpg",
		"photos/shared.jpg",
		"photos/seeded.jpg",
		"photos/alice.jpg",
		"results/old_demo/as_loaded.json",
		"results/old_demo/fixed.json",
		"results/recent_demo/as_loaded.json",
	]);
	return { db, bucket };
}

const ids = (db: ReturnType<typeof createTestDb>) =>
	(db.raw.prepare("SELECT id FROM inspections ORDER BY id").all() as { id: string }[]).map((r) => r.id);

describe("purgeDemoInspections", () => {
	it("deletes demo inspections older than 24 hours, with their rows and R2 objects", async () => {
		const { db, bucket } = world();
		const report = await purgeDemoInspections(db, bucket, NOW);
		expect(report.inspections.sort()).toEqual(["just_over", "old_demo"]);
		expect(ids(db)).not.toContain("old_demo");
		expect(ids(db)).not.toContain("just_over");
		for (const table of ["photos", "scenarios", "results"]) {
			expect(db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE inspection_id = 'old_demo'`).get()).toEqual({ n: 0 });
		}
		expect(bucket.keys.has("photos/only-old.jpg")).toBe(false);
		expect(bucket.keys.has("results/old_demo/as_loaded.json")).toBe(false);
		expect(bucket.keys.has("results/old_demo/fixed.json")).toBe(false);
		expect(report.objects).toBe(3);
	});

	it("never deletes the seeded inspections, recent ones, or anything of a real account", async () => {
		const { db, bucket } = world();
		await purgeDemoInspections(db, bucket, NOW);
		expect(ids(db)).toEqual(expect.arrayContaining(["seeded_demo", "recent_demo", "a1", "a2", "b1", "d1", "o1"]));
		expect(bucket.keys.has("photos/seeded.jpg")).toBe(true);
		expect(bucket.keys.has("photos/alice.jpg")).toBe(true);
		expect(bucket.keys.has("results/recent_demo/as_loaded.json")).toBe(true);
	});

	it("keeps a photo another inspection still uses", async () => {
		const { db, bucket } = world();
		await purgeDemoInspections(db, bucket, NOW);
		expect(bucket.keys.has("photos/shared.jpg")).toBe(true);
	});

	it("does nothing when there is nothing to reset", async () => {
		const { db, bucket } = world();
		await purgeDemoInspections(db, bucket, NOW);
		const second = await purgeDemoInspections(db, bucket, NOW);
		expect(second).toEqual({ inspections: [], objects: 0 });
	});

	it("a new inspection is not seeded: the cron may reset it", () => {
		const db = createTestDb();
		const t = NOW.toISOString();
		db.raw.exec(`INSERT INTO users (id, email, name, is_demo, created_at) VALUES ('u', NULL, 'Demo', 1, '${t}')`);
		db.raw.exec(`INSERT INTO inspections (id, author_id, created_at, updated_at) VALUES ('x', 'u', '${t}', '${t}')`);
		expect(db.raw.prepare("SELECT seeded FROM inspections WHERE id = 'x'").get()).toEqual({ seeded: 0 });
	});
});
