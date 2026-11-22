/**
 * Seed the demo organization for the judges: "Demo Fleet", a manager and three drivers, and
 * inspections built from the gallery examples (fails, fixes, passes) with sample photos. Their
 * seven-situation batteries and proven fixes are static files on the site
 * (`backend/scripts/build_demo_inspections.py`), so the dashboard opens them with the API down.
 *
 * The demo people and organization live in D1 only (since 2026-11-21): demo visitors enter with a
 * Worker-issued session (`src/demo.ts`), not a Clerk account, so nobody can change their password,
 * delete them or see other visitors' devices. Writes `seed/out/demo.sql`, which replaces the demo
 * rows in D1. Recorded usage is never touched: it is what the monthly cap is computed from.
 *
 *   pnpm run seed:demo
 *   npx wrangler d1 execute securecargo --remote --file seed/out/demo.sql
 *
 * Names are fictional and nobody has an email: no real personal data.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { diffDrafts } from "../src/events";
import { cargoTypes, failureCodes, packList } from "../src/summary";
import { type BatteryLike, STORED, verdictState } from "../src/verdict";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = join(here, "..", "..", "..", "frontend", "public", "demo");

interface DemoPerson {
	key: "manager" | "driver" | "driver2" | "driver3";
	/** Stable ids: the demo session principal is found by them (settings below). */
	id: string;
	name: string;
	role: "org:admin" | "org:member";
}

/** The visitor's two personas are "Demo insurer" and "Demo driver"; the other drivers are colleagues. */
const PEOPLE: DemoPerson[] = [
	{ key: "manager", id: "demo_insurer", name: "Demo insurer", role: "org:admin" },
	{ key: "driver", id: "demo_driver", name: "Demo driver", role: "org:member" },
	{ key: "driver2", id: "demo_driver_2", name: "Joana (demo)", role: "org:member" },
	{ key: "driver3", id: "demo_driver_3", name: "Tiago (demo)", role: "org:member" },
];
// One organization holds both demo personas (an org_admin reads only its own organization), so its
// name fits a driver and a manager alike: "Demo Fleet · Driver", "Demo Fleet · Manager".
const ORG = { id: "org_demo", name: "Demo Fleet", type: "insurer" as const };

// ---- inspections from the gallery -------------------------------------------------------------

interface Battery {
	passed: number;
	total: number;
	draft: { truck: { body: string; size: string }; units: { mass_kg: number | null }[] };
	situations: { id: string; status: string; findings: unknown[]; margins: unknown; event: unknown; trip: unknown; severity: number; scenario_hash: string }[];
	contran_945: { status: string }[];
}
interface PlanFile {
	draft: Battery["draft"];
	changes: unknown[];
	verified: boolean;
}
interface GalleryIndex {
	scenarios: { id: string; title: string }[];
}
interface ExplorerFixture {
	draft: Battery["draft"];
	scenario: { units: { mass_kg: number }[] };
}

const SAMPLE_PHOTOS: Record<string, string> = {
	"emergency-braking": "/media/scenario-braking.jpg",
	"sharp-curve": "/media/scenario-curve.jpg",
	"rope-lashing": "/media/scenario-rope.jpg",
	"weigh-station": "/media/scenario-weigh-station.jpg",
	"full-trip": "/media/hero.jpg",
	"box-truck": "/media/dock.jpg",
};

/**
 * Who loaded what, and what happened next, over the last seven weeks (the dashboard's trend).
 * - `proven`: the planner's fix was simulated, the driver loaded it and a new photo of it was
 *   approved (a linked re-inspection, whose photo is the MuJoCo render of the fixed load);
 * - `fixed`: the planner's fix was simulated, but no new photo proves it yet (an alert);
 * - `failed`: left as loaded (an alert); `passed`: loaded right the first time (the fixed load).
 * A `sample` is one of the sample photographs, with its recorded AI reading and battery.
 */
type Outcome = "proven" | "fixed" | "failed" | "passed";
const PLAN: { example?: string; sample?: string; author: DemoPerson["key"]; outcome: Outcome; daysAgo: number }[] = [
	{ example: "emergency-braking", author: "driver", outcome: "proven", daysAgo: 0.25 },
	{ example: "rope-lashing", author: "driver", outcome: "failed", daysAgo: 1.2 },
	{ example: "anti-slip-mat", author: "driver", outcome: "passed", daysAgo: 3 },
	{ example: "full-trip", author: "driver", outcome: "proven", daysAgo: 6 },
	{ sample: "crates-ropes", author: "driver", outcome: "failed", daysAgo: 9 },
	{ example: "box-truck", author: "driver", outcome: "passed", daysAgo: 15 },
	{ example: "steel-coil", author: "driver", outcome: "proven", daysAgo: 22 },
	{ sample: "concrete-pipes", author: "driver", outcome: "failed", daysAgo: 30 },
	{ example: "dirt-road", author: "driver", outcome: "fixed", daysAgo: 38 },
	{ example: "sharp-curve", author: "driver2", outcome: "proven", daysAgo: 0.5 },
	{ example: "steel-coil", author: "driver2", outcome: "failed", daysAgo: 2 },
	{ example: "box-truck", author: "driver2", outcome: "passed", daysAgo: 5 },
	{ sample: "steel-racks", author: "driver2", outcome: "failed", daysAgo: 8 },
	{ example: "emergency-braking", author: "driver2", outcome: "passed", daysAgo: 12 },
	{ example: "weigh-station", author: "driver2", outcome: "proven", daysAgo: 19 },
	{ example: "anti-slip-mat", author: "driver2", outcome: "passed", daysAgo: 27 },
	{ sample: "lumber-straps", author: "driver2", outcome: "failed", daysAgo: 33 },
	{ example: "rope-lashing", author: "driver2", outcome: "proven", daysAgo: 44 },
	{ example: "weigh-station", author: "driver3", outcome: "fixed", daysAgo: 1 },
	{ example: "dirt-road", author: "driver3", outcome: "failed", daysAgo: 4 },
	{ example: "emergency-braking", author: "driver3", outcome: "passed", daysAgo: 8 },
	{ sample: "steel-pipes", author: "driver3", outcome: "failed", daysAgo: 11 },
	{ example: "full-trip", author: "driver3", outcome: "passed", daysAgo: 17 },
	{ example: "sharp-curve", author: "driver3", outcome: "fixed", daysAgo: 25 },
	{ sample: "backhoe-chains", author: "driver3", outcome: "failed", daysAgo: 35 },
	{ example: "anti-slip-mat", author: "driver3", outcome: "passed", daysAgo: 46 },
];

interface SampleFile {
	id: string;
	title: string;
	weight_kg: number;
	truck: { body: string; size: string; style: string };
	photos: { position: string; path: string }[];
	analysis: { units: unknown[] };
	perception: { draft: Battery["draft"] };
	battery: Battery;
}

const q = (value: unknown): string =>
	value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

function readJson<T>(file: string): T {
	return JSON.parse(readFileSync(join(demoDir, file), "utf8")) as T;
}

/** As the Worker decides it (src/verdict.ts): pass, warning (holds, out of compliance), fail. */
function verdictOf(battery: Battery): "pass" | "warning" | "fail" {
	return STORED[verdictState(battery as unknown as BatteryLike)];
}

function resultRows(id: string, scenarioId: string, battery: Battery, at: string, prefix: string): string[] {
	return battery.situations.map(
		(s, n) =>
			`INSERT INTO results (id, inspection_id, scenario_id, situation, verdict, metrics_json, keyframes_ref, created_at)
			 VALUES (${q(`${id}_${prefix}${n + 1}`)}, ${q(id)}, ${q(scenarioId)}, ${q(s.id)}, ${q(s.status)},
			   ${q(JSON.stringify({ findings: s.findings, margins: s.margins, event: s.event, trip: s.trip, severity: s.severity }))},
			   ${q(s.scenario_hash)}, ${q(at)});`,
	);
}

async function main() {
	const ids = new Map<DemoPerson["key"], string>(PEOPLE.map((person) => [person.key, person.id]));
	const managerId = ids.get("manager") as string;
	const orgId = ORG.id;

	const index = readJson<GalleryIndex>("index.json");
	const now = Date.now();
	const sql: string[] = [
		"-- Generated by seed/demo.ts. Replaces every demo row.",
		...["inspection_events", "certificates"].map(
			(table) => `DELETE FROM ${table} WHERE inspection_id IN (SELECT id FROM inspections WHERE org_id IN (SELECT id FROM organizations WHERE is_demo = 1));`,
		),
		`DELETE FROM inspections WHERE org_id IN (SELECT id FROM organizations WHERE is_demo = 1);`,
		`INSERT INTO organizations (id, name, type, is_demo, created_at) VALUES (${q(orgId)}, ${q(ORG.name)}, 'insurer', 1, ${q(new Date(now).toISOString())})
		 ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type, is_demo = 1;`,
		// A demo org from another Clerk instance (development, before production): its inspections
		// are gone above; drop its memberships and the org itself when nothing else points at it.
		`DELETE FROM memberships WHERE org_id IN (SELECT id FROM organizations WHERE is_demo = 1 AND id <> ${q(orgId)});`,
		`DELETE FROM organizations WHERE is_demo = 1 AND id <> ${q(orgId)}
		 AND id NOT IN (SELECT org_id FROM trucks WHERE org_id IS NOT NULL)
		 AND id NOT IN (SELECT org_id FROM certificates WHERE org_id IS NOT NULL);`,
	];
	for (const person of PEOPLE) {
		const id = ids.get(person.key) as string;
		sql.push(
			`INSERT INTO users (id, email, name, is_demo, created_at) VALUES (${q(id)}, NULL, ${q(person.name)}, 1, ${q(new Date(now).toISOString())})
			 ON CONFLICT (id) DO UPDATE SET email = NULL, name = excluded.name, is_demo = 1;`,
			`INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (${q(id)}, ${q(orgId)}, ${q(person.role === "org:admin" ? "org_admin" : "member")}, ${q(new Date(now).toISOString())})
			 ON CONFLICT (user_id, org_id) DO UPDATE SET role = excluded.role;`,
		);
	}
	for (const [key, value] of [
		["demo_org_id", orgId],
		["demo_driver_user_id", ids.get("driver")],
		["demo_insurer_user_id", managerId],
	] as const) {
		sql.push(
			`INSERT INTO settings (key, value, updated_at) VALUES (${q(key)}, ${q(value)}, ${q(new Date(now).toISOString())})
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
		);
	}

	let events = 0;
	const event = (inspectionId: string, actor: string, at: string, kind: string, detail: Record<string, unknown> = {}) =>
		sql.push(
			`INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
			 VALUES (${q(`evt_demo_${String(++events).padStart(3, "0")}`)}, ${q(inspectionId)}, ${q(actor)}, ${q(at)}, ${q(kind)}, ${q(JSON.stringify(detail))});`,
		);
	const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

	/** One simulated inspection, its photo, its confirmed load and its events. */
	function inspection(params: {
		id: string;
		authorId: string;
		at: string;
		title: string;
		draft: Battery["draft"];
		battery: Battery;
		batteryRef: string;
		photo: { position: string; path: string; sha: string };
		weight: number;
		weightSource: "measured" | "invoice";
		truckJson: string | null;
		sample?: SampleFile;
		reinspectionOf?: string;
	}) {
		const { id, authorId, at, draft, battery } = params;
		const verdict = verdictOf(battery);
		sql.push(
			`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, status, title, truck_body, truck_size, truck_json,
			   cargo_weight_kg, weight_source, notes, situations_passed, situations_total, verdict, sample, reinspection_of,
			   cargo_types, failure_codes, seeded)
			 VALUES (${q(id)}, ${q(orgId)}, ${q(authorId)}, ${q(at)}, ${q(plus(at, 4))}, 'simulated', ${q(params.title)},
			   ${q(draft.truck.body)}, ${q(["vuc", "toco", "truck", "semi"].includes(draft.truck.size) ? draft.truck.size : null)}, ${q(params.truckJson)},
			   ${params.weight}, ${q(params.weightSource)}, '', ${battery.passed}, ${battery.total}, ${q(verdict)},
			   ${q(params.sample?.id ?? null)}, ${q(params.reinspectionOf ?? null)},
			   ${q(packList(cargoTypes(draft)))}, ${q(packList(failureCodes(battery)))}, 1);`,
			`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
			 VALUES (${q(`${id}_p1`)}, ${q(id)}, ${q(params.photo.position)}, ${q(`sample:${params.photo.path}`)}, ${q(params.photo.sha)}, 'image/jpeg', 0, 1, ${q(at)});`,
			`INSERT INTO scenarios (id, inspection_id, kind, draft_json, battery_ref, created_by, created_at)
			 VALUES (${q(`${id}_s1`)}, ${q(id)}, 'as_loaded', ${q(JSON.stringify(draft))}, ${q(params.batteryRef)}, ${q(authorId)}, ${q(plus(at, 2))});`,
			...resultRows(id, `${id}_s1`, battery, plus(at, 3), "r"),
		);
		event(id, authorId, at, "created", { sample: params.sample?.id ?? null, reinspection_of: params.reinspectionOf ?? null });
		event(id, authorId, plus(at, 1), "photo_added", { position: params.photo.position, sha256: params.photo.sha });
		if (params.sample) {
			event(id, authorId, plus(at, 1), "analyzed", { mode: "sample", model: null, units: params.sample.analysis.units.length });
		}
		event(id, authorId, plus(at, 2), "load_confirmed", {
			units: draft.units.length,
			...(params.sample ? { edits: diffDrafts(params.sample.perception.draft, draft) } : {}),
			cargo_weight_kg: params.weight,
			weight_source: params.weightSource,
		});
		event(id, authorId, plus(at, 3), "simulated", { verdict, passed: battery.passed, total: battery.total, failures: failureCodes(battery) });
		return verdict;
	}

	PLAN.forEach((item, n) => {
		const id = `insp_demo_${String(n + 1).padStart(2, "0")}`;
		const at = new Date(now - item.daysAgo * 86_400_000 - n * 2_700_000).toISOString();
		const authorId = ids.get(item.author) as string;

		if (item.sample) {
			const sample = readJson<SampleFile>(`samples/${item.sample}.json`);
			inspection({
				id,
				authorId,
				at,
				title: sample.title,
				draft: sample.battery.draft,
				battery: sample.battery,
				batteryRef: `static:/demo/samples/${sample.id}.json#battery`,
				photo: { position: sample.photos[0]?.position ?? "left", path: sample.photos[0]?.path ?? "", sha: `sample-${sample.id}` },
				weight: sample.weight_kg,
				weightSource: "invoice",
				truckJson: JSON.stringify(sample.truck),
				sample,
			});
			return;
		}

		const exampleId = item.example as string;
		const example = index.scenarios.find((s) => s.id === exampleId);
		if (!example) throw new Error(`Unknown gallery example ${exampleId}`);
		const asLoaded = readJson<ExplorerFixture>(`explorer/${exampleId}.as_loaded.json`).draft;
		const loadedBattery = readJson<Battery>(`inspections/${exampleId}.as_loaded.json`);
		const fixedBattery = readJson<Battery>(`inspections/${exampleId}.fixed.json`);
		const plan = readJson<PlanFile>(`inspections/${exampleId}.plan.json`);
		const weight = Math.round(readJson<ExplorerFixture>(`explorer/${exampleId}.as_loaded.json`).scenario.units.reduce((sum, u) => sum + u.mass_kg, 0));
		// A load that passed as loaded is the planner's fixed load, loaded right the first time.
		const passedFirst = item.outcome === "passed";
		const photoOf = (fixed: boolean) =>
			!fixed && SAMPLE_PHOTOS[exampleId] ? SAMPLE_PHOTOS[exampleId] : `/demo/video/${exampleId}.${fixed ? "fixed" : "as_loaded"}.jpg`;
		inspection({
			id,
			authorId,
			at,
			title: example.title,
			draft: passedFirst ? plan.draft : asLoaded,
			battery: passedFirst ? fixedBattery : loadedBattery,
			batteryRef: `static:/demo/inspections/${exampleId}.${passedFirst ? "fixed" : "as_loaded"}.json`,
			photo: { position: "rear", path: photoOf(passedFirst), sha: `sample-${exampleId}${passedFirst ? "-fixed" : ""}` },
			weight,
			weightSource: "measured",
			truckJson: null,
		});
		if (item.outcome === "fixed" || item.outcome === "proven") {
			const later = plus(at, 6);
			const fixedId = `${id}_s2`;
			sql.push(
				`UPDATE inspections SET fixed_verdict = ${q(verdictOf(fixedBattery))} WHERE id = ${q(id)};`,
				`INSERT INTO scenarios (id, inspection_id, kind, draft_json, battery_ref, created_by, created_at)
				 VALUES (${q(fixedId)}, ${q(id)}, 'fixed', ${q(JSON.stringify(plan.draft))}, ${q(`static:/demo/inspections/${exampleId}.fixed.json`)}, ${q(authorId)}, ${q(later)});`,
				...resultRows(id, fixedId, fixedBattery, later, "f"),
				`INSERT INTO fixes (id, inspection_id, from_scenario_id, to_scenario_id, changes_json, passes, created_at)
				 VALUES (${q(`${id}_f1`)}, ${q(id)}, ${q(`${id}_s1`)}, ${q(fixedId)}, ${q(JSON.stringify(plan.changes))},
				   ${plan.verified ? 1 : 0}, ${q(later)});`,
			);
			event(id, authorId, later, "fix_simulated", {
				verdict: verdictOf(fixedBattery),
				changes: plan.changes.length,
				codes: plan.changes.map((change) => (change as { code?: string }).code).filter(Boolean),
			});
		}
		if (item.outcome === "proven" && verdictOf(fixedBattery) === "pass") {
			// "I fixed it: take a new photo", a couple of hours later (never in the future).
			const childAt = new Date(Math.min(Date.parse(at) + 2 * 3_600_000, now - 600_000)).toISOString();
			const childId = `${id}r`;
			event(id, authorId, childAt, "reinspected", { inspection_id: childId });
			inspection({
				id: childId,
				authorId,
				at: childAt,
				title: example.title,
				draft: plan.draft,
				battery: fixedBattery,
				batteryRef: `static:/demo/inspections/${exampleId}.fixed.json`,
				photo: { position: "rear", path: photoOf(true), sha: `sample-${exampleId}-fixed` },
				weight,
				weightSource: "measured",
				truckJson: null,
				reinspectionOf: id,
			});
		}
	});

	const out = join(here, "out");
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "demo.sql"), `${sql.join("\n")}\n`);
	console.log(`Demo org ${orgId}; ${PLAN.length} inspections (and their re-inspections); wrote seed/out/demo.sql`);
}

await main();
