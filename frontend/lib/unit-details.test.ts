import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DemoRun } from "./demo";
import { parseKeyframes, sampleFrame } from "./keyframes";
import { spreadMarkers, unitDetails } from "./unit-details";

function load(name: string) {
  const run = JSON.parse(readFileSync(join(__dirname, "..", "public", "demo", name), "utf8")) as DemoRun;
  return parseKeyframes(run.result.keyframes);
}

const asLoaded = load("emergency-braking.as_loaded.json");
const fixed = load("emergency-braking.fixed.json");
const unsecured = load("sharp-curve.as_loaded.json");

describe("unit details", () => {
  it("are the weight on the floor and no inertia before the event", () => {
    const details = unitDetails(fixed, sampleFrame(fixed, 0), 0);
    expect(details).not.toBeNull();
    expect(details?.inertia).toBeCloseTo(0, 0);
    expect(details?.slide).toBe(0);
    expect(details?.slipping).toBe(false);
    // 900 kg plus the pretension of two straps pulling down.
    expect(details?.floor).toBeGreaterThan(900 * 9.81);
    expect(details?.friction).toBeCloseTo(0.45 * (details?.floor ?? 0), 6);
  });

  it("list the lashings of the unit only, each against its capacity", () => {
    const details = unitDetails(fixed, sampleFrame(fixed, 1.6), 1);
    expect(details?.lashings).toHaveLength(2);
    for (const lashing of details?.lashings ?? []) {
      expect(fixed.straps[lashing.index]?.unit_id).toBe(fixed.units[1]?.id);
      expect(lashing.capacity).toBe(25000);
      expect(lashing.ratio).toBeCloseTo(lashing.tension / 25000, 9);
      expect(lashing.tension).toBeGreaterThan(0);
    }
    expect(unitDetails(unsecured, sampleFrame(unsecured, 0), 0)?.lashings).toEqual([]);
  });

  it("hold under braking when fixed and slip as loaded", () => {
    const held = unitDetails(fixed, sampleFrame(fixed, 1.6), 0);
    expect(held?.inertia).toBeGreaterThan(6000);
    expect(held?.slipping).toBe(false);
    expect(held?.slide).toBeLessThan(0.01);

    const end = asLoaded.duration_s;
    const moved = Math.max(...asLoaded.units.map((_, index) => unitDetails(asLoaded, sampleFrame(asLoaded, end), index)?.slide ?? 0));
    expect(moved).toBeGreaterThan(0.05);
    const slipped = asLoaded.frames.some((_, frame) =>
      asLoaded.units.some((__, index) => unitDetails(asLoaded, sampleFrame(asLoaded, frame / asLoaded.fps), index)?.slipping),
    );
    expect(slipped).toBe(true);
  });

  it("are null for a unit the document does not have", () => {
    expect(unitDetails(fixed, sampleFrame(fixed, 0), 99)).toBeNull();
    expect(unitDetails(fixed, sampleFrame(fixed, 0), -1)).toBeNull();
  });
});

describe("marker spreading", () => {
  const frame = { width: 343, height: 257 };
  const size = 44;

  function overlapping(points: ({ x: number; y: number } | null)[]): boolean {
    const shown = points.filter((point) => point !== null);
    return shown.some((a, i) =>
      shown.some((b, j) => i < j && Math.abs(a.x - b.x) < size && Math.abs(a.y - b.y) < size),
    );
  }

  it("leaves markers that do not touch where they are", () => {
    const points = [
      { x: 100, y: 120 },
      { x: 150, y: 118 },
      { x: 200, y: 116 },
    ];
    expect(spreadMarkers(points, size, frame)).toEqual(points);
  });

  it("moves a marker that would overlap an earlier one up by one target", () => {
    const [first, second] = spreadMarkers(
      [
        { x: 100, y: 120 },
        { x: 110, y: 125 },
      ],
      size,
      frame,
    );
    expect(first).toEqual({ x: 100, y: 120 });
    expect(second).toEqual({ x: 110, y: 76 });
  });

  it("separates a pile of markers on the same spot", () => {
    const spread = spreadMarkers(
      Array.from({ length: 5 }, () => ({ x: 170, y: 130 })),
      size,
      frame,
    );
    expect(overlapping(spread)).toBe(false);
    for (const point of spread) {
      expect(point?.x).toBeGreaterThanOrEqual(size / 2);
      expect(point?.x).toBeLessThanOrEqual(frame.width - size / 2);
      expect(point?.y).toBeGreaterThanOrEqual(size / 2);
      expect(point?.y).toBeLessThanOrEqual(frame.height - size / 2);
    }
  });

  it("moves sideways when there is no room above", () => {
    const [, second] = spreadMarkers(
      [
        { x: 100, y: 30 },
        { x: 105, y: 32 },
      ],
      size,
      frame,
    );
    expect(second).toEqual({ x: 144, y: 32 });
  });

  it("keeps whole targets inside the frame", () => {
    expect(spreadMarkers([{ x: -20, y: 400 }], size, frame)).toEqual([{ x: 22, y: 235 }]);
    expect(spreadMarkers([{ x: 500, y: -5 }], size, frame)).toEqual([{ x: 321, y: 22 }]);
  });

  it("passes off-screen markers through and ignores them when spreading", () => {
    const spread = spreadMarkers([null, { x: 100, y: 120 }, null, { x: 100, y: 120 }], size, frame);
    expect(spread[0]).toBeNull();
    expect(spread[2]).toBeNull();
    expect(spread[1]).toEqual({ x: 100, y: 120 });
    expect(spread[3]).toEqual({ x: 100, y: 76 });
  });
});
