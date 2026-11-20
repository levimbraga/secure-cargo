import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { DemoRun } from "@/lib/demo";

import { explain } from "./reason";

function run(id: string, variant: string): DemoRun["result"] {
  return (JSON.parse(readFileSync(`public/demo/${id}.${variant}.json`, "utf8")) as DemoRun).result;
}

describe("explain", () => {
  it("says inertia beat friction when pallets slide into the headboard", () => {
    const result = run("emergency-braking", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("slidesIntoHeadboard");
    expect(reason.subject).toMatch(/^pallet-/);
    expect(reason.values.inertia).toBeGreaterThan(reason.values.friction ?? Infinity);
    // 900 kg at the braking the dry road allows (about 0.76 g): close to 6.7 kN.
    expect(reason.values.inertia).toBeGreaterThan(6);
    expect(reason.values.inertia).toBeLessThan(7.5);
    expect(reason.values.slide).toBeGreaterThan(50);
  });

  it("says friction holds once the load is lashed", () => {
    const result = run("emergency-braking", "fixed");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("holds");
    expect(reason.values.friction).toBeGreaterThan(reason.values.inertia ?? Infinity);
  });

  it("explains a cabinet that tips with moments", () => {
    const result = run("sharp-curve", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("tips");
    expect(reason.values.overturning).toBeGreaterThan(reason.values.restoring ?? Infinity);
  });

  it("names the overloaded axle when nothing moves", () => {
    const result = run("weigh-station", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("axleOverloaded");
    expect(reason.values.load).toBeGreaterThan(reason.values.limit ?? Infinity);
  });

  it("explains rope that lets the load slide", () => {
    const result = run("rope-lashing", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(["slides", "slidesLoose"]).toContain(reason.key);
  });

  it("names tipping when a tall unit holds, with its margin next to friction", () => {
    const result = run("sharp-curve", "fixed");
    const reason = explain(result, result.keyframes);
    expect(["holdsUpright", "holdsTall"]).toContain(reason.key);
    expect(reason.subject).toMatch(/^cabinet-/);
    expect(reason.values.overturning).toBeGreaterThan(0);
    expect(reason.values.overturning).toBeLessThan(reason.values.restoring ?? 0);
    expect(reason.values.friction).toBeGreaterThan(0);
  });

  it("keeps a low pallet to friction alone", () => {
    const result = run("anti-slip-mat", "fixed");
    expect(explain(result, result.keyframes).key).toBe("holds");
  });

  it("says a coil rolls, not slides", () => {
    const result = run("steel-coil", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("rollsIntoHeadboard");
    expect(reason.values.slide).toBeGreaterThan(100);
  });

  it("puts the overloaded front wall in the sentence", () => {
    const result = run("box-truck", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("slidesIntoWall");
    expect(reason.values.force).toBeGreaterThan(reason.values.capacity ?? Infinity);
  });

  it("blames loosened straps on the dirt road", () => {
    const result = run("dirt-road", "as_loaded");
    const reason = explain(result, result.keyframes);
    expect(reason.key).toBe("slidesAfterLoosening");
    expect(reason.values.after).toBeLessThan(0.75 * (reason.values.before ?? 0));
    expect(reason.values.inertia).toBeGreaterThan(reason.values.friction ?? Infinity);
  });

  it("takes friction from instants when the unit stands on the floor", () => {
    const result = run("full-trip", "as_loaded");
    const reason = explain(result, result.keyframes);
    // A 1.5 t crate on plywood (0.45), no lashing: about the weight's 6.6 kN, though it bounces
    // over the speed bump and on the crate in front.
    expect(reason.values.friction).toBeGreaterThan(5.5);
    expect(reason.values.friction).toBeLessThan(7.5);
  });

  it("reads friction when braking peaks, not when a sliding pallet hits the next one", () => {
    const result = run("emergency-braking", "as_loaded");
    const reason = explain(result, result.keyframes);
    // 900 kg on plywood (0.45) pressed down by its weight and one 300 daN strap: about 6.3 kN of
    // friction, short of the 6.7 kN braking asks for. Bouncing instants read far lower.
    expect(reason.values.friction).toBeGreaterThan(5.8);
    expect(reason.values.friction).toBeLessThan(reason.values.inertia ?? 0);
  });
});
