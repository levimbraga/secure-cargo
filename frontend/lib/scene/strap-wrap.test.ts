import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type KeyframesDoc, type KeyframeStrap, type KeyframeUnit, parseKeyframes, rotate, sampleFrame, type Vec3 } from "@/lib/keyframes";

import { drawnPointCount, drawnStrapPath, WRAP_POINTS } from "./strap-wrap";

/** A one-unit document at rest, its centre at `centre`. */
function doc(unit: KeyframeUnit, centre: Vec3, straps: KeyframeStrap[]): KeyframesDoc {
  return {
    version: 2,
    source: "simulation",
    fps: 30,
    duration_s: 0,
    bed: { length_m: 6, width_m: 2.4, floor_height_m: 1.2, headboard_height_m: 1.2 },
    units: [unit],
    straps,
    events: [],
    frames: [{ t: 0, units: [{ p: centre, q: [1, 0, 0, 0] }], straps: straps.map(() => ({ tension_n: 0 })) }],
    result: { status: "pass", unit_ids: [] },
  };
}

function topOver(unitPoints: [Vec3, Vec3]): KeyframeStrap {
  return {
    id: "s",
    unit_id: "u",
    kind: "strap",
    routing: "top_over",
    path_m: [],
    anchor_points_m: [
      [0, 1.2, 0],
      [0, -1.2, 0],
    ],
    unit_points_m: unitPoints,
  };
}

describe("lashings drawn on round units", () => {
  it("wrap a strap around the round side of a pipe, tangent from each anchor", () => {
    const radius = 0.25;
    const pipe: KeyframeUnit = { id: "u", size_m: [6, 0.5, 0.5], shape: "cylinder", axis: "x" };
    const d = doc(pipe, [0, 0, radius], [topOver([[0, radius, radius], [0, -radius, radius]])]);
    const path = drawnStrapPath(d, sampleFrame(d, 0), 0);

    expect(path).toHaveLength(WRAP_POINTS + 2);
    expect(drawnPointCount(d, 0)).toBe(path.length);
    expect(path[0]).toEqual([0, 1.2, 0]);
    expect(path.at(-1)).toEqual([0, -1.2, 0]);
    for (const [, y, z] of path.slice(1, -1)) expect(Math.hypot(y, z - radius)).toBeCloseTo(radius, 6);
    // Highest point of the arc: the pipe's top.
    expect(Math.max(...path.map((p) => p[2]))).toBeCloseTo(2 * radius, 3);
    // Each leg meets the circle at a right angle to the radius: a tangent.
    for (const [anchor, touch] of [
      [path[0], path[1]],
      [path.at(-1), path.at(-2)],
    ] as [Vec3, Vec3][]) {
      const dot = (touch[1] - anchor[1]) * touch[1] + (touch[2] - anchor[2]) * (touch[2] - radius);
      expect(dot).toBeCloseTo(0, 6);
    }
  });

  it("lay a strap along a coil's crest where it crosses the coil", () => {
    const coil: KeyframeUnit = { id: "u", size_m: [1.6, 1.2, 1.6], shape: "cylinder", axis: "y" };
    const d = doc(coil, [0.4, 0, 0.8], [topOver([[-0.4, 0.6, 0.8], [-0.4, -0.6, 0.8]])]);
    const path = drawnStrapPath(d, sampleFrame(d, 0), 0);

    // 0.4 m off the coil's centre the surface is sqrt(0.8² - 0.4²) = 0.693 m above it.
    for (const point of path.slice(1, -1)) {
      expect(point[0]).toBeCloseTo(0, 6);
      expect(point[2]).toBeCloseTo(0.8 + Math.sqrt(0.64 - 0.16), 6);
    }
  });

  it("cross a drum's top on the circle, not at the corners of its box", () => {
    const drum: KeyframeUnit = { id: "u", size_m: [0.6, 0.6, 0.9], shape: "cylinder", axis: "z" };
    const d = doc(drum, [0, 0, 0.45], [topOver([[0.15, 0.3, 0.45], [0.15, -0.3, 0.45]])]);
    const path = drawnStrapPath(d, sampleFrame(d, 0), 0);
    const [, first] = path;
    expect(first?.[1]).toBeCloseTo(Math.sqrt(0.09 - 0.0225), 6);
    expect(first?.[2]).toBeCloseTo(0.9, 6);
  });

  it("move a direct lashing fixed at a corner of a drum's box onto the drum", () => {
    const drum: KeyframeUnit = { id: "u", size_m: [0.6, 0.6, 0.9], shape: "cylinder", axis: "z" };
    const direct: KeyframeStrap = {
      id: "d",
      unit_id: "u",
      kind: "strap",
      routing: "direct",
      path_m: [
        [1.2, 1.2, 0],
        [0.3, 0.3, 0.4],
      ],
      anchor_points_m: [[1.2, 1.2, 0]],
      unit_points_m: [[0.3, 0.3, -0.05]],
    };
    const d = doc(drum, [0, 0, 0.45], [direct]);
    const [anchor, point] = drawnStrapPath(d, sampleFrame(d, 0), 0);
    expect(anchor).toEqual([1.2, 1.2, 0]);
    expect(Math.hypot(point?.[0] ?? 0, point?.[1] ?? 0)).toBeCloseTo(0.3, 6);
    expect(point?.[2]).toBeCloseTo(0.4, 6);
    expect(drawnPointCount(d, 0)).toBe(2);
  });

  it("draw a strap over a row through each unit, each point moving with its own unit", () => {
    const box = (id: string): KeyframeUnit => ({ id, size_m: [1, 1, 1], shape: "box" });
    const row: KeyframeStrap = {
      id: "s",
      unit_id: "a",
      kind: "strap",
      routing: "top_over",
      path_m: [
        [0, 1.2, 0],
        [0, 1, 1],
        [0.2, -1, 1],
        [0, -1.2, 0],
      ],
      anchor_points_m: [
        [0, 1.2, 0],
        [0, -1.2, 0],
      ],
      unit_points_m: [
        [0, 0.5, 0.5],
        [0, -0.5, 0.5],
      ],
      point_unit_ids: ["a", "b"],
    };
    const d = doc(box("a"), [0, 0.5, 0.5], [row]);
    d.units.push(box("b"));
    d.frames = [{ t: 0, units: [{ p: [0, 0.5, 0.5], q: [1, 0, 0, 0] }, { p: [0.2, -0.5, 0.5], q: [1, 0, 0, 0] }], straps: [{ tension_n: 0 }] }];
    const path = drawnStrapPath(d, sampleFrame(d, 0), 0);
    expect(path).toHaveLength(4);
    expect(drawnPointCount(d, 0)).toBe(4);
    expect(path[1]).toEqual([0, 1, 1]);
    // The second point is on unit "b", which stands 0.2 m further forward.
    expect(path[2]).toEqual([0.2, -1, 1]);
  });

  it("draw every lashing of the demo runs on its unit's surface, at every frame", () => {
    const root = join(__dirname, "..", "..", "public", "demo");
    const files = [
      ...readdirSync(root).filter((name) => /\.(as_loaded|fixed)\.json$/.test(name)),
      ...readdirSync(join(root, "samples"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => readdirSync(join(root, "samples", entry.name)).map((name) => join("samples", entry.name, name))),
    ];
    let checked = 0;
    for (const file of files) {
      const run = JSON.parse(readFileSync(join(root, file), "utf8")) as { result: { keyframes: unknown } };
      const keyframes = parseKeyframes(run.result.keyframes);
      for (const time of [0, keyframes.duration_s / 2, keyframes.duration_s]) {
        const sample = sampleFrame(keyframes, time);
        keyframes.straps.forEach((strap, index) => {
          const path = drawnStrapPath(keyframes, sample, index);
          expect(path).toHaveLength(drawnPointCount(keyframes, index));
          expect(path.flat().every(Number.isFinite)).toBe(true);
          const points = path.slice(1, strap.routing === "top_over" ? -1 : undefined);
          points.forEach((point, pointIndex) => {
            // A strap over a row: each point is on its own unit.
            const owner = strap.point_unit_ids?.[pointIndex] ?? strap.unit_id;
            const unitIndex = keyframes.units.findIndex((unit) => unit.id === owner);
            const unit = keyframes.units[unitIndex];
            const pose = sample.units[unitIndex];
            if (unit?.shape !== "cylinder" || !unit.axis || !pose) return;
            const axis = { x: 0, y: 1, z: 2 }[unit.axis];
            const radius = Math.min(...unit.size_m.filter((_, i) => i !== axis)) / 2;
            const local = rotate([pose.q[0], -pose.q[1], -pose.q[2], -pose.q[3]], [
              point[0] - pose.p[0],
              point[1] - pose.p[1],
              point[2] - pose.p[2],
            ]);
            const across = local.filter((_, i) => i !== axis);
            expect(Math.hypot(across[0] ?? 0, across[1] ?? 0)).toBeLessThanOrEqual(radius + 1e-3);
            checked += 1;
          });
        });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
