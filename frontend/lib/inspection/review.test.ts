import { describe, expect, it } from "vitest";

import type { LoadDraft } from "@/lib/explorer/draft";

import { scaledSize } from "./image";
import { addUnit, removeUnit, resizeUnit, setCargo, splitWeight, weightOf, weightsComplete } from "./review";
import { batteryPasses, type ContranCheck } from "./types";

const bed = { length_m: 6.2, width_m: 2.4 };

function draft(units: LoadDraft["units"]): LoadDraft {
  return {
    version: 1,
    source: "photo",
    truck: { body: "flatbed", size: "toco" },
    trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
    restraint: "top_over",
    units,
  };
}

const pallet = (id: string, x: number, extra: Partial<LoadDraft["units"][number]> = {}) => ({
  id,
  cargo: "wood_pallet" as const,
  x_m: x,
  y_m: 0,
  straps: 2,
  mass_kg: null,
  ...extra,
});

describe("weights come only from the user", () => {
  it("are empty until the user gives them, and the load cannot be confirmed", () => {
    const load = draft([pallet("u1", 2.5), pallet("u2", 1.3)]);
    expect(weightsComplete(load, null)).toBe(false);
    expect(weightsComplete(load, 1800)).toBe(false);
  });

  it("split a total by volume in whole kilograms that add up exactly", () => {
    const load = splitWeight(draft([pallet("u1", 2.5), pallet("u2", 1.3, { size_m: [1.2, 1.0, 2.2] })]), 1501);
    expect(weightOf(load)).toBe(1501);
    expect(load.units[1]?.mass_kg).toBeCloseTo(2 * (load.units[0]?.mass_kg ?? 0), -1);
    expect(weightsComplete(load, 1501)).toBe(true);
    expect(weightsComplete(load, 2000)).toBe(false);
  });
});

describe("review edits", () => {
  it("adds a unit at the first free spot from the headboard", () => {
    const load = draft([pallet("u1", 2.5, { y_m: 0.7 })]);
    const added = addUnit(load, bed, "crate");
    const unit = added?.units[1];
    expect(unit).toMatchObject({ cargo: "crate", mass_kg: null, id: "unit-2" });
    // Beside the first pallet, not on top of it.
    expect(Math.abs((unit?.y_m ?? 0) - 0.7)).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });

  it("refuses a size that would overlap, and keeps units on the bed", () => {
    const load = draft([pallet("u1", 2.5), pallet("u2", 1.3)]);
    expect(resizeUnit(load, bed, "u1", [2.0, 1.0, 1.1])).toBeNull();
    const longer = resizeUnit(load, bed, "u2", [1.2, 3.0, 1.1]);
    expect(longer?.units[1]?.size_m?.[1]).toBe(2.4);
  });

  it("removes a unit with whatever stands on it", () => {
    const load = draft([pallet("u1", 2.5), pallet("u2", 2.5, { on: "u1" }), pallet("u3", 1.3)]);
    expect(removeUnit(load, "u1")?.units.map((u) => u.id)).toEqual(["u3"]);
    expect(removeUnit(draft([pallet("u1", 2.5)]), "u1")).toBeNull();
  });

  it("gives a round cargo its usual cross-section", () => {
    const coil = setCargo(draft([pallet("u1", 0)]), bed, "u1", "steel_coil");
    expect(coil?.units[0]?.size_m).toEqual([1.6, 1.2, 1.6]);
  });
});

describe("photos", () => {
  it("are scaled so the long edge is at most 1568 px", () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("verdict", () => {
  it("passes only with every situation and every CONTRAN rule", () => {
    const rule = (status: "pass" | "fail"): ContranCheck[] => [{ code: "devices_allowed", article: "", status, unit_ids: [], message: "" }];
    expect(batteryPasses({ passed: 7, total: 7, contran_945: rule("pass") })).toBe(true);
    expect(batteryPasses({ passed: 7, total: 7, contran_945: rule("fail") })).toBe(false);
    expect(batteryPasses({ passed: 6, total: 7, contran_945: [] })).toBe(false);
  });
});
