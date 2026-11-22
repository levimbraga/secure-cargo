import { describe, expect, it } from "vitest";

import { biggerTrucks, fewerUnits, rankOptions } from "./alternatives";
import type { LoadDraft } from "./draft";

const machine = (id: string, x: number, mass = 6000) => ({ id, cargo: "machine" as const, x_m: x, y_m: 0, straps: 2, mass_kg: mass });

function draft(units: LoadDraft["units"], size: LoadDraft["truck"]["size"] = "toco"): LoadDraft {
  return {
    version: 1,
    source: "explorer",
    truck: { body: "flatbed", size },
    trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
    restraint: "top_over",
    units,
  };
}

describe("bigger trucks", () => {
  it("are the next trucks of the family that can carry the load, the lightest first", () => {
    // Three 6 t machines: 18 t, over a toco's 8 t and a truck's 14 t.
    const options = biggerTrucks(draft([machine("m1", 2), machine("m2", 0), machine("m3", -2)]));
    expect(options.map((option) => option.size)).toEqual(["semi"]);
    // Two of them: 12 t, a truck (14 t) first.
    expect(biggerTrucks(draft([machine("m1", 2), machine("m2", 0)])).map((option) => option.size)).toEqual(["truck", "semi"]);
  });

  it("keep each unit's distance to the headboard and drop lashings set by hand", () => {
    const [option] = biggerTrucks(draft([{ ...machine("m1", 2), lashings: [{ kind: "chain", routing: "top_over", anchors: ["L1", "R1"] }] }]));
    // Toco bed 6.2 m, truck 8.0 m: 0.9 m further from the centre.
    expect(option?.draft.units[0]).toMatchObject({ x_m: 2.9, lashings: null });
    expect(option?.draft.truck.size).toBe("truck");
  });

  it("stay in the US or EU family", () => {
    expect(biggerTrucks(draft([machine("m1", 0, 3000)], "us_box")).every((option) => option.size?.startsWith("us_"))).toBe(true);
  });
});

describe("fewer units", () => {
  it("take off the heaviest stacks until the truck can carry the rest", () => {
    const option = fewerUnits(draft([machine("m1", 2, 3000), machine("m2", 0, 5000), machine("m3", -2, 4000)]));
    // 12 t on an 8 t toco: the 5 t machine goes on a second trip.
    expect(option?.removed).toEqual(["m2"]);
    expect(option?.draft.units.map((unit) => unit.id)).toEqual(["m1", "m3"]);
  });

  it("otherwise take off the unit that fails, with whatever stands on it", () => {
    const load = draft([
      { id: "c1", cargo: "crate", x_m: 2, y_m: 0, straps: 1 },
      { id: "c2", cargo: "crate", x_m: 0, y_m: 0, straps: 0 },
      { id: "c3", cargo: "crate", x_m: 0, y_m: 0, straps: 1, on: "c2" },
    ]);
    expect(fewerUnits(load, ["c3"])?.removed).toEqual(["c2", "c3"]);
    // Nothing named: the rearmost.
    expect(fewerUnits(load)?.removed).toEqual(["c2", "c3"]);
    expect(fewerUnits(draft([machine("m1", 0, 1000)]))).toBeNull();
  });
});

describe("ranking", () => {
  it("puts proven options first, then those that hold, smallest change first", () => {
    const plan = (verified: boolean, holds: boolean) => ({ verified, holds });
    const ranked = rankOptions(
      [
        { kind: "this_truck", plan: plan(false, false), alternative: null },
        { kind: "fewer_units", plan: plan(true, true), alternative: null },
        { kind: "bigger_truck", plan: plan(true, true), alternative: null },
        { kind: "bigger_truck", plan: plan(false, true), alternative: null },
      ],
      (p) => p.holds,
    );
    expect(ranked.map((option) => `${option.kind}:${option.plan.verified}`)).toEqual([
      "bigger_truck:true",
      "fewer_units:true",
      "bigger_truck:false",
      "this_truck:false",
    ]);
  });
});
