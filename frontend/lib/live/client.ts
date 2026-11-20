/** Where the live lab gets its inputs: the static demo files first, the API for anything changed. */

import { API_URL } from "@/lib/api";
import { type DemoId, type DemoRun, demoFile, type RunSummary, type Variant } from "@/lib/demo";
import { type KeyframesDoc, parseKeyframes } from "@/lib/keyframes";

import { type LiveModel, parseLiveModel } from "./model";
import type { Scenario, TripEventInput } from "./scenario";

const TIMEOUT_MS = 20_000; // generous: the API container may be cold-starting

export type BaseRun = {
  scenario: Scenario;
  event: TripEventInput;
  /** The server's own run of the scenario as authored. */
  server: RunSummary & { keyframes: KeyframesDoc };
};

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The scenario as authored, its event and the server's result, from the static demo file. */
export async function fetchBaseRun(id: DemoId, variant: Variant, signal?: AbortSignal): Promise<BaseRun> {
  const run = (await getJson(demoFile(id, variant), signal)) as DemoRun & { scenario: Scenario };
  return {
    scenario: run.scenario,
    event: run.event as TripEventInput,
    server: { ...run.result, keyframes: parseKeyframes(run.result.keyframes) },
  };
}

/** The live model of a demo run as authored, from the static files (no API needed). */
export async function fetchStaticLiveModel(id: DemoId, variant: Variant, signal?: AbortSignal): Promise<LiveModel> {
  return parseLiveModel(await getJson(`/demo/live/${id}.${variant}.json`, signal));
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

const liveModels = new Map<string, LiveModel>();
const MAX_CACHED = 24;

/** The MJCF and run plan of a changed scenario, from the API; answers are kept for the session. */
export async function fetchLiveModel(
  scenario: Scenario,
  event: TripEventInput,
  signal?: AbortSignal,
): Promise<LiveModel> {
  const key = JSON.stringify([scenario, event]);
  const cached = liveModels.get(key);
  if (cached) return cached;
  const live = parseLiveModel(await post("/mjcf", { scenario, event }, signal));
  if (liveModels.size >= MAX_CACHED) {
    const oldest = liveModels.keys().next().value;
    if (oldest !== undefined) liveModels.delete(oldest);
  }
  liveModels.set(key, live);
  return live;
}

/** The server's simulation of a scenario: the fallback when the browser cannot step the model. */
export async function simulateOnServer(
  scenario: Scenario,
  event: TripEventInput,
  signal?: AbortSignal,
): Promise<RunSummary & { keyframes: KeyframesDoc }> {
  const body = (await post("/simulate", { scenario, event }, signal)) as {
    result: RunSummary & { keyframes: KeyframesDoc };
  };
  return { ...body.result, keyframes: parseKeyframes(body.result.keyframes) };
}
