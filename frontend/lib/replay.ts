/**
 * What the replay page derives from a keyframes document: the series of its charts, the moment
 * worth watching in slow motion, impacts on the headboard, and the colour of a lashing.
 */

import type { KeyframesDoc, Vec3 } from "./keyframes";

export const GRAVITY = 9.81;

/** Movement beyond these counts as "the load is moving" (the warning thresholds of the backend). */
const SLIDE_START_M = 0.01;
const TILT_START_COS = Math.cos((1 * Math.PI) / 180);

export type Series = {
  /** Time of every frame [s]. */
  t: number[];
  /** Truck acceleration in g: braking is positive `braking`, `sideways` is signed, `vertical` is signed. */
  braking: number[];
  sideways: number[];
  vertical: number[];
  /** Horizontal distance of each unit from where it started [m]: one array per unit. */
  slide: number[][];
  /** Tension of each lashing [N]: one array per lashing. */
  tension: number[][];
  /** Height of the bed above its starting level [m], from the vertical acceleration. */
  bedHeight: number[];
  /** Distance the truck has covered on the road [m]. */
  distance: number[];
};

export function buildSeries(doc: KeyframesDoc): Series {
  const dt = 1 / doc.fps;
  const start = doc.frames[0]?.units ?? [];
  const series: Series = {
    t: [],
    braking: [],
    sideways: [],
    vertical: [],
    slide: doc.units.map(() => []),
    tension: doc.straps.map(() => []),
    bedHeight: [],
    distance: [],
  };
  let verticalSpeed = 0;
  let height = 0;
  let distance = 0;
  doc.frames.forEach((frame, index) => {
    const [ax, ay, az] = frame.bed_accel_mps2 ?? [0, 0, 0];
    series.t.push(index * dt);
    series.braking.push(-ax / GRAVITY);
    series.sideways.push(ay / GRAVITY);
    series.vertical.push(az / GRAVITY);
    frame.units.forEach((unit, unitIndex) => {
      const origin = start[unitIndex]?.p ?? unit.p;
      series.slide[unitIndex]?.push(Math.hypot(unit.p[0] - origin[0], unit.p[1] - origin[1]));
    });
    frame.straps.forEach((strap, strapIndex) => series.tension[strapIndex]?.push(strap.tension_n));
    // Integrate the way the engine does: speed first, then position.
    if (index > 0) {
      verticalSpeed += az * dt;
      height += verticalSpeed * dt;
      const previous = doc.frames[index - 1]?.truck_speed_mps ?? 0;
      distance += ((previous + (frame.truck_speed_mps ?? 0)) / 2) * dt;
    }
    series.bedHeight.push(height);
    series.distance.push(distance);
  });
  return series;
}

/** Linear interpolation of a per-frame series at time `t`. */
export function seriesAt(doc: KeyframesDoc, values: number[], t: number): number {
  const last = values.length - 1;
  if (last < 0) return 0;
  const position = Math.min(Math.max(t * doc.fps, 0), last);
  const index = Math.min(Math.floor(position), last);
  const next = Math.min(index + 1, last);
  const a = values[index] ?? 0;
  return a + ((values[next] ?? a) - a) * (position - index);
}

/**
 * The stretch of a failing run worth watching slowly: from just before the load starts to move
 * (or first touches the headboard) until shortly after. `null` when nothing moves.
 */
export function criticalWindow(doc: KeyframesDoc): { start: number; end: number } | null {
  const dt = 1 / doc.fps;
  const origin = doc.frames[0]?.units ?? [];
  for (const [index, frame] of doc.frames.entries()) {
    const moving = frame.units.some((unit, unitIndex) => {
      const start = origin[unitIndex]?.p ?? unit.p;
      const slid = Math.hypot(unit.p[0] - start[0], unit.p[1] - start[1]) > SLIDE_START_M;
      // 1 - 2 (x^2 + y^2) is the cosine of the tilt away from vertical.
      const upright = 1 - 2 * (unit.q[1] ** 2 + unit.q[2] ** 2);
      return slid || upright < TILT_START_COS;
    });
    if (moving) {
      const t = index * dt;
      return { start: Math.max(t - 0.25, 0), end: Math.min(t + 1.0, doc.duration_s) };
    }
  }
  return null;
}

export type Impact = { t: number; position: Vec3; force: number };

/** Moments when a unit first touches the headboard after not touching it. */
export function headboardImpacts(doc: KeyframesDoc): Impact[] {
  const impacts: Impact[] = [];
  let touching = (doc.frames[0]?.contacts ?? []).some((contact) => contact[4] === "headboard");
  doc.frames.forEach((frame, index) => {
    const hits = (frame.contacts ?? []).filter((contact) => contact[4] === "headboard");
    if (hits.length > 0 && !touching && index > 0) {
      const count = hits.length;
      impacts.push({
        t: index / doc.fps,
        position: [
          hits.reduce((sum, hit) => sum + hit[0], 0) / count,
          hits.reduce((sum, hit) => sum + hit[1], 0) / count,
          hits.reduce((sum, hit) => sum + hit[2], 0) / count,
        ],
        force: hits.reduce((sum, hit) => sum + hit[3], 0),
      });
    }
    touching = hits.length > 0;
  });
  return impacts;
}

export const SPEEDS = ["auto", 1, 0.5, 0.25] as const;
export type Speed = (typeof SPEEDS)[number];
/** Slow-motion factor inside the critical window when the speed is "auto". */
export const SLOW_MOTION = 0.25;

/** How fast the replay clock runs at time `t`. */
export function playbackRate(
  speed: Speed,
  t: number,
  critical: { start: number; end: number } | null,
): number {
  if (speed !== "auto") return speed;
  return critical && t >= critical.start && t <= critical.end ? SLOW_MOTION : 1;
}

/** RGB colours of the lashing scale: slack, half of capacity, at capacity. */
const NEUTRAL: Vec3 = [0x8a, 0x8a, 0x86];
const AMBER: Vec3 = [0xf2, 0xa1, 0x00];
const RED: Vec3 = [0xb4, 0x23, 0x18];
/** Share of the capacity at which a lashing is fully amber. */
const AMBER_AT = 0.5;

/**
 * Colour of a lashing by how much of its capacity LC it carries: neutral when slack, amber at
 * half, red at LC and beyond. Returns components in 0..1.
 */
export function tensionColor(tension: number, capacity: number): Vec3 {
  const ratio = capacity > 0 ? Math.min(Math.max(tension / capacity, 0), 1) : 0;
  const [from, to, k] =
    ratio <= AMBER_AT
      ? [NEUTRAL, AMBER, ratio / AMBER_AT]
      : [AMBER, RED, (ratio - AMBER_AT) / (1 - AMBER_AT)];
  return [
    (from[0] + (to[0] - from[0]) * k) / 255,
    (from[1] + (to[1] - from[1]) * k) / 255,
    (from[2] + (to[2] - from[2]) * k) / 255,
  ];
}

/** Forces on a unit, for the arrows: what the motion of the truck asks of it and what friction can give. */
export function unitForces(
  mass: number,
  friction: number,
  normal: number,
  bedAccel: Vec3,
): { inertia: [number, number]; inertiaMagnitude: number; frictionLimit: number } {
  // Seen from the bed, a unit of mass m feels -m a: forward when the truck brakes.
  const inertia: [number, number] = [-mass * bedAccel[0], -mass * bedAccel[1]];
  return {
    inertia,
    inertiaMagnitude: Math.hypot(inertia[0], inertia[1]),
    frictionLimit: friction * normal,
  };
}
