/** The 3D truck is the catalog's truck: the same axles, wheels, cab and coupling as the 2D drawings. */
import { describe, expect, it } from "vitest";

import { TRUCK_CATALOG } from "@/lib/inspection/truck-catalog";

import { axlePositions, truckLayout, WHEEL_RADIUS, wheelLayout } from "./truck-geometry";

const SIZES = Object.keys(TRUCK_CATALOG) as (keyof typeof TRUCK_CATALOG)[];

function bedOf(size: keyof typeof TRUCK_CATALOG, length?: number) {
  const truck = TRUCK_CATALOG[size];
  return { length_m: length ?? truck.deck.length_m, width_m: truck.deck.width_m, truck_size: size };
}

describe("the 3D truck from the truck catalog", () => {
  it.each(SIZES)("%s: every axle where the catalog puts it", (size) => {
    const truck = TRUCK_CATALOG[size];
    const bed = bedOf(size);
    const layout = truckLayout(bed);
    // Back to the catalog's frame: metres from the front bumper.
    const fromBumper = (x: number) => truck.deck.front_x_m + (bed.length_m / 2 - x);
    expect(layout.axles).toHaveLength(truck.axle_count);
    layout.axles.forEach((axle, index) => {
      const expected = truck.axles[index];
      expect(axle.group).toBe(expected?.group);
      expect(fromBumper(axle.x)).toBeCloseTo(expected?.x_m ?? NaN, 9);
    });
    expect(layout.wheelRadius).toBeCloseTo(truck.wheel_m / 2, 9);
    expect(fromBumper(layout.cab.front)).toBeCloseTo(0, 9);
    expect(layout.cab).toMatchObject({ kind: truck.cab.kind, length: truck.cab.length_m, height: truck.cab.height_m });
    // Single tyres on the steer axle, twins on the others: two wheel sets per axle.
    const wheels = wheelLayout(bed);
    expect(wheels).toHaveLength(2 * truck.axle_count);
    expect(wheels.filter((w) => w.axle === "front")).toHaveLength(2);
    expect(new Set(wheels.map((w) => w.radius))).toEqual(new Set([truck.wheel_m / 2]));
  });

  it("draws the semis with a tractor, its fifth wheel under the kingpin and a gap to the trailer", () => {
    for (const size of SIZES) {
      const truck = TRUCK_CATALOG[size];
      const layout = truckLayout(bedOf(size));
      expect(Boolean(layout.tractor)).toBe(Boolean(truck.coupling));
      if (!truck.coupling || !layout.tractor) continue;
      const half = truck.deck.length_m / 2;
      expect(truck.deck.front_x_m + half - layout.tractor.kingpin).toBeCloseTo(truck.coupling.kingpin_x_m, 9);
      const trailerFront = layout.upperDeck ? layout.upperDeck.front : half;
      expect(layout.cab.front - layout.cab.length).toBeGreaterThan(trailerFront); // the gap
    }
    expect(truckLayout(bedOf("us_dry_van_53")).cab.kind).toBe("conventional");
    expect(truckLayout(bedOf("semi")).cab.kind).toBe("cab_over");
  });

  it("draws a step deck's upper level ahead of the bed, at the catalog's height", () => {
    const truck = TRUCK_CATALOG.us_step_deck;
    const deck = truckLayout(bedOf("us_step_deck")).upperDeck;
    expect(deck?.length).toBeCloseTo(truck.upper_deck?.length_m ?? NaN, 9);
    expect(deck?.rise).toBeCloseTo((truck.upper_deck?.floor_m ?? NaN) - truck.deck.floor_m, 9);
    expect(deck?.front).toBeCloseTo(truck.deck.length_m / 2 + (truck.upper_deck?.length_m ?? NaN), 9);
  });

  it("keeps the rear overhang of a saved truck with its own bed length", () => {
    const standard = axlePositions(bedOf("truck"));
    const longer = axlePositions(bedOf("truck", 9.0));
    expect(longer.rear - -4.5).toBeCloseTo(standard.rear - -TRUCK_CATALOG.truck.deck.length_m / 2, 9);
    expect(longer.front - 4.5).toBeCloseTo(standard.front - TRUCK_CATALOG.truck.deck.length_m / 2, 9);
  });

  it("draws the generic two-axle truck for a document without a truck size", () => {
    const layout = truckLayout({ length_m: 6.2, width_m: 2.4 });
    expect(layout.size).toBeNull();
    expect(layout.axles.map((a) => a.x)).toEqual([3.1 + 0.9, -3.1 + 2.3]);
    expect(layout.wheelRadius).toBe(WHEEL_RADIUS);
    expect(truckLayout({ length_m: 6.2, width_m: 2.4, truck_size: "unknown" }).size).toBeNull();
  });
});
