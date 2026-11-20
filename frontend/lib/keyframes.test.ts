import { describe, expect, it } from "vitest";

import securedRaw from "../content/keyframes/braking-secured.json";
import unsecuredRaw from "../content/keyframes/braking-unsecured.json";
import {
  displacement,
  distanceAt,
  type KeyframesDoc,
  KeyframesError,
  largestSlide,
  parseKeyframes,
  rotate,
  sampleFrame,
  strapPath,
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
    ["an unknown version", { ...makeDoc(), version: 3 }],
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

function makeSimulationDoc(): KeyframesDoc {
  return {
    version: 2,
    source: "simulation",
    fps: 1,
    duration_s: 1,
    bed: {
      length_m: 6,
      width_m: 2.4,
      floor_height_m: 1.2,
      headboard_height_m: 1.2,
      side_rail_height_m: 0,
    },
    units: [{ id: "box", size_m: [1, 1, 1] }],
    straps: [
      {
        id: "over",
        unit_id: "box",
        kind: "strap",
        routing: "top_over",
        lashing_capacity_n: 25000,
        anchor_points_m: [
          [0, 1.2, 0],
          [0, -1.2, 0],
        ],
        unit_points_m: [
          [0, 0.5, 0.5],
          [0, -0.5, 0.5],
        ],
        path_m: [
          [0, 1.2, 0],
          [0, 0.5, 1],
          [0, -0.5, 1],
          [0, -1.2, 0],
        ],
      },
      {
        id: "chain",
        unit_id: "box",
        kind: "chain",
        routing: "direct",
        lashing_capacity_n: 40000,
        anchor_points_m: [[-1.5, 1.2, 0]],
        unit_points_m: [[-0.5, 0.5, 0]],
        path_m: [
          [-1.5, 1.2, 0],
          [-0.5, 0.5, 0.5],
        ],
      },
    ],
    events: [{ t: 0.3, kind: "braking_start" }],
    frames: [
      {
        t: 0,
        truck_speed_mps: 20,
        bed_accel_mps2: [0, 0, 0],
        units: [{ p: [0, 0, 0.5], q: [1, 0, 0, 0] }],
        straps: [
          { tension_n: 3000, slide_m: 0 },
          { tension_n: 500, slide_m: 0 },
        ],
      },
      {
        t: 1,
        truck_speed_mps: 12,
        bed_accel_mps2: [-8, 0, 0],
        // Moved 2 m forward and turned a quarter turn about the vertical axis.
        units: [{ p: [2, 0, 0.5], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }],
        straps: [
          { tension_n: 5000, slide_m: -0.4 },
          { tension_n: 9000, slide_m: 0 },
        ],
      },
    ],
    result: { status: "fail", unit_ids: ["box"] },
  };
}

describe("version 2 documents (physics engine)", () => {
  it("are accepted, and unknown versions are not", () => {
    expect(parseKeyframes(makeSimulationDoc()).version).toBe(2);
    expect(() => parseKeyframes({ ...makeSimulationDoc(), version: 3 })).toThrow(KeyframesError);
  });

  it("interpolate strap tension, strap slide and bed acceleration", () => {
    const sample = sampleFrame(makeSimulationDoc(), 0.5);

    expect(sample.straps[0]).toEqual({ tension: 4000, slide: -0.2 });
    expect(sample.bedAccel).toEqual([-4, 0, 0]);
    expect(sample.truckSpeed).toBe(16);
  });

  it("report zero acceleration and slide for version 1 documents", () => {
    const sample = sampleFrame(makeDoc(), 0);

    expect(sample.bedAccel).toEqual([0, 0, 0]);
    expect(sample.straps).toEqual([]);
  });

  it("rotate a vector by a quaternion", () => {
    const quarterTurnAboutZ: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const [x, y, z] = rotate(quarterTurnAboutZ, [1, 0, 0]);

    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });

  it("draw a strap as installed at the first frame", () => {
    const doc = makeSimulationDoc();
    const start = sampleFrame(doc, 0);

    expect(strapPath(doc, start, 0)).toEqual(doc.straps[0]?.path_m);
    expect(strapPath(doc, start, 1)).toEqual(doc.straps[1]?.path_m);
  });

  it("move the points on the unit with the unit, and keep the anchors on the bed", () => {
    const doc = makeSimulationDoc();
    const end = sampleFrame(doc, 1);
    const chain = strapPath(doc, end, 1);

    // The anchor stays; the lashing point [-0.5, 0.5, 0] turns to [-0.5, -0.5, 0] and moves with the unit.
    expect(chain[0]).toEqual([-1.5, 1.2, 0]);
    expect(chain[1]?.[0]).toBeCloseTo(1.5);
    expect(chain[1]?.[1]).toBeCloseTo(-0.5);
    expect(chain[1]?.[2]).toBeCloseTo(0.5);
  });

  it("let a top-over strap slide along its unit", () => {
    const doc = makeSimulationDoc();
    const end = sampleFrame(doc, 1);
    const [anchor, first, , last] = strapPath(doc, end, 0);

    expect(anchor).toEqual([0, 1.2, 0]);
    expect(last).toEqual([0, -1.2, 0]);
    // Local point [0 - 0.4, 0.5, 0.5], turned a quarter turn, plus the unit position [2, 0, 0.5].
    expect(first?.[0]).toBeCloseTo(1.5);
    expect(first?.[1]).toBeCloseTo(-0.4);
    expect(first?.[2]).toBeCloseTo(1);
  });

  it("measure the largest horizontal slide of any unit", () => {
    const doc = makeSimulationDoc();

    expect(largestSlide(doc, sampleFrame(doc, 0))).toBe(0);
    expect(largestSlide(doc, sampleFrame(doc, 1))).toBeCloseTo(2);
  });
});
