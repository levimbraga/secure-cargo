/** The battery and the planner's proof, run in parallel on one container instance per situation. */
import { describe, expect, it } from "vitest";

import { type ContainerCall, runBattery, runPlan, SITUATIONS, worstIndex } from "../src/fanout";

type Verdicts = Partial<Record<(typeof SITUATIONS)[number], "pass" | "warning" | "fail">>;

/** A fake container: each draft carries the verdict of each situation it should get. */
function fakeContainer(options: { infeasible?: boolean; candidates?: Verdicts[] } = {}) {
	const calls: { path: string; instance?: string }[] = [];
	const call: ContainerCall = async (path, body, instance) => {
		calls.push({ path, instance });
		const { draft, situation } = body as { draft: { verdicts: Verdicts; name?: string }; situation?: string };
		if (path === "/battery/checks") {
			return Response.json({ draft, scenario: {}, axle_loads: [], en_12195_1: [], contran_945: [{ status: "pass" }], recommendation: { changes: ["x"] } });
		}
		if (path === "/battery/situation") {
			const status = draft.verdicts[situation as keyof Verdicts] ?? "pass";
			return Response.json({
				situation: {
					id: situation,
					status,
					passed: status !== "fail",
					severity: status === "fail" ? (situation === "long_vibration" ? 9 : 2) : 0,
					findings: status === "fail" ? [{ code: "unit_slid", severity: "fail" }] : [],
				},
				result: { keyframes: situation },
			});
		}
		if (path === "/plan/candidates") {
			return Response.json({
				infeasible: options.infeasible ? "overweight" : null,
				values: options.infeasible ? { mass_kg: 20000, payload_kg: 14000 } : {},
				candidates: (options.candidates ?? []).map((verdicts, n) => ({ name: `c${n}`, draft: { verdicts, name: `c${n}` }, changes: [`change-${n}`] })),
			});
		}
		return new Response("{}", { status: 404 });
	};
	return { call, calls };
}

describe("the battery in parallel", () => {
	it("sends each situation to its own instance and the checks to the main one", async () => {
		const { call, calls } = fakeContainer();
		const battery = await runBattery(call, { verdicts: {} });
		expect(battery.passed).toBe(7);
		expect(battery.recommendation).toBeNull();
		expect(calls.filter((c) => c.path === "/battery/situation").map((c) => c.instance).sort()).toEqual(
			SITUATIONS.map((s) => `s-${s}`).sort(),
		);
		expect(calls.find((c) => c.path === "/battery/checks")?.instance).toBeUndefined();
	});

	it("shows the worst failure first, with its run, and recommends a fix", async () => {
		const { call } = fakeContainer();
		const battery = await runBattery(call, { verdicts: { emergency_braking: "fail", long_vibration: "fail", pothole: "warning" } });
		expect(battery).toMatchObject({ passed: 5, total: 7, status: "fail", worst: "long_vibration", worst_result: { keyframes: "long_vibration" } });
		expect(battery.recommendation).toEqual({ changes: ["x"] });
	});

	it("orders like the container: failures before warnings, then severity, then the first", () => {
		expect(worstIndex([{ status: "warning", severity: 5 }, { status: "fail", severity: 1 }])).toBe(1);
		expect(worstIndex([{ status: "fail", severity: 2 }, { status: "fail", severity: 2 }])).toBe(0);
	});
});

describe("the planner's proof in parallel", () => {
	it("returns the first candidate that passes the whole battery", async () => {
		const { call } = fakeContainer({ candidates: [{ long_vibration: "fail" }, {}, {}] });
		const plan = await runPlan(call, { verdicts: { emergency_braking: "fail" } });
		expect(plan).toMatchObject({ verified: true, rounds: 2, changes: ["change-1"] });
		expect(plan.battery?.passed).toBe(7);
	});

	it("changes nothing when the load already passes", async () => {
		const { call } = fakeContainer({ candidates: [{}] });
		expect(await runPlan(call, { verdicts: {} })).toMatchObject({ verified: true, rounds: 0, changes: [] });
	});

	it("says when the cargo is heavier than the truck may carry, without simulating candidates", async () => {
		const { call, calls } = fakeContainer({ infeasible: true });
		const plan = await runPlan(call, { verdicts: { emergency_braking: "fail" } });
		expect(plan).toMatchObject({ verified: false, rounds: 0, changes: [{ code: "overweight", values: { mass_kg: 20000 } }] });
		expect(calls.filter((c) => c.path === "/battery/situation")).toHaveLength(7); // the original only
	});

	it("reports the last candidate when none passes", async () => {
		const { call } = fakeContainer({ candidates: [{ pothole: "fail" }, { sharp_curve: "fail" }] });
		const plan = await runPlan(call, { verdicts: { pothole: "fail" } });
		expect(plan).toMatchObject({ verified: false, rounds: 2, changes: ["change-1"] });
	});

	it("passes the container's refusal on as a 422 with its code", async () => {
		const call: ContainerCall = async () => Response.json({ detail: { code: "units_overlap", message: "overlap" } }, { status: 422 });
		await expect(runBattery(call, {})).rejects.toMatchObject({ status: 422, code: "units_overlap" });
	});
});

describe("the verdict of a battery in parallel", () => {
	it("is yellow, not red, when every situation holds and only an axle is over its limit", async () => {
		const call: ContainerCall = async (path, body, instance) => {
			const { situation } = body as { situation?: string };
			if (path === "/battery/checks") {
				return Response.json({
					draft: {},
					scenario: {},
					axle_loads: [{ load_kg: 11000, limit_kg: 10000 }],
					en_12195_1: [],
					contran_945: [{ status: "pass" }],
					checklist: { weight: [{ code: "axle", kind: "rule", status: "fail" }] },
					recommendation: { changes: ["balance"] },
				});
			}
			return Response.json({
				situation: { id: situation ?? instance, status: "pass", passed: true, severity: 0, findings: [] },
				result: {},
			});
		};
		const battery = await runBattery(call, {});
		expect(battery.verdict).toEqual({ state: "holds_noncompliant" });
		expect(battery.recommendation).toEqual({ changes: ["balance"] });
	});
});
