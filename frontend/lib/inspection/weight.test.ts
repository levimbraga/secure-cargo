import { describe, expect, it } from "vitest";

import type { LoadDraft } from "@/lib/explorer/draft";

import { weightsComplete } from "./review";
import { describeSplit, estimateRange, perUnitMatches, simulatedWeight, withWeights } from "./weight";

const draft = (sizes: [number, number, number][], cargo: LoadDraft["units"][number]["cargo"] = "crate"): LoadDraft => ({
  version: 1,
  source: "photo",
  truck: { body: "flatbed", size: "toco" },
  trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
  restraint: "top_over",
  units: sizes.map((size_m, n) => ({ id: `unit-${n + 1}`, cargo, size_m, x_m: 2 - n * 1.3, y_m: 0, straps: 2, mass_kg: null })),
});

describe("the weight split", () => {
  it("splits the total by volume and says ≈ each when the units are alike", () => {
    const split = withWeights(draft([[1.2, 1, 1], [1.2, 1, 1], [1.2, 1, 1]]), 1800, null);
    expect(split.units.map((u) => u.mass_kg)).toEqual([600, 600, 600]);
    expect(describeSplit(split)).toEqual({ kind: "equal", each: 600, count: 3 });
    expect(weightsComplete(split, 1800)).toBe(true);
  });

  it("gives a bigger unit more, and the units always add up to the total", () => {
    const split = withWeights(draft([[1.2, 1, 1], [1.2, 1, 2]]), 1000, null);
    expect(split.units.map((u) => u.mass_kg)).toEqual([333, 667]);
    expect(describeSplit(split)).toEqual({ kind: "varied", min: 333, max: 667, count: 2 });
  });

  it("takes per-unit weights only when they add up to the total", () => {
    const base = draft([[1.2, 1, 1], [1.2, 1, 1]]);
    const own = withWeights(base, 1000, { "unit-1": 300, "unit-2": 700 });
    expect(own.units.map((u) => u.mass_kg)).toEqual([300, 700]);
    expect(perUnitMatches([300, 600], 1000)).toBe(false);
    expect(perUnitMatches([300, null], 1000)).toBe(false);
    // A sum that does not match falls back to the volume split.
    expect(withWeights(base, 1000, { "unit-1": 300, "unit-2": 600 }).units.map((u) => u.mass_kg)).toEqual([500, 500]);
  });
});

describe("an estimated weight", () => {
  it("is a range from cargo type and volume, rounded outwards", () => {
    const range = estimateRange(draft([[1.2, 1, 1], [1.2, 1, 1]]));
    // Crates: 150 to 700 kg per m³ over 2.4 m³.
    expect(range).toEqual({ low_kg: 350, high_kg: 1700 });
    expect(estimateRange({ units: [] })).toBeNull();
  });

  it("is simulated at the upper bound, never at a typed value", () => {
    const range = { low_kg: 350, high_kg: 1700 };
    expect(simulatedWeight("estimated", 900, range)).toBe(1700);
    expect(simulatedWeight("measured", 900, range)).toBe(900);
    expect(simulatedWeight("invoice", 1840, null)).toBe(1840);
    expect(simulatedWeight("estimated", null, null)).toBeNull();
    expect(simulatedWeight("measured", null, null)).toBeNull();
  });
});
