/**
 * Seed the demo organization for the judges: "Demo Insurer", a manager and three drivers, and
 * inspections built from the gallery examples (fails, fixes, passes) with sample photos. Their
 * seven-situation batteries and proven fixes are static files on the site
 * (`backend/scripts/build_demo_inspections.py`), so the dashboard opens them with the API down.
 *
 * 1. Finds or creates the demo users and organization in Clerk (idempotent, by email and name).
 * 2. Writes `seed/out/demo.sql`, which replaces the demo inspections in D1. Recorded usage is never
 *    touched: it is what the monthly cap is computed from.
 *
 *   pnpm seed:demo                          # reads CLERK_SECRET_KEY from .dev.vars or the env
 *   npx wrangler d1 execute securecargo --remote --file seed/out/demo.sql
 *
 * Names are fictional and the emails are on our own demo subdomain (no mailbox; nothing is ever sent to
 * them): no real personal data.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClerkClient } from "@clerk/backend";

import { type BatteryLike, STORED, verdictState } from "../src/verdict";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = join(here, "..", "..", "..", "frontend", "public", "demo");

function secret(name: string): string {
	if (process.env[name]) return process.env[name] as string;
	try {
		const line = readFileSync(join(here, "..", ".dev.vars"), "utf8")
			.split("\n")
			.find((l) => l.startsWith(`${name}=`));
		const value = line?.slice(name.length + 1).trim();
		if (value) return value;
	} catch {
		// no .dev.vars
	}
	throw new Error(`${name} is not set (env or backend/worker/.dev.vars)`);
}

const clerk = createClerkClient({ secretKey: secret("CLERK_SECRET_KEY") });

interface DemoPerson {
	key: "manager" | "driver" | "driver2" | "driver3";
	firstName: string;
	lastName: string;
	email: string;
	role: "org:admin" | "org:member";
}

const PEOPLE: DemoPerson[] = [
	{ key: "manager", firstName: "Marina", lastName: "(demo insurer)", email: "manager@demo.securecargo.app", role: "org:admin" },
	{ key: "driver", firstName: "Rafael", lastName: "(demo driver)", email: "driver@demo.securecargo.app", role: "org:member" },
	{ key: "driver2", firstName: "Joana", lastName: "(demo driver)", email: "driver2@demo.securecargo.app", role: "org:member" },
	{ key: "driver3", firstName: "Tiago", lastName: "(demo driver)", email: "driver3@demo.securecargo.app", role: "org:member" },
];
const ORG = { name: "Demo Insurer", type: "insurer" as const };

async function findOrCreateUser(person: DemoPerson): Promise<string> {
	const { data } = await clerk.users.getUserList({ emailAddress: [person.email] });
	if (data[0]) return data[0].id;
	const user = await clerk.users.createUser({
		emailAddress: [person.email],
		firstName: person.firstName,
		lastName: person.lastName,
		skipPasswordRequirement: true,
		publicMetadata: { demo: true },
	});
	return user.id;
}

async function findOrCreateOrg(createdBy: string): Promise<string> {
	// Organization slugs are off by default in Clerk Core 3: find the demo org by name and metadata.
	const { data } = await clerk.organizations.getOrganizationList({ query: ORG.name, limit: 20 });
	const existing = data.find((o) => o.name === ORG.name && (o.publicMetadata as { demo?: boolean } | null)?.demo);
	if (existing) return existing.id;
	const org = await clerk.organizations.createOrganization({
		name: ORG.name,
		createdBy,
		publicMetadata: { type: ORG.type, demo: true },
	});
	return org.id;
}

async function ensureMembership(orgId: string, userId: string, role: string): Promise<void> {
	const { data } = await clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 });
	const current = data.find((m) => m.publicUserData?.userId === userId);
	if (!current) {
		await clerk.organizations.createOrganizationMembership({ organizationId: orgId, userId, role });
	} else if (current.role !== role) {
		await clerk.organizations.updateOrganizationMembership({ organizationId: orgId, userId, role });
	}
}

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
 * Who loaded what, and what happened next. `fixed`: the planner's fix was applied and proven;
 * `failed`: left as loaded; `passed`: loaded right the first time (the planner's fixed load).
 */
const PLAN: { example: string; author: DemoPerson["key"]; outcome: "fixed" | "failed" | "passed"; daysAgo: number }[] = [
	{ example: "emergency-braking", author: "driver", outcome: "fixed", daysAgo: 0 },
	{ example: "rope-lashing", author: "driver", outcome: "failed", daysAgo: 1 },
	{ example: "anti-slip-mat", author: "driver", outcome: "passed", daysAgo: 3 },
	{ example: "full-trip", author: "driver", outcome: "fixed", daysAgo: 6 },
	{ example: "sharp-curve", author: "driver2", outcome: "fixed", daysAgo: 0 },
	{ example: "steel-coil", author: "driver2", outcome: "failed", daysAgo: 2 },
	{ example: "box-truck", author: "driver2", outcome: "passed", daysAgo: 5 },
	{ example: "weigh-station", author: "driver3", outcome: "fixed", daysAgo: 1 },
	{ example: "dirt-road", author: "driver3", outcome: "failed", daysAgo: 4 },
	{ example: "emergency-braking", author: "driver3", outcome: "passed", daysAgo: 8 },
];

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
	const ids = new Map<DemoPerson["key"], string>();
	for (const person of PEOPLE) ids.set(person.key, await findOrCreateUser(person));
	const managerId = ids.get("manager") as string;
	const orgId = await findOrCreateOrg(managerId);
	for (const person of PEOPLE) await ensureMembership(orgId, ids.get(person.key) as string, person.role);

	const index = readJson<GalleryIndex>("index.json");
	const now = Date.now();
	const sql: string[] = [
		"-- Generated by seed/demo.ts. Replaces every demo row.",
		`DELETE FROM inspections WHERE org_id IN (SELECT id FROM organizations WHERE is_demo = 1);`,
		`INSERT INTO organizations (id, name, type, is_demo, created_at) VALUES (${q(orgId)}, ${q(ORG.name)}, 'insurer', 1, ${q(new Date(now).toISOString())})
		 ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type, is_demo = 1;`,
	];
	for (const person of PEOPLE) {
		const id = ids.get(person.key) as string;
		sql.push(
			`INSERT INTO users (id, email, name, is_demo, created_at) VALUES (${q(id)}, ${q(person.email)}, ${q(`${person.firstName} ${person.lastName}`)}, 1, ${q(new Date(now).toISOString())})
			 ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, is_demo = 1;`,
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
	// New tickets for the (possibly new) demo users.
	sql.push("DELETE FROM demo_tickets;");

	PLAN.forEach((item, n) => {
		const example = index.scenarios.find((s) => s.id === item.example);
		if (!example) throw new Error(`Unknown gallery example ${item.example}`);
		const asLoaded = readJson<ExplorerFixture>(`explorer/${item.example}.as_loaded.json`).draft;
		const loadedBattery = readJson<Battery>(`inspections/${item.example}.as_loaded.json`);
		const fixedBattery = readJson<Battery>(`inspections/${item.example}.fixed.json`);
		const plan = readJson<PlanFile>(`inspections/${item.example}.plan.json`);
		// A load that passed as loaded is the planner's fixed load, loaded right the first time.
		const passedFirst = item.outcome === "passed";
		const loaded = passedFirst ? plan.draft : asLoaded;
		const battery = passedFirst ? fixedBattery : loadedBattery;
		const batteryRef = `static:/demo/inspections/${item.example}.${passedFirst ? "fixed" : "as_loaded"}.json`;
		const at = new Date(now - item.daysAgo * 86_400_000 - n * 2_700_000).toISOString();
		const later = new Date(Date.parse(at) + 240_000).toISOString();
		const authorId = ids.get(item.author) as string;
		const id = `insp_demo_${String(n + 1).padStart(2, "0")}`;
		const weight = Math.round(readJson<ExplorerFixture>(`explorer/${item.example}.as_loaded.json`).scenario.units.reduce((sum, u) => sum + u.mass_kg, 0));
		const fixedVerdict = item.outcome === "fixed" ? verdictOf(fixedBattery) : null;
		sql.push(
			`INSERT INTO inspections (id, org_id, author_id, created_at, updated_at, status, title, truck_body, truck_size,
			   cargo_weight_kg, notes, situations_passed, situations_total, verdict, fixed_verdict, seeded)
			 VALUES (${q(id)}, ${q(orgId)}, ${q(authorId)}, ${q(at)}, ${q(later)}, 'simulated', ${q(example.title)},
			   ${q(loaded.truck.body)}, ${q(loaded.truck.size)}, ${weight}, '',
			   ${battery.passed}, ${battery.total}, ${q(verdictOf(battery))}, ${q(fixedVerdict)}, 1);`,
		);
		// Every inspection has a picture: a sample photograph, or else the MuJoCo render of the load.
		const photo = SAMPLE_PHOTOS[item.example] ?? `/demo/video/${item.example}.${passedFirst ? "fixed" : "as_loaded"}.jpg`;
		sql.push(
			`INSERT INTO photos (id, inspection_id, position, r2_key, sha256, content_type, bytes, exif_stripped, created_at)
			 VALUES (${q(`${id}_p1`)}, ${q(id)}, 'rear', ${q(`sample:${photo}`)}, ${q(`sample-${item.example}`)}, 'image/jpeg', 0, 1, ${q(at)});`,
		);
		const scenarioId = `${id}_s1`;
		sql.push(
			`INSERT INTO scenarios (id, inspection_id, kind, draft_json, battery_ref, created_by, created_at)
			 VALUES (${q(scenarioId)}, ${q(id)}, 'as_loaded', ${q(JSON.stringify(loaded))}, ${q(batteryRef)}, ${q(authorId)}, ${q(at)});`,
			...resultRows(id, scenarioId, battery, at, "r"),
		);
		if (item.outcome === "fixed") {
			const fixedId = `${id}_s2`;
			sql.push(
				`INSERT INTO scenarios (id, inspection_id, kind, draft_json, battery_ref, created_by, created_at)
				 VALUES (${q(fixedId)}, ${q(id)}, 'fixed', ${q(JSON.stringify(plan.draft))}, ${q(`static:/demo/inspections/${item.example}.fixed.json`)}, ${q(authorId)}, ${q(later)});`,
				...resultRows(id, fixedId, fixedBattery, later, "f"),
				`INSERT INTO fixes (id, inspection_id, from_scenario_id, to_scenario_id, changes_json, passes, created_at)
				 VALUES (${q(`${id}_f1`)}, ${q(id)}, ${q(scenarioId)}, ${q(fixedId)}, ${q(JSON.stringify(plan.changes))},
				   ${plan.verified ? 1 : 0}, ${q(later)});`,
			);
		}
	});

	const out = join(here, "out");
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "demo.sql"), `${sql.join("\n")}\n`);
	console.log(`Demo org ${orgId}; ${PLAN.length} inspections; wrote seed/out/demo.sql`);
}

await main();
