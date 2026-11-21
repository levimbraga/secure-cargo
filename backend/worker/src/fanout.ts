/**
 * The battery and the planner's proof, run in parallel: one container instance per situation.
 *
 * A `basic` container has a quarter of a vCPU. Run one after the other, the seven situations of
 * a battery take most of a minute on it; run side by side on seven instances, about as long as
 * the slowest one. Each situation always goes to the same instance (`s-<situation>`), whose cache
 * then answers repeated runs at once. The rule checks and the planner's candidates come from the
 * main instance; neither simulates anything.
 *
 * The answers have the shapes of the container's own `POST /battery` and `POST /plan`.
 */
import { ApiError, fail } from "./http";

/** A POST to a container instance (only the Worker can reach them). `instance` names it. */
export type ContainerCall = (path: string, body: unknown, instance?: string) => Promise<Response>;

export const SITUATIONS = [
	"emergency_braking",
	"lane_change",
	"sharp_curve",
	"pothole",
	"speed_bump",
	"mountain_descent",
	"long_vibration",
] as const;

type Status = "pass" | "warning" | "fail";

export interface Situation {
	id: (typeof SITUATIONS)[number];
	status: Status;
	passed: boolean;
	severity: number;
	findings: unknown[];
	margins: unknown;
	event: unknown;
	trip: unknown;
	scenario_hash: string;
	[key: string]: unknown;
}

export interface BatteryJson {
	draft: unknown;
	scenario: unknown;
	situations: Situation[];
	passed: number;
	total: number;
	status: Status;
	worst: string;
	worst_result: unknown;
	axle_loads: unknown[];
	en_12195_1: unknown[];
	contran_945: { status: string }[];
	wall_time_s: number;
	recommendation: unknown;
}

export interface PlanJson {
	draft: unknown;
	changes: unknown[];
	verified: boolean;
	rounds: number;
	battery: BatteryJson | null;
}

const RANK: Record<Status, number> = { pass: 0, warning: 1, fail: 2 };

async function post<T>(call: ContainerCall, path: string, body: unknown, instance?: string): Promise<T> {
	let response: Response;
	try {
		response = await call(path, body, instance);
	} catch (error) {
		console.error(`Container call ${path} failed:`, error);
		fail(503, "api_unavailable", "The physics engine is starting or unavailable. Try again.");
	}
	if (response.status === 422) {
		const detail = ((await response.json().catch(() => ({}))) as { detail?: { code?: string; message?: string } }).detail;
		fail(422, detail?.code ?? "invalid_load", detail?.message ?? "This load cannot be simulated.");
	}
	if (!response.ok) fail(503, "api_unavailable", "The physics engine is starting or unavailable. Try again.");
	return (await response.json()) as T;
}

/** The situation shown first: failures before warnings, then the most severe (as battery.py). */
export function worstIndex(situations: Pick<Situation, "status" | "severity">[]): number {
	let best = 0;
	situations.forEach((s, i) => {
		const b = situations[best] as Pick<Situation, "status" | "severity">;
		if (RANK[s.status] > RANK[b.status] || (RANK[s.status] === RANK[b.status] && s.severity > b.severity)) best = i;
	});
	return best;
}

export function passesRules(battery: Pick<BatteryJson, "passed" | "total" | "contran_945">): boolean {
	return battery.passed === battery.total && battery.contran_945.every((check) => check.status !== "fail");
}

/** The seven situations side by side, then the battery as the container would have answered. */
export async function runBattery(call: ContainerCall, draft: unknown, withRecommendation = true): Promise<BatteryJson> {
	const started = Date.now();
	const [checks, ...runs] = await Promise.all([
		post<{ draft: unknown; scenario: unknown; axle_loads: unknown[]; en_12195_1: unknown[]; contran_945: { status: string }[]; recommendation: unknown }>(
			call,
			"/battery/checks",
			{ draft },
		),
		...SITUATIONS.map((situation) =>
			post<{ situation: Situation; result: unknown }>(call, "/battery/situation", { draft, situation }, `s-${situation}`),
		),
	]);
	const situations = runs.map((run) => run.situation);
	const worst = worstIndex(situations);
	const statuses = new Set(situations.map((s) => s.status));
	const battery: BatteryJson = {
		draft: checks.draft,
		scenario: checks.scenario,
		situations,
		passed: situations.filter((s) => s.passed).length,
		total: situations.length,
		status: statuses.has("fail") ? "fail" : statuses.has("warning") ? "warning" : "pass",
		worst: (situations[worst] as Situation).id,
		worst_result: (runs[worst] as { result: unknown }).result,
		axle_loads: checks.axle_loads,
		en_12195_1: checks.en_12195_1,
		contran_945: checks.contran_945,
		wall_time_s: (Date.now() - started) / 1000,
		recommendation: null,
	};
	if (withRecommendation && !passesRules(battery)) battery.recommendation = checks.recommendation;
	return battery;
}

interface Candidates {
	candidates: { name: string; draft: unknown; changes: unknown[] }[];
	infeasible: "overweight" | null;
	values: Record<string, number>;
}

/**
 * The planner's fix, proven: the original battery, then each candidate (cheapest first) through
 * the whole battery in parallel, until one passes every situation and every rule.
 */
export async function runPlan(call: ContainerCall, draft: unknown): Promise<PlanJson> {
	const [original, options] = await Promise.all([
		runBattery(call, draft, false),
		post<Candidates>(call, "/plan/candidates", { draft }),
	]);
	if (passesRules(original)) return { draft, changes: [], verified: true, rounds: 0, battery: original };
	if (options.infeasible === "overweight") {
		const change = {
			code: "overweight",
			unit_id: null,
			before: null,
			after: null,
			article: null,
			values: options.values,
			message: "The cargo is heavier than this truck may carry. Use a larger truck or split the load.",
		};
		return { draft, changes: [change], verified: false, rounds: 0, battery: original };
	}
	let last: PlanJson | null = null;
	let rounds = 0;
	for (const candidate of options.candidates) {
		rounds += 1;
		const battery = await runBattery(call, candidate.draft, false);
		last = { draft: candidate.draft, changes: candidate.changes, verified: passesRules(battery), rounds, battery };
		if (last.verified) return last;
	}
	if (!last) throw new ApiError(502, "plan_failed", "The planner found no candidate.");
	return last;
}
