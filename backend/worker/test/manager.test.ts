/**
 * The manager dashboard (Phase 7): metrics, filters, alerts, policies, the certificate (who may
 * get one, hash verification) and real organizations.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson, certificateEligibility, contentHash, verifyContent } from "../src/certificate";
import { diffDrafts, readingVsLoad } from "../src/events";
import { csvCell, filterClauses, parseFilters, toCsv } from "../src/listing";
import { computeOverview, isAlert, type MetricRow, weekStart } from "../src/metrics";
import { cargoTypes, failureCodes, packList } from "../src/summary";
import { as, setup } from "./helpers";

const HOUR = 3_600_000;

/** A battery: physics fails with `slide`, a rule fails with `rule`. */
function battery({ slide = false, rule = false } = {}) {
	return {
		passed: slide ? 6 : 7,
		total: 7,
		situations: [
			{ id: "emergency_braking", status: slide ? "fail" : "pass", findings: slide ? [{ code: "unit_slid", severity: "fail" }] : [] },
			{ id: "lane_change", status: "pass", findings: [{ code: "axle_overloaded", severity: "fail" }] },
		],
		contran_945: [
			{ code: "devices_allowed", article: "Art. 4", status: rule ? "fail" : "pass" },
			{ code: "four_terminals", article: "Art. 5", status: "pass" },
		],
		checklist: { weight: [{ code: "axle", kind: "rule", status: "pass" }, { code: "lateral_balance", kind: "advice", status: "fail" }] },
		axle_loads: [{ axle_group_id: "front", load_kg: 5000, limit_kg: 6000 }],
	};
}

const DRAFT = {
	version: 1,
	truck: { body: "flatbed", size: "toco", style: "platform" },
	restraint: "top_over",
	units: [
		{ id: "u1", cargo: "wood_pallet", x_m: 0, y_m: 0, straps: 2, mass_kg: 500 },
		{ id: "u2", cargo: "crate", x_m: 1.3, y_m: 0, straps: 2, mass_kg: 500 },
	],
};

interface Seeded {
	id: string;
	author?: string;
	org?: string | null;
	createdHoursAgo: number;
	verdict: "pass" | "warning" | "fail" | null;
	failures?: string[];
	cargo?: string[];
	truck?: string;
	reinspectionOf?: string;
	title?: string;
	battery?: ReturnType<typeof battery>;
}

/** Inspections with a stored battery each (static files answered by `fetchStatic`). */
function world(rows: Seeded[], options: { rateLimitAllows?: () => boolean } = {}) {
	const files = new Map<string, unknown>();
	const t = setup({ ...options, extra: { fetchStatic: async (path) => files.get(path) ?? null } });
	const at = Date.now();
	// Only these rows: the helpers' own inspections would count too.
	t.db.raw.exec("DELETE FROM inspections WHERE id IN ('a1', 'a2', 'b1', 'd1')");
	for (const r of rows) {
		const created = new Date(at - r.createdHoursAgo * HOUR).toISOString();
		t.db.raw
			.prepare(
				`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, status, title, truck_json, cargo_weight_kg,
				 weight_source, verdict, situations_passed, situations_total, failure_codes, cargo_types, reinspection_of)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, 'measured', ?, 7, 7, ?, ?, ?)`,
			)
			.run(
				r.id,
				r.org === undefined ? "org_a" : r.org,
				r.author ?? "alice",
				created,
				created,
				r.verdict ? "simulated" : "draft",
				r.title ?? r.id,
				JSON.stringify({ body: "flatbed", size: r.truck ?? "toco", style: "platform" }),
				r.verdict,
				r.verdict ? packList(r.failures ?? []) : null,
				packList(r.cargo ?? ["wood_pallet"]),
				r.reinspectionOf ?? null,
			);
		if (r.verdict) {
			const ref = `/demo/test/${r.id}.json`;
			files.set(ref, r.battery ?? battery({ slide: r.verdict === "fail", rule: r.verdict === "warning" }));
			t.db.raw
				.prepare("INSERT INTO scenarios (id, inspection_id, kind, draft_json, battery_ref, created_by, created_at) VALUES (?, ?, 'as_loaded', ?, ?, ?, ?)")
				.run(`${r.id}_s`, r.id, JSON.stringify(DRAFT), `static:${ref}`, r.author ?? "alice", created);
			t.db.raw
				.prepare("INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at) VALUES (?, ?, 'rear', ?, ?, 'image/jpeg', 0, 1, ?)")
				.run(`${r.id}_p`, r.id, `sample:/media/${r.id}.jpg`, `sha-${r.id}`, created);
		}
	}
	return t;
}

// ---- summaries ---------------------------------------------------------------------------

describe("failure types and cargo types", () => {
	it("lists physical failures, then rules; an axle overload is a rule", () => {
		expect(failureCodes(battery({ slide: true, rule: true }))).toEqual(["unit_slid", "devices_allowed", "axle"]);
		expect(failureCodes(battery())).toEqual(["axle"]);
		expect(failureCodes({ situations: [{ findings: [{ code: "unit_slid", severity: "warning" }] }] })).toEqual([]);
	});

	it("advice never counts as a failure", () => {
		expect(failureCodes({ checklist: { weight: [{ code: "lateral_balance", kind: "advice", status: "fail" }] } })).toEqual([]);
	});

	it("packs lists so that one LIKE finds a member", () => {
		expect(cargoTypes(DRAFT)).toEqual(["crate", "wood_pallet"]);
		expect(packList(["a", "b"])).toBe(",a,b,");
		expect(packList([])).toBe("");
	});
});

// ---- metrics ------------------------------------------------------------------------------

describe("overview metrics", () => {
	const at = new Date("2026-11-21T15:00:00.000Z");
	const row = (over: Partial<MetricRow>): MetricRow => ({
		id: "x",
		author_id: "alice",
		author_name: "Alice",
		created_at: "2026-11-20T12:00:00.000Z",
		verdict: "pass",
		proven_by: null,
		reinspection_of: null,
		failure_codes: "",
		...over,
	});
	const rows: MetricRow[] = [
		row({ id: "a", verdict: "pass" }),
		row({ id: "b", verdict: "fail", failure_codes: ",unit_slid,devices_allowed,", proven_by: "b2" }),
		row({ id: "b2", verdict: "pass", reinspection_of: "b" }),
		row({ id: "c", verdict: "fail", failure_codes: ",unit_slid,", author_id: "bob", author_name: "Bob" }),
		row({ id: "d", verdict: "warning", failure_codes: ",axle,", author_id: "bob", author_name: "Bob", created_at: "2026-11-21T14:00:00.000Z" }),
		row({ id: "e", verdict: null, author_id: "bob", author_name: "Bob" }),
		row({ id: "old", verdict: "fail", failure_codes: ",unit_tilted,", created_at: "2026-09-01T12:00:00.000Z" }),
	];
	const overview = computeOverview(rows, {
		from: "2026-11-01T03:00:00.000Z",
		to: at.toISOString(),
		weeksFrom: "2026-10-26T03:00:00.000Z",
		at,
		alertHours: 24,
	});

	it("counts first inspections only, in the three states", () => {
		expect(overview.totals).toMatchObject({
			inspections: 5,
			simulated: 4,
			approved: 1,
			holds_noncompliant: 1,
			fails: 2,
			needs_fix: 3,
			fixed_and_proven: 1,
			failed_no_proven_fix: 2,
			reinspections: 1,
		});
		expect(overview.totals.fixed_and_proven_rate).toBeCloseTo(1 / 3);
	});

	it("alerts include old open failures outside the period, not recent ones", () => {
		// c (27 h old) and old (months) alert; d is 1 h old; b is proven.
		expect(overview.totals.alerts).toBe(2);
	});

	it("ranks the most common failures among the loads that need a fix", () => {
		expect(overview.failures[0]).toEqual({ code: "unit_slid", inspections: 2, share: 2 / 3 });
		expect(overview.failures.map((f) => f.code)).toEqual(["unit_slid", "axle", "devices_allowed"]);
	});

	it("gives each driver inspections, failure rate and proven fixes", () => {
		const bob = overview.drivers.find((d) => d.user_id === "bob");
		const alice = overview.drivers.find((d) => d.user_id === "alice");
		expect(bob).toMatchObject({ inspections: 3, needs_fix: 2, fixes_proven: 0, open: 2, failure_rate: 1 });
		expect(alice).toMatchObject({ inspections: 2, needs_fix: 1, fixes_proven: 1, open: 0, failure_rate: 0.5 });
		expect(overview.drivers[0]?.user_id).toBe("bob"); // most open first
	});

	it("lists every week of the trend, Monday first, also empty ones", () => {
		expect(weekStart("2026-11-20T12:00:00.000Z")).toBe("2026-11-16");
		// Sunday 23:00 in Brasília is still the week that started on Monday the 16th.
		expect(weekStart("2026-11-23T01:59:00.000Z")).toBe("2026-11-16");
		expect(overview.weeks.map((w) => w.week)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
		expect(overview.weeks.at(-1)).toEqual({ week: "2026-11-16", approved: 1, holds_noncompliant: 1, fails: 2, pending: 1 });
	});

	it("an alert is open, unproven, a first inspection, and older than N hours", () => {
		const failing = row({ verdict: "fail", created_at: new Date(at.getTime() - 25 * HOUR).toISOString() });
		expect(isAlert(failing, at, 24)).toBe(true);
		expect(isAlert(failing, at, 48)).toBe(false);
		expect(isAlert({ ...failing, proven_by: "r" }, at, 24)).toBe(false);
		expect(isAlert({ ...failing, reinspection_of: "p" }, at, 24)).toBe(false);
		expect(isAlert({ ...failing, verdict: "pass" }, at, 24)).toBe(false);
		expect(isAlert({ ...failing, verdict: "warning" }, at, 24)).toBe(true);
	});
});

describe("GET /org/overview and /org/alerts", () => {
	const rows: Seeded[] = [
		{ id: "f1", createdHoursAgo: 30, verdict: "fail", failures: ["unit_slid"] },
		{ id: "f2", createdHoursAgo: 2, verdict: "fail", failures: ["unit_slid"], author: "bob" },
		{ id: "w1", createdHoursAgo: 50, verdict: "warning", failures: ["axle"], author: "bob" },
		{ id: "p1", createdHoursAgo: 10, verdict: "pass" },
		{ id: "x1", createdHoursAgo: 40, verdict: "fail", org: "org_b", author: "dave" },
	];

	it("the manager sees the organization's numbers; other organizations never count", async () => {
		const { call } = world(rows);
		const response = await call("GET", "/org/overview?days=30", as.carol);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { totals: Record<string, number>; drivers: unknown[] };
		expect(body.totals).toMatchObject({ inspections: 4, fails: 2, holds_noncompliant: 1, approved: 1, alerts: 2 });
		expect(body.drivers).toHaveLength(2);
	});

	it("members, and managers of no organization, get no overview", async () => {
		const { call } = world(rows);
		expect((await call("GET", "/org/overview", as.alice)).status).toBe(403);
		expect((await call("GET", "/org/alerts", as.alice)).status).toBe(403);
		expect((await call("GET", "/org/overview", as.owner)).status).toBe(403);
	});

	it("alerts follow the organization's N hours, and the menu badge agrees", async () => {
		const { call, db } = world(rows);
		let body = (await (await call("GET", "/org/alerts", as.carol)).json()) as { alerts: { id: string; hours_open: number }[] };
		expect(body.alerts.map((a) => a.id)).toEqual(["w1", "f1"]);
		const me = (await (await call("GET", "/me", as.carol)).json()) as { org: { alerts: number } };
		expect(me.org.alerts).toBe(2);
		db.raw.exec("UPDATE organizations SET alert_after_hours = 1 WHERE id = 'org_a'");
		body = (await (await call("GET", "/org/alerts", as.carol)).json()) as typeof body;
		expect(body.alerts.map((a) => a.id)).toEqual(["w1", "f1", "f2"]);
		// A proven fix closes the alert.
		db.raw.exec(
			`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, status, verdict, reinspection_of)
			 VALUES ('f1r', 'org_a', 'alice', '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', 'simulated', 'pass', 'f1')`,
		);
		body = (await (await call("GET", "/org/alerts", as.carol)).json()) as typeof body;
		expect(body.alerts.map((a) => a.id)).toEqual(["w1", "f2"]);
	});

	it("fills in the failure types of older rows from their stored battery", async () => {
		const { call, db } = world([{ id: "legacy", createdHoursAgo: 5, verdict: "fail" }]);
		db.raw.exec("UPDATE inspections SET failure_codes = NULL");
		const body = (await (await call("GET", "/org/overview", as.carol)).json()) as { failures: { code: string }[] };
		expect(body.failures.map((f) => f.code).sort()).toEqual(["axle", "unit_slid"]);
	});
});

// ---- filters and CSV --------------------------------------------------------------------

describe("inspection table filters", () => {
	const rows: Seeded[] = [
		{ id: "t1", createdHoursAgo: 1, verdict: "fail", failures: ["unit_slid"], cargo: ["crate"], truck: "semi", title: "Crates to Santos" },
		{ id: "t2", createdHoursAgo: 2, verdict: "pass", cargo: ["wood_pallet"], author: "bob" },
		{ id: "t3", createdHoursAgo: 3, verdict: "warning", failures: ["axle"], cargo: ["steel_coil", "crate"] },
		{ id: "t4", createdHoursAgo: 4, verdict: null },
		{ id: "t5", createdHoursAgo: 30 * 24, verdict: "fail", failures: ["unit_tilted"], title: "100% cotton_bales" },
		{ id: "x9", createdHoursAgo: 1, verdict: "fail", org: "org_b", author: "dave", cargo: ["crate"] },
	];
	const ids = async (path: string, token = as.carol) => {
		const response = await world(rows).call("GET", path, token);
		expect(response.status).toBe(200);
		return ((await response.json()) as { inspections: { id: string }[] }).inspections.map((i) => i.id).sort();
	};

	it("filter by state, driver, truck, cargo and failure type", async () => {
		expect(await ids("/inspections?scope=org&state=fails")).toEqual(["t1", "t5"]);
		expect(await ids("/inspections?scope=org&state=holds_noncompliant")).toEqual(["t3"]);
		expect(await ids("/inspections?scope=org&state=pending")).toEqual(["t4"]);
		expect(await ids("/inspections?scope=org&state=open")).toEqual(["t1", "t3", "t5"]);
		expect(await ids("/inspections?scope=org&driver=bob")).toEqual(["t2"]);
		expect(await ids("/inspections?scope=org&truck=semi")).toEqual(["t1"]);
		expect(await ids("/inspections?scope=org&cargo=crate")).toEqual(["t1", "t3"]);
		expect(await ids("/inspections?scope=org&failure=axle")).toEqual(["t3"]);
	});

	it("search matches title, driver and id, with LIKE wildcards taken literally", async () => {
		expect(await ids("/inspections?scope=org&q=santos")).toEqual(["t1"]);
		expect(await ids("/inspections?scope=org&q=Bob")).toEqual(["t2"]);
		expect(await ids("/inspections?scope=org&q=100%25")).toEqual(["t5"]);
		expect(await ids("/inspections?scope=org&q=_")).toEqual(["t5"]);
	});

	it("dates are Brasília days, both ends included", async () => {
		const today = new Date(Date.now() - 3 * HOUR).toISOString().slice(0, 10);
		const old = await ids(`/inspections?scope=org&to=${new Date(Date.now() - 3 * HOUR - 20 * 24 * HOUR).toISOString().slice(0, 10)}`);
		expect(old).toEqual(["t5"]);
		expect((await ids(`/inspections?scope=org&from=${today}`)).includes("t5")).toBe(false);
	});

	it("filters never widen what the role may read", async () => {
		// A member asking for the org scope is refused; their own scope stays their own.
		expect((await world(rows).call("GET", "/inspections?scope=org&driver=bob", as.alice)).status).toBe(403);
		expect(await ids("/inspections?scope=mine&driver=bob", as.alice)).toEqual([]);
		expect(await ids("/inspections?scope=org&cargo=crate", as.erin)).toEqual(["x9"]);
	});

	it("pages, with the total", async () => {
		const { call } = world(rows);
		const page = (await (await call("GET", "/inspections?scope=org&page=2&page_size=2", as.carol)).json()) as { inspections: { id: string }[]; total: number };
		expect(page.total).toBe(5);
		expect(page.inspections.map((i) => i.id)).toEqual(["t3", "t4"]);
	});

	it("rejects malformed filters", async () => {
		const { call } = world(rows);
		for (const q of ["state=bad", "from=21/11/2026", "failure=nope", "page=0", "page_size=500", "cargo=DROP%20TABLE"]) {
			expect((await call("GET", `/inspections?scope=org&${q}`, as.carol)).status).toBe(422);
		}
		expect(() => parseFilters((k) => ({ truck: "bus" })[k])).toThrow();
		expect(filterClauses(parseFilters(() => undefined)).where).toEqual([]);
	});

	it("exports the filtered rows as CSV, safe for spreadsheets", async () => {
		const { call } = world(rows);
		const response = await call("GET", "/inspections/export.csv?scope=org&state=fails", as.carol);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/csv");
		const bytes = new Uint8Array(await response.clone().arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 byte-order mark
		const text = await response.text();
		const lines = text.trim().split("\r\n");
		expect(lines[0]).toMatch(/^id,created_at,driver/);
		expect(lines).toHaveLength(3);
		expect(text).toContain("unit_slid");
		expect(text).not.toContain("x9");
		expect((await call("GET", "/inspections/export.csv?scope=org", as.alice)).status).toBe(403);
		expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
		expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
		expect(toCsv([])).toBe("\uFEFFid,created_at,driver,title,truck_size,truck_style,cargo_types,cargo_weight_kg,weight_source,state,situations_passed,situations_total,fix,failure_types,reinspection_of\r\n");
	});
});

// ---- policies ---------------------------------------------------------------------------

describe("organization policies", () => {
	it("only a real manager changes them, within bounds", async () => {
		const { call } = setup();
		expect((await call("PATCH", "/org/policies", as.alice, { require_two_photos: true })).status).toBe(403);
		expect((await call("PATCH", "/org/policies", as.demoInsurer, { require_two_photos: true })).status).toBe(403);
		expect((await call("PATCH", "/org/policies", as.carol, { alert_after_hours: 0 })).status).toBe(422);
		expect((await call("PATCH", "/org/policies", as.carol, { alert_after_hours: 2.5 })).status).toBe(422);
		const response = await call("PATCH", "/org/policies", as.carol, { require_two_photos: true, alert_after_hours: 12, certificate_requires_compliance: false });
		expect(await response.json()).toEqual({ require_two_photos: true, certificate_requires_compliance: false, alert_after_hours: 12 });
		// Erin's organization keeps its defaults.
		const other = (await (await call("GET", "/me", as.erin)).json()) as { org: { policies: unknown } };
		expect(other.org.policies).toEqual({ require_two_photos: false, certificate_requires_compliance: true, alert_after_hours: 24 });
	});

	it("require 2 photos: a load with one photo is not confirmed; a sample is exempt", async () => {
		const { call, db } = setup();
		db.raw.exec("UPDATE organizations SET require_two_photos = 1 WHERE id = 'org_a'");
		db.raw.exec(
			`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
			 VALUES ('ph1', 'a1', 'left', 'photos/x.jpg', 'x', 'image/jpeg', 1, 1, '2026-11-20T12:00:00.000Z')`,
		);
		const body = { draft: DRAFT, cargo_weight_kg: 1000 };
		let response = await call("PUT", "/inspections/a1/draft", as.alice, body);
		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: { code: string } }).detail.code).toBe("policy_two_photos");
		expect((await call("POST", "/inspections/a1/analyze", as.alice)).status).toBe(422);
		db.raw.exec(
			`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
			 VALUES ('ph2', 'a1', 'rear', 'photos/y.jpg', 'y', 'image/jpeg', 1, 1, '2026-11-20T12:00:01.000Z')`,
		);
		response = await call("PUT", "/inspections/a1/draft", as.alice, body);
		expect(response.status).toBe(200);
		db.raw.exec("DELETE FROM photos WHERE id = 'ph2'; UPDATE inspections SET sample = 'crates' WHERE id = 'a1'");
		expect((await call("PUT", "/inspections/a1/draft", as.alice, body)).status).toBe(200);
		// Another organization's members are not bound by it.
		db.raw.exec(
			`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
			 VALUES ('ph3', 'd1', 'left', 'photos/z.jpg', 'z', 'image/jpeg', 1, 1, '2026-11-20T12:00:00.000Z')`,
		);
		expect((await call("PUT", "/inspections/d1/draft", as.dave, body)).status).toBe(200);
	});
});

// ---- audit trail ------------------------------------------------------------------------

describe("audit trail", () => {
	it("records who confirmed what, and what the driver changed in the AI's reading", async () => {
		const { call } = setup();
		const prefill = { ...DRAFT, units: [{ ...DRAFT.units[0], straps: 1, mass_kg: null }, { ...DRAFT.units[1], cargo: "drum", mass_kg: null }, { id: "u3", cargo: "crate", x_m: 3, y_m: 0, straps: 0 }] };
		expect((await call("PUT", "/inspections/a1/draft", as.alice, { draft: DRAFT, cargo_weight_kg: 1000, prefill })).status).toBe(200);
		const moved = { ...DRAFT, units: [{ ...DRAFT.units[0], x_m: 0.5 }, DRAFT.units[1]] };
		expect((await call("PUT", "/inspections/a1/draft", as.alice, { draft: moved, cargo_weight_kg: 1000 })).status).toBe(200);
		const audit = (await (await call("GET", "/inspections/a1/audit", as.carol)).json()) as {
			events: { kind: string; actor_name: string; detail: { changes?: { code: string }[] } }[];
			edits: { code: string; unit: string }[];
		};
		expect(audit.events.map((e) => e.kind)).toEqual(["load_confirmed", "load_confirmed"]);
		expect(audit.events[0]?.actor_name).toBe("Alice");
		expect(audit.edits).toEqual([
			{ code: "unit_removed", unit: "u3", cargo: "crate" },
			{ code: "unit_straps", unit: "u1", from: 1, to: 2 },
			{ code: "unit_cargo", unit: "u2", from: "drum", to: "crate" },
		]);
		expect(audit.events[1]?.detail.changes).toEqual([{ code: "unit_moved", unit: "u1", distance_m: 0.5 }]);
		// Readers only: another organization gets a 404, a member another member's 404.
		expect((await call("GET", "/inspections/a1/audit", as.erin)).status).toBe(404);
		expect((await call("GET", "/inspections/a1/audit", as.bob)).status).toBe(404);
	});

	it("puts the AI's reading beside the confirmed load", () => {
		const analysis = {
			truck: { body: "flatbed", size: "semi" },
			units: [{ cargo: "crate" }, { cargo: "wood_pallet" }],
			restraints: [{ kind: "rope", count: 3 }, { kind: "strap", count: 1 }],
		};
		const rows = readingVsLoad(analysis, DRAFT, { cargo_weight_kg: 1000, weight_source: "invoice" });
		const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
		expect(byField.truck_size).toMatchObject({ ai: "semi", driver: "toco", changed: true });
		expect(byField.units).toMatchObject({ ai: 2, driver: 2, changed: false });
		expect(byField.cargo?.changed).toBe(false);
		expect(byField.straps).toMatchObject({ ai: 1, driver: 4, changed: true });
		expect(byField.weight).toMatchObject({ ai: null, driver: { kg: 1000, source: "invoice" } });
	});

	it("moves under 5 cm are not edits; weights never are", () => {
		const nudged = { ...DRAFT, units: [{ ...DRAFT.units[0], x_m: 0.03, mass_kg: 900 }, DRAFT.units[1]] };
		expect(diffDrafts(DRAFT, nudged)).toEqual([]);
	});
});

// ---- certificate ------------------------------------------------------------------------

describe("certificate", () => {
	it("only approved, or fixed and proven; the policy decides for out of compliance", () => {
		const strict = { certificate_requires_compliance: true };
		const lenient = { certificate_requires_compliance: false };
		expect(certificateEligibility({ verdict: "pass", proven_by: null }, strict)).toEqual({ ok: true, state: "approved" });
		expect(certificateEligibility({ verdict: "fail", proven_by: "r1" }, strict)).toEqual({ ok: true, state: "fixed_and_proven" });
		expect(certificateEligibility({ verdict: "fail", proven_by: null }, lenient)).toEqual({ ok: false, code: "fails_no_proven_fix" });
		expect(certificateEligibility({ verdict: "warning", proven_by: null }, strict)).toEqual({ ok: false, code: "out_of_compliance" });
		expect(certificateEligibility({ verdict: "warning", proven_by: null }, lenient)).toEqual({ ok: true, state: "holds_noncompliant" });
		expect(certificateEligibility({ verdict: null, proven_by: null }, lenient)).toEqual({ ok: false, code: "not_simulated" });
	});

	const rows: Seeded[] = [
		{ id: "ok1", createdHoursAgo: 5, verdict: "pass" },
		{ id: "bad1", createdHoursAgo: 5, verdict: "fail" },
		{ id: "bad1r", createdHoursAgo: 1, verdict: "pass", reinspectionOf: "bad1" },
		{ id: "warn1", createdHoursAgo: 5, verdict: "warning" },
		{ id: "fail2", createdHoursAgo: 5, verdict: "fail", author: "bob" },
		{ id: "dok", createdHoursAgo: 5, verdict: "pass", org: "org_b", author: "dave" },
	];

	it("is issued to the author and the manager, never to other drivers or organizations", async () => {
		const { call } = world(rows);
		expect((await call("POST", "/inspections/ok1/certificate", as.bob)).status).toBe(404);
		expect((await call("POST", "/inspections/ok1/certificate", as.erin)).status).toBe(404);
		const issued = await call("POST", "/inspections/ok1/certificate", as.alice);
		expect(issued.status).toBe(201);
		const cert = (await issued.json()) as { id: string; content_hash: string; authentic: boolean; content: { state: string } };
		expect(cert.id).toMatch(/^SC-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
		expect(cert.authentic).toBe(true);
		expect(cert.content.state).toBe("approved");
		// The same record again: the same certificate.
		const again = await call("POST", "/inspections/ok1/certificate", as.carol);
		expect(again.status).toBe(200);
		expect(((await again.json()) as { id: string }).id).toBe(cert.id);
		// Reading it: the author and the manager; nobody else.
		expect((await call("GET", `/certificates/${cert.id}`, as.carol)).status).toBe(200);
		expect((await call("GET", `/certificates/${cert.id}`, as.bob)).status).toBe(404);
		expect((await call("GET", `/certificates/${cert.id}`, as.erin)).status).toBe(404);
		expect((await call("GET", `/certificates/${cert.id}`)).status).toBe(401);
	});

	it("refuses a load that fails without a proven fix; a proven one records the proof", async () => {
		const { call } = world(rows);
		const refused = await call("POST", "/inspections/fail2/certificate", as.bob);
		expect(refused.status).toBe(409);
		expect(((await refused.json()) as { detail: { code: string } }).detail.code).toBe("certificate_fails_no_proven_fix");
		const proven = (await (await call("POST", "/inspections/bad1/certificate", as.alice)).json()) as {
			content: { state: string; proof_inspection_id: string; results: { passed: number } };
			photo: { inspection_id: string };
		};
		expect(proven.content).toMatchObject({ state: "fixed_and_proven", proof_inspection_id: "bad1r", results: { passed: 7 } });
		expect(proven.photo.inspection_id).toBe("bad1r");
	});

	it("out of compliance: refused by default, issued (and marked) when the policy allows it", async () => {
		const { call, db } = world(rows);
		expect((await call("POST", "/inspections/warn1/certificate", as.alice)).status).toBe(409);
		db.raw.exec("UPDATE organizations SET certificate_requires_compliance = 0 WHERE id = 'org_a'");
		const cert = (await (await call("POST", "/inspections/warn1/certificate", as.alice)).json()) as { content: { state: string } };
		expect(cert.content.state).toBe("holds_noncompliant");
	});

	it("the public verify page: authentic, minimal, and a changed record no longer verifies", async () => {
		const { call, db } = world(rows);
		const cert = (await (await call("POST", "/inspections/ok1/certificate", as.alice)).json()) as { id: string; content_hash: string };
		const verify = await call("GET", `/verify/${cert.id}`);
		expect(verify.status).toBe(200);
		const body = (await verify.json()) as Record<string, unknown> & { summary: Record<string, unknown> };
		expect(body).toMatchObject({ id: cert.id, authentic: true, valid: true, content_hash: cert.content_hash });
		expect(Object.keys(body.summary).sort()).toEqual(["checks_failed", "inspected_at", "organization", "proven_at", "situations", "state", "truck"]);
		// Nothing personal on the public page.
		expect(JSON.stringify(body)).not.toMatch(/Alice|alice|sha-ok1|ok1_p|media/);
		// Lower case works (typed by hand); garbage is a 404.
		expect((await call("GET", `/verify/${cert.id.toLowerCase()}`)).status).toBe(200);
		expect((await call("GET", "/verify/SC-0000-0000")).status).toBe(404);
		// Tampering with the stored record breaks the hash.
		db.raw.prepare("UPDATE certificates SET content_json = replace(content_json, '\"approved\"', '\"approved \"') WHERE id = ?").run(cert.id);
		const tampered = (await (await call("GET", `/verify/${cert.id}`)).json()) as { authentic: boolean; valid: boolean; summary: unknown };
		expect(tampered).toMatchObject({ authentic: false, valid: false, summary: null });
	});

	it("a new confirmed load revokes the certificate", async () => {
		const { call } = world(rows);
		const cert = (await (await call("POST", "/inspections/ok1/certificate", as.alice)).json()) as { id: string };
		expect((await call("PUT", "/inspections/ok1/draft", as.alice, { draft: DRAFT, cargo_weight_kg: 1000 })).status).toBe(200);
		const after = (await (await call("GET", `/verify/${cert.id}`)).json()) as { valid: boolean; revoked_at: string | null };
		expect(after.valid).toBe(false);
		expect(after.revoked_at).not.toBeNull();
	});

	it("verify is rate-limited per IP", async () => {
		const { call } = world(rows, { rateLimitAllows: () => false });
		expect((await call("GET", "/verify/SC-2345-6789")).status).toBe(429);
	});

	it("the hash is the SHA-256 of canonical JSON (key order does not matter)", async () => {
		expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}');
		const hash = await contentHash({ b: 1, a: 2 });
		expect(hash).toBe(await contentHash({ a: 2, b: 1 }));
		expect(hash).toHaveLength(64);
		expect(await verifyContent('{"a":2,"b":1}', hash)).toBe(true);
		expect(await verifyContent('{"a":3,"b":1}', hash)).toBe(false);
		expect(await verifyContent("not json", hash)).toBe(false);
	});
});

// ---- real organizations -----------------------------------------------------------------

describe("creating an organization", () => {
	it("a signed-in user without one creates it and becomes its manager", async () => {
		const { call, identity, db } = setup();
		const response = await call("POST", "/orgs", "token:newcomer", { name: "Rota Sul Transportes", type: "carrier" });
		expect(response.status).toBe(201);
		const org = (await response.json()) as { id: string; type: string };
		expect(org.type).toBe("carrier");
		expect(identity.created[0]).toMatchObject({ name: "Rota Sul Transportes", createdBy: "newcomer" });
		const membership = db.raw.prepare("SELECT role FROM memberships WHERE user_id = 'newcomer' AND org_id = ?").get(org.id) as { role: string };
		expect(membership.role).toBe("org_admin");
		// With the new organization active, the manager invites by email.
		expect((await call("POST", "/org/invitations", `token:newcomer:${org.id}:org_admin`, { email: "driver@example.com" })).status).toBe(201);
	});

	it("demo accounts and members of an organization cannot; bad input is refused", async () => {
		const { call } = setup();
		expect((await call("POST", "/orgs", as.demoDriver, { name: "X Corp", type: "carrier" })).status).toBe(403);
		expect((await call("POST", "/orgs", as.alice, { name: "X Corp", type: "carrier" })).status).toBe(409);
		expect((await call("POST", "/orgs", "token:newcomer", { name: "X", type: "carrier" })).status).toBe(422);
		expect((await call("POST", "/orgs", "token:newcomer", { name: "X Corp", type: "bank" })).status).toBe(422);
		expect((await call("POST", "/orgs", undefined, { name: "X Corp", type: "carrier" })).status).toBe(401);
		// Demo managers still cannot invite.
		expect((await call("POST", "/org/invitations", as.demoInsurer, { email: "a@example.com" })).status).toBe(403);
	});
});
