/**
 * Where a run is simulated, and what happens when that fails: the fallback chain of the live
 * lab and the explorer.
 *
 * A run is simulated in the browser by MuJoCo WebAssembly when it can be: WebAssembly exists,
 * the module loads, and the device is fast enough. Otherwise it comes from the server's
 * `/simulate`, and the page says why (`fallback`). A run slower than `slowMs` is shown, but the
 * following runs go to the server: a device that slow cannot be explored with. A simulation
 * that becomes unstable is an error of its own, so the page can keep the previous result.
 *
 * The engine, the clock and the server are passed in, so the chain is tested without a browser
 * (`runner.test.ts`).
 */

import type { RunSummary } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";

import { LiveRunError } from "./engine";
import type { LiveModel } from "./model";
import type { Mujoco } from "./mujoco";

/** Why runs come from the server instead of the browser. */
export type FallbackReason = "no_wasm" | "load_failed" | "slow";
export type RunError = "api_unreachable" | "unstable";
export type RunSource = "browser" | "server";

/** Wall time of one slice of simulation before the page gets a turn [ms]. */
export const SLICE_MS = 12;
/** A browser run slower than this moves the following runs to the server [ms]. */
export const SLOW_RUN_MS = 2500;

/** What the runner needs of a browser run (`LiveRun` in production, a fake in tests). */
export type BrowserRun = {
  readonly progress: number;
  advance(budgetMs: number): boolean;
  summary(): { summary: RunSummary; doc: KeyframesDoc };
  dispose(): void;
};

export type ServerResult = RunSummary & { keyframes: KeyframesDoc };

export type RunnerDeps = {
  webAssemblySupported: () => boolean;
  loadMujoco: () => Promise<Mujoco>;
  start: (mujoco: Mujoco, live: LiveModel) => BrowserRun;
  now: () => number;
  /** Gives the page a turn between slices. */
  yieldTurn: () => Promise<void>;
  sliceMs?: number;
  slowMs?: number;
};

export type RunInput = {
  /** The live model to step; only fetched when the browser simulates. */
  live: () => Promise<LiveModel>;
  /** The server's run of the same inputs. */
  server: () => Promise<ServerResult>;
  signal: AbortSignal;
  onProgress?: (share: number) => void;
};

export type RunOutcome = {
  source: RunSource;
  summary: RunSummary;
  doc: KeyframesDoc;
  /** Wall time: simulating in the browser, or waiting for the server [ms]. */
  runMs: number;
  /** The finished browser run, kept for stepping it again live; `null` for server runs. */
  engine: BrowserRun | null;
};

export class RunnerError extends Error {
  constructor(readonly code: RunError, cause?: unknown) {
    super(code);
    this.name = "RunnerError";
    this.cause = cause;
  }
}

export class LiveRunner {
  /** Set once runs have moved to the server; never unset for the life of the page. */
  fallback: FallbackReason | null = null;
  private readonly deps: Required<RunnerDeps>;

  constructor(deps: RunnerDeps) {
    this.deps = { sliceMs: SLICE_MS, slowMs: SLOW_RUN_MS, ...deps };
  }

  /** Simulates one run; resolves with `null` when `signal` aborted it. */
  async run(input: RunInput): Promise<RunOutcome | null> {
    try {
      if (this.fallback === null) {
        const browser = await this.inBrowser(input);
        if (browser !== "fallback") return browser;
      }
      if (input.signal.aborted) return null;
      return await this.onServer(input);
    } catch (cause) {
      if (input.signal.aborted) return null;
      if (cause instanceof RunnerError) throw cause;
      throw new RunnerError(cause instanceof LiveRunError ? "unstable" : "api_unreachable", cause);
    }
  }

  private async onServer(input: RunInput): Promise<RunOutcome | null> {
    const started = this.deps.now();
    const result = await input.server();
    if (input.signal.aborted) return null;
    return { source: "server", summary: result, doc: result.keyframes, runMs: this.deps.now() - started, engine: null };
  }

  private async inBrowser(input: RunInput): Promise<RunOutcome | null | "fallback"> {
    const { deps } = this;
    if (!deps.webAssemblySupported()) {
      this.fallback = "no_wasm";
      return "fallback";
    }
    let mujoco: Mujoco;
    try {
      mujoco = await deps.loadMujoco();
    } catch {
      this.fallback = "load_failed";
      return "fallback";
    }
    const live = await input.live();
    if (input.signal.aborted) return null;

    const started = deps.now();
    const run = deps.start(mujoco, live);
    try {
      while (!run.advance(deps.sliceMs)) {
        input.onProgress?.(run.progress);
        await deps.yieldTurn();
        if (input.signal.aborted) {
          run.dispose();
          return null;
        }
      }
      const { summary, doc } = run.summary();
      const runMs = deps.now() - started;
      // Too slow to explore with: the next runs come from the server.
      if (runMs > deps.slowMs) this.fallback = "slow";
      return { source: "browser", summary, doc, runMs, engine: run };
    } catch (cause) {
      run.dispose();
      throw cause;
    }
  }
}
