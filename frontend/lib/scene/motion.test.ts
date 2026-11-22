/**
 * Invariants of the scene motion, for every event on every surface (the fixture the backend
 * exports from its own event profiles) and every body type and size of the gallery.
 */

import { describe, expect, it } from "vitest";

import type { KeyframesDoc } from "@/lib/keyframes";

import PROFILES from "./__fixtures__/profiles.json";
import {
  buildScenePath,
  frameStepTime,
  inPothole,
  poseAt,
  roadFrame,
  roadHeight,
  sceneConditions,
  shadowGrid,
  SHADOW_LIFT,
  truckPose,
  verticalAccel,
  verticalHeave,
} from "./motion";
import SIM from "./sim-constants.json";
import { WHEEL_RADIUS } from "./truck-geometry";

type Fixture = {
  name: string;
  event: { kind: string; road_surface?: string; fog?: boolean; speed_kmh: number };
  profile: Record<string, number | string>;
  doc: { fps: number; duration_s: number; events: { t: number; kind: string }[]; speed: number[]; accel: number[][] };
};

const BEDS: KeyframesDoc["bed"][] = [
  { body: "flatbed", length_m: 6.2, width_m: 2.4, floor_height_m: 1.25, headboard_height_m: 1.2 },
  { body: "flatbed", length_m: 14.63, width_m: 2.59, floor_height_m: 1.52, headboard_height_m: 1.2 },
  { body: "box", length_m: 4.2, width_m: 2.2, floor_height_m: 1.0, headboard_height_m: 2.2 },
  { body: "curtain_sider", length_m: 13.6, width_m: 2.48, floor_height_m: 1.2, headboard_height_m: 2.6 },
];

function toDoc(fixture: Fixture, bed: KeyframesDoc["bed"]): KeyframesDoc {
  const { doc } = fixture;
  return {
    version: 2,
    source: "simulation",
    fps: doc.fps,
    duration_s: doc.duration_s,
    bed,
    units: [],
    straps: [],
    events: doc.events,
    frames: doc.speed.map((speed, index) => ({
      t: index / doc.fps,
      truck_speed_mps: speed,
      bed_accel_mps2: [doc.accel[0]?.[index] ?? 0, doc.accel[1]?.[index] ?? 0, doc.accel[2]?.[index] ?? 0],
      units: [],
      straps: [],
    })),
    result: { status: "pass", unit_ids: [] },
  };
}

const FIXTURES = PROFILES as unknown as Fixture[];
const conditionsOf = (fixture: Fixture) =>
  sceneConditions(fixture.profile, { surface: fixture.event.road_surface ?? "dry", fog: fixture.event.fog ?? false });

/** Lowest gap between a wheel's circle and the road under its whole width (negative: it sinks). */
function wheelGaps(path: ReturnType<typeof buildScenePath>, s: number, d: number, width: number, centre: number) {
  let lowest = Infinity;
  for (let i = 0; i <= 100; i++) {
    const x = -WHEEL_RADIUS + (2 * WHEEL_RADIUS * i) / 100;
    const circle = centre - Math.sqrt(WHEEL_RADIUS ** 2 - x ** 2);
    for (let j = 0; j <= 4; j++) {
      const across = -width / 2 + (width * j) / 4;
      lowest = Math.min(lowest, circle - roadHeight(path, s + x, d + across));
    }
  }
  return lowest;
}

describe("the fixture", () => {
  it("covers every event on every surface", () => {
    const kinds = new Set(FIXTURES.map((f) => f.event.kind));
    expect([...kinds].sort()).toEqual(
      ["emergency_braking", "full_trip", "lane_change", "long_vibration", "mountain_descent", "pothole", "sharp_curve", "speed_bump"].sort(),
    );
    const surfaces = new Set(FIXTURES.map((f) => f.event.road_surface ?? "dry"));
    expect([...surfaces].sort()).toEqual(["dry", "gravel", "heavy_rain", "mud", "wet"]);
  });
});

describe.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s", (_name, fixture) => {
  const conditions = conditionsOf(fixture);

  it("rebuilds the vertical acceleration the simulation applied", () => {
    const doc = toDoc(fixture, BEDS[0] as KeyframesDoc["bed"]);
    const path = buildScenePath(doc, conditions);
    doc.frames.forEach((frame, index) => {
      const rebuilt = verticalAccel(path.vertical, frameStepTime(index, doc.fps));
      expect(Math.abs(rebuilt - (frame.bed_accel_mps2?.[2] ?? 0))).toBeLessThan(2e-3);
    });
  });

  it.each(BEDS.map((bed) => [`${bed.body} ${bed.length_m} m`, bed] as const))(
    "keeps every wheel on the road and the shadow under the truck (%s)",
    (_label, bed) => {
      const doc = toDoc(fixture, bed);
      const path = buildScenePath(doc, conditions);
      const times: number[] = [];
      for (let t = -0.5; t <= doc.duration_s + 0.5; t += 1 / 60) times.push(t);
      // Each wheel crosses a hole or a bump in a few milliseconds: look closely there.
      for (const feature of path.features) for (let t = feature.t - 0.6; t < feature.t + 0.6; t += 0.002) times.push(t);
      let deepest = 0;
      for (const t of times) {
        const pose = truckPose(path, t, bed.floor_height_m);
        for (const wheel of pose.wheels) {
          const gap = wheelGaps(path, wheel.s, wheel.d, wheel.width, wheel.centre);
          expect(gap).toBeGreaterThan(-0.01);
          expect(gap).toBeLessThan(0.01);
          if (inPothole(path, wheel.s, wheel.d)) deepest = Math.min(deepest, wheel.centre - WHEEL_RADIUS - roadFrame(path.road, wheel.s).z);
        }
        const shadow = shadowGrid(path, pose, bed);
        // The middle of the shadow is under the middle of the truck, on the road.
        const centre = shadow[Math.floor(shadow.length / 2)];
        expect(centre?.y).toBeCloseTo(0, 6);
        expect(Math.abs((centre?.z ?? 0) - SHADOW_LIFT - roadHeight(path, pose.s + (centre?.x ?? 0), pose.d))).toBeLessThan(0.02);
      }
      if (path.features.some((f) => f.kind === "pothole")) expect(deepest).toBeLessThan(-0.035);
    },
  );

  it("drives the speeds and sideways accelerations of the run", () => {
    const doc = toDoc(fixture, BEDS[0] as KeyframesDoc["bed"]);
    const path = buildScenePath(doc, conditions);
    doc.frames.forEach((frame, index) => {
      const pose = poseAt(path, index / doc.fps);
      expect(pose.v).toBeCloseTo(frame.truck_speed_mps ?? 0, 6);
    });
    // Sideways: in a lane change d'' = a_y; elsewhere v^2 times the road's curvature = a_y.
    const step = 0.05;
    let peak = 0;
    let worst = 0;
    for (let t = step; t < doc.duration_s - step; t += step) {
      const before = poseAt(path, t - step);
      const now = poseAt(path, t);
      const after = poseAt(path, t + step);
      const lane = path.lanes.some(([a, b]) => t - step >= a && t + step <= b);
      const curve = path.lanes.every(([a, b]) => t + step < a || t - step > b);
      if (!lane && !curve) continue;
      const measured = lane
        ? (after.d - 2 * now.d + before.d) / step ** 2
        : (now.v ** 2 * (roadFrame(path.road, after.s).heading - roadFrame(path.road, before.s).heading)) / Math.max(after.s - before.s, 1e-6);
      // Braking in fog keeps a curve's sideways acceleration down to walking pace: the drawing
      // caps the curve at a 15 m radius there (see the report, "honesty check").
      if (!lane && (now.v < 5 || Math.abs(now.ay) / now.v ** 2 > 1 / 15)) continue;
      peak = Math.max(peak, Math.abs(now.ay));
      worst = Math.max(worst, Math.abs(measured - now.ay));
    }
    expect(worst).toBeLessThan(Math.max(0.03 * peak, 0.05));
  });

  it("never lets the bed take off", () => {
    const doc = toDoc(fixture, BEDS[0] as KeyframesDoc["bed"]);
    const path = buildScenePath(doc, conditions);
    for (let t = 0; t <= doc.duration_s; t += 0.004) {
      expect(Math.abs(verticalHeave(path.vertical, t))).toBeLessThan(SIM.speed_bump.height_m + 0.03);
    }
  });
});

describe("events", () => {
  const find = (name: string) => FIXTURES.find((f) => f.name === name) as Fixture;
  const bed = BEDS[0] as KeyframesDoc["bed"];

  it("a lane change ends one lane over, going straight", () => {
    for (const name of ["lane_change/dry/80", "lane_change/wet/40", "lane_change/dry/80/fog"]) {
      const fixture = find(name);
      const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
      const end = fixture.doc.events.find((m) => m.kind === "lane_change_end")?.t ?? 0;
      const pose = poseAt(path, end);
      // The offset is the double integral of the run's sideways acceleration: one lane, or
      // less in fog, where braking at the same time leaves less grip for the lane change.
      let rate = 0;
      let offset = 0;
      const ay = fixture.doc.accel[1] ?? [];
      for (let i = 1; i < ay.length && i / fixture.doc.fps <= end; i++) {
        const next = rate + (((ay[i - 1] ?? 0) + (ay[i] ?? 0)) / 2) / fixture.doc.fps;
        offset += (rate + next) / 2 / fixture.doc.fps;
        rate = next;
      }
      expect(Math.abs(pose.d - offset)).toBeLessThan(0.05);
      if (!fixture.event.fog) expect(pose.d).toBeCloseTo(SIM.lane_width_m, 1);
      expect(Math.abs(pose.yaw)).toBeLessThan(0.01);
      // The road itself stays straight.
      expect(Math.abs(roadFrame(path.road, pose.s).heading)).toBeLessThan(1e-4);
    }
  });

  it("a sharp curve bends the road with the radius v^2 / a_y and the truck stays in its lane", () => {
    const fixture = find("sharp_curve/dry/40/r30");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
    const pose = poseAt(path, 2.0);
    const radius = pose.v ** 2 / pose.ay;
    expect(radius).toBeCloseTo(30, 0);
    for (let t = 0; t <= fixture.doc.duration_s; t += 0.1) expect(Math.abs(poseAt(path, t).d)).toBeLessThan(1e-9);
    expect(pose.roll).toBeGreaterThan(0.01);
    // At 80 km/h the curve is capped at 0.5 g: the radius drawn is the one the run implies.
    const fast = find("sharp_curve/dry/80");
    const fastPath = buildScenePath(toDoc(fast, bed), conditionsOf(fast));
    const held = poseAt(fastPath, 2.0);
    expect(held.v ** 2 / held.ay).toBeCloseTo((80 / 3.6) ** 2 / (0.5 * SIM.gravity_mps2), 0);
  });

  it("emergency braking dips the nose and stops the truck", () => {
    const fixture = find("emergency_braking/dry/80");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
    expect(poseAt(path, 1.5).pitch).toBeGreaterThan(0.02);
    expect(poseAt(path, fixture.doc.duration_s).v).toBe(0);
    expect(truckPose(path, 1.5, bed.floor_height_m).bodyPitch).toBeLessThan(-0.02);
  });

  it("a pothole drops the bed by its depth and the hole is on the road", () => {
    const fixture = find("pothole/dry/80");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
    const hole = path.features[0];
    expect(hole?.kind).toBe("pothole");
    const event = path.vertical.events[0];
    if (event?.kind !== "pothole") throw new Error("no pothole");
    expect(verticalHeave(path.vertical, event.t + event.period + event.crossing / 2)).toBeCloseTo(-SIM.pothole.depth_m, 6);
  });

  it("a speed bump lifts the bed and the road", () => {
    const fixture = find("speed_bump/dry/30");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
    const event = path.vertical.events[0];
    if (event?.kind !== "speed_bump") throw new Error("no bump");
    expect(verticalHeave(path.vertical, event.t + event.crossing / 2)).toBeCloseTo(SIM.speed_bump.height_m, 3);
    const bump = path.features[0];
    if (bump?.kind !== "speed_bump") throw new Error("no bump feature");
    expect(roadHeight(path, bump.start + bump.length / 2, 0)).toBeCloseTo(SIM.speed_bump.height_m, 6);
  });

  it("dirt and a sharp curve at 80 km/h: the truck stays on the road (the floating bug)", () => {
    const fixture = find("sharp_curve/gravel/80");
    const doc = toDoc(fixture, bed);
    const path = buildScenePath(doc, conditionsOf(fixture));
    for (let t = 0; t <= doc.duration_s; t += 1 / 30) {
      const pose = truckPose(path, t, bed.floor_height_m);
      const clearance = pose.bodyZ - bed.floor_height_m - pose.groundZ;
      expect(Math.abs(clearance)).toBeLessThan(0.05);
    }
  });

  it("a mountain descent goes downhill at the run's grade", () => {
    const fixture = find("mountain_descent/dry/80");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture));
    const grade = (conditionsOf(fixture).gradePercent ?? 0) / 100;
    expect(grade).toBeGreaterThan(0);
    const a = poseAt(path, 3);
    const b = poseAt(path, 5);
    const slope = (roadFrame(path.road, a.s).z - roadFrame(path.road, b.s).z) / (b.s - a.s);
    expect(slope).toBeCloseTo(grade, 3);
  });

  it("the engineering view is a flat ground without features", () => {
    const fixture = find("pothole/gravel/80");
    const path = buildScenePath(toDoc(fixture, bed), conditionsOf(fixture), true);
    expect(path.features).toHaveLength(0);
    expect(truckPose(path, 1, bed.floor_height_m).wheels.every((w) => Math.abs(w.centre - WHEEL_RADIUS) < 1e-9)).toBe(true);
  });
});
