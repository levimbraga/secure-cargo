/**
 * The drawn truck around the simulated bed: its axles and wheels, cab, tractor and fifth wheel,
 * and a step deck's upper level. Shared by the 3D truck (`components/scene/truck.tsx`) and the
 * scene motion (`motion.ts`), so the wheels that are drawn are the wheels whose contact with the
 * road is computed and tested.
 *
 * The layout comes from the truck catalog (`lib/inspection/truck-catalog.json`), the same data
 * as the 2D drawings, exported from the simulation's presets: the keyframes document names the
 * preset (`bed.truck_size`). A document without one (older runs, hand-made scenarios) gets the
 * generic two-axle rigid the scene always drew.
 *
 * Sim frame: X to the front of the truck, Y to its left [m]; the origin is the middle of the bed
 * floor. The catalog measures from the front bumper towards the rear.
 */

import { type CatalogTruck, TRUCK_CATALOG } from "@/lib/inspection/truck-catalog";
import type { KeyframesDoc } from "@/lib/keyframes";

type Bed = KeyframesDoc["bed"];
type BedSize = Pick<Bed, "length_m" | "width_m"> & { truck_size?: string | null };

/** The generic truck's wheel radius [m]; a catalog truck has its own (`TruckLayout.wheelRadius`). */
export const WHEEL_RADIUS = 0.5;

export type AxleGroupName = "steer" | "drive" | "rear" | "trailer";

export type TruckAxle = {
  /** Along the truck, from the middle of the bed [m]. */
  x: number;
  group: AxleGroupName;
  /** Twin tyres on each side (every axle but the steer axle). */
  dual: boolean;
};

export type TruckLayout = {
  /** The catalog preset drawn, or null for the generic truck. */
  size: string | null;
  wheelRadius: number;
  axles: TruckAxle[];
  cab: {
    kind: "cab_over" | "conventional";
    /** X of the front bumper [m]. */
    front: number;
    length: number;
    /** Roof above the road [m]. */
    height: number;
  };
  /** Semis: the tractor's frame ends at `frameEnd`, its fifth wheel under the kingpin. */
  tractor: { kingpin: number; frameEnd: number } | null;
  /** A step deck's upper level, ahead of the bed: `rise` above the bed floor [m]. */
  upperDeck: { front: number; length: number; rise: number } | null;
};

export type WheelSpec = {
  /**
   * "front": the steer axle; "rear": the last axle group, whose wheels the road features are
   * placed for; "mid": a tractor's drive axles. The body's pitch rests on front and rear.
   */
  axle: "front" | "mid" | "rear";
  /** Index of the wheel's axle in `TruckLayout.axles`. */
  axleIndex: number;
  x: number;
  y: number;
  width: number;
  radius: number;
};

function catalogEntry(size: string | null | undefined): CatalogTruck | null {
  if (!size) return null;
  return (TRUCK_CATALOG as Record<string, CatalogTruck | undefined>)[size] ?? null;
}

/** The generic two-axle rigid the scene drew before the catalog (and still draws without one). */
function genericLayout(bed: BedSize): TruckLayout {
  const half = bed.length_m / 2;
  return {
    size: null,
    wheelRadius: WHEEL_RADIUS,
    axles: [
      { x: half + 0.9, group: "steer", dual: false },
      { x: -half + 2.3, group: "rear", dual: true },
    ],
    cab: { kind: "cab_over", front: half + 2.27, length: 1.95, height: 3.0 },
    tractor: null,
    upperDeck: null,
  };
}

/**
 * The truck drawn around a bed. Points ahead of the bed (cab, steer and drive axles, kingpin)
 * keep their distance to the bed's front; the rear group keeps its distance to the bed's rear,
 * so a saved truck with its own bed length keeps its overhangs.
 */
export function truckLayout(bed: BedSize): TruckLayout {
  const truck = catalogEntry(bed.truck_size);
  if (!truck) return genericLayout(bed);
  const half = bed.length_m / 2;
  const deckFront = truck.deck.front_x_m;
  const deckRear = deckFront + truck.deck.length_m;
  const ahead = (x: number) => half + (deckFront - x);
  const behind = (x: number) => -half + (deckRear - x);
  return {
    size: bed.truck_size ?? null,
    wheelRadius: truck.wheel_m / 2,
    axles: truck.axles.map((axle) => ({
      x: axle.group === "rear" || axle.group === "trailer" ? behind(axle.x_m) : ahead(axle.x_m),
      group: axle.group,
      dual: axle.group !== "steer",
    })),
    cab: { kind: truck.cab.kind, front: ahead(0), length: truck.cab.length_m, height: truck.cab.height_m },
    tractor: truck.coupling ? { kingpin: ahead(truck.coupling.kingpin_x_m), frameEnd: ahead(truck.coupling.frame_end_x_m) } : null,
    upperDeck: truck.upper_deck
      ? { front: ahead(truck.upper_deck.front_x_m), length: truck.upper_deck.length_m, rise: truck.upper_deck.floor_m - truck.deck.floor_m }
      : null,
  };
}

/** Position of the steer axle and of the last axle group's centre, from the middle of the bed [m]. */
export function axlePositions(bed: BedSize): { front: number; rear: number } {
  const { axles } = truckLayout(bed);
  const last = axles.filter((axle) => axle.group === "rear" || axle.group === "trailer");
  const front = axles.find((axle) => axle.group === "steer") ?? axles[0];
  return {
    front: front?.x ?? bed.length_m / 2,
    rear: last.length ? last.reduce((sum, axle) => sum + axle.x, 0) / last.length : -bed.length_m / 2,
  };
}

/** Every wheel set: a single tyre on each side of the steer axle, twin tyres on the others. */
export function wheelLayout(bed: BedSize): WheelSpec[] {
  const layout = truckLayout(bed);
  const half = bed.width_m / 2;
  const wheels: WheelSpec[] = [];
  layout.axles.forEach((axle, axleIndex) => {
    const axleName: WheelSpec["axle"] = axle.group === "steer" ? "front" : axle.group === "drive" ? "mid" : "rear";
    const width = axle.dual ? 0.58 : 0.3;
    const track = half - (axle.dual ? 0.3 : 0.17);
    for (const side of [1, -1]) {
      wheels.push({ axle: axleName, axleIndex, x: axle.x, y: side * track, width, radius: layout.wheelRadius });
    }
  });
  return wheels;
}
