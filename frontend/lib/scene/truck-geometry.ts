/**
 * Where the drawn truck's wheels are, relative to the middle of the bed floor. Shared by the
 * 3D truck (`components/scene/truck.tsx`) and the scene motion (`motion.ts`), so the wheels
 * that are drawn are the wheels whose contact with the road is computed and tested.
 *
 * Sim frame: X to the front of the truck, Y to its left [m].
 */

import type { KeyframesDoc } from "@/lib/keyframes";

type Bed = KeyframesDoc["bed"];

export const WHEEL_RADIUS = 0.5;

export type WheelSpec = { axle: "front" | "rear"; x: number; y: number; width: number };

/** Position of the axles along the truck, relative to the middle of the bed [m]. */
export function axlePositions(bed: Pick<Bed, "length_m">): { front: number; rear: number } {
  return { front: bed.length_m / 2 + 0.9, rear: -bed.length_m / 2 + 2.3 };
}

/** The four wheel sets: a single front tyre and a dual rear tyre on each side. */
export function wheelLayout(bed: Pick<Bed, "length_m" | "width_m">): WheelSpec[] {
  const { front, rear } = axlePositions(bed);
  const half = bed.width_m / 2;
  return [
    { axle: "front", x: front, y: half - 0.17, width: 0.3 },
    { axle: "front", x: front, y: -(half - 0.17), width: 0.3 },
    { axle: "rear", x: rear, y: half - 0.3, width: 0.58 },
    { axle: "rear", x: rear, y: -(half - 0.3), width: 0.58 },
  ];
}
