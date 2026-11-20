/**
 * What the phone layout of the engineering view needs: the numbers of one unit at one instant
 * (for the panel a marker opens), and marker positions that do not overlap.
 */

import type { KeyframesDoc, Sample } from "./keyframes";
import { unitForces } from "./replay";

export type LashingDetails = {
  /** Index of the lashing in the document. */
  index: number;
  id: string;
  /** Tension it carries now [N]. */
  tension: number;
  /** Lashing capacity LC [N], or `null` when the document does not give it. */
  capacity: number | null;
  /** Share of the capacity in use, or `null` without a capacity. */
  ratio: number | null;
};

export type UnitDetails = {
  /** What the motion of the truck asks of the unit: mass times acceleration [N]. */
  inertia: number;
  /** The most friction can give: friction factor times the floor force [N]. */
  friction: number;
  /** Force with which the floor holds the unit up [N]. */
  floor: number;
  /** Horizontal distance from where the unit started [m]. */
  slide: number;
  /** Inertia is larger than the friction available. */
  slipping: boolean;
  /** The lashings on this unit, in the order of the document. */
  lashings: LashingDetails[];
};

/** The numbers of one unit at a sampled instant, or `null` for an index the document does not have. */
export function unitDetails(doc: KeyframesDoc, sample: Sample, unitIndex: number): UnitDetails | null {
  const unit = doc.units[unitIndex];
  const pose = sample.units[unitIndex];
  if (!unit || !pose) return null;
  const forces = unitForces(unit.mass_kg ?? 0, unit.friction_coefficient ?? 0, pose.normal, sample.bedAccel);
  const start = doc.frames[0]?.units[unitIndex]?.p ?? pose.p;
  const lashings: LashingDetails[] = [];
  doc.straps.forEach((strap, index) => {
    if (strap.unit_id !== unit.id) return;
    const tension = sample.straps[index]?.tension ?? 0;
    const capacity = strap.lashing_capacity_n && strap.lashing_capacity_n > 0 ? strap.lashing_capacity_n : null;
    lashings.push({ index, id: strap.id, tension, capacity, ratio: capacity === null ? null : tension / capacity });
  });
  return {
    inertia: forces.inertiaMagnitude,
    friction: forces.frictionLimit,
    floor: pose.normal,
    slide: Math.hypot(pose.p[0] - start[0], pose.p[1] - start[1]),
    slipping: forces.inertiaMagnitude > forces.frictionLimit,
    lashings,
  };
}

export type Point = { x: number; y: number };

/** Two square tap targets of side `size` centred on these points overlap. */
function overlaps(a: Point, b: Point, size: number): boolean {
  return Math.abs(a.x - b.x) < size && Math.abs(a.y - b.y) < size;
}

/**
 * Places square tap targets of side `size`, centred on `points`, so that none overlaps another
 * and all stay inside the frame. Earlier points keep their place; a later one that would
 * overlap moves up, or sideways when there is no room above. `null` points (off screen) stay
 * `null`.
 */
export function spreadMarkers(
  points: (Point | null)[],
  size: number,
  frame: { width: number; height: number },
): (Point | null)[] {
  const half = size / 2;
  const clampX = (x: number) => Math.min(Math.max(x, half), Math.max(frame.width - half, half));
  const clampY = (y: number) => Math.min(Math.max(y, half), Math.max(frame.height - half, half));
  const placed: Point[] = [];
  return points.map((point) => {
    if (!point) return null;
    let next: Point = { x: clampX(point.x), y: clampY(point.y) };
    // Each step moves clear of one marker; a few steps settle any group that fits the frame.
    for (let step = 0; step < placed.length * 3; step++) {
      const other = placed.find((candidate) => overlaps(candidate, next, size));
      if (!other) break;
      if (other.y - size >= half) next = { x: next.x, y: other.y - size };
      else if (other.x + size <= frame.width - half) next = { x: other.x + size, y: next.y };
      else next = { x: clampX(other.x - size), y: next.y };
    }
    placed.push(next);
    return next;
  });
}
