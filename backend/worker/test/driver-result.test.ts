/**
 * The driver result experience: the three-state verdict, the invoice reading (never invented),
 * the estimated weight, the re-inspection link, "My trucks" and the public summary link.
 */
import { describe, expect, it } from "vitest";

import type { BatteryJson } from "../src/fanout";
import type { InvoiceReader, Physics, PhotoStore } from "../src/flow";
import { parseBrazilianNumber, readingOf } from "../src/perception/invoice";
import { verdictState } from "../src/verdict";
import { as, setup } from "./helpers";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 4, 0, 0, 7, 0xff, 0xd9]);

function memoryStore(): PhotoStore & { objects: Map<string, Uint8Array> } {
	const objects = new Map<string, Uint8Array>();
	return {
		objects,
		async put(key, bytes) {
			objects.set(key, bytes);
		},
		async get(key) {
			const bytes = objects.get(key);
			return bytes ? { bytes, contentType: key.endsWith(".json") ? "application/json" : "image/jpeg" } : null;
		},
	};
}

const SITUATIONS = ["emergency_braking", "lane_change", "sharp_curve", "pothole", "speed_bump", "mountain_descent", "long_vibration"];
const SLID = { code: "unit_slid", severity: "fail", unit_id: "u1" };

function battery(kind: "approved" | "holds_noncompliant" | "fails"): BatteryJson {
	return {
		situations: SITUATIONS.map((id, n) => ({
			id,
			status: kind === "fails" && n === 0 ? "fail" : "pass",
			passed: !(kind === "fails" && n === 0),
			severity: 0,
			findings: kind === "fails" && n === 0 ? [SLID] : [],
			margins: {},
			event: {},
			trip: {},
			scenario_hash: id,
		})),
		passed: kind === "fails" ? 6 : 7,
		total: 7,
		contran_945: [{ code: "devices_allowed", status: kind === "holds_noncompliant" ? "fail" : "pass" }],
		checklist: { weight: [], protection: [], dimensions: [] },
		axle_loads: [],
	} as unknown as BatteryJson;
}

function physicsReturning(kinds: ("approved" | "holds_noncompliant" | "fails")[]): Physics {
	let n = 0;
	return {
		async battery() {
			return battery(kinds[Math.min(n++, kinds.length - 1)] ?? "approved");
		},
		async plan() {
			return { draft: {}, changes: [], verified: true, rounds: 1, battery: battery("approved") };
		},
	};
}

const draft = (total: number) => ({
	version: 1,
	source: "photo",
	truck: { body: "flatbed", size: "three_quarter", style: "open_low_sides", headboard_height_m: 1.2 },
	trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
	restraint: "top_over",
	units: [{ id: "u1", cargo: "crate", x_m: 1, y_m: 0, straps: 2, mass_kg: total }],
});

function readerAnswering(answer: unknown): InvoiceReader & { calls: number } {
	const reader = {
		model: "claude-test",
		calls: 0,
		async read() {
			reader.calls += 1;
			return { reading: readingOf(answer), model: "claude-test", inputTokens: 1500, outputTokens: 60, costUsd: 0.007 };
		},
	};
	return reader;
}

function ctx(options: { kinds?: ("approved" | "holds_noncompliant" | "fails")[]; reader?: InvoiceReader } = {}) {
	const photos = memoryStore();
	const c = setup({ flow: { photos, physics: physicsReturning(options.kinds ?? ["fails"]), invoiceReader: options.reader ?? null } });
	const create = async (token: string, body: unknown = {}) => {
		const response = await c.call("POST", "/inspections", token, body);
		return { status: response.status, id: ((await response.json()) as { id: string }).id };
	};
	const raw = (path: string, token: string, bytes: Uint8Array) =>
		c.app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "https://securecargo.app" }, body: bytes });
	return { ...c, photos, create, raw };
}

describe("the three-state verdict", () => {
	it("is approved, yellow or red, and never red when every situation holds", () => {
		expect(verdictState(battery("approved"))).toBe("approved");
		expect(verdictState(battery("holds_noncompliant"))).toBe("holds_noncompliant");
		expect(verdictState(battery("fails"))).toBe("fails");
		const axleOnly = { ...battery("approved"), situations: battery("approved").situations.map((s) => ({ ...s, findings: [{ code: "axle_overloaded", severity: "fail" }] })) };
		expect(verdictState(axleOnly)).toBe("approved");
		expect(verdictState({ ...axleOnly, checklist: { weight: [{ kind: "rule", status: "fail" }] } })).toBe("holds_noncompliant");
		expect(verdictState({ ...battery("approved"), checklist: { protection: [{ kind: "advice", status: "advice" }] } })).toBe("approved");
	});

	it("is stored as pass, warning or fail", async () => {
		const { create, call } = ctx({ kinds: ["holds_noncompliant"] });
		const { id } = await create(as.alice);
		await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draft(800), cargo_weight_kg: 800 });
		await call("POST", `/inspections/${id}/simulate`, as.alice);
		const saved = (await (await call("GET", `/inspections/${id}`, as.alice)).json()) as { verdict: string; truck_json: string; truck_size: string | null };
		expect(saved.verdict).toBe("warning");
		// A 3/4 truck is kept in truck_json; the old column only knows the four first sizes.
		expect(saved.truck_size).toBeNull();
		expect(JSON.parse(saved.truck_json)).toMatchObject({ size: "three_quarter", style: "open_low_sides", headboard_height_m: 1.2 });
	});
});

describe("reading the weight off the invoice", () => {
	it("parses only what is printed, in the Brazilian number format", () => {
		expect(parseBrazilianNumber("1.234,500")).toBe(1234.5);
		expect(parseBrazilianNumber("12.000")).toBe(12000);
		expect(parseBrazilianNumber("850")).toBe(850);
		expect(parseBrazilianNumber("about 900")).toBeNull();
		expect(parseBrazilianNumber("")).toBeNull();
		expect(parseBrazilianNumber("1,2,3")).toBeNull();
	});

	it("never invents a weight", () => {
		const good = { is_invoice: true, found: true, label: "PESO BRUTO", text: "1.840,000", unit: "kg" };
		expect(readingOf(good).gross_kg).toBe(1840);
		expect(readingOf({ ...good, found: false }).gross_kg).toBeNull();
		expect(readingOf({ ...good, is_invoice: false }).gross_kg).toBeNull();
		expect(readingOf({ ...good, label: "PESO LÍQUIDO" }).gross_kg).toBeNull(); // another box
		expect(readingOf({ ...good, text: "approx. 1840" }).gross_kg).toBeNull();
		expect(readingOf({ ...good, text: "" }).gross_kg).toBeNull();
		expect(readingOf({ ...good, gross_kg: 5000, text: "" }).gross_kg).toBeNull(); // a number field is ignored
		expect(readingOf({ ...good, text: "2,5", unit: "t" }).gross_kg).toBe(2500);
		expect(readingOf({ ...good, text: "900.000" }).gross_kg).toBeNull(); // 900 t: not a truck load
		expect(readingOf(null).gross_kg).toBeNull();
	});

	it("is shown for confirmation, saved with the inspection, cached and counted as usage", async () => {
		const reader = readerAnswering({ is_invoice: true, found: true, label: "PESO BRUTO", text: "1.840,000", unit: "kg" });
		const { create, raw, call, db, photos } = ctx({ reader });
		const { id } = await create(as.alice);
		const first = (await (await raw(`/inspections/${id}/invoice`, as.alice, JPEG)).json()) as { mode: string; reading: { gross_kg: number; photo_key: string } };
		expect(first).toMatchObject({ mode: "live", reading: { gross_kg: 1840 } });
		expect(photos.objects.has(first.reading.photo_key)).toBe(true);
		const again = (await (await raw(`/inspections/${id}/invoice`, as.alice, JPEG)).json()) as { mode: string };
		expect(again.mode).toBe("cached");
		expect(reader.calls).toBe(1);
		const saved = (await (await call("GET", `/inspections/${id}`, as.alice)).json()) as { invoice_json: string };
		expect(JSON.parse(saved.invoice_json)).toMatchObject({ gross_kg: 1840, text: "1.840,000" });
		expect(db.raw.prepare("SELECT COUNT(*) AS n FROM usage").get()).toEqual({ n: 2 });
		expect((await raw(`/inspections/${id}/invoice`, as.bob, JPEG)).status).toBe(404);
	});

	it("answers not found, never a number, when the box is unreadable", async () => {
		const reader = readerAnswering({ is_invoice: true, found: false, label: "", text: "", unit: "none" });
		const { create, raw } = ctx({ reader });
		const { id } = await create(as.alice);
		const answer = (await (await raw(`/inspections/${id}/invoice`, as.alice, JPEG)).json()) as { reading: { gross_kg: number | null } };
		expect(answer.reading.gross_kg).toBeNull();
	});
});

describe("an estimated weight", () => {
	it("is labelled estimated and simulated at the upper bound of its range", async () => {
		const { create, call } = ctx();
		const { id } = await create(as.alice);
		const put = (body: Record<string, unknown>) => call("PUT", `/inspections/${id}/draft`, as.alice, body);
		const low = await put({ draft: draft(900), cargo_weight_kg: 900, weight_source: "estimated", weight_range: { low_kg: 900, high_kg: 1400 } });
		expect(low.status).toBe(422);
		expect(((await low.json()) as { detail: { code: string } }).detail.code).toBe("estimate_not_upper_bound");
		expect((await put({ draft: draft(1400), cargo_weight_kg: 1400, weight_source: "estimated" })).status).toBe(422);
		const ok = await put({ draft: draft(1400), cargo_weight_kg: 1400, weight_source: "estimated", weight_range: { low_kg: 900, high_kg: 1400 } });
		expect(ok.status).toBe(200);
		const saved = (await (await call("GET", `/inspections/${id}`, as.alice)).json()) as { weight_source: string; weight_range_json: string };
		expect(saved.weight_source).toBe("estimated");
		expect(JSON.parse(saved.weight_range_json)).toEqual({ low_kg: 900, high_kg: 1400 });
	});

	it("defaults to measured", async () => {
		const { create, call } = ctx();
		const { id } = await create(as.alice);
		await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draft(800), cargo_weight_kg: 800 });
		expect(((await (await call("GET", `/inspections/${id}`, as.alice)).json()) as { weight_source: string }).weight_source).toBe("measured");
	});
});

describe("the re-inspection", () => {
	it("links the new photo's inspection to the first, which is proven only when the new one passes", async () => {
		const { create, call } = ctx({ kinds: ["fails", "fails", "approved"] });
		const { id: first } = await create(as.alice);
		const run = async (id: string) => {
			await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draft(800), cargo_weight_kg: 800 });
			await call("POST", `/inspections/${id}/simulate`, as.alice);
		};
		await run(first);
		const retry = await create(as.alice, { reinspection_of: first });
		expect(retry.status).toBe(201);
		await run(retry.id); // still fails
		type Read = { proven_by: string | null; reinspections: { id: string; verdict: string }[]; reinspection_of: string | null };
		let parent = (await (await call("GET", `/inspections/${first}`, as.alice)).json()) as Read;
		expect(parent.proven_by).toBeNull();
		expect(parent.reinspections.map((r) => r.verdict)).toEqual(["fail"]);
		const proof = await create(as.alice, { reinspection_of: first });
		await run(proof.id); // approved
		parent = (await (await call("GET", `/inspections/${first}`, as.alice)).json()) as Read;
		expect(parent.proven_by).toBe(proof.id);
		const child = (await (await call("GET", `/inspections/${proof.id}`, as.alice)).json()) as Read;
		expect(child.reinspection_of).toBe(first);
		// The manager sees it in the org list.
		const list = (await (await call("GET", "/inspections?scope=org", as.carol)).json()) as { inspections: Read[] & { id: string }[] };
		expect((list.inspections as unknown as { id: string; proven_by: string | null }[]).find((i) => i.id === first)?.proven_by).toBe(proof.id);
	});

	it("is only for the author of the first inspection", async () => {
		const { create } = ctx();
		const { id } = await create(as.alice);
		expect((await create(as.bob, { reinspection_of: id })).status).toBe(404); // cannot see it
		expect((await create(as.carol, { reinspection_of: id })).status).toBe(403); // reads, cannot redo
		expect((await create(as.erin, { reinspection_of: id })).status).toBe(404); // another org
		expect((await create(as.alice, { reinspection_of: "nope" })).status).toBe(404);
	});
});

describe("my trucks", () => {
	it("are saved without a plate and seen only by their owner", async () => {
		const { call } = ctx();
		const created = await call("POST", "/trucks", as.alice, { nickname: "Blue 3/4", size: "three_quarter", style: "open_tall_rack", headboard_height_m: 1.6, bed_length_m: 5.4, anchors_per_side: 8 });
		expect(created.status).toBe(201);
		const truck = (await created.json()) as { id: string; headboard_height_m: number };
		expect(truck.headboard_height_m).toBe(1.6);
		expect(((await (await call("GET", "/trucks", as.alice)).json()) as { trucks: unknown[] }).trucks).toHaveLength(1);
		expect(((await (await call("GET", "/trucks", as.bob)).json()) as { trucks: unknown[] }).trucks).toHaveLength(0);
		expect((await call("PATCH", `/trucks/${truck.id}`, as.bob, { nickname: "mine" })).status).toBe(404);
		expect((await call("PATCH", `/trucks/${truck.id}`, as.carol, { nickname: "mine" })).status).toBe(404);
		expect((await call("PATCH", `/trucks/${truck.id}`, as.alice, { headboard_height_m: 1.8 })).status).toBe(200);
		expect((await call("POST", "/trucks", as.alice, { size: "huge", style: "box" })).status).toBe(422);
		expect((await call("POST", "/trucks", as.alice, { nickname: "no size" })).status).toBe(422);
		expect((await call("DELETE", `/trucks/${truck.id}`, as.bob)).status).toBe(404);
		expect((await call("DELETE", `/trucks/${truck.id}`, as.alice)).status).toBe(200);
		expect((await call("GET", "/trucks")).status).toBe(401);
	});
});

describe("the public summary link", () => {
	it("shows the verdict and checks without the driver's name unless the org allows it", async () => {
		const { create, call, raw, db } = ctx({ kinds: ["holds_noncompliant"] });
		const { id } = await create(as.alice);
		await raw(`/inspections/${id}/photos?position=left`, as.alice, JPEG);
		await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draft(800), cargo_weight_kg: 800 });
		await call("POST", `/inspections/${id}/simulate`, as.alice);
		expect((await call("POST", `/inspections/${id}/share`, as.bob)).status).toBe(404);
		const shared = (await (await call("POST", `/inspections/${id}/share`, as.alice)).json()) as { token: string; path: string };
		expect(shared.path).toBe(`/app/share?t=${shared.token}`);
		// Sharing again gives the same link.
		expect(((await (await call("POST", `/inspections/${id}/share`, as.carol)).json()) as { token: string }).token).toBe(shared.token);
		type Summary = { verdict: string; driver_name: string | null; photo: { path: string }; checks: { contran_945: unknown[] }; author_id?: string };
		const summary = (await (await call("GET", `/share/${shared.token}`)).json()) as Summary;
		expect(summary.verdict).toBe("warning");
		expect(summary.driver_name).toBeNull();
		expect(summary.author_id).toBeUndefined();
		expect(summary.checks.contran_945).toHaveLength(1);
		expect((await call("GET", summary.photo.path)).status).toBe(200);
		db.raw.exec("UPDATE organizations SET share_driver_name = 1 WHERE id = 'org_a'");
		expect(((await (await call("GET", `/share/${shared.token}`)).json()) as Summary).driver_name).toBe("Alice");
		await call("DELETE", `/inspections/${id}/share`, as.alice);
		expect((await call("GET", `/share/${shared.token}`)).status).toBe(404);
		expect((await call("GET", "/share/short")).status).toBe(404);
	});
});
