import { describe, expect, it, vi } from "vitest";

import type { RunSummary } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";

import { LiveRunError } from "./engine";
import type { LiveModel } from "./model";
import type { Mujoco } from "./mujoco";
import { type BrowserRun, LiveRunner, type RunnerDeps, RunnerError, type ServerResult } from "./runner";

const summary = { verdict: { status: "pass", findings: [] } } as unknown as RunSummary;
const doc = { frames: [] } as unknown as KeyframesDoc;
const server: ServerResult = { ...summary, keyframes: doc };
const live = {} as LiveModel;

/** A browser run that takes `slices` slices of `msPerSlice` each on a fake clock. */
function fakeEngine(clock: { t: number }, slices: number, msPerSlice: number, fail = false): BrowserRun {
  let done = 0;
  return {
    get progress() {
      return done / slices;
    },
    advance() {
      clock.t += msPerSlice;
      done += 1;
      if (fail && done === 2) throw new LiveRunError("the simulation became unstable");
      return done >= slices;
    },
    summary: () => ({ summary, doc }),
    dispose: vi.fn(),
  };
}

function runner(overrides: Partial<RunnerDeps> & { msPerSlice?: number; fail?: boolean } = {}) {
  const clock = { t: 0 };
  const engines: BrowserRun[] = [];
  const deps: RunnerDeps = {
    webAssemblySupported: () => true,
    loadMujoco: async () => ({}) as Mujoco,
    start: () => {
      const engine = fakeEngine(clock, 10, overrides.msPerSlice ?? 50, overrides.fail);
      engines.push(engine);
      return engine;
    },
    now: () => clock.t,
    yieldTurn: async () => undefined,
    ...overrides,
  };
  return { runner: new LiveRunner(deps), engines };
}

function input(signal = new AbortController().signal) {
  return { live: vi.fn(async () => live), server: vi.fn(async () => server), signal };
}

describe("LiveRunner", () => {
  it("simulates in the browser when it can, in slices", async () => {
    const { runner: subject } = runner();
    const progress: number[] = [];
    const run = input();
    const outcome = await subject.run({ ...run, onProgress: (share) => progress.push(share) });

    expect(outcome?.source).toBe("browser");
    expect(outcome?.runMs).toBe(500);
    expect(outcome?.engine).not.toBeNull();
    expect(progress.length).toBe(9);
    expect(run.server).not.toHaveBeenCalled();
    expect(subject.fallback).toBeNull();
  });

  it("moves to the server after a run slower than the limit, and stays there", async () => {
    // 10 slices of 300 ms: 3 s, over the 2.5 s limit.
    const { runner: subject, engines } = runner({ msPerSlice: 300 });

    const first = await subject.run(input());
    // The slow run is still shown: it finished, and its result is right.
    expect(first?.source).toBe("browser");
    expect(subject.fallback).toBe("slow");

    const second = input();
    const next = await subject.run(second);
    expect(next?.source).toBe("server");
    expect(next?.engine).toBeNull();
    expect(second.live).not.toHaveBeenCalled();
    expect(engines).toHaveLength(1);
  });

  it("uses the server when WebAssembly is missing or the module does not load", async () => {
    const noWasm = runner({ webAssemblySupported: () => false }).runner;
    expect((await noWasm.run(input()))?.source).toBe("server");
    expect(noWasm.fallback).toBe("no_wasm");

    const broken = runner({ loadMujoco: () => Promise.reject(new Error("offline")) }).runner;
    expect((await broken.run(input()))?.source).toBe("server");
    expect(broken.fallback).toBe("load_failed");
  });

  it("reports an unstable simulation as its own error and frees the engine", async () => {
    const { runner: subject, engines } = runner({ fail: true });

    const error = await subject.run(input()).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RunnerError);
    expect((error as RunnerError).code).toBe("unstable");
    expect(engines[0]?.dispose).toHaveBeenCalled();
    // An unstable run is not a slow device: the next run still tries the browser.
    expect(subject.fallback).toBeNull();
  });

  it("reports a server that does not answer", async () => {
    const subject = runner({ webAssemblySupported: () => false }).runner;
    const run = { ...input(), server: () => Promise.reject(new Error("timeout")) };

    await expect(subject.run(run)).rejects.toMatchObject({ code: "api_unreachable" });
  });

  it("drops a run that was replaced by a newer one", async () => {
    const controller = new AbortController();
    const { runner: subject, engines } = runner({
      yieldTurn: async () => controller.abort(),
    });

    expect(await subject.run(input(controller.signal))).toBeNull();
    expect(engines[0]?.dispose).toHaveBeenCalled();
  });
});
