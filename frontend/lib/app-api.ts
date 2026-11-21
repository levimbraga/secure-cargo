/**
 * Client for the application API (served by the Worker): who am I, inspections, organization
 * and platform admin. Every request carries the Clerk session token; the API enforces every
 * authorization rule, so the UI only hides what a role cannot use.
 */
"use client";

import { useCallback } from "react";

import { useMe } from "@/components/app/me-provider";
import { API_URL } from "@/lib/api";

export type OrgRole = "member" | "org_admin";
export type Verdict = "pass" | "warning" | "fail";

export interface AnalysisAllowance {
  allowed: boolean;
  reason: "blocked" | "kill_switch" | "budget_cap" | "quota_exceeded" | null;
  mode: "live" | "demo";
  usedToday: number;
  dailyQuota: number;
  sharedPool: boolean;
  monthSpendUsd: number;
  monthlyCapUsd: number;
}

export interface Me {
  user: { id: string; email: string | null; name: string | null; is_demo: boolean };
  org: { id: string; name: string; type: "insurer" | "carrier"; role: OrgRole; is_demo: boolean } | null;
  is_platform_admin: boolean;
  blocked: boolean;
  analysis: AnalysisAllowance;
}

export interface InspectionSummary {
  id: string;
  org_id: string | null;
  author_id: string;
  author_name: string | null;
  org_name: string | null;
  created_at: string;
  updated_at: string;
  status: "draft" | "analyzed" | "confirmed" | "simulated";
  title: string;
  truck_body: string | null;
  truck_size: string | null;
  cargo_weight_kg: number | null;
  notes: string;
  plate: string | null;
  situations_passed: number | null;
  situations_total: number | null;
  verdict: Verdict | null;
  fixed_verdict: Verdict | null;
  cover_photo: string | null;
}

export interface InspectionDetail extends InspectionSummary {
  photos: { id: string; position: string; r2_key: string; created_at: string }[];
  scenarios: { id: string; kind: "as_loaded" | "fixed"; draft: unknown; created_at: string }[];
  results: {
    id: string;
    scenario_id: string;
    situation: string;
    verdict: Verdict;
    metrics: { gallery?: string; variant?: "as_loaded" | "fixed" };
    keyframes_ref: string | null;
  }[];
  fixes: {
    id: string;
    from_scenario_id: string;
    to_scenario_id: string;
    passes: boolean;
    changes: { unit?: string; field: string; from: unknown; to: unknown }[];
  }[];
}

export interface OrgView {
  org: { id: string; name: string; type: "insurer" | "carrier"; is_demo: number };
  members: {
    userId: string;
    name: string | null;
    email: string | null;
    role: OrgRole;
    joinedAt: string;
    inspections: number;
    last_inspection_at: string | null;
  }[];
  invitations: { id: string; email: string; role: OrgRole; status: string; createdAt: string }[];
}

export interface AdminOverview {
  month_start: string;
  month_spend_usd: number;
  settings: {
    kill_switch: boolean;
    monthly_cap_usd: number;
    default_daily_quota: number;
    demo_shared_daily_quota: number;
  };
  totals: {
    users: number;
    organizations: number;
    inspections: number;
    analyses_month: number;
    cached_month: number;
    analyses_today: number;
  };
  daily: { date: string; cost_usd: number; calls: number }[];
  organizations: {
    id: string;
    name: string;
    type: string;
    is_demo: number;
    daily_analysis_quota: number | null;
    members: number;
    inspections: number;
    month_cost_usd: number;
  }[];
}

export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  is_demo: number;
  blocked: number;
  daily_analysis_quota: number | null;
  last_seen_at: string | null;
  organizations: string | null;
  inspections: number;
  analyses_today: number;
  analyses_month: number;
  month_cost_usd: number;
}

export class AppApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppApiError";
  }
}

export async function readError(response: Response): Promise<AppApiError> {
  let code = "failed";
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { detail?: { code?: string; message?: string } };
    code = body.detail?.code ?? code;
    message = body.detail?.message ?? message;
  } catch {
    // not JSON
  }
  return new AppApiError(response.status, code, message);
}

/** A request with the session token attached; throws `AppApiError` on non-2xx. */
export async function requestWithToken<T>(
  getToken: () => Promise<string | null>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

/** `request(path, init)` with the signed-in user's session token. */
export function useAppApi() {
  const { getToken } = useMe();
  return useCallback(<T,>(path: string, init: RequestInit = {}) => requestWithToken<T>(getToken, path, init), [getToken]);
}

/** A photo reference stored with an inspection: a public sample (`sample:/media/…`) or a private key. */
export function photoUrl(r2Key: string | null): string | null {
  if (!r2Key) return null;
  if (r2Key.startsWith("sample:")) return r2Key.slice("sample:".length);
  // Private photos need the session token: the inspection flow (Phase 6) fetches them as blobs.
  return null;
}
