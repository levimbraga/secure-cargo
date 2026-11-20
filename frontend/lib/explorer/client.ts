/**
 * Where the explorer gets a load: the static cache of the site first (every gallery version and
 * the default configuration work with the API down), then the API.
 */

import { API_URL } from "@/lib/api";
import { parseKeyframes } from "@/lib/keyframes";
import { parseLiveModel } from "@/lib/live/model";
import type { ServerResult } from "@/lib/live/runner";

import { type ExplorerConfig, toQuery } from "./config";
import type { ExplorerLoad, LoadDraft } from "./draft";

const TIMEOUT_MS = 20_000; // generous: the API container may be cold-starting

/** A load the server refused, with the stable code the page translates (`Explorer.errors.*`). */
export class ExplorerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExplorerError";
  }
}

export type LoadedExplorer = {
  load: ExplorerLoad;
  /** The server's run of the load when the site ships it; else the API simulates on demand. */
  serverRun: (() => Promise<ServerResult>) | null;
};

type StaticIndex = { queries: Record<string, { file: string; live: string; run?: string }> };
let staticIndex: Promise<StaticIndex | null> | null = null;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new ExplorerError("api_unreachable");
  }
  if (response.status === 422) {
    const body = (await response.json().catch(() => null)) as { detail?: { code?: unknown } } | null;
    const code = body?.detail?.code;
    throw new ExplorerError(typeof code === "string" ? code : "invalid_load");
  }
  if (!response.ok) throw new ExplorerError("api_unreachable");
  return response.json();
}

function loadIndex(): Promise<StaticIndex | null> {
  staticIndex ??= getJson("/demo/explorer/index.json").then(
    (value) => value as StaticIndex,
    () => {
      staticIndex = null;
      return null;
    },
  );
  return staticIndex;
}

function asLoad(value: unknown): ExplorerLoad {
  const load = value as ExplorerLoad;
  return { ...load, live: parseLiveModel(load.live) };
}

/** The load of a configuration, from the site's cache when it is there. */
export async function fetchConfigLoad(config: ExplorerConfig, signal?: AbortSignal): Promise<LoadedExplorer> {
  const query = toQuery(config);
  const entry = (await loadIndex())?.queries[query];
  if (entry) {
    const [load, live] = await Promise.all([getJson(`/demo/${entry.file}`, { signal }), getJson(`/demo/${entry.live}`, { signal })]);
    const run = entry.run;
    return {
      load: asLoad({ ...(load as object), live }),
      serverRun: run
        ? async () => {
            const stored = (await getJson(`/demo/${run}`)) as { result: ServerResult };
            return { ...stored.result, keyframes: parseKeyframes(stored.result.keyframes) };
          }
        : null,
    };
  }
  return { load: asLoad(await getJson(`${API_URL}/explorer?${query}`, { signal })), serverRun: null };
}

/** The scenario and live model of an edited (or imported) draft. */
export async function fetchDraftLoad(draft: LoadDraft, signal?: AbortSignal): Promise<LoadedExplorer> {
  const body = await getJson(`${API_URL}/explorer/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
    signal,
  });
  return { load: asLoad(body), serverRun: null };
}
