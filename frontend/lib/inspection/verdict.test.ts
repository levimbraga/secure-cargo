import { describe, expect, it } from "vitest";

import { physicsPassed, stateOfStored, verdictOf } from "./verdict";

const slid = { code: "unit_slid", severity: "fail", unit_id: "pallet-2" };
const axle = { code: "axle_overloaded", severity: "fail", unit_id: null };
const situation = (id: string, ...findings: object[]) => ({ id, severity: findings.length ? 1 : 0, findings: findings as never });
const pass = { code: "devices_allowed", status: "pass" };
const rope = { code: "devices_allowed", status: "fail", article: "Art. 4 §3", unit_ids: ["c-1"] };

describe("the three-state verdict", () => {
  it("is approved when everything holds and complies", () => {
    expect(verdictOf({ situations: [situation("pothole")], contran_945: [pass] })).toEqual({ state: "approved", problem: null });
  });

  it("is yellow, never red, when every situation holds and a rule fails", () => {
    const verdict = verdictOf({ situations: [situation("pothole")], contran_945: [rope] });
    expect(verdict.state).toBe("holds_noncompliant");
    expect(verdict.problem).toMatchObject({ kind: "rule", code: "devices_allowed", unitId: "c-1", theme: "securing" });
  });

  it("counts a finding only under the countries it names (49 CFR 393.102(a)(1))", () => {
    const overLc = { code: "lashing_overloaded", severity: "fail", unit_id: null, countries: ["BR", "EU"] };
    const battery = { situations: [situation("emergency_braking", overLc)], contran_945: [pass] };
    expect(verdictOf({ ...battery, country: "BR" }).state).toBe("fails");
    expect(verdictOf({ ...battery, country: "US" }).state).toBe("approved");
    expect(physicsPassed({ ...battery, country: "US" })).toBe(1);
  });

  it("treats an axle overload as a rule, not as physics", () => {
    const battery = {
      situations: [situation("emergency_braking", axle), situation("lane_change", axle)],
      contran_945: [pass],
      axle_loads: [{ axle_group_id: "rear", load_kg: 11_000, limit_kg: 10_000 }],
    };
    expect(physicsPassed(battery)).toBe(2);
    expect(verdictOf(battery)).toMatchObject({ state: "holds_noncompliant", problem: { code: "axle", theme: "weight" } });
  });

  it("counts checklist rules, never advice", () => {
    const base = { situations: [situation("pothole")], contran_945: [pass] };
    const advice = { code: "anti_slip_mat", kind: "advice" as const, status: "advice" };
    const tall = { code: "height", kind: "rule" as const, status: "fail" };
    expect(verdictOf({ ...base, checklist: { protection: [advice] } }).state).toBe("approved");
    expect(verdictOf({ ...base, checklist: { dimensions: [tall] } })).toMatchObject({ state: "holds_noncompliant", problem: { theme: "dimensions" } });
  });

  it("is red on any physical failure and names the situation and the unit", () => {
    const verdict = verdictOf({ situations: [situation("lane_change"), situation("emergency_braking", slid)], contran_945: [rope] });
    expect(verdict).toEqual({ state: "fails", problem: { kind: "physics", code: "unit_slid", situation: "emergency_braking", unitId: "pallet-2" } });
  });

  it("does not count a headboard height to confirm as a violation", () => {
    const art8 = { code: "above_headboard", status: "to_confirm" };
    expect(verdictOf({ situations: [situation("pothole")], contran_945: [art8] }).state).toBe("approved");
  });

  it("reads the stored list verdicts", () => {
    expect([stateOfStored("pass"), stateOfStored("warning"), stateOfStored("fail"), stateOfStored(null)]).toEqual([
      "approved",
      "holds_noncompliant",
      "fails",
      null,
    ]);
  });
});
