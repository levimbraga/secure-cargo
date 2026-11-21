/**
 * Calls of the inspection flow.
 *
 * Public physics endpoints (no login, rate-limited per IP): `/perception/draft`, `/battery`,
 * `/plan`, `/simulate`. They serve the sample photos for visitors who are not signed in.
 * Signed in, the Worker runs everything itself and saves it (`/inspections/:id/...`).
 */

import { API_URL } from "@/lib/api";
import { AppApiError, readError } from "@/lib/app-api";
import type { LoadDraft } from "@/lib/explorer/draft";
import type { Scenario, TripEventInput } from "@/lib/live/scenario";

import type { Battery, PerceptionDraft, PhotoAnalysis, Plan, ServerRunResult } from "./types";

/** The battery runs seven simulations and the planner up to thirty: be patient with them. */
const LONG_MS = 150_000;
const SHORT_MS = 25_000;

async function postJson<T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new AppApiError(0, "api_unavailable", "The API did not answer.");
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export function perceptionDraft(
  analysis: PhotoAnalysis,
  truck: LoadDraft["truck"],
  weight: { total_kg?: number; per_unit_kg?: Record<number, number> } | null,
  signal?: AbortSignal,
): Promise<PerceptionDraft> {
  return postJson("/perception/draft", { analysis, truck, weight }, SHORT_MS, signal);
}

export function runBattery(draft: LoadDraft, signal?: AbortSignal): Promise<Battery> {
  return postJson("/battery", { draft }, LONG_MS, signal);
}

export function runPlan(draft: LoadDraft, signal?: AbortSignal): Promise<Plan> {
  return postJson("/plan", { draft }, LONG_MS, signal);
}

/** One situation's run with keyframes (cached on the server by input hash). */
export async function simulateSituation(
  scenario: Scenario,
  event: TripEventInput,
  signal?: AbortSignal,
): Promise<ServerRunResult> {
  const body = await postJson<{ result: ServerRunResult }>("/simulate", { scenario, event }, SHORT_MS * 2, signal);
  return body.result;
}

/** The Worker's flow calls, with the session token. */
export function flowCalls(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  const post = <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    create: (body: { title?: string; sample?: string; notes?: string; reinspection_of?: string }) => post<{ id: string }>("/inspections", body),
    upload: async (getToken: () => Promise<string | null>, id: string, photo: Blob, position: string) => {
      const token = await getToken();
      const response = await fetch(`${API_URL}/inspections/${encodeURIComponent(id)}/photos?position=${position}`, {
        method: "POST",
        headers: { "Content-Type": photo.type || "image/jpeg", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: photo,
      });
      if (!response.ok) throw await readError(response);
      return (await response.json()) as { id: string; sha256: string };
    },
    analyze: (id: string) => post<import("./types").AnalysisAnswer>(`/inspections/${encodeURIComponent(id)}/analyze`),
    saveDraft: (
      id: string,
      body: {
        draft: LoadDraft;
        cargo_weight_kg: number;
        notes?: string;
        title?: string;
        weight_source?: "measured" | "invoice" | "estimated";
        weight_range?: { low_kg: number; high_kg: number } | null;
        truck_id?: string;
      },
    ) =>
      request<{ scenario_id: string }>(`/inspections/${encodeURIComponent(id)}/draft`, { method: "PUT", body: JSON.stringify(body) }),
    simulate: (id: string) => post<Battery>(`/inspections/${encodeURIComponent(id)}/simulate`),
    fix: (id: string) => post<Plan>(`/inspections/${encodeURIComponent(id)}/fix`),
    battery: (id: string, kind: "as_loaded" | "fixed") => request<Battery>(`/inspections/${encodeURIComponent(id)}/battery/${kind}`),
  };
}
