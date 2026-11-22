import { describe, expect, it } from "vitest";

import type { PurgeBucket } from "../src/purge";
import { as, setup } from "./helpers";

class FakeBucket implements PurgeBucket {
	keys: Set<string>;
	constructor(keys: string[]) {
		this.keys = new Set(keys);
	}
	async delete(keys: string[]) {
		for (const key of keys) this.keys.delete(key);
	}
	async list({ prefix }: { prefix: string }) {
		return { objects: [...this.keys].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
	}
}

const T = "2026-11-21T12:00:00.000Z";

function world() {
	const bucket = new FakeBucket([
		"photos/alice.jpg",
		"photos/owner-only.jpg",
		"photos/shared.jpg",
		"invoices/owner.jpg",
		"results/o1/battery.json",
		"results/a1/battery.json",
	]);
	const env = setup({ extra: { purgeBucket: bucket } });
	env.db.raw.exec(`
		UPDATE inspections SET invoice_json = '{"gross_kg": 1200, "photo_key": "invoices/owner.jpg"}', notes = 'personal note' WHERE id = 'o1';
		INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, created_at) VALUES
			('p1', 'a1', 'rear', 'photos/alice.jpg', 'h1', 'image/jpeg', 1, '${T}'),
			('p2', 'o1', 'rear', 'photos/owner-only.jpg', 'h2', 'image/jpeg', 1, '${T}'),
			('p3', 'o1', 'left', 'photos/shared.jpg', 'h3', 'image/jpeg', 1, '${T}'),
			('p4', 'b1', 'left', 'photos/shared.jpg', 'h3', 'image/jpeg', 1, '${T}');
		INSERT INTO scenarios (id, inspection_id, kind, draft_json, created_by, created_at) VALUES
			('s1', 'a1', 'as_loaded', '{}', 'alice', '${T}'),
			('s2', 'o1', 'as_loaded', '{}', 'owner', '${T}'),
			('s3', 'b1', 'as_loaded', '{}', 'alice', '${T}');
		INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json) VALUES
			('e1', 'a1', 'alice', '${T}', 'created', '{}'),
			('e2', 'b1', 'alice', '${T}', 'shared', '{}');
		INSERT INTO certificates (id, inspection_id, org_id, issued_by, issued_at, content_json, content_hash) VALUES
			('SC-1', 'a1', 'org_a', 'alice', '${T}', '{}', 'h');
		INSERT INTO usage (id, user_id, org_id, kind, model, cost_usd, created_at) VALUES
			('u1', 'alice', 'org_a', 'photo_analysis', 'm', 0.03, '${T}');
		INSERT INTO trucks (id, owner_id, org_id, nickname, size, style, created_at, updated_at) VALUES
			('t1', 'alice', 'org_a', 'Blue truck', 'toco', 'platform', '${T}', '${T}');
	`);
	return { ...env, bucket };
}

const CONFIRM = { confirm: "DELETE" };

/** Every row of every table, as text: to prove an id or an email is gone from the database. */
function dump(raw: ReturnType<typeof setup>["db"]["raw"]): string {
	const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
	return tables.map((t) => JSON.stringify(raw.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
}

describe("DELETE /me", () => {
	it("keeps the member's organization inspections, anonymized", async () => {
		const { call, db, identity } = world();
		const response = await call("DELETE", "/me", as.alice, CONFIRM);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ deleted: true, deleted_inspections: 0, kept_inspections: 2 });

		const kept = db.raw.prepare("SELECT id, author_id FROM inspections WHERE id IN ('a1', 'a2') ORDER BY id").all() as { id: string; author_id: string }[];
		expect(kept).toHaveLength(2);
		const placeholder = kept[0]?.author_id as string;
		expect(placeholder).toMatch(/^deleted_/);
		expect(db.raw.prepare("SELECT email, name, blocked FROM users WHERE id = ?").get(placeholder)).toEqual({ email: null, name: null, blocked: 1 });

		// No row anywhere still points to her or holds her email or name.
		const all = dump(db.raw);
		expect(all).not.toContain('"alice"');
		expect(all).not.toContain("alice@example.com");
		expect(all).not.toContain('"Alice"');
		expect(all).not.toContain("Blue truck");
		expect(identity.deleted).toEqual(["alice"]);
	});

	it("logs the deletion on each kept inspection without personal data", async () => {
		const { call, db } = world();
		await call("DELETE", "/me", as.alice, CONFIRM);
		const events = db.raw.prepare("SELECT inspection_id, actor_id, detail_json FROM inspection_events WHERE kind = 'author_deleted' ORDER BY inspection_id").all();
		expect(events).toEqual([
			{ inspection_id: "a1", actor_id: null, detail_json: "{}" },
			{ inspection_id: "a2", actor_id: null, detail_json: "{}" },
		]);
	});

	it("lets the manager still read the kept inspections, with no author name", async () => {
		const { call } = world();
		await call("DELETE", "/me", as.alice, CONFIRM);
		const response = await call("GET", "/inspections/a1", as.carol);
		expect(response.status).toBe(200);
		expect(((await response.json()) as { author_name: string | null }).author_name).toBeNull();
	});

	it("keeps the usage records, so the monthly spend does not drop", async () => {
		const { call, db } = world();
		await call("DELETE", "/me", as.alice, CONFIRM);
		expect(db.raw.prepare("SELECT SUM(cost_usd) AS total FROM usage").get()).toEqual({ total: 0.03 });
	});

	it("deletes personal inspections with their photos, invoice and results in R2", async () => {
		const { call, db, bucket } = world();
		const response = await call("DELETE", "/me", as.owner, CONFIRM);
		expect(await response.json()).toMatchObject({ deleted_inspections: 1, kept_inspections: 0 });
		expect(db.raw.prepare("SELECT id FROM inspections WHERE id = 'o1'").all()).toHaveLength(0);
		expect(db.raw.prepare("SELECT id FROM users WHERE id = 'owner'").all()).toHaveLength(0);
		// The shared photo stays: another inspection still uses it.
		expect([...bucket.keys].sort()).toEqual(["photos/alice.jpg", "photos/shared.jpg", "results/a1/battery.json"]);
		expect(dump(db.raw)).not.toContain("personal note");
	});

	it("does not touch other people's data", async () => {
		const { call, db } = world();
		await call("DELETE", "/me", as.alice, CONFIRM);
		expect(db.raw.prepare("SELECT author_id FROM inspections WHERE id = 'b1'").get()).toEqual({ author_id: "bob" });
		expect(db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE id IN ('bob', 'carol', 'owner')").get()).toEqual({ n: 3 });
	});

	it("asks for the confirmation word", async () => {
		const { call, db } = world();
		const response = await call("DELETE", "/me", as.alice, { confirm: "delete" });
		expect(response.status).toBe(422);
		expect(db.raw.prepare("SELECT id FROM users WHERE id = 'alice'").all()).toHaveLength(1);
	});

	it("refuses demo sessions and signed-out callers", async () => {
		const { call } = world();
		expect((await call("DELETE", "/me", as.demoDriver, CONFIRM)).status).toBe(403);
		expect((await call("DELETE", "/me", undefined, CONFIRM)).status).toBe(401);
	});

	it("can be retried when the sign-in provider fails", async () => {
		const { call, db, identity } = world();
		identity.failDelete = true;
		expect((await call("DELETE", "/me", as.alice, CONFIRM)).status).toBe(502);
		identity.failDelete = false;
		expect((await call("DELETE", "/me", as.alice, CONFIRM)).status).toBe(200);
		expect(identity.deleted).toEqual(["alice"]);
		expect(db.raw.prepare("SELECT id FROM users WHERE id = 'alice'").all()).toHaveLength(0);
	});
});
