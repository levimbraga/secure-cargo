import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  anchorPairs,
  applyControls,
  authoredMat,
  authoredPretension,
  authoredStrapsPerUnit,
  defaultControls,
  isDefault,
  maxStrapsPerUnit,
} from "./controls";
import type { Scenario, TripEventInput } from "./scenario";

function demo(id: string, variant: string): { scenario: Scenario; event: TripEventInput } {
  const run = JSON.parse(readFileSync(`public/demo/${id}.${variant}.json`, "utf8")) as {
    scenario: Scenario;
    event: TripEventInput;
  };
  return { scenario: run.scenario, event: run.event };
}

describe("lab controls", () => {
  const braking = demo("emergency-braking", "as_loaded");

  it("start from the scenario as authored and change nothing", () => {
    const controls = defaultControls(braking.event);
    expect(isDefault(controls, braking.event)).toBe(true);
    expect(applyControls(braking.scenario, braking.event, controls)).toEqual(braking);
  });

  it("read the authored straps, pretension and mat", () => {
    expect(authoredStrapsPerUnit(braking.scenario)).toBe(1);
    expect(authoredStrapsPerUnit(demo("eu-curtain-pallets", "fixed").scenario)).toBe(2);
    expect(authoredPretension(braking.scenario)).toBe(3000);
    expect(authoredMat(braking.scenario)).toBe(false);
    expect(authoredMat(demo("eu-curtain-pallets", "fixed").scenario)).toBe(true);
    // The machine is only chained: no strap goes over it.
    expect(authoredStrapsPerUnit(demo("weigh-station", "fixed").scenario)).toBe(null);
    // Units with diagonal lashings are left to them, whatever goes over them.
    expect(authoredStrapsPerUnit(demo("emergency-braking", "fixed").scenario)).toBe(null);
    expect(authoredStrapsPerUnit(demo("dirt-road", "as_loaded").scenario)).toBe(3);
  });

  it("find the anchor pairs over a unit", () => {
    const unit = braking.scenario.units[0];
    expect(unit && anchorPairs(braking.scenario, unit).map((pair) => pair.left)).toEqual(["L11", "L12", "L13"]);
    expect(maxStrapsPerUnit(braking.scenario)).toBe(3);
  });

  it("set the number of straps on every unit, evenly spread", () => {
    const controls = { ...defaultControls(braking.event), strapsPerUnit: 2 };
    const { scenario } = applyControls(braking.scenario, braking.event, controls);
    expect(scenario.lashings.map((lashing) => lashing.anchor_ids.join())).toEqual([
      "L11,R11",
      "L13,R13",
      "L7,R7",
      "L9,R9",
      "L3,R3",
      "L5,R5",
    ]);

    const none = applyControls(braking.scenario, braking.event, { ...controls, strapsPerUnit: 0 });
    expect(none.scenario.lashings).toEqual([]);
    const many = applyControls(braking.scenario, braking.event, { ...controls, strapsPerUnit: 9 });
    expect(many.scenario.lashings).toHaveLength(9);
  });

  it("leave units held by direct lashings alone", () => {
    const sacks = demo("dirt-road", "fixed");
    const controls = { ...defaultControls(sacks.event), strapsPerUnit: 1 };
    const { scenario } = applyControls(sacks.scenario, sacks.event, controls);
    expect(scenario.lashings.filter((lashing) => lashing.routing === "direct")).toHaveLength(12);
    expect(scenario.lashings.filter((lashing) => lashing.routing === "top_over")).toHaveLength(0);
  });

  it("keep rope as rope and never tension a lashing beyond its capacity", () => {
    const rope = demo("rope-lashing", "as_loaded");
    const controls = { ...defaultControls(rope.event), strapsPerUnit: 3, pretensionN: 4000 };
    const { scenario } = applyControls(rope.scenario, rope.event, controls);
    expect(scenario.lashings).toHaveLength(9);
    expect(new Set(scenario.lashings.map((lashing) => lashing.kind))).toEqual(new Set(["rope"]));
    expect(new Set(scenario.lashings.map((lashing) => lashing.pretension_n))).toEqual(new Set([1000]));
  });

  it("scale the mass, lay the mat, and take it away again", () => {
    const controls = { ...defaultControls(braking.event), massFactor: 1.5, antiSlipMat: true };
    const { scenario } = applyControls(braking.scenario, braking.event, controls);
    expect(scenario.units.map((unit) => unit.mass_kg)).toEqual([1350, 1350, 1350]);
    expect(scenario.units.map((unit) => unit.material)).toEqual(["rubber_mat", "rubber_mat", "rubber_mat"]);

    const fixed = demo("rope-lashing", "fixed");
    const loaded = demo("rope-lashing", "as_loaded");
    const bare = applyControls(
      fixed.scenario,
      fixed.event,
      { ...defaultControls(fixed.event), antiSlipMat: false },
      loaded.scenario,
    );
    expect(bare.scenario.units.map((unit) => unit.material)).toEqual([
      "plastic_pallet",
      "plastic_pallet",
      "plastic_pallet",
    ]);
  });

  it("change the event, speed and surface, dropping parameters of another event", () => {
    const curve = demo("sharp-curve", "fixed");
    const same = applyControls(curve.scenario, curve.event, { ...defaultControls(curve.event), speedKmh: 40 });
    expect(same.event).toMatchObject({ kind: "sharp_curve", speed_kmh: 40, curve_radius_m: 60 });
    const other = applyControls(curve.scenario, curve.event, {
      ...defaultControls(curve.event),
      event: "emergency_braking",
      surface: "wet",
    });
    expect(other.event).toMatchObject({ kind: "emergency_braking", road_surface: "wet", curve_radius_m: null });
  });
});
