import { readFileSync } from "node:fs";

import loadMujoco from "@mujoco/mujoco";
import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_IDS, type DemoRun, VARIANTS } from "@/lib/demo";

import { LiveRun } from "./engine";
import { type LiveModel, parseLiveModel } from "./model";
import { parityDifferences, paritySummary } from "./parity";

type Mujoco = Awaited<ReturnType<typeof loadMujoco>>;

function liveModel(id: string, variant: string): LiveModel {
  return parseLiveModel(JSON.parse(readFileSync(`public/demo/live/${id}.${variant}.json`, "utf8")));
}

function serverRun(id: string, variant: string): DemoRun {
  return JSON.parse(readFileSync(`public/demo/${id}.${variant}.json`, "utf8")) as DemoRun;
}

describe("LiveRun (MuJoCo WebAssembly)", () => {
  let mujoco: Mujoco;
  beforeAll(async () => {
    mujoco = await loadMujoco();
  });

  it("runs the engine version the server runs", () => {
    expect(mujoco.mj_versionString()).toBe(liveModel("emergency-braking", "fixed").engine.mujoco_version);
  });

  for (const id of DEMO_IDS) {
    for (const variant of VARIANTS) {
      it(`matches the server on ${id} (${variant})`, () => {
        const server = serverRun(id, variant).result;
        const run = new LiveRun(mujoco, liveModel(id, variant));
        run.advance();
        const result = run.result();
        run.dispose();

        expect(parityDifferences(paritySummary(result), paritySummary(server))).toEqual([]);
        expect(result.keyframes.frames).toHaveLength(server.keyframes.frames.length);
        expect(result.duration_s).toBe(server.duration_s);
        // Same per-unit numbers, not only the worst ones.
        for (const [index, unit] of result.units.entries()) {
          const expected = server.units[index];
          expect(unit.id).toBe(expected?.id);
          expect(unit.hit_headboard).toBe(expected?.hit_headboard);
          expect(unit.left_bed).toBe(expected?.left_bed);
        }
        // The replay shows the same thing: last pose, tensions and contact points of a mid frame.
        const middle = Math.floor(result.keyframes.frames.length / 2);
        const mine = result.keyframes.frames[middle];
        const theirs = server.keyframes.frames[middle];
        expect(mine?.contacts?.length).toBe(theirs?.contacts?.length);
        mine?.units.forEach((unit, index) => {
          const other = theirs?.units[index];
          unit.p.forEach((value, axis) => expect(value).toBeCloseTo(other?.p[axis] ?? NaN, 3));
          expect(Math.abs((unit.n ?? 0) - (other?.n ?? NaN))).toBeLessThanOrEqual(
            Math.max(10, 0.01 * (other?.n ?? 0)),
          );
        });
        mine?.straps.forEach((strap, index) => {
          const other = theirs?.straps[index]?.tension_n ?? NaN;
          expect(Math.abs(strap.tension_n - other)).toBeLessThanOrEqual(Math.max(10, 0.01 * other));
        });
      });
    }
  }

  it("can be simulated in slices and reports progress", () => {
    const run = new LiveRun(mujoco, liveModel("emergency-braking", "fixed"));
    expect(run.done).toBe(false);
    let slices = 0;
    while (!run.advance(1)) slices += 1;
    expect(slices).toBeGreaterThan(1);
    expect(run.progress).toBe(1);
    expect(run.result().verdict.status).toBe("pass");
    run.dispose();
  });

  it("repeats the event when stepped again from a keyframe", () => {
    const live = liveModel("emergency-braking", "as_loaded");
    const run = new LiveRun(mujoco, live);
    run.advance();
    const frames = run.result().keyframes.frames;
    const from = 30;
    run.seek(from);
    run.stepLive(live.profile.steps - Math.round(from / (live.settings.replay_fps * live.settings.timestep_s)));
    const sample = run.sample();
    const last = frames[frames.length - 1];
    sample.units.forEach((unit, index) => {
      expect(unit.p[0]).toBeCloseTo(last?.units[index]?.p[0] ?? NaN, 2);
    });
    run.dispose();
  });

  it("lets a push move loose cargo further than lashed cargo", () => {
    const pushed = (variant: string): number => {
      const live = liveModel("emergency-braking", variant);
      const run = new LiveRun(mujoco, live);
      run.advance();
      run.seek(0);
      const before = run.sample().units[0]?.p[1] ?? 0;
      // Half the unit's weight, sideways, for one second.
      const unit = live.units[0];
      run.setPush(0, [0, 0.5 * (unit?.mass_kg ?? 0) * live.settings.gravity_mps2, 0]);
      run.stepLive(500);
      const after = run.sample().units[0]?.p[1] ?? 0;
      run.dispose();
      return Math.abs(after - before);
    };
    const loose = pushed("as_loaded");
    const lashed = pushed("fixed");
    expect(loose).toBeGreaterThan(0.05);
    expect(lashed).toBeLessThan(loose / 5);
  });
});
