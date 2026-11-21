/** The inspection flow: photos, analysis (cache, quota, kill switch), weights, battery and fix. */
import { describe, expect, it } from "vitest";

import type { BatteryJson } from "../src/fanout";
import type { Analyzer, Physics, PhotoStore, SamplePhoto } from "../src/flow";
import type { PhotoInput } from "../src/perception/claude";
import { sanitizeAnalysis } from "../src/perception/schema";
import { as, setup } from "./helpers";

/** A tiny JPEG: SOI, JFIF, an EXIF segment with a GPS tag, a scan, EOI. */
function jpegWithGps(seed = 0): Uint8Array {
	const exif = new TextEncoder().encode("Exif\0\0GPSLatitude=-23.55;GPSLongitude=-46.63");
	const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
	const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
	const scan = [0xff, 0xda, 0, 4, 0, 0, 1, 2, 3, seed, 0xff, 0xd9];
	return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...scan]);
}

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

/** What the model "answers": includes a weight, which must never get through. */
const MODEL_ANSWER = {
	is_truck_load: true,
	truck: { body: "flatbed", size: "toco", confidence: 0.8, uncertain: "", weight_kg: 9000 },
	units: [
		{ number: 1, cargo: "wood_pallet", length_m: 1.2, width_m: 1, height_m: 1.1, along: 0.2, across: 0.5, stacked_on: null, photo: 0, box: [0.1, 0.2, 0.4, 0.8], confidence: 0.9, uncertain: "", mass_kg: 900 },
		{ number: 2, cargo: "wood_pallet", length_m: 1.2, width_m: 1, height_m: 1.1, along: 0.5, across: 0.5, stacked_on: null, photo: 0, box: [0.5, 0.2, 0.8, 0.8], confidence: 0.7, uncertain: "partly hidden", weight: 800 },
	],
	restraints: [{ kind: "strap", count: 2, routing: "top_over", units: [1, 2], confidence: 0.8, uncertain: "" }],
	violations: [],
	overall_confidence: 0.8,
	summary: "Two pallets with two straps.",
};

function fakeAnalyzer(): Analyzer & { calls: PhotoInput[][] } {
	const calls: PhotoInput[][] = [];
	return {
		model: "claude-test",
		calls,
		async analyze(photos) {
			calls.push(photos);
			return { analysis: sanitizeAnalysis(MODEL_ANSWER, photos.length), model: "claude-test", inputTokens: 3000, outputTokens: 800, costUsd: 0.014 };
		},
	};
}

const BATTERY = {
	passed: 4,
	total: 7,
	status: "fail",
	worst: "emergency_braking",
	situations: ["emergency_braking", "lane_change", "sharp_curve", "pothole", "speed_bump", "mountain_descent", "long_vibration"].map((id, n) => ({
		id,
		status: n < 3 ? "fail" : "pass",
		findings: n < 3 ? [{ code: "unit_slid", severity: "fail", unit_id: "unit-1" }] : [],
		margins: {},
		event: { kind: id },
		trip: {},
		severity: n < 3 ? 2 : 0,
		scenario_hash: `hash-${id}`,
	})),
	contran_945: [{ code: "four_terminals", status: "fail" }],
	recommendation: { draft: {}, changes: [{ code: "straps" }] },
};

function fakePhysics(): Physics & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async battery() {
			calls.push("/battery");
			return BATTERY as unknown as BatteryJson;
		},
		async plan() {
			calls.push("/plan");
			const passing = {
				...BATTERY,
				passed: 7,
				status: "pass",
				situations: BATTERY.situations.map((s) => ({ ...s, status: "pass", findings: [] })),
				contran_945: [{ code: "four_terminals", status: "pass" }],
			};
			return { draft: { version: 1 }, changes: [{ code: "straps" }], verified: true, rounds: 1, battery: passing as unknown as BatteryJson };
		},
	};
}

const SAMPLE: SamplePhoto = {
	id: "pallets",
	photos: [{ position: "rear", path: "/demo/samples/pallets/rear.jpg", sha256: "sample-hash" }],
	analysis: sanitizeAnalysis(MODEL_ANSWER, 1),
};

function flowSetup() {
	const photos = memoryStore();
	const analyzer = fakeAnalyzer();
	const physics = fakePhysics();
	const ctx = setup({ flow: { photos, analyzer, physics, samples: { pallets: SAMPLE } } });
	const upload = (id: string, token: string, bytes: Uint8Array, position = "rear") =>
		ctx.app.request(`/inspections/${id}/photos?position=${position}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", Origin: "https://securecargo.app" },
			body: bytes,
		});
	const create = async (token: string, body: unknown = {}) =>
		((await (await ctx.call("POST", "/inspections", token, body)).json()) as { id: string }).id;
	return { ...ctx, photos, analyzer, physics, upload, create };
}

const draftFor = (masses: (number | null)[]) => ({
	version: 1,
	source: "photo",
	truck: { body: "flatbed", size: "toco" },
	trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
	restraint: "top_over",
	units: masses.map((mass_kg, n) => ({ id: `u${n + 1}`, cargo: "wood_pallet", x_m: 2 - n * 1.3, y_m: 0, straps: 2, mass_kg })),
});

describe("photos", () => {
	it("are stored without EXIF or GPS, keyed by hash", async () => {
		const { create, upload, photos } = flowSetup();
		const id = await create(as.alice);
		const response = await upload(id, as.alice, jpegWithGps());
		expect(response.status).toBe(201);
		const body = (await response.json()) as { sha256: string };
		const stored = photos.objects.get(`photos/${body.sha256}.jpg`);
		expect(stored).toBeDefined();
		const text = new TextDecoder("latin1").decode(stored);
		expect(text).not.toContain("GPS");
		expect(text).not.toContain("Exif");
		expect(text).toContain("JFIF");
	});

	it("only the author adds photos, at most four, and only JPEG or PNG", async () => {
		const { create, upload } = flowSetup();
		const id = await create(as.alice);
		expect((await upload(id, as.bob, jpegWithGps())).status).toBe(404); // another member: unseen
		expect((await upload(id, as.carol, jpegWithGps())).status).toBe(403); // the manager reads only
		expect((await upload(id, as.dave, jpegWithGps())).status).toBe(404);
		expect((await upload(id, as.alice, new TextEncoder().encode("GIF89a..."))).status).toBe(415);
		for (let n = 0; n < 4; n++) expect((await upload(id, as.alice, jpegWithGps(n))).status).toBe(201);
		expect((await upload(id, as.alice, jpegWithGps(9))).status).toBe(422);
	});

	it("are served only to those who can read the inspection", async () => {
		const { create, upload, call } = flowSetup();
		const id = await create(as.alice);
		const { id: photoId } = (await (await upload(id, as.alice, jpegWithGps())).json()) as { id: string };
		expect((await call("GET", `/inspections/${id}/photos/${photoId}`, as.alice)).status).toBe(200);
		expect((await call("GET", `/inspections/${id}/photos/${photoId}`, as.carol)).status).toBe(200); // org_admin
		expect((await call("GET", `/inspections/${id}/photos/${photoId}`, as.bob)).status).toBe(404);
		expect((await call("GET", `/inspections/${id}/photos/${photoId}`, as.erin)).status).toBe(404);
	});
});

describe("photo analysis", () => {
	it("is cached by photo hash: a repeated photo is never billed again", async () => {
		const { create, upload, call, analyzer, db } = flowSetup();
		const first = await create(as.alice);
		await upload(first, as.alice, jpegWithGps());
		const live = (await (await call("POST", `/inspections/${first}/analyze`, as.alice)).json()) as { mode: string };
		expect(live.mode).toBe("live");
		const second = await create(as.alice);
		await upload(second, as.alice, jpegWithGps());
		const cached = (await (await call("POST", `/inspections/${second}/analyze`, as.alice)).json()) as { mode: string };
		expect(cached.mode).toBe("cached");
		expect(analyzer.calls).toHaveLength(1);
		const usage = db.raw.prepare("SELECT cached, cost_usd FROM usage ORDER BY created_at").all() as { cached: number; cost_usd: number }[];
		expect(usage).toEqual([
			{ cached: 0, cost_usd: 0.014 },
			{ cached: 1, cost_usd: 0 },
		]);
	});

	it("counts against the daily quota and answers demo mode past it", async () => {
		const { create, upload, call, analyzer, db } = flowSetup();
		db.raw.exec("UPDATE users SET daily_analysis_quota = 1 WHERE id = 'alice'");
		const a = await create(as.alice);
		await upload(a, as.alice, jpegWithGps(1));
		expect(((await (await call("POST", `/inspections/${a}/analyze`, as.alice)).json()) as { mode: string }).mode).toBe("live");
		const b = await create(as.alice);
		await upload(b, as.alice, jpegWithGps(2));
		const denied = (await (await call("POST", `/inspections/${b}/analyze`, as.alice)).json()) as { mode: string; reason: string };
		expect(denied).toMatchObject({ mode: "demo", reason: "quota_exceeded" });
		expect(analyzer.calls).toHaveLength(1);
	});

	it("respects the kill switch and the monthly cap", async () => {
		const { create, upload, call, analyzer, db } = flowSetup();
		const id = await create(as.alice);
		await upload(id, as.alice, jpegWithGps());
		db.raw.exec("UPDATE settings SET value = 'true' WHERE key = 'kill_switch'");
		expect(await (await call("POST", `/inspections/${id}/analyze`, as.alice)).json()).toMatchObject({ mode: "demo", reason: "kill_switch" });
		db.raw.exec("UPDATE settings SET value = 'false' WHERE key = 'kill_switch'");
		db.raw.exec(`INSERT INTO usage (id, user_id, kind, cost_usd, created_at) VALUES ('u', 'bob', 'photo_analysis', 80, '${new Date().toISOString()}')`);
		expect(await (await call("POST", `/inspections/${id}/analyze`, as.alice)).json()).toMatchObject({ mode: "demo", reason: "budget_cap" });
		expect(analyzer.calls).toHaveLength(0);
	});

	it("never passes on a weight, whatever the model writes", async () => {
		const { create, upload, call } = flowSetup();
		const id = await create(as.alice);
		await upload(id, as.alice, jpegWithGps());
		const { analysis } = (await (await call("POST", `/inspections/${id}/analyze`, as.alice)).json()) as { analysis: unknown };
		const json = JSON.stringify(analysis);
		expect(json).not.toMatch(/mass|weight|kg/i);
		expect((analysis as { units: unknown[] }).units).toHaveLength(2);
	});

	it("of a sample photo costs nothing and needs no API key", async () => {
		const { create, call, analyzer, db } = flowSetup();
		const id = await create(as.demoDriver, { sample: "pallets" });
		const body = (await (await call("POST", `/inspections/${id}/analyze`, as.demoDriver)).json()) as { mode: string };
		expect(body.mode).toBe("sample");
		expect(analyzer.calls).toHaveLength(0);
		expect(db.raw.prepare("SELECT COUNT(*) AS n FROM usage").get()).toEqual({ n: 0 });
		expect((await call("POST", "/inspections", as.alice, { sample: "nope" })).status).toBe(422);
	});
});

describe("confirmed load", () => {
	it("needs the cargo weight, a weight on every unit, adding up to it", async () => {
		const { create, call } = flowSetup();
		const id = await create(as.alice);
		const put = (draft: unknown, cargo_weight_kg?: number) => call("PUT", `/inspections/${id}/draft`, as.alice, { draft, cargo_weight_kg });
		const code = async (r: Response) => ((await r.json()) as { detail: { code: string } }).detail.code;
		expect(await code(await put(draftFor([900, 900])))).toBe("weight_required");
		expect(await code(await put(draftFor([900, null]), 1800))).toBe("unit_weight_required");
		expect(await code(await put(draftFor([900, 500]), 1800))).toBe("weights_do_not_add_up");
		const ok = await put(draftFor([900, 900]), 1800);
		expect(ok.status).toBe(200);
		const inspection = (await (await call("GET", `/inspections/${id}`, as.alice)).json()) as { status: string; cargo_weight_kg: number };
		expect(inspection).toMatchObject({ status: "confirmed", cargo_weight_kg: 1800 });
	});
});

describe("simulation and fix", () => {
	it("runs the battery on the server, saves it, and the manager sees it", async () => {
		const { create, call, physics } = flowSetup();
		const id = await create(as.alice);
		expect((await call("POST", `/inspections/${id}/simulate`, as.alice)).status).toBe(409);
		await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draftFor([900, 900]), cargo_weight_kg: 1800 });
		const battery = (await (await call("POST", `/inspections/${id}/simulate`, as.alice)).json()) as { passed: number };
		expect(battery.passed).toBe(4);
		expect(physics.calls).toEqual(["/battery"]);
		const listed = (await (await call("GET", "/inspections?scope=org", as.carol)).json()) as { inspections: { id: string; status: string; situations_passed: number; verdict: string }[] };
		expect(listed.inspections.find((i) => i.id === id)).toMatchObject({ status: "simulated", situations_passed: 4, verdict: "fail" });
		expect((await call("GET", `/inspections/${id}/battery/as_loaded`, as.carol)).status).toBe(200);
		expect((await call("GET", `/inspections/${id}/battery/as_loaded`, as.erin)).status).toBe(404);
		expect((await call("POST", `/inspections/${id}/simulate`, as.carol)).status).toBe(403); // readers do not run it
	});

	it("saves both versions when the fix is applied", async () => {
		const { create, call } = flowSetup();
		const id = await create(as.alice);
		await call("PUT", `/inspections/${id}/draft`, as.alice, { draft: draftFor([900, 900]), cargo_weight_kg: 1800 });
		await call("POST", `/inspections/${id}/simulate`, as.alice);
		const plan = (await (await call("POST", `/inspections/${id}/fix`, as.alice)).json()) as { verified: boolean };
		expect(plan.verified).toBe(true);
		const detail = (await (await call("GET", `/inspections/${id}`, as.alice)).json()) as {
			scenarios: { kind: string }[];
			fixes: { passes: boolean }[];
			fixed_verdict: string;
			results: unknown[];
		};
		expect(detail.scenarios.map((s) => s.kind).sort()).toEqual(["as_loaded", "fixed"]);
		expect(detail.fixes[0]?.passes).toBe(true);
		expect(detail.fixed_verdict).toBe("pass");
		expect(detail.results).toHaveLength(14);
	});
});
