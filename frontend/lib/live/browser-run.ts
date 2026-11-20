/** The production pieces of the runner: MuJoCo WebAssembly in this browser, on the real clock. */

import type { RunSummary } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";

import { LiveRun } from "./engine";
import type { LiveModel } from "./model";
import { loadMujoco, type Mujoco, webAssemblySupported } from "./mujoco";
import { type BrowserRun, LiveRunner } from "./runner";

/** The summary a page shows of a browser run: the engine's result plus the live model's checks. */
export function browserSummary(live: LiveModel, run: LiveRun): { summary: RunSummary; doc: KeyframesDoc } {
  const result = run.result();
  return {
    doc: result.keyframes,
    summary: {
      duration_s: result.duration_s,
      engine: { mujoco_version: result.engine.mujoco_version, timestep_s: result.engine.timestep_s },
      profile: result.profile,
      verdict: result.verdict,
      units: result.units,
      margins: result.margins,
      axle_loads: live.axle_loads,
      en_12195_1: live.en_12195_1,
    },
  };
}

/** A `LiveRun` seen through the runner's interface; `engine` is kept for stepping it live. */
export class LiveBrowserRun implements BrowserRun {
  constructor(
    readonly engine: LiveRun,
    private readonly live: LiveModel,
  ) {}

  get progress(): number {
    return this.engine.progress;
  }

  advance(budgetMs: number): boolean {
    return this.engine.advance(budgetMs);
  }

  summary() {
    return browserSummary(this.live, this.engine);
  }

  dispose(): void {
    this.engine.dispose();
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A runner that steps models in this browser and falls back to the server. */
export function browserRunner(): LiveRunner {
  return new LiveRunner({
    webAssemblySupported,
    loadMujoco,
    start: (mujoco: Mujoco, live: LiveModel) => new LiveBrowserRun(new LiveRun(mujoco, live), live),
    now: () => performance.now(),
    yieldTurn: nextTurn,
  });
}

/** The engine inside a runner outcome, or `null` for a server run. */
export function engineOf(run: BrowserRun | null): LiveRun | null {
  return run instanceof LiveBrowserRun ? run.engine : null;
}
