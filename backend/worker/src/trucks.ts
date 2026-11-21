/**
 * "My trucks": a driver saves a truck once (body style, size, bed length, headboard height,
 * anchor points, an optional nickname; no plate) and picks it before the photo.
 *
 *   GET    /trucks          my saved trucks, most recently used first
 *   POST   /trucks          save a truck
 *   PATCH  /trucks/:id      change it
 *   DELETE /trucks/:id      remove it
 *
 * A truck belongs to the person who saved it: nobody else reads or changes it (404), the
 * platform admin included only for reading, as support.
 */
import type { Context, Hono, MiddlewareHandler } from "hono";

import type { Principal } from "./authz";
import { type Db, newId, now } from "./db";
import { fail, field, jsonBody, notFound } from "./http";

type Env = { Variables: { principal: Principal } };

export const TRUCK_SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"] as const;
export const BODY_STYLES = ["open_low_sides", "open_tall_rack", "platform", "box", "curtain_sider"] as const;
export type BodyStyle = (typeof BODY_STYLES)[number];
/** The body the physics engine simulates for each style (`backend/app/explorer/draft.py`). */
export const STYLE_BODY: Record<BodyStyle, "flatbed" | "box" | "curtain_sider"> = {
	open_low_sides: "flatbed",
	open_tall_rack: "flatbed",
	platform: "flatbed",
	box: "box",
	curtain_sider: "curtain_sider",
};
const MAX_TRUCKS = 20;
const COLUMNS = "id, nickname, size, style, bed_length_m, headboard_height_m, anchors_per_side, created_at, updated_at";

interface TruckRow {
	id: string;
	owner_id: string;
}

function readTruck(body: Record<string, unknown>, partial: boolean) {
	const size = field.optionalEnum(body, "size", TRUCK_SIZES);
	const style = field.optionalEnum(body, "style", BODY_STYLES);
	if (!partial && (!size || !style)) fail(422, "invalid_field", "A truck needs a size and a body style.");
	const anchors = field.optionalNumber(body, "anchors_per_side", 2, 40);
	if (anchors !== undefined && anchors !== null && !Number.isInteger(anchors)) {
		fail(422, "invalid_field", "anchors_per_side must be a whole number.");
	}
	return {
		nickname: field.optionalString(body, "nickname", 40)?.trim(),
		size: size ?? undefined,
		style: style ?? undefined,
		bed_length_m: field.optionalNumber(body, "bed_length_m", 2, 15),
		headboard_height_m: field.optionalNumber(body, "headboard_height_m", 0.1, 4),
		anchors_per_side: anchors,
	};
}

export function registerTrucks(app: Hono<Env>, db: Db, authenticated: MiddlewareHandler<Env>): void {
	async function own(c: Context<Env>, write: boolean): Promise<TruckRow> {
		const p = c.get("principal");
		const row = await db.prepare("SELECT id, owner_id FROM trucks WHERE id = ?").bind(c.req.param("id")).first<TruckRow>();
		const allowed = row && (row.owner_id === p.userId || (!write && p.isPlatformAdmin));
		if (!row || !allowed) notFound();
		return row;
	}

	app.get("/trucks", authenticated, async (c) => {
		const p = c.get("principal");
		const { results } = await db.prepare(`SELECT ${COLUMNS} FROM trucks WHERE owner_id = ? ORDER BY updated_at DESC`).bind(p.userId).all();
		return c.json({ trucks: results });
	});

	app.post("/trucks", authenticated, async (c) => {
		const p = c.get("principal");
		const truck = readTruck(await jsonBody(c), false);
		const count = await db.prepare("SELECT COUNT(*) AS n FROM trucks WHERE owner_id = ?").bind(p.userId).first<{ n: number }>();
		if ((count?.n ?? 0) >= MAX_TRUCKS) fail(422, "too_many_trucks", `Save at most ${MAX_TRUCKS} trucks.`);
		const id = newId("trk");
		const at = now();
		await db
			.prepare(
				`INSERT INTO trucks (id, owner_id, org_id, nickname, size, style, bed_length_m, headboard_height_m, anchors_per_side, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				p.userId,
				p.orgId,
				truck.nickname ?? "",
				truck.size,
				truck.style,
				truck.bed_length_m ?? null,
				truck.headboard_height_m ?? null,
				truck.anchors_per_side ?? null,
				at,
				at,
			)
			.run();
		return c.json(await db.prepare(`SELECT ${COLUMNS} FROM trucks WHERE id = ?`).bind(id).first(), 201);
	});

	app.patch("/trucks/:id", authenticated, async (c) => {
		const row = await own(c, true);
		const truck = readTruck(await jsonBody(c), true);
		const updates = Object.entries(truck).filter(([, value]) => value !== undefined);
		if (updates.length) {
			updates.push(["updated_at", now()]);
			await db
				.prepare(`UPDATE trucks SET ${updates.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
				.bind(...updates.map(([, v]) => v), row.id)
				.run();
		}
		return c.json(await db.prepare(`SELECT ${COLUMNS} FROM trucks WHERE id = ?`).bind(row.id).first());
	});

	app.delete("/trucks/:id", authenticated, async (c) => {
		const row = await own(c, true);
		await db.prepare("DELETE FROM trucks WHERE id = ?").bind(row.id).run();
		return c.json({ deleted: true });
	});
}
