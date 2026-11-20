import { describe, expect, it } from "vitest";

import securedRaw from "../content/keyframes/braking-secured.json";
import unsecuredRaw from "../content/keyframes/braking-unsecured.json";
import {
  displacement,
  distanceAt,
  type KeyframesDoc,
  KeyframesError,
  parseKeyframes,
  sampleFrame,
  toThreePosition,
  toThreeQuaternion,
} from "./keyframes";

function makeDoc(): KeyframesDoc {
  return {
    version: 1,
    source: "placeholder",
    fps: 2,
    duration_s: 1,
    bed: { length_m: 6, width_m: 2.4, floor_height_m: 1.1, headboard_height_m: 1.2 },
    units: [{ id: "u1", size_m: [1, 1, 1] }],
    straps: [],
    events: [],
    frames: [
      { t: 0, truck_speed_mps: 10, units: [{ p: [0, 0, 0.5], q: [1, 0, 0, 0] }], straps: [] },
      { t: 0.5, truck_speed_mps: 10, units: [{ p: [1, 0, 0.5], q: [0, 0, 0, 1] }], straps: [] },
      { t: 1, truck_speed_mps: 0, units: [{ p: [3, 0, 0.5], q: [0, 0, 0, 1] }], straps: [] },
    ],
    result: { status: "fail", unit_ids: ["u1"] },
  };
}

describe("parseKeyframes", () => {
  it("accepts a well-formed document", () => {
    expect(parseKeyframes(makeDoc()).units).toHaveLength(1);
  });

  it.each([
    ["not an object", null],
    ["another version", { ...makeDoc(), version: 2 }],
    ["no frames", { ...makeDoc(), frames: [] }],
    ["a non-positive fps", { ...makeDoc(), fps: 0 }],
    [
      "a frame with the wrong number of units",
      { ...makeDoc(), frames: [{ t: 0, units: [], straps: [] }] },
    ],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseKeyframes(raw)).toThrowError(KeyframesError);
  });
});

describe("sampleFrame", () => {
  it("returns the exact frame on a frame time", () => {
    expect(sampleFrame(makeDoc(), 0.5).units[0]?.p).toEqual([1, 0, 0.5]);
  });

  it("interpolates positions between frames", () => {
    expect(sampleFrame(makeDoc(), 0.75).units[0]?.p).toEqual([2, 0, 0.5]);
    expect(sampleFrame(makeDoc(), 0.75).truckSpeed).toBe(5);
  });

  it("interpolates rotations and keeps them normalized", () => {
    const [w, x, y, z] = sampleFrame(makeDoc(), 0.25).units[0]?.q ?? [0, 0, 0, 0];
    expect(Math.hypot(w, x, y, z)).toBeCloseTo(1, 10);
    // Halfway between no rotation and 180 degrees about Z is 90 degrees about Z.
    expect(w).toBeCloseTo(Math.SQRT1_2, 10);
    expect(z).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("clamps before the first and after the last frame", () => {
    expect(sampleFrame(makeDoc(), -3).units[0]?.p).toEqual([0, 0, 0.5]);
    expect(sampleFrame(makeDoc(), 99).units[0]?.p).toEqual([3, 0, 0.5]);
  });
});

describe("distanceAt", () => {
  it("integrates the truck speed over time", () => {
    const doc = makeDoc();
    expect(distanceAt(doc, 0)).toBe(0);
    expect(distanceAt(doc, 0.5)).toBe(5); // 10 m/s for 0.5 s
    expect(distanceAt(doc, 1)).toBe(7.5); // then braking linearly to a stop
    expect(distanceAt(doc, 5)).toBe(7.5);
  });
});

describe("displacement", () => {
  it("measures how far a unit moved from its first frame", () => {
    const doc = makeDoc();
    expect(displacement(doc, sampleFrame(doc, 1), 0)).toBe(3);
    expect(displacement(doc, sampleFrame(doc, 0), 0)).toBe(0);
  });
});

describe("frame conversion to three.js", () => {
  it("maps Z-up positions to Y-up", () => {
    expect(toThreePosition([1, 2, 3])).toEqual([1, 3, -2]);
  });

  it("maps a yaw about the simulation Z axis to a rotation about the three.js Y axis", () => {
    const half = Math.PI / 4;
    expect(toThreeQuaternion([Math.cos(half), 0, 0, Math.sin(half)])).toEqual([
      0,
      Math.sin(half),
      -0,
      Math.cos(half),
    ]);
  });
});

describe("placeholder keyframes", () => {
  const unsecured = parseKeyframes(unsecuredRaw);
  const secured = parseKeyframes(securedRaw);

  it("are labeled as placeholders, not simulation output", () => {
    expect(unsecured.source).toBe("placeholder");
    expect(secured.source).toBe("placeholder");
  });

  it("cover the same event with the same cargo", () => {
    expect(secured.units).toEqual(unsecured.units);
    expect(secured.duration_s).toBe(unsecured.duration_s);
    expect(secured.frames).toHaveLength(unsecured.frames.length);
  });

  it("show the unsecured cargo sliding forward and stopping at the headboard", () => {
    const end = sampleFrame(unsecured, unsecured.duration_s);
    for (const [index, unit] of unsecured.units.entries()) {
      expect(displacement(unsecured, end, index)).toBeGreaterThan(0.9);
      const front = (end.units[index]?.p[0] ?? 0) + unit.size_m[0] / 2;
      expect(front).toBeLessThanOrEqual(unsecured.bed.length_m / 2 + 1e-6);
    }
    expect(unsecured.result.status).toBe("fail");
  });

  it("show the secured cargo staying in place under straps", () => {
    for (const frame of secured.frames) {
      for (const index of secured.units.keys()) {
        const sample = sampleFrame(secured, frame.t);
        expect(displacement(secured, sample, index)).toBeLessThan(0.05);
      }
    }
    expect(secured.straps.length).toBeGreaterThan(0);
    expect(secured.result.status).toBe("pass");
  });
});
