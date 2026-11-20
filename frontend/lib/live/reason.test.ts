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
});
