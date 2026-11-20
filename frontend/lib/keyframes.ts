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

export type UnitShape = "box" | "cylinder";
/** Direction of a cylinder's axis in the bed frame. */
export type CylinderAxis = "x" | "y" | "z";
export type KeyframeUnit = {
  id: string;
  /** For a cylinder, the box around it: the two sides across the axis are its diameter. */
  size_m: Vec3;
  /** Version 2 only. */
  mass_kg?: number;
  /** Friction factor against the bed floor. Version 2 only. */
  friction_coefficient?: number;
  /** Missing in older documents: a box. */
  shape?: UnitShape;
  axis?: CylinderAxis | null;
  /** A hollow cylinder's inner diameter (a coil's eye) [m]. */
  inner_diameter_m?: number | null;
};
export type BodyType = "flatbed" | "box" | "curtain_sider";
/** Something fixed to the bed that stops cargo by contact: a chock, a beam, a cradle side. */
export type KeyframeBlock = {
  id: string;
  kind: "chock" | "beam" | "cradle";
  size_m: Vec3;
  /** Centre of the bottom face, bed frame [m]. */
  position_m: Vec3;
};
export type ContactKind = "floor" | "headboard" | "rail" | "unit" | "road" | "block";
/** A contact point of the physics engine: x, y, z in the bed frame [m], normal force [N], what is touched. */
export type KeyframeContact = [number, number, number, number, ContactKind];
/**
 * A lashing. Version 2 documents (from the physics engine) add what is needed to draw it as
 * the unit moves: `anchor_points_m` are fixed on the bed, `unit_points_m` are relative to the
 * unit's center and move with it. `path_m` is the path as installed.
 */
export type KeyframeStrap = {
  id: string;
  unit_id: string;
  path_m: Vec3[];
  kind?: "strap" | "chain" | "rope";
  routing?: "top_over" | "direct";
  lashing_capacity_n?: number;
  anchor_points_m?: Vec3[];
  unit_points_m?: Vec3[];
};
export type KeyframeFrame = {
  t: number;
  /** Forward speed of the truck; only used to move the road under it. */
  truck_speed_mps?: number;
  /** Acceleration of the bed (braking is negative X). Version 2 only. */
  bed_accel_mps2?: Vec3;
  /** `n`: force with which the floor holds the unit up [N]. Version 2 only. */
  units: { p: Vec3; q: Quat; n?: number }[];
  /** `slide_m`: how far a top-over strap has moved along its unit. Version 2 only. */
  straps: { tension_n: number; slide_m?: number }[];
  /** Contact points the solver found at this instant. Version 2 only. */
  contacts?: KeyframeContact[];
};

export type KeyframesDoc = {
  /** 1: hand-made placeholders. 2: output of the physics engine (docs/design.md). */
  version: 1 | 2;
  /** "placeholder" is hand-made animation; "simulation" comes from the physics engine. */
  source: "placeholder" | "simulation";
  fps: number;
  duration_s: number;
  bed: {
    length_m: number;
    width_m: number;
    floor_height_m: number;
    headboard_height_m: number;
    side_rail_height_m?: number;
    /** Missing in older documents: a flatbed. */
    body?: BodyType;
    rear_wall_height_m?: number;
    blocks?: KeyframeBlock[];
  };
  units: KeyframeUnit[];
  straps: KeyframeStrap[];
  events: { t: number; kind: string }[];
  frames: KeyframeFrame[];
  result: { status: "pass" | "warning" | "fail"; unit_ids: string[] };
};

export type Sample = {
  truckSpeed: number;
  /** Acceleration of the bed in m/s²; zero for version 1 documents. */
  bedAccel: Vec3;
  /** `normal`: force with which the floor holds the unit up [N]; zero for version 1 documents. */
  units: { p: Vec3; q: Quat; normal: number }[];
  straps: { tension: number; slide: number }[];
  /** Contact points of the nearest earlier frame (they are not interpolated). */
  contacts: KeyframeContact[];
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
  if (doc.version !== 1 && doc.version !== 2) {
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
    bedAccel: lerpVec3(a.bed_accel_mps2 ?? ZERO, b.bed_accel_mps2 ?? ZERO, k),
    units: a.units.map((unit, i) => {
      const other = b.units[i] ?? unit;
      return {
        p: lerpVec3(unit.p, other.p, k),
        q: nlerpQuat(unit.q, other.q, k),
        normal: lerp(unit.n ?? 0, other.n ?? 0, k),
      };
    }),
    contacts: a.contacts ?? NO_CONTACTS,
    straps: a.straps.map((strap, i) => {
      const other = b.straps[i] ?? strap;
      return {
        tension: lerp(strap.tension_n, other.tension_n, k),
        slide: lerp(strap.slide_m ?? 0, other.slide_m ?? 0, k),
      };
    }),
  };
}

const ZERO: Vec3 = [0, 0, 0];
const NO_CONTACTS: KeyframeContact[] = [];

/** Rotates a vector by a unit quaternion [w, x, y, z]. */
export function rotate([w, x, y, z]: Quat, [vx, vy, vz]: Vec3): Vec3 {
  // v + 2 q_vec × (q_vec × v + w v)
  const cx = y * vz - z * vy + w * vx;
  const cy = z * vx - x * vz + w * vy;
  const cz = x * vy - y * vx + w * vz;
  return [vx + 2 * (y * cz - z * cy), vy + 2 * (z * cx - x * cz), vz + 2 * (x * cy - y * cx)];
}

/**
 * Path of a lashing at a sampled state, in the simulation frame: anchor, the points on the
 * unit (which move with it), anchor. A top-over strap may have slid along its unit. Version 1
 * documents only have the installed path.
 */
export function strapPath(doc: KeyframesDoc, sample: Sample, strapIndex: number): Vec3[] {
  const strap = doc.straps[strapIndex];
  if (!strap) return [];
  const { anchor_points_m: anchors, unit_points_m: unitPoints } = strap;
  const unitIndex = doc.units.findIndex((unit) => unit.id === strap.unit_id);
  const pose = sample.units[unitIndex];
  const first = anchors?.[0];
  if (!anchors || !unitPoints || !pose || !first) return strap.path_m;

  const slide = strap.routing === "top_over" ? (sample.straps[strapIndex]?.slide ?? 0) : 0;
  const onUnit = unitPoints.map(([x, y, z]): Vec3 => {
    const [rx, ry, rz] = rotate(pose.q, [x + slide, y, z]);
    return [pose.p[0] + rx, pose.p[1] + ry, pose.p[2] + rz];
  });
  const last = anchors[1];
  return last ? [first, ...onUnit, last] : [first, ...onUnit];
}

/** Largest horizontal distance any unit is from where it started, at a sampled state. */
export function largestSlide(doc: KeyframesDoc, sample: Sample): number {
  const start = doc.frames[0]?.units ?? [];
  let largest = 0;
  for (const [index, unit] of sample.units.entries()) {
    const origin = start[index]?.p;
    if (!origin) continue;
    largest = Math.max(largest, Math.hypot(unit.p[0] - origin[0], unit.p[1] - origin[1]));
  }
  return largest;
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
