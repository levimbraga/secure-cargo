"use client";

/**
 * The state of the explorer: the configuration (one choice per dimension), the load draft the
 * editor edits, and the latest run.
 *
 * A new configuration -> its load (static cache or `GET /explorer`) -> a run. An edit of the
 * draft shows at once in the editor (positions, straps, axle loads) and, once the visitor
 * pauses, goes to `POST /explorer/draft` -> a run. Runs go through the shared runner: MuJoCo
 * WebAssembly in the browser, the server when the browser cannot.
 *
 * The page URL always describes the load: the configuration and the editor's edits as a query
 * string, or, for a draft that came from outside (a photo, an inspection), the draft itself in
 * the fragment (`#draft=`), which never reaches a server.
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RunSummary } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";
import { browserRunner, engineOf } from "@/lib/live/browser-run";
import { simulateOnServer } from "@/lib/live/client";
import type { LiveRun } from "@/lib/live/engine";
import { explain, type Reason } from "@/lib/live/reason";
import { type FallbackReason, RunnerError, type RunSource } from "@/lib/live/runner";
import type { Country } from "@/lib/country";

import { ExplorerError, fetchConfigLoad, fetchDraftLoad, type LoadedExplorer } from "./client";
import { choose, type Dimension, type ExplorerConfig, fromSearch, toQuery } from "./config";

/** The address with the country's rules in it (`country=US` or `EU`; Brazil is the default). */
function withCountry(address: string, country: Country): string {
  const [query, hash = ""] = address.split("#");
  const params = (query ?? "").replace(/^\?/, "").split("&").filter((part) => part && !part.startsWith("country="));
  if (country !== "BR") params.push(`country=${country}`);
  return `${params.length ? `?${params.join("&")}` : ""}${hash ? `#${hash}` : ""}`;
}
import { editsToConfig, encodeDraft, type ExplorerLoad, type LoadDraft, parseDraft } from "./draft";

/** An edit waits this long for the next one before it goes to the API [ms]. */
const EDIT_DEBOUNCE_MS = 350;

export type ExplorerRun = {
  source: RunSource;
  summary: RunSummary;
  doc: KeyframesDoc;
  reason: Reason;
  runMs: number;
};

export type ExplorerState = {
  config: ExplorerConfig;
  /** Where the load came from: the selectors, or a draft from outside. */
  origin: "config" | "draft";
  /** The latest load the server built; `null` until the first one arrives. */
  load: ExplorerLoad | null;
  /** The draft as edited, ahead of `load` while an edit is on its way. */
  draft: LoadDraft | null;
  run: ExplorerRun | null;
  busy: boolean;
  progress: number;
  /** A stable code: `api_unreachable`, `unstable`, or why the server refused the load. */
  error: string | null;
  fallback: FallbackReason | null;
  engine: RefObject<LiveRun | null>;
  choose: <K extends Dimension | "speed_kmh" | "count" | "mass_kg" | "body_code">(dimension: K, value: ExplorerConfig[K]) => void;
  /** Whose rules and units are shown; switching it runs no simulation. */
  country: Country;
  setCountry: (country: Country) => void;
  edit: (draft: LoadDraft) => void;
  /** Back to the load the configuration describes, without the editor's edits. */
  resetEdits: () => void;
  /** True when the draft has edits the configuration alone does not describe. */
  edited: boolean;
};

type Source = { kind: "config"; config: ExplorerConfig } | { kind: "draft"; draft: LoadDraft };

/** Reads where the load comes from in the page address. */
export function sourceFromLocation(location: { search: string; hash: string }): Source {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, "")).get("draft");
  if (fragment) {
    try {
      return { kind: "draft", draft: parseDraft(fragment) };
    } catch {
      // A broken fragment: fall back to the query string.
    }
  }
  return { kind: "config", config: fromSearch(location.search) };
}

/** The address of the explorer with this draft in it, for a photo analysis or an inspection. */
export function explorerDraftHash(draft: LoadDraft): string {
  return `#draft=${encodeDraft(draft)}`;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useExplorer(initial: Source): ExplorerState {
  const [source, setSource] = useState<Source>(initial);
  const [loaded, setLoaded] = useState<LoadedExplorer | null>(null);
  // The draft the server made of the configuration: edits are measured against it.
  const [base, setBase] = useState<LoadDraft | null>(initial.kind === "draft" ? initial.draft : null);
  const [draft, setDraft] = useState<LoadDraft | null>(initial.kind === "draft" ? initial.draft : null);
  const [run, setRun] = useState<ExplorerRun | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(null);
  const engine = useRef<LiveRun | null>(null);
  const runner = useRef(browserRunner());

  const config = source.kind === "config" ? source.config : fromSearch("");
  // Whose rules and units the page shows. Switching it changes no physics: no new simulation.
  const [country, setCountry] = useState<Country>(() =>
    source.kind === "config" ? source.config.country : (source.draft.country ?? "BR"),
  );

  const simulate = useCallback(async (next: LoadedExplorer, signal: AbortSignal) => {
    const { load, serverRun } = next;
    const outcome = await runner.current.run({
      live: async () => load.live,
      server: serverRun ?? (() => simulateOnServer(load.scenario, load.event, signal)),
      signal,
      onProgress: setProgress,
    });
    if (!outcome) return;
    const previous = engine.current;
    engine.current = engineOf(outcome.engine);
    if (previous !== engine.current) previous?.dispose();
    setFallback(runner.current.fallback);
    setRun({
      source: outcome.source,
      summary: outcome.summary,
      doc: outcome.doc,
      reason: explain(outcome.summary, outcome.doc),
      runMs: outcome.runMs,
    });
    setError(null);
  }, []);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof RunnerError) setError(cause.code);
    else if (cause instanceof ExplorerError) setError(cause.code);
    else setError("api_unreachable");
  }, []);

  // A new configuration, or a draft from outside: build its load and simulate it.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      setBusy(true);
      setProgress(0);
      try {
        const next =
          source.kind === "config" ? await fetchConfigLoad(source.config, signal) : await fetchDraftLoad(source.draft, signal);
        if (signal.aborted) return;
        setLoaded(next);
        setBase(next.load.draft);
        setDraft(next.load.draft);
        await simulate(next, signal);
      } catch (cause) {
        if (!signal.aborted) fail(cause);
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [source, simulate, fail]);

  // An edit of the draft: once the visitor pauses, build and simulate it. Only a new draft
  // starts (or cancels) this; the load it produces must not cancel its own run.
  const latest = useRef({ loaded, base, source });
  useEffect(() => {
    latest.current = { loaded, base, source };
  });
  const pending = Boolean(draft && loaded && !same(draft, loaded.load.draft));
  useEffect(() => {
    const { loaded: current, base: original, source: from } = latest.current;
    if (!draft || !current || same(draft, current.load.draft)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      (async () => {
        setBusy(true);
        setProgress(0);
        try {
          // Back to the configuration's own load: the cache may have it, no request needed.
          const built =
            original && same(draft, original) && from.kind === "config"
              ? await fetchConfigLoad(from.config, signal)
              : await fetchDraftLoad(draft, signal);
          if (signal.aborted) return;
          // The server answers with the draft it read, every default written out (a new unit's
          // `on: null`, `label: ""`): keep the one sent, so the edit counts as built.
          const next = { ...built, load: { ...built.load, draft } };
          setLoaded(next);
          await simulate(next, signal);
        } catch (cause) {
          if (!signal.aborted) fail(cause);
        } finally {
          if (!signal.aborted) setBusy(false);
        }
      })();
    }, EDIT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, simulate, fail]);

  // Keep the address shareable without a navigation.
  useEffect(() => {
    if (!draft) return;
    let address: string;
    if (source.kind === "config" && base) {
      const edited = editsToConfig(source.config, base, draft);
      address = edited ? `?${toQuery(edited)}` : `?${toQuery(source.config)}${explorerDraftHash(draft)}`;
    } else {
      address = `${window.location.search}${explorerDraftHash(draft)}`;
    }
    address = withCountry(address, country);
    if (address !== `${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", address);
    }
  }, [draft, base, source, country]);

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const chooseValue = useCallback(
    <K extends Dimension | "speed_kmh" | "count" | "mass_kg" | "body_code">(dimension: K, value: ExplorerConfig[K]) => {
      setSource((current) => {
        // A draft from outside, or a load edited beyond what the configuration can say (units
        // added, a weight, the planner's fix), keeps its units: the truck, the trip and the
        // securing change on the edited draft.
        const beyond = current.kind === "config" && base && draft && !editsToConfig(current.config, base, draft);
        const outside = draft ?? (current.kind === "draft" ? current.draft : null);
        if ((current.kind === "draft" || beyond) && outside) {
          const trip = ["speed_kmh", "road", "weather", "event"].includes(dimension);
          if (trip) return { kind: "draft", draft: { ...outside, trip: { ...outside.trip, [dimension]: value } } };
          if (dimension === "body" || dimension === "size" || dimension === "body_code") {
            return { kind: "draft", draft: { ...outside, truck: { ...outside.truck, [dimension]: value } } };
          }
          if (dimension === "restraint") return { kind: "draft", draft: { ...outside, restraint: value as LoadDraft["restraint"] } };
        }
        const config = current.kind === "config" ? current.config : fromSearch("");
        // Choices that keep the layout (the trip, the securing, the mass) keep the editor's
        // edits too: they are written into the configuration before the choice applies.
        const keepsLayout = !["body", "size", "cargo", "position", "count"].includes(dimension);
        const from =
          keepsLayout && current.kind === "config" && base && draft ? (editsToConfig(config, base, draft) ?? config) : config;
        const kept =
          dimension === "speed_kmh" || dimension === "count" || dimension === "mass_kg" || dimension === "body_code"
            ? { ...from, [dimension]: value, ...(dimension === "count" ? { moves: [], straps: null } : {}) }
            : choose(from, dimension as Dimension, value as ExplorerConfig[Dimension]);
        return { kind: "config", config: kept };
      });
    },
    [base, draft],
  );

  const resetEdits = useCallback(() => {
    if (base) setDraft(base);
  }, [base]);

  const edited = useMemo(() => Boolean(draft && base && !same(draft, base)), [draft, base]);
  // The selectors show the load as it is: a draft's truck, trip and securing (a photo's load, or
  // the planner's fix) over the configuration's.
  const shownConfig = useMemo<ExplorerConfig>(
    () =>
      draft
        ? {
            ...config,
            body: draft.truck.body,
            size: draft.truck.size,
            body_code: draft.truck.body_code ?? config.body_code,
            restraint: draft.restraint,
            speed_kmh: draft.trip.speed_kmh,
            road: draft.trip.road,
            weather: draft.trip.weather,
            event: draft.trip.event,
          }
        : config,
    [config, draft],
  );

  return {
    config: shownConfig,
    origin: source.kind,
    load: loaded?.load ?? null,
    draft,
    run,
    busy: busy || pending,
    progress,
    error,
    fallback,
    engine,
    choose: chooseValue,
    country,
    setCountry,
    edit: setDraft,
    resetEdits,
    edited,
  };
}
