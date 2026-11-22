import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DemoRun } from "./demo";
import { parseKeyframes, sampleFrame } from "./keyframes";
import {
  buildSeries,
  criticalWindow,
  GRAVITY,
  headboardImpacts,
  playbackRate,
  seriesAt,
  tensionColor,
  unitForces,
} from "./replay";
import { buildScenePath, sceneConditions, verticalHeave } from "./scene/motion";

function load(name: string) {
  const run = JSON.parse(readFileSync(join(__dirname, "..", "public", "demo", name), "utf8")) as DemoRun;
  return { run, doc: parseKeyframes(run.result.keyframes) };
}

const braking = load("emergency-braking.as_loaded.json");
const brakingFixed = load("emergency-braking.fixed.json");
const bump = load("weigh-station.fixed.json");

describe("chart series", () => {
  const series = buildSeries(braking.doc);

  it("have one value per frame", () => {
    const frames = braking.doc.frames.length;
    expect(series.t).toHaveLength(frames);
    expect(series.braking).toHaveLength(frames);
    expect(series.slide).toHaveLength(3);
    expect(series.slide[0]).toHaveLength(frames);
    expect(series.tension).toHaveLength(3);
  });

  it("reach the braking, slide and tension the run reports", () => {
    expect(Math.max(...series.braking)).toBeCloseTo(Number(braking.run.result.profile.peak_forward_g), 2);
    expect(Math.max(...series.slide.flat())).toBeCloseTo(braking.run.result.margins.max_slide_m, 1);
    expect(series.slide[0]?.[0]).toBe(0);
    expect(series.tension[0]?.[0]).toBeCloseTo(3000, -1);
  });

  it("cover the stopping distance of the truck", () => {
    // From 80 km/h at 0.756 g: v^2 / (2 a) is 33 m, plus the lead-in and the brake build-up.
    const total = series.distance.at(-1) ?? 0;
    expect(total).toBeGreaterThan(33);
    expect(total).toBeLessThan(50);
    expect(series.distance[0]).toBe(0);
  });

  it("lift the bed by the height of the speed bump and bring it back (scene motion)", () => {
    const path = buildScenePath(bump.doc, sceneConditions(bump.run.result.profile));
    const heights = Array.from({ length: 400 }, (_, i) => verticalHeave(path.vertical, (i / 400) * bump.doc.duration_s));
    expect(Math.max(...heights)).toBeCloseTo(0.1, 2);
    expect(Math.abs(heights.at(-1) ?? 1)).toBeLessThan(1e-9);
  });

  it("interpolate between frames", () => {
    const values = [0, 10, 20];
    const doc = { ...braking.doc, fps: 1 };
    expect(seriesAt(doc, values, 0.5)).toBe(5);
    expect(seriesAt(doc, values, 99)).toBe(20);
  });
});

describe("critical window", () => {
  it("starts just before the load begins to move", () => {
    const window = criticalWindow(braking.doc);
    expect(window).not.toBeNull();
    // Braking starts at 0.3 s and builds up over 0.45 s; the pallets let go on the way up.
    expect(window?.start).toBeGreaterThan(0.3);
    expect(window?.start).toBeLessThan(0.9);
    expect((window?.end ?? 0) - (window?.start ?? 0)).toBeCloseTo(1.25, 1);
  });

  it("does not exist when nothing moves", () => {
    expect(criticalWindow(brakingFixed.doc)).toBeNull();
  });
});

describe("headboard impacts", () => {
  it("find the pallet that slides into the headboard", () => {
    const impacts = headboardImpacts(braking.doc);
    expect(impacts.length).toBeGreaterThanOrEqual(1);
    const [first] = impacts;
    // At the headboard: the front end of the 6.2 m bed.
    expect(first?.position[0]).toBeCloseTo(3.1, 1);
    expect(first?.force).toBeGreaterThan(0);
  });

  it("find none when the load holds", () => {
    expect(headboardImpacts(brakingFixed.doc)).toEqual([]);
  });
});

describe("playback rate", () => {
  const window = { start: 1, end: 2 };

  it("slows down inside the critical window when automatic", () => {
    expect(playbackRate("auto", 0.5, window)).toBe(1);
    expect(playbackRate("auto", 1.5, window)).toBe(0.25);
    expect(playbackRate("auto", 2.5, window)).toBe(1);
    expect(playbackRate("auto", 1.5, null)).toBe(1);
  });

  it("uses a chosen speed everywhere", () => {
    expect(playbackRate(0.5, 1.5, window)).toBe(0.5);
    expect(playbackRate(1, 1.5, window)).toBe(1);
  });
});

describe("lashing colour", () => {
  const hex = (color: number[]) => color.map((c) => Math.round(c * 255));

  it("runs from neutral through amber to red at the capacity", () => {
    expect(hex(tensionColor(0, 25000))).toEqual([0x8a, 0x8a, 0x86]);
    expect(hex(tensionColor(12500, 25000))).toEqual([0xf2, 0xa1, 0x00]);
    expect(hex(tensionColor(25000, 25000))).toEqual([0xb4, 0x23, 0x18]);
    expect(hex(tensionColor(40000, 25000))).toEqual([0xb4, 0x23, 0x18]);
  });

  it("is continuous in between", () => {
    const quarter = tensionColor(6250, 25000);
    expect(quarter[0]).toBeGreaterThan(0x8a / 255);
    expect(quarter[0]).toBeLessThan(0xf2 / 255);
  });
});

describe("forces on a unit", () => {
  it("compare what braking asks with what friction can give", () => {
    const { doc } = braking;
    const unit = doc.units[0];
    const atRest = sampleFrame(doc, 0);
    const brakingHard = sampleFrame(doc, 2);
    const mass = unit?.mass_kg ?? 0;
    const friction = unit?.friction_coefficient ?? 0;

    const before = unitForces(mass, friction, atRest.units[0]?.normal ?? 0, atRest.bedAccel);
    const during = unitForces(mass, friction, brakingHard.units[0]?.normal ?? 0, brakingHard.bedAccel);

    expect(before.inertiaMagnitude).toBe(0);
    // 900 kg: the weight plus one strap at 300 daN, times the friction factor 0.45.
    expect(before.frictionLimit).toBeCloseTo(0.45 * (900 * GRAVITY + 2 * 3000 * 0.843), -2);
    // Braking at 0.756 g throws the pallet forward with more than friction can hold.
    expect(during.inertia[0]).toBeCloseTo(900 * 0.756 * GRAVITY, -2);
    expect(during.inertia[1]).toBeCloseTo(0);
    expect(during.inertiaMagnitude).toBeGreaterThan(before.frictionLimit);
  });

  it("show friction above inertia for the fixed load", () => {
    const { doc } = brakingFixed;
    const sample = sampleFrame(doc, 2);
    const unit = doc.units[0];
    const forces = unitForces(unit?.mass_kg ?? 0, unit?.friction_coefficient ?? 0, sample.units[0]?.normal ?? 0, sample.bedAccel);

    expect(forces.frictionLimit).toBeGreaterThan(forces.inertiaMagnitude);
  });
});
