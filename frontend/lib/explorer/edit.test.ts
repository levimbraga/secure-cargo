import { describe, expect, it } from "vitest";

import type { LoadDraft } from "./draft";
import { addUnits, duplicateUnit, massOf, MAX_UNITS, strapRoomAt } from "./edit";

// A 6 m by 2.4 m bed with lashing points every 0.5 m on both sides.
const anchors = Array.from({ length: 11 }, (_, n) => -2.5 + n * 0.5).flatMap((x) => [
  { position_m: [x, 1.2, 0] },
  { position_m: [x, -1.2, 0] },
]);
const bed = { length_m: 6, width_m: 2.4, anchor_points: anchors };

function draft(units: LoadDraft["units"]): LoadDraft {
  return {
    version: 1,
    source: "explorer",
    truck: { body: "flatbed", size: "toco" },
    trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
    restraint: "top_over",
    units,
  };
}

const pallet = (id: string, x: number, straps = 2) => ({ id, cargo: "wood_pallet" as const, x_m: x, y_m: 0.7, straps });

describe("strap room", () => {
  it("counts the anchor pairs inside a footprint", () => {
    // A 1.2 m pallet centred at 0: anchors at -0.5, 0 and 0.5.
    expect(strapRoomAt(bed, 0, 1.2, 0)).toBe(3);
    expect(strapRoomAt(bed, 0, 0.4, 0)).toBe(1);
  });
});

describe("adding units", () => {
  it("adds several units of a cargo at free spots, named after the cargo", () => {
    const { draft: next, added } = addUnits(draft([pallet("pallet-1", 2.4)]), bed, "crate", 3);
    expect(added).toEqual(["crate-2", "crate-3", "crate-4"]);
    expect(next.units).toHaveLength(4);
    const boxes = next.units.map((unit) => [unit.x_m, unit.y_m]);
    expect(new Set(boxes.map((box) => box.join())).size).toBe(4);
  });

  it("secures a new unit like the first one, where the anchors allow it", () => {
    const one = addUnits(draft([pallet("pallet-1", 0, 1)]), bed, "wood_pallet", 1).draft;
    expect(one.units[1]?.straps).toBe(1);
    // At the front (x 1.8 to 3.0 m) only the lashing points at 2.0 and 2.5 m lie along it.
    const three = addUnits(draft([pallet("pallet-1", 0, 3)]), bed, "wood_pallet", 1).draft;
    expect(three.units[1]).toMatchObject({ x_m: 2.4, straps: 2 });
  });

  it("adds only what fits and says so", () => {
    const { draft: next, added } = addUnits(draft([pallet("pallet-1", 2.4)]), bed, "machine", 10);
    // A 2 m x 1.6 m machine: one row of two along a 6 m bed minus the pallet.
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThan(10);
    expect(next.units.length).toBe(1 + added.length);
  });

  it("never goes past the draft's unit limit", () => {
    const { draft: next } = addUnits(draft([pallet("pallet-1", 2.4)]), { ...bed, length_m: 60 }, "stacked_boxes", 100);
    expect(next.units.length).toBeLessThanOrEqual(MAX_UNITS);
  });
});

describe("duplicating a unit", () => {
  it("copies its size, weight and straps to a free spot", () => {
    const base = draft([{ ...pallet("pallet-1", 2.4), mass_kg: 1200, size_m: [1.2, 1, 1.4] }]);
    const copy = duplicateUnit(base, bed, "pallet-1");
    expect(copy?.id).toBe("pallet-2");
    const unit = copy?.draft.units[1];
    expect(unit).toMatchObject({ cargo: "wood_pallet", mass_kg: 1200, size_m: [1.2, 1, 1.4], straps: 2, on: null });
    expect([unit?.x_m, unit?.y_m]).not.toEqual([2.4, 0.7]);
  });

  it("refuses when the bed is full", () => {
    const tight = { ...bed, length_m: 1.2, width_m: 1.0 };
    expect(duplicateUnit(draft([{ ...pallet("pallet-1", 0), y_m: 0 }]), tight, "pallet-1")).toBeNull();
  });
});

describe("usual mass", () => {
  it("is the unit's own weight, else its cargo's", () => {
    expect(massOf({ ...pallet("pallet-1", 0), mass_kg: 500 })).toBe(500);
    expect(massOf(pallet("pallet-1", 0))).toBe(900);
  });
});
