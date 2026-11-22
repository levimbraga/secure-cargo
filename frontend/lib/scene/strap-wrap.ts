/**
 * How a lashing is drawn on a round unit (a coil, a pipe, a drum).
 *
 * The physics fixes a top-over strap to the unit at the two top edges of the box around it,
 * and a direct lashing at a point given in that box (backend/scene/mjcf.py). On a box those
 * points are on the unit; on a cylinder the corners of its box are in the air, so a strap
 * drawn through them floats beside the coil. This module draws the same lashing on the
 * cylinder's surface instead: around the round side of a pipe, along the crest of a coil,
 * across a drum's top. The anchors, the routing and the forces stay those of the physics.
 */

import { type KeyframesDoc, type Quat, rotate, type Sample, strapPath, type Vec3 } from "@/lib/keyframes";

/** Points of the stretch of a top-over strap that lies on a round unit, ends included. */
export const WRAP_POINTS = 9;

function conjugate([w, x, y, z]: Quat): Quat {
  return [w, -x, -y, -z];
}

function toLocal(q: Quat, centre: Vec3, point: Vec3): Vec3 {
  return rotate(conjugate(q), [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]]);
}

function toWorld(q: Quat, centre: Vec3, point: Vec3): Vec3 {
  const [x, y, z] = rotate(q, point);
  return [centre[0] + x, centre[1] + y, centre[2] + z];
}

/** Coordinates of a local point in the plane across the cylinder's axis, and back. */
const PLANES = {
  x: { across: (p: Vec3): [number, number] => [p[1], p[2]], back: (along: number, u: number, v: number): Vec3 => [along, u, v], along: (p: Vec3) => p[0] },
  y: { across: (p: Vec3): [number, number] => [p[0], p[2]], back: (along: number, u: number, v: number): Vec3 => [u, along, v], along: (p: Vec3) => p[1] },
  z: { across: (p: Vec3): [number, number] => [p[0], p[1]], back: (along: number, u: number, v: number): Vec3 => [u, v, along], along: (p: Vec3) => p[2] },
} as const;

/** Angle of the tangent point from `[u, v]` to a circle of radius `r` at the origin, on the upper side. */
function tangentAngle(u: number, v: number, r: number): number | null {
  const distance = Math.hypot(u, v);
  if (distance <= r * 1.001) return null;
  const towards = Math.atan2(v, u);
  const spread = Math.acos(r / distance);
  const a = towards + spread;
  const b = towards - spread;
  return Math.sin(a) >= Math.sin(b) ? a : b;
}

function spread(from: Vec3, to: Vec3, count: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const k = count === 1 ? 0 : i / (count - 1);
    return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
  });
}

/**
 * The drawn path of a lashing at a sampled state. Box units, and documents without the
 * geometry, keep the physics path (`strapPath`). The number of points depends only on the
 * document, never on the sample, so a lashing keeps the same pieces from frame to frame.
 */
export function drawnStrapPath(doc: KeyframesDoc, sample: Sample, strapIndex: number): Vec3[] {
  const path = strapPath(doc, sample, strapIndex);
  const strap = doc.straps[strapIndex];
  const unitIndex = doc.units.findIndex((unit) => unit.id === strap?.unit_id);
  const unit = doc.units[unitIndex];
  const pose = sample.units[unitIndex];
  if (!strap?.anchor_points_m || !strap.unit_points_m || !unit || !pose || unit.shape !== "cylinder" || !unit.axis) {
    return path;
  }
  const axis = unit.axis;
  const plane = PLANES[axis];
  const sides = unit.size_m.filter((_, index) => index !== { x: 0, y: 1, z: 2 }[axis]);
  const radius = Math.min(...sides) / 2;
  const local = (point: Vec3) => toLocal(pose.q, pose.p, point);
  const world = (point: Vec3) => toWorld(pose.q, pose.p, point);

  if (strap.routing === "direct") {
    const [anchor, point] = path;
    if (!anchor || !point) return path;
    const p = local(point);
    const [u, v] = plane.across(p);
    const distance = Math.hypot(u, v);
    // A lashing fixed through a coil's eye (on the axis) stays where it is.
    if (distance <= radius) return path;
    return [anchor, world(plane.back(plane.along(p), (u / distance) * radius, (v / distance) * radius))];
  }

  const [first, edgeA, edgeB, last] = path;
  if (path.length !== 4 || !first || !edgeA || !edgeB || !last) return path;
  const a = local(edgeA);
  const b = local(edgeB);

  if (axis === "x") {
    // A pipe or a coil lying along the truck: the strap crosses it and wraps its round side.
    const along = (plane.along(a) + plane.along(b)) / 2;
    const [ua, va] = plane.across(local(first));
    const [ub, vb] = plane.across(local(last));
    const start = tangentAngle(ua, va, radius);
    const end = tangentAngle(ub, vb, radius);
    if (start === null || end === null) return [first, ...spread(edgeA, edgeB, WRAP_POINTS), last];
    // The short way round over the top: the tangent points are on the upper half.
    let to = end;
    while (to - start > Math.PI) to -= 2 * Math.PI;
    while (start - to > Math.PI) to += 2 * Math.PI;
    const arc = Array.from({ length: WRAP_POINTS }, (_, i) => {
      const angle = start + ((to - start) * i) / (WRAP_POINTS - 1);
      return world(plane.back(along, Math.cos(angle) * radius, Math.sin(angle) * radius));
    });
    return [first, ...arc, last];
  }

  if (axis === "y") {
    // A coil lying across the truck, strap along its axis: on the crest line at the strap's place.
    const offset = Math.min(Math.abs(a[0]), radius);
    const height = Math.sqrt(radius * radius - offset * offset);
    const x = Math.sign(a[0]) * offset;
    const onA: Vec3 = [x, a[1], height];
    const onB: Vec3 = [x, b[1], height];
    return [first, ...spread(onA, onB, WRAP_POINTS).map(world), last];
  }

  // A drum standing up: the strap crosses its top, a chord of the circle.
  const offset = Math.min(Math.abs(a[0]), radius);
  const half = Math.sqrt(radius * radius - offset * offset);
  const x = Math.sign(a[0]) * offset;
  const onA: Vec3 = [x, Math.sign(a[1]) * half, a[2]];
  const onB: Vec3 = [x, Math.sign(b[1]) * half, b[2]];
  return [first, ...spread(onA, onB, WRAP_POINTS).map(world), last];
}

/** How many points `drawnStrapPath` gives for a lashing, whatever the sample. */
export function drawnPointCount(doc: KeyframesDoc, strapIndex: number): number {
  const strap = doc.straps[strapIndex];
  if (!strap) return 0;
  const unit = doc.units.find((candidate) => candidate.id === strap.unit_id);
  const wraps =
    strap.routing === "top_over" &&
    strap.anchor_points_m?.length === 2 &&
    strap.unit_points_m?.length === 2 &&
    unit?.shape === "cylinder" &&
    Boolean(unit.axis);
  return wraps ? WRAP_POINTS + 2 : strap.path_m.length;
}
