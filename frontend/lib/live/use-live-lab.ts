"use client";

/**
 * The state of the live lab: the scenario as authored, the controls, and the latest run.
 *
 * A change of controls goes: controls -> scenario and event (`applyControls`) -> live model
 * (static file for the scenario as authored, `POST /mjcf` otherwise) -> MuJoCo WebAssembly
 * (`LiveRun`), simulated in short slices so the page stays responsive. When the browser cannot
 * step the model (no WebAssembly, the module fails to load, or the device is too slow), runs come
 * from the server's `/simulate` instead and the page says so.
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DemoId, RunSummary, Variant } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";

import { type BaseRun, fetchBaseRun, fetchLiveModel, fetchStaticLiveModel, simulateOnServer } from "./client";
import {
  applyControls,
  authoredMat,
  authoredPretension,
  authoredStrapsPerUnit,
  defaultControls,
  isDefault,
  type LabControls,
  maxStrapsPerUnit,
} from "./controls";
import { browserRunner, engineOf } from "./browser-run";
import type { LiveRun } from "./engine";
import { explain, type Reason } from "./reason";
import { type FallbackReason, RunnerError, type RunSource } from "./runner";
import type { Scenario } from "./scenario";

/** A change of controls waits this long for the next one before asking the API [ms]. */
const DEBOUNCE_MS = 180;

export { SLOW_RUN_MS } from "./runner";
export type { FallbackReason };
export type LabSource = RunSource;
export type LabError = "load_failed" | "api_unreachable" | "unstable";

export type LabRun = {
  source: LabSource;
  controls: LabControls;
  summary: RunSummary;
  doc: KeyframesDoc;
  reason: Reason;
  /** Wall time the run took: simulating in the browser, or waiting for the server [ms]. */
  runMs: number;
};

export type LabLimits = {
  maxStraps: number;
  authoredStraps: number | null;
  authoredPretension: number | null;
  authoredMat: boolean;
  /** Mass of every unit as authored [kg], in the order of the units. */
  unitMassesKg: number[];
};

export type LiveLab = {
  /** `null` until the scenario as authored has loaded. */
  controls: LabControls | null;
  limits: LabLimits | null;
  changeControls: (change: Partial<LabControls>) => void;
  resetControls: () => void;
  /** True when the controls are the scenario as authored. */
  authored: boolean;
  /** The latest finished run; it stays while the next one is computed. */
  run: LabRun | null;
  busy: boolean;
  /** Share of the current browser run simulated so far, 0..1. */
  progress: number;
  error: LabError | null;
  fallback: FallbackReason | null;
  /** The engine of the latest browser run, for stepping it again live; `null` for server runs. */
  engine: RefObject<LiveRun | null>;
};

export function useLiveLab(id: DemoId, variant: Variant): LiveLab {
  const [base, setBase] = useState<{ key: string; run: BaseRun; other: Scenario } | null>(null);
  const [changes, setChanges] = useState<{ key: string; controls: LabControls } | null>(null);
  const [run, setRun] = useState<{ key: string; run: LabRun } | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<LabError | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(null);
  const engine = useRef<LiveRun | null>(null);
  // One runner per page: once the device proved too slow, it stays on the server.
  const runner = useRef(browserRunner());

  const key = `${id}.${variant}`;
  const current = base?.key === key ? base : null;
  const controls = useMemo(
    () => (current ? (changes?.key === key ? changes.controls : defaultControls(current.run.event)) : null),
    [current, changes, key],
  );

  // The scenario as authored, in both versions.
  useEffect(() => {
    const controller = new AbortController();
    const other: Variant = variant === "as_loaded" ? "fixed" : "as_loaded";
    Promise.all([fetchBaseRun(id, variant, controller.signal), fetchBaseRun(id, other, controller.signal)]).then(
      ([own, theOther]) => setBase({ key: `${id}.${variant}`, run: own, other: theOther.scenario }),
      () => {
        if (!controller.signal.aborted) {
          setError("load_failed");
          setBusy(false);
        }
      },
    );
    return () => controller.abort();
  }, [id, variant]);

  // Simulate whenever the scenario or the controls change.
  useEffect(() => {
    if (!current || !controls) return;
    const controller = new AbortController();
    const { signal } = controller;
    const authored = isDefault(controls, current.run.event);
    const input = applyControls(current.run.scenario, current.run.event, controls, current.other);

    const finish = (source: LabSource, summary: RunSummary, doc: KeyframesDoc, runMs: number) => {
      setRun({ key, run: { source, controls, summary, doc, reason: explain(summary, doc), runMs } });
      setError(null);
      setBusy(false);
    };

    const start = async () => {
      setBusy(true);
      setProgress(0);
      try {
        const outcome = await runner.current.run({
          live: () =>
            authored ? fetchStaticLiveModel(id, variant, signal) : fetchLiveModel(input.scenario, input.event, signal),
          // The scenario as authored was already simulated by the server: no request needed.
          server: async () => (authored ? current.run.server : simulateOnServer(input.scenario, input.event, signal)),
          signal,
          onProgress: setProgress,
        });
        if (!outcome) return;
        const previous = engine.current;
        engine.current = engineOf(outcome.engine);
        if (previous !== engine.current) previous?.dispose();
        setFallback(runner.current.fallback);
        finish(outcome.source, outcome.summary, outcome.doc, outcome.runMs);
      } catch (cause) {
        if (signal.aborted) return;
        setError(cause instanceof RunnerError ? cause.code : "api_unreachable");
        setBusy(false);
      }
    };

    // The first run starts at once; a change of controls waits for the visitor to settle.
    const timer = setTimeout(() => void start(), authored ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [current, controls, id, variant, key]);

  // Free the engine's memory when the page goes away.
  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const changeControls = useCallback(
    (change: Partial<LabControls>) => {
      if (!controls) return;
      setChanges({ key, controls: { ...controls, ...change } });
    },
    [controls, key],
  );
  const resetControls = useCallback(() => setChanges(null), []);

  const limits = useMemo<LabLimits | null>(
    () =>
      current
        ? {
            maxStraps: maxStrapsPerUnit(current.run.scenario),
            authoredStraps: authoredStrapsPerUnit(current.run.scenario),
            authoredPretension: authoredPretension(current.run.scenario),
            authoredMat: authoredMat(current.run.scenario),
            unitMassesKg: current.run.scenario.units.map((unit) => unit.mass_kg),
          }
        : null,
    [current],
  );

  return {
    controls,
    limits,
    changeControls,
    resetControls,
    authored: Boolean(current && controls && isDefault(controls, current.run.event)),
    run: run?.key === key ? run.run : null,
    busy,
    progress,
    error,
    fallback,
    engine,
  };
}
