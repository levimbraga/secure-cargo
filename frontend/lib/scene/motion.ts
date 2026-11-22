/**
 * The truck's motion on the road, rebuilt from a simulation run (see
 * `notes/scene-realism-report.md` in the workspace and `docs/design.md`, "Scene motion").
 *
 * The simulation drives a bed that does not turn: it only feels accelerations (physics
 * model, "Reference frame"). The replay turns those same accelerations back into a drive:
 *
 * - along the road: the truck speed of every keyframe (it already goes to 0 when braking);
 * - sideways: during a lane change the sideways acceleration moves the truck across the
 *   road (`d'' = a_y`, one lane for the profile of the simulation); anywhere else it is the
 *   centripetal acceleration of a curve, so the road bends with curvature `a_y / v^2`;
 * - vertically: the bed's vertical acceleration is rebuilt from the event's markers and the
 *   constants of `backend/physics/conditions` (`sim-constants.json`, exported by the backend
 *   and checked against the keyframes by the tests), and turned into a displacement without
 *   the drift of a double integral (the cause of the floating truck, see the report);
 * - downhill: the grade of a mountain descent becomes a road that goes down.
 *
 * Everything here is a pure function of the keyframes document and the run's conditions, so a
 * replay at time `t` always draws the same scene and the invariants can be tested.
 */

import type { KeyframesDoc } from "@/lib/keyframes";

import SIM from "./sim-constants.json";
import { axlePositions, WHEEL_RADIUS, wheelLayout } from "./truck-geometry";

export const G = SIM.gravity_mps2;

export const SURFACES = ["dry", "wet", "heavy_rain", "mud", "gravel"] as const;
export type Surface = (typeof SURFACES)[number];

export type Conditions = {
  surface: Surface;
  fog: boolean;
  /** Downhill grade of a mountain descent [%], when the run has one. */
  gradePercent: number | null;
};

export const DRY: Conditions = { surface: "dry", fog: false, gradePercent: null };

function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && (SURFACES as readonly string[]).includes(value);
}

/**
 * The conditions of a run, from the parameters its profile reports (`result.profile`), with
 * explicit values winning. Fog is not a parameter of its own: the profiles report the design
 * reaction time of 2.5 s instead of 1 s when there is fog.
 */
export function sceneConditions(
  profile?: Record<string, number | string> | null,
  explicit: { surface?: string | null; fog?: boolean | null } = {},
): Conditions {
  const surface = isSurface(explicit.surface) ? explicit.surface : isSurface(profile?.road_surface) ? profile.road_surface : "dry";
  const fog = explicit.fog ?? profile?.reaction_time_s === 2.5;
  const grade = profile?.grade_percent;
  return { surface, fog: Boolean(fog), gradePercent: typeof grade === "number" ? grade : null };
}

// --- Segments and the vertical profile -----------------------------------------------------

export type Segment = { kind: string; start: number; end: number; v0: number };

/** Which event a run of one event was, from its markers. */
export function inferKind(markers: { kind: string }[]): string {
  const kinds = markers.map((marker) => marker.kind);
  if (kinds.includes("lane_change_start")) return "lane_change";
  if (kinds.includes("pothole")) return "pothole";
  if (kinds.includes("speed_bump")) return "speed_bump";
  if (kinds.includes("vibration_start")) return "long_vibration";
  const curves = kinds.filter((kind) => kind === "curve_start").length;
  if (curves >= 2 && kinds.includes("braking_start")) return "mountain_descent";
  if (curves >= 1) return "sharp_curve";
  if (kinds.includes("truck_stopped")) return "emergency_braking";
  return "unknown";
}

/** Time of the profile step a keyframe was taken at (simulate.py samples step round(n / (fps dt)) - 1). */
export function frameStepTime(index: number, fps: number): number {
  if (index <= 0) return 0;
  const dt = SIM.timestep_s;
  return (Math.round(index / (fps * dt)) - 1) * dt;
}

/**
 * Speed of the truck at a keyframe. Keyframes round it to the millimetre per second; an event
 * starts at a speed in whole tenths of km/h, so a value that close to one is snapped to it.
 */
function speedAtFrame(doc: KeyframesDoc, index: number): number {
  const speed = doc.frames[Math.min(Math.max(index, 0), doc.frames.length - 1)]?.truck_speed_mps ?? 0;
  const kmh = Math.round(speed * 36) / 10;
  return Math.abs(kmh / 3.6 - speed) < 0.002 ? kmh / 3.6 : speed;
}

/** The events of the run in order: one, or the segments of a full trip. */
export function segmentsOf(doc: KeyframesDoc): Segment[] {
  const markers = doc.events ?? [];
  const starts = markers.filter((marker) => marker.kind.startsWith("segment:"));
  const firstFrameAt = (t: number) => {
    // The first keyframe whose profile step is at or after the segment start.
    for (let index = 0; index < doc.frames.length; index++) {
      if (frameStepTime(index, doc.fps) >= t - 1e-9) return index;
    }
    return doc.frames.length - 1;
  };
  if (starts.length === 0) {
    return [{ kind: inferKind(markers), start: 0, end: doc.duration_s, v0: speedAtFrame(doc, 0) }];
  }
  return starts.map((marker, index) => {
    const end = starts[index + 1]?.t ?? doc.duration_s;
    return { kind: marker.kind.slice("segment:".length), start: marker.t, end, v0: speedAtFrame(doc, firstFrameAt(marker.t)) };
  });
}

export type VerticalEvent =
  | { kind: "pothole"; t: number; period: number; crossing: number; peak: number; depth: number }
  | { kind: "speed_bump"; t: number; crossing: number; peak: number; rise: number };

type Shaking = { start: number; end: number; rms: number; envelope: "flat" | "long_vibration" };

export type Vertical = {
  events: VerticalEvent[];
  shaking: Shaking[];
};

const TONES = SIM.vibration.frequencies_hz.map((f, index) => ({
  omega: 2 * Math.PI * f,
  phase: SIM.vibration.phases_rad[index] ?? 0,
}));
const TONE_SCALE = 1 / Math.sqrt(TONES.length / 2);

/** The vertical part of the run, from its markers, its speeds and the backend's constants. */
export function verticalOf(doc: KeyframesDoc, conditions: Conditions): Vertical {
  const events: VerticalEvent[] = [];
  const shaking: Shaking[] = [];
  const roughness = SIM.surfaces[conditions.surface]?.roughness_grms ?? 0;
  for (const segment of segmentsOf(doc)) {
    const inside = (doc.events ?? []).filter((m) => m.t >= segment.start - 1e-9 && m.t < segment.end - 1e-9);
    const v0 = Math.max(segment.v0, 0.1);
    if (roughness > 0) shaking.push({ start: segment.start, end: segment.end, rms: roughness * G, envelope: "flat" });
    if (segment.kind === "long_vibration") {
      shaking.push({ start: segment.start, end: segment.end, rms: SIM.long_vibration.grms * G, envelope: "long_vibration" });
    }
    const hit = (kind: string) => inside.find((m) => m.kind === kind)?.t;
    if (segment.kind === "pothole") {
      const t = hit("pothole");
      if (t !== undefined) {
        const peak = SIM.pothole.peak_g * G;
        const period = Math.sqrt((2 * Math.PI * SIM.pothole.depth_m) / peak);
        events.push({ kind: "pothole", t, period, crossing: SIM.pothole.length_m / v0, peak, depth: SIM.pothole.depth_m });
      }
    }
    if (segment.kind === "speed_bump") {
      const t = hit("speed_bump");
      if (t !== undefined) {
        const crossing = SIM.speed_bump.length_m / v0;
        const peak = Math.min((2 * Math.PI ** 2 * SIM.speed_bump.height_m) / crossing ** 2, SIM.speed_bump.ceiling_g * G);
        events.push({ kind: "speed_bump", t, crossing, peak, rise: (peak * crossing ** 2) / (2 * Math.PI ** 2) });
      }
    }
  }
  return { events, shaking };
}

function envelope(shake: Shaking, tau: number): number {
  if (shake.envelope === "flat") return 1;
  const { ramp_s: ramp, duration_s: duration } = SIM.long_vibration;
  const lead = SIM.lead_in_s;
  const up = Math.min(Math.max((tau - lead) / ramp, 0), 1);
  const down = Math.min(Math.max((lead + duration - tau) / ramp, 0), 1);
  return Math.min(up, down);
}

/** One period of a sine starting at `start` (backend `_full_sine`). */
function fullSine(t: number, start: number, period: number): number {
  const phase = (t - start) / period;
  return phase >= 0 && phase < 1 ? Math.sin(2 * Math.PI * phase) : 0;
}

/** Vertical acceleration of the bed at `t` [m/s^2]: what the simulation applied. */
export function verticalAccel(vertical: Vertical, t: number): number {
  let total = 0;
  for (const shake of vertical.shaking) {
    if (t < shake.start || t >= shake.end) continue;
    const tau = t - shake.start;
    const k = envelope(shake, tau);
    if (k === 0) continue;
    let sum = 0;
    for (const tone of TONES) sum += Math.sin(tone.omega * tau + tone.phase);
    total += k * sum * shake.rms * TONE_SCALE;
  }
  for (const event of vertical.events) {
    if (event.kind === "pothole") {
      total += event.peak * (-fullSine(t, event.t, event.period) + fullSine(t, event.t + event.period + event.crossing, event.period));
    } else {
      const phase = (t - event.t) / event.crossing;
      if (phase >= 0 && phase < 1) total += event.peak * Math.cos(2 * Math.PI * phase);
    }
  }
  return total;
}

/** Fade of the vibration's displacement at the ends of a segment, so it does not jump [s]. */
const SHAKE_FADE_S = 0.2;

/**
 * Vertical displacement of the bed at `t` [m], as the double integral of `verticalAccel`
 * without its constant and linear terms. The simulation integrates from rest, so its bed also
 * picks up a constant vertical velocity from the vibration (up to 29 cm in four seconds on
 * gravel); in the frame of the run that velocity changes nothing, on a road it would be a
 * truck taking off. Pothole and speed bump integrate to zero velocity by construction.
 */
export function verticalHeave(vertical: Vertical, t: number): number {
  let total = 0;
  for (const shake of vertical.shaking) {
    if (t < shake.start || t >= shake.end) continue;
    const tau = t - shake.start;
    const k = envelope(shake, tau) * Math.min(1, tau / SHAKE_FADE_S, (shake.end - t) / SHAKE_FADE_S);
    if (k <= 0) continue;
    let sum = 0;
    for (const tone of TONES) sum -= Math.sin(tone.omega * tau + tone.phase) / tone.omega ** 2;
    total += k * sum * shake.rms * TONE_SCALE;
  }
  for (const event of vertical.events) {
    if (event.kind === "pothole") {
      const { period: T, crossing: c, peak: A, depth } = event;
      const w = (2 * Math.PI) / T;
      const tau = t - event.t;
      if (tau < 0 || tau >= 2 * T + c) continue;
      if (tau < T) total -= (A * (tau - Math.sin(w * tau) / w)) / w;
      else if (tau < T + c) total -= depth;
      else {
        const u = tau - T - c;
        total += -depth + (A * (u - Math.sin(w * u) / w)) / w;
      }
    } else {
      const phase = (t - event.t) / event.crossing;
      if (phase >= 0 && phase < 1) total += (event.rise / 2) * (1 - Math.cos(2 * Math.PI * phase));
    }
  }
  return total;
}

// --- The road and the path ---------------------------------------------------------------------

/** Lanes are as wide as the lane of the simulated lane change; the truck starts in the middle one. */
export const LANE_WIDTH = SIM.lane_width_m;
/** Half width of the road: three lanes [m]. */
export const ROAD_HALF_WIDTH = LANE_WIDTH * 1.5;
/** Tightest curve the drawing follows [m]: the smallest radius an event may ask for. */
const MIN_RADIUS = 15;
const ROAD_BEHIND = 150;
const ROAD_AHEAD = 220;
const GRID_HZ = 120;
/** Time constants of the drawn suspension and camera [s]. */
const SUSPENSION_S = 0.14;
const CAMERA_SIDE_S = 2;
const CAMERA_YAW_S = 0.5;
/** How the body answers the run's accelerations; drawing only (the simulated bed does not tilt). */
export const PITCH_RAD_PER_G = 0.035;
export const ROLL_RAD_PER_G = 0.07;
const CAMERA_LAG_M_PER_G = 0.45;
/** Length over which a grade starts and ends [m]. */
const GRADE_BLEND_M = 12;

export type RoadLine = {
  /** Station along the road centre [m], increasing. */
  s: Float64Array;
  x: Float64Array;
  y: Float64Array;
  heading: Float64Array;
  /** Height of the road surface [m] (downhill grades). */
  z: Float64Array;
};

export type RoadFeature =
  | { kind: "pothole"; t: number; start: number; length: number; depth: number; tracks: number[]; halfWidth: number }
  | { kind: "speed_bump"; t: number; start: number; length: number; height: number };

export type ScenePath = {
  duration: number;
  conditions: Conditions;
  /** Engineering view: a flat ground, no features and no grade. */
  flat: boolean;
  t: Float64Array;
  /** Station of the bed's middle along the road, offset from the road centre (left +), and its rate. */
  s: Float64Array;
  d: Float64Array;
  dRate: Float64Array;
  v: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  /** Heading of the truck in the world (left turn +) and of the road where it is [rad]. */
  yaw: Float64Array;
  roadHeading: Float64Array;
  pitch: Float64Array;
  roll: Float64Array;
  camS: Float64Array;
  camD: Float64Array;
  camYaw: Float64Array;
  lanes: [number, number][];
  road: RoadLine;
  features: RoadFeature[];
  vertical: Vertical;
  wheels: ReturnType<typeof wheelLayout>;
  axles: { front: number; rear: number };
};

function lowpass(values: Float64Array, dt: number, tau: number): Float64Array {
  const out = new Float64Array(values.length);
  const k = 1 - Math.exp(-dt / tau);
  let state = values[0] ?? 0;
  values.forEach((value, index) => {
    if (index > 0) state += (value - state) * k;
    out[index] = state;
  });
  return out;
}

function frameValue(doc: KeyframesDoc, t: number, pick: (frame: KeyframesDoc["frames"][number]) => number): number {
  const last = doc.frames.length - 1;
  const position = Math.min(Math.max(t * doc.fps, 0), last);
  const index = Math.floor(position);
  const a = doc.frames[index];
  const b = doc.frames[Math.min(index + 1, last)];
  if (!a) return 0;
  const va = pick(a);
  return va + ((b ? pick(b) : va) - va) * (position - index);
}

/** Binary search: the index `i` with `values[i] <= x < values[i + 1]`, clamped. */
function bracket(values: Float64Array, x: number): number {
  let low = 0;
  let high = values.length - 1;
  if (x <= (values[0] ?? 0)) return 0;
  if (x >= (values[high] ?? 0)) return Math.max(high - 1, 0);
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((values[mid] as number) <= x) low = mid;
    else high = mid;
  }
  return low;
}

function interp(xs: Float64Array, ys: Float64Array, x: number): number {
  const i = bracket(xs, x);
  const x0 = xs[i] as number;
  const x1 = xs[i + 1] ?? x0;
  const y0 = ys[i] as number;
  const y1 = ys[i + 1] ?? y0;
  if (x1 === x0) return y0;
  const k = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * k;
}

/** Truck motion and road of a run. `flat` builds the engineering view's flat ground. */
export function buildScenePath(doc: KeyframesDoc, conditions: Conditions = DRY, flat = false): ScenePath {
  const duration = Math.max(doc.duration_s, 1 / doc.fps);
  const dt = 1 / GRID_HZ;
  const n = Math.max(Math.ceil(duration / dt) + 1, 2);
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = Math.min(k * dt, duration);

  const markers = doc.events ?? [];
  const lanes: [number, number][] = [];
  let open: number | null = null;
  for (const marker of markers) {
    if (marker.kind === "lane_change_start") open = marker.t;
    if (marker.kind === "lane_change_end" && open !== null) {
      lanes.push([open, marker.t]);
      open = null;
    }
  }
  if (open !== null) lanes.push([open, duration]);
  const inLane = (time: number) => lanes.some(([a, b]) => time >= a && time <= b);

  const v = new Float64Array(n);
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const time = t[k] as number;
    v[k] = frameValue(doc, time, (frame) => frame.truck_speed_mps ?? 0);
    ax[k] = frameValue(doc, time, (frame) => frame.bed_accel_mps2?.[0] ?? 0);
    ay[k] = frameValue(doc, time, (frame) => frame.bed_accel_mps2?.[1] ?? 0);
  }

  // Integrate along the road: station, road heading and centre, offset across the road.
  const s = new Float64Array(n);
  const d = new Float64Array(n);
  const dRate = new Float64Array(n);
  const heading = new Float64Array(n);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const step = (t[k] as number) - (t[k - 1] as number);
    const vm = ((v[k - 1] as number) + (v[k] as number)) / 2;
    const am = ((ay[k - 1] as number) + (ay[k] as number)) / 2;
    const tm = ((t[k - 1] as number) + (t[k] as number)) / 2;
    let curvature = 0;
    let lateral = 0;
    if (inLane(tm)) lateral = am;
    else {
      const limit = 1 / MIN_RADIUS;
      curvature = Math.min(Math.max(am / Math.max(vm, 1) ** 2, -limit), limit);
    }
    const h0 = heading[k - 1] as number;
    const mid = h0 + (curvature * vm * step) / 2;
    cx[k] = (cx[k - 1] as number) + vm * Math.cos(mid) * step;
    cy[k] = (cy[k - 1] as number) + vm * Math.sin(mid) * step;
    heading[k] = h0 + curvature * vm * step;
    s[k] = (s[k - 1] as number) + vm * step;
    const rate = (dRate[k - 1] as number) + lateral * step;
    d[k] = (d[k - 1] as number) + (((dRate[k - 1] as number) + rate) / 2) * step;
    dRate[k] = rate;
  }
  const yaw = new Float64Array(n);
  for (let k = 0; k < n; k++) yaw[k] = (heading[k] as number) + Math.atan2(dRate[k] as number, Math.max(v[k] as number, 0.5));

  // Grade: down along the stations the descent covers.
  const segments = segmentsOf(doc);
  const gradeOf = (time: number) => {
    if (flat || !conditions.gradePercent) return 0;
    const segment = segments.find((seg) => time >= seg.start && time < seg.end) ?? segments[segments.length - 1];
    return segment?.kind === "mountain_descent" ? conditions.gradePercent / 100 : 0;
  };
  const road = roadLine(s, cx, cy, heading, t, gradeOf);

  // Body attitude and camera, all as functions of time so a paused replay draws the same frame.
  const braking = new Float64Array(n);
  const sideways = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const grade = gradeOf(t[k] as number);
    const pull = (G * grade) / Math.hypot(1, grade);
    braking[k] = Math.max(-(ax[k] as number) - pull, 0) / G;
    sideways[k] = (ay[k] as number) / G;
  }
  const brakingLp = lowpass(braking, dt, SUSPENSION_S);
  const pitch = brakingLp.map((value) => value * PITCH_RAD_PER_G);
  const roll = lowpass(sideways, dt, SUSPENSION_S).map((value) => value * ROLL_RAD_PER_G);
  const camS = new Float64Array(n);
  for (let k = 0; k < n; k++) camS[k] = (s[k] as number) - (brakingLp[k] as number) * CAMERA_LAG_M_PER_G;
  const camD = lowpass(d, dt, CAMERA_SIDE_S);
  const camYaw = lowpass(yaw, dt, CAMERA_YAW_S);

  const path: ScenePath = {
    duration,
    conditions,
    flat,
    t,
    s,
    d,
    dRate,
    v,
    ax,
    ay,
    yaw,
    roadHeading: heading,
    pitch,
    roll,
    camS,
    camD,
    camYaw,
    lanes,
    road,
    features: [],
    vertical: verticalOf(doc, conditions),
    wheels: wheelLayout(doc.bed),
    axles: axlePositions(doc.bed),
  };
  if (!flat) path.features = roadFeatures(path);
  return path;
}

function roadLine(
  s: Float64Array,
  cx: Float64Array,
  cy: Float64Array,
  heading: Float64Array,
  t: Float64Array,
  gradeOf: (time: number) => number,
): RoadLine {
  const stations: number[] = [-ROAD_BEHIND];
  const xs: number[] = [-ROAD_BEHIND];
  const ys: number[] = [0];
  const hs: number[] = [0];
  const grades: number[] = [0];
  for (let k = 0; k < s.length; k++) {
    const station = s[k] as number;
    if (station - (stations[stations.length - 1] as number) < 0.05 && k > 0) continue;
    stations.push(station);
    xs.push(cx[k] as number);
    ys.push(cy[k] as number);
    hs.push(heading[k] as number);
    grades.push(gradeOf(t[k] as number));
  }
  const last = s.length - 1;
  const endHeading = heading[last] as number;
  const endStation = s[last] as number;
  for (const extra of [1, ROAD_AHEAD]) {
    stations.push(endStation + extra);
    xs.push((cx[last] as number) + Math.cos(endHeading) * extra);
    ys.push((cy[last] as number) + Math.sin(endHeading) * extra);
    hs.push(endHeading);
    grades.push(0);
  }
  // Blend grades over a few metres (a moving average) and integrate the height.
  const z = new Float64Array(stations.length);
  const blended = grades.map((_, index) => {
    const centre = stations[index] as number;
    let sum = 0;
    let weight = 0;
    for (let j = index; j >= 0 && centre - (stations[j] as number) <= GRADE_BLEND_M; j--) {
      sum += grades[j] as number;
      weight += 1;
    }
    return weight ? sum / weight : 0;
  });
  for (let index = 1; index < stations.length; index++) {
    const ds = (stations[index] as number) - (stations[index - 1] as number);
    const slope = ((blended[index] as number) + (blended[index - 1] as number)) / 2;
    z[index] = (z[index - 1] as number) - slope * ds;
  }
  return {
    s: Float64Array.from(stations),
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    heading: Float64Array.from(hs),
    z,
  };
}

/** Centre of the road at station `s`, its heading, and the height of the surface there. */
export function roadFrame(road: RoadLine, station: number): { x: number; y: number; heading: number; z: number } {
  const first = road.s[0] as number;
  const last = road.s[road.s.length - 1] as number;
  if (station < first || station > last) {
    const end = station < first ? 0 : road.s.length - 1;
    const h = road.heading[end] as number;
    const delta = station - (road.s[end] as number);
    return {
      x: (road.x[end] as number) + Math.cos(h) * delta,
      y: (road.y[end] as number) + Math.sin(h) * delta,
      heading: h,
      z: road.z[end] as number,
    };
  }
  return {
    x: interp(road.s, road.x, station),
    y: interp(road.s, road.y, station),
    heading: interp(road.s, road.heading, station),
    z: interp(road.s, road.z, station),
  };
}

/** World point at station `s`, offset `d` to the left of the road centre. */
export function roadPoint(road: RoadLine, station: number, offset: number): [number, number] {
  const frame = roadFrame(road, station);
  return [frame.x - Math.sin(frame.heading) * offset, frame.y + Math.cos(frame.heading) * offset];
}

/** Station and offset of a world point, starting the search at `guess`. */
export function project(road: RoadLine, x: number, y: number, guess: number): { s: number; d: number } {
  let station = guess;
  for (let iteration = 0; iteration < 4; iteration++) {
    const frame = roadFrame(road, station);
    const along = (x - frame.x) * Math.cos(frame.heading) + (y - frame.y) * Math.sin(frame.heading);
    station += along;
    if (Math.abs(along) < 1e-5) break;
  }
  const frame = roadFrame(road, station);
  return { s: station, d: -(x - frame.x) * Math.sin(frame.heading) + (y - frame.y) * Math.cos(frame.heading) };
}

/** Pothole wall width and the half width of each hole [m]. */
const POTHOLE_WALL = 0.04;
const POTHOLE_HALF_WIDTH = 0.45;

/**
 * The pothole or speed bump of the run, on the road where the truck's rear axle reaches it at
 * the moment the simulation's vertical shock starts. The simulation drops or lifts the whole
 * bed at once; the drawing lets each axle pass over it.
 */
function roadFeatures(path: ScenePath): RoadFeature[] {
  const features: RoadFeature[] = [];
  const rear = path.axles.rear;
  const tracks = [...new Set(path.wheels.filter((w) => w.axle === "rear").map((w) => w.y))];
  for (const event of path.vertical.events) {
    const pose = poseAt(path, event.t);
    const start = pose.s + rear;
    if (event.kind === "pothole") {
      features.push({
        kind: "pothole",
        t: event.t,
        start,
        length: SIM.pothole.length_m,
        depth: event.depth,
        tracks: tracks.map((y) => pose.d + y),
        halfWidth: POTHOLE_HALF_WIDTH,
      });
    } else {
      features.push({ kind: "speed_bump", t: event.t, start, length: SIM.speed_bump.length_m, height: SIM.speed_bump.height_m });
    }
  }
  return features;
}

/** Height of the road surface at station `s`, offset `d` [m]. */
export function roadHeight(path: ScenePath, station: number, offset: number): number {
  if (path.flat) return 0;
  let z = roadFrame(path.road, station).z;
  for (const feature of path.features) {
    const along = station - feature.start;
    if (along < 0 || along > feature.length) continue;
    if (feature.kind === "speed_bump") {
      z += (feature.height / 2) * (1 - Math.cos((2 * Math.PI * along) / feature.length));
    } else {
      for (const track of feature.tracks) {
        const across = feature.halfWidth - Math.abs(offset - track);
        if (across <= 0) continue;
        const edge = Math.min(along, feature.length - along, across);
        z -= feature.depth * Math.min(edge / POTHOLE_WALL, 1);
        break;
      }
    }
  }
  return z;
}

/** Whether the point is inside a pothole (where a wheel may go below the level of the road). */
export function inPothole(path: ScenePath, station: number, offset: number): boolean {
  return path.features.some(
    (feature) =>
      feature.kind === "pothole" &&
      station >= feature.start &&
      station <= feature.start + feature.length &&
      feature.tracks.some((track) => Math.abs(offset - track) < feature.halfWidth),
  );
}

const CONTACT_SAMPLES = 33;

/**
 * Height of a wheel's centre resting on the road at station `s`, offset `d`: the highest the
 * tyre's circle can sit without going into the surface anywhere under its width.
 */
export function wheelCentre(path: ScenePath, station: number, offset: number, width: number, radius = WHEEL_RADIUS): number {
  let best = -Infinity;
  for (let i = 0; i < CONTACT_SAMPLES; i++) {
    const x = -radius + (2 * radius * i) / (CONTACT_SAMPLES - 1);
    const lift = Math.sqrt(Math.max(radius * radius - x * x, 0));
    for (const across of [-width / 2, 0, width / 2]) {
      best = Math.max(best, roadHeight(path, station + x, offset + across) + lift);
    }
  }
  return best;
}

export type Pose = {
  t: number;
  s: number;
  d: number;
  v: number;
  ax: number;
  ay: number;
  x: number;
  y: number;
  yaw: number;
  /** Drawn suspension response [rad]: nose down +, lean to the right +. */
  pitch: number;
  roll: number;
  /** Vertical displacement of the bed from the simulation [m]. */
  heave: number;
  cam: { x: number; y: number; yaw: number; z: number };
};

/** The truck and the camera at time `t`; before the run and after it the truck keeps going. */
export function poseAt(path: ScenePath, time: number): Pose {
  const { t, duration } = path;
  const clamped = Math.min(Math.max(time, 0), duration);
  const value = (values: Float64Array) => interp(t, values, clamped);
  let s = value(path.s);
  let camS = value(path.camS);
  const v = value(path.v);
  if (time < 0) {
    s += (path.v[0] as number) * time;
    camS += (path.v[0] as number) * time;
  } else if (time > duration) {
    const last = path.v[path.v.length - 1] as number;
    s += last * (time - duration);
    camS += last * (time - duration);
  }
  const inside = time >= 0 && time <= duration;
  const d = value(path.d);
  const frame = roadFrame(path.road, s);
  const yaw = inside ? value(path.yaw) : frame.heading + (value(path.yaw) - value(path.roadHeading));
  const [x, y] = roadPoint(path.road, s, d);
  const camD = value(path.camD);
  const [cx, cy] = roadPoint(path.road, camS, camD);
  return {
    t: time,
    s,
    d,
    v,
    ax: inside ? value(path.ax) : 0,
    ay: inside ? value(path.ay) : 0,
    x,
    y,
    yaw,
    pitch: inside ? value(path.pitch) : 0,
    roll: inside ? value(path.roll) : 0,
    heave: inside ? verticalHeave(path.vertical, time) : 0,
    cam: { x: cx, y: cy, yaw: inside ? value(path.camYaw) : yaw, z: path.flat ? 0 : roadFrame(path.road, camS).z },
  };
}

export type WheelPose = { x: number; y: number; s: number; d: number; centre: number; width: number; axle: "front" | "rear" };
export type TruckPose = Pose & {
  wheels: WheelPose[];
  /** Height of the bed floor's middle above the world origin [m], and the body's pitch and roll [rad]. */
  bodyZ: number;
  bodyPitch: number;
  bodyRoll: number;
  /** Height of the road under the middle of the bed [m]. */
  groundZ: number;
};

/** The truck's wheels on the road and its body on the wheels, at time `t`. */
export function truckPose(path: ScenePath, time: number, floorHeight: number): TruckPose {
  const pose = poseAt(path, time);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const wheels = path.wheels.map((wheel) => {
    const x = pose.x + wheel.x * cos - wheel.y * sin;
    const y = pose.y + wheel.x * sin + wheel.y * cos;
    const place = project(path.road, x, y, pose.s + wheel.x);
    return { x, y, s: place.s, d: place.d, centre: wheelCentre(path, place.s, place.d, wheel.width), width: wheel.width, axle: wheel.axle };
  });
  const { front, rear } = path.axles;
  const base = (axle: "front" | "rear") => {
    const set = wheels.filter((wheel) => wheel.axle === axle);
    const grade = set.reduce((sum, wheel) => sum + (path.flat ? 0 : roadFrame(path.road, wheel.s).z), 0) / set.length;
    const actual = set.reduce((sum, wheel) => sum + wheel.centre, 0) / set.length;
    return { grade: grade + WHEEL_RADIUS, feature: actual - grade - WHEEL_RADIUS };
  };
  const f = base("front");
  const r = base("rear");
  const span = front - rear;
  const slope = Math.atan2(f.grade - r.grade, span);
  const featurePitch = Math.atan2(f.feature - r.feature, span);
  const atOrigin = r.grade + ((f.grade - r.grade) * -rear) / span;
  const groundZ = path.flat ? 0 : roadHeight(path, pose.s, pose.d);
  return {
    ...pose,
    wheels,
    bodyZ: atOrigin - WHEEL_RADIUS + floorHeight + pose.heave,
    // Positive slope (front higher) raises the nose; the braking response lowers it.
    bodyPitch: slope + featurePitch - pose.pitch,
    bodyRoll: pose.roll,
    groundZ,
  };
}

/** How far the cab reaches in front of the bed, and the soft border of the contact shadow [m]. */
export const CAB_REACH = 2.3;
export const SHADOW_BORDER = 0.9;
/** The contact shadow floats this far above the road so it never flickers into it [m]. */
export const SHADOW_LIFT = 0.015;

/**
 * Corners of the soft contact shadow under the truck, as a `columns` x `rows` grid in the
 * truck's own frame (x forward, y left) with the height of the road under each point: the
 * shadow lies on the road, bumps and holes included, right under the truck.
 */
export function shadowGrid(
  path: ScenePath,
  pose: Pose,
  bed: Pick<KeyframesDoc["bed"], "length_m" | "width_m">,
  columns = 9,
  rows = 3,
): { x: number; y: number; z: number }[] {
  const rearEdge = -bed.length_m / 2 - SHADOW_BORDER;
  const frontEdge = bed.length_m / 2 + CAB_REACH + SHADOW_BORDER;
  const half = bed.width_m / 2 + SHADOW_BORDER;
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const points: { x: number; y: number; z: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const y = -half + (2 * half * row) / (rows - 1);
    for (let column = 0; column < columns; column++) {
      const x = rearEdge + ((frontEdge - rearEdge) * column) / (columns - 1);
      const wx = pose.x + x * cos - y * sin;
      const wy = pose.y + x * sin + y * cos;
      const place = project(path.road, wx, wy, pose.s + x);
      points.push({ x, y, z: roadHeight(path, place.s, place.d) + SHADOW_LIFT });
    }
  }
  return points;
}
