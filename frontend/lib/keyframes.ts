/**
 * Keyframes: the JSON a simulation run produces and the 3D player replays.
 *
 * Conventions (see docs/design.md): SI units; right-handed frame with X to the front of the
 * truck, Y to its left and Z up; origin at the center of the bed floor surface; quaternions as
 * [w, x, y, z], which is MuJoCo's order.
 */

export type Vec3 = [number, number, number];
/** [w, x, y, z] */
export type Quat = [number, number, number, number];

export type KeyframeUnit = { id: string; size_m: Vec3 };
export type KeyframeStrap = { id: string; unit_id: string; path_m: Vec3[] };
export type KeyframeFrame = {
  t: number;
  /** Forward speed of the truck; only used to move the road under it. */
  truck_speed_mps?: number;
  units: { p: Vec3; q: Quat }[];
  straps: { tension_n: number }[];
};

export type KeyframesDoc = {
  version: 1;
  /** "placeholder" is hand-made animation; "simulation" comes from the physics engine. */
  source: "placeholder" | "simulation";
  fps: number;
  duration_s: number;
  bed: {
    length_m: number;
    width_m: number;
    floor_height_m: number;
    headboard_height_m: number;
  };
  units: KeyframeUnit[];
  straps: KeyframeStrap[];
  events: { t: number; kind: string }[];
  frames: KeyframeFrame[];
  result: { status: "pass" | "warning" | "fail"; unit_ids: string[] };
};

export type Sample = {
  truckSpeed: number;
  units: { p: Vec3; q: Quat }[];
};

export class KeyframesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyframesError";
  }
}

/** Checks the parts of a document the player relies on, and returns it typed. */
export function parseKeyframes(raw: unknown): KeyframesDoc {
  const doc = raw as Partial<KeyframesDoc> | null;
  if (typeof doc !== "object" || doc === null) {
    throw new KeyframesError("Keyframes must be an object");
  }
  if (doc.version !== 1) {
    throw new KeyframesError(`Unsupported keyframes version: ${String(doc.version)}`);
  }
  if (!(typeof doc.fps === "number" && doc.fps > 0)) {
    throw new KeyframesError("Keyframes need a positive fps");
  }
  if (!Array.isArray(doc.units) || !Array.isArray(doc.frames) || doc.frames.length === 0) {
    throw new KeyframesError("Keyframes need units and at least one frame");
  }
  const unitCount = doc.units.length;
  const strapCount = Array.isArray(doc.straps) ? doc.straps.length : -1;
  for (const [index, frame] of doc.frames.entries()) {
    if (frame.units?.length !== unitCount || frame.straps?.length !== strapCount) {
      throw new KeyframesError(`Frame ${index} does not match the unit and strap lists`);
    }
  }
  return doc as KeyframesDoc;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpVec3(a: Vec3, b: Vec3, k: number): Vec3 {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** Normalized linear interpolation along the shortest arc; accurate for the small steps between frames. */
function nlerpQuat(a: Quat, b: Quat, k: number): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  const q: Quat = [
    lerp(a[0], sign * b[0], k),
    lerp(a[1], sign * b[1], k),
    lerp(a[2], sign * b[2], k),
    lerp(a[3], sign * b[3], k),
  ];
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** State of the scene at time `t` (seconds), interpolated between the two nearest frames. */
export function sampleFrame(doc: KeyframesDoc, t: number): Sample {
  const last = doc.frames.length - 1;
  const position = Math.min(Math.max(t * doc.fps, 0), last);
  const index = Math.min(Math.floor(position), last);
  const next = Math.min(index + 1, last);
  const k = position - index;

  const a = doc.frames[index] as KeyframeFrame;
  const b = doc.frames[next] as KeyframeFrame;

  return {
    truckSpeed: lerp(a.truck_speed_mps ?? 0, b.truck_speed_mps ?? 0, k),
    units: a.units.map((unit, i) => {
      const other = b.units[i] ?? unit;
      return { p: lerpVec3(unit.p, other.p, k), q: nlerpQuat(unit.q, other.q, k) };
    }),
  };
}

const distanceCache = new WeakMap<KeyframesDoc, number[]>();

/** Distance the truck has travelled by time `t`, integrated from the per-frame speed. */
export function distanceAt(doc: KeyframesDoc, t: number): number {
  let cumulative = distanceCache.get(doc);
  if (!cumulative) {
    cumulative = [0];
    for (let i = 1; i < doc.frames.length; i++) {
      const previous = doc.frames[i - 1]?.truck_speed_mps ?? 0;
      const current = doc.frames[i]?.truck_speed_mps ?? 0;
      cumulative.push((cumulative[i - 1] ?? 0) + ((previous + current) / 2) / doc.fps);
    }
    distanceCache.set(doc, cumulative);
  }
  const last = cumulative.length - 1;
  const position = Math.min(Math.max(t * doc.fps, 0), last);
  const index = Math.min(Math.floor(position), last);
  const next = Math.min(index + 1, last);
  return lerp(cumulative[index] ?? 0, cumulative[next] ?? 0, position - index);
}

/** How far a unit is from where it started, at a sampled state. */
export function displacement(doc: KeyframesDoc, sample: Sample, unitIndex: number): number {
  const start = doc.frames[0]?.units[unitIndex]?.p;
  const now = sample.units[unitIndex]?.p;
  if (!start || !now) return 0;
  return Math.hypot(now[0] - start[0], now[1] - start[1], now[2] - start[2]);
}

/** Simulation frame (Z up, Y left) to three.js (Y up): [x, y, z] -> [x, z, -y]. */
export function toThreePosition([x, y, z]: Vec3): Vec3 {
  return [x, z, -y];
}

/** Simulation quaternion [w, x, y, z] to three.js order [x, y, z, w] in the Y-up frame. */
export function toThreeQuaternion([w, x, y, z]: Quat): [number, number, number, number] {
  return [x, z, -y, w];
}
