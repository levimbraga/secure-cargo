/**
 * Client for the application API (served by the Worker): who am I, inspections, organization
 * and platform admin. Every request carries the Clerk session token; the API enforces every
 * authorization rule, so the UI only hides what a role cannot use.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

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
  org: {
    id: string;
    name: string;
    type: "insurer" | "carrier";
    role: OrgRole;
    is_demo: boolean;
    policies?: OrgPolicies;
    /** Open alerts (managers only; null for members). */
    alerts?: number | null;
  } | null;
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
  cover_photo_id: string | null;
  /** The truck as confirmed (size, body style, measurements), JSON. */
  truck_json?: string | null;
  weight_source?: "measured" | "invoice" | "estimated" | null;
  weight_range_json?: string | null;
  invoice_json?: string | null;
  /** The inspection this one re-checks ("I fixed it: take a new photo"). */
  reinspection_of?: string | null;
  /** The re-inspection that proved the fix, if any: the inspection is "fixed and proven". */
  proven_by?: string | null;
  share_token?: string | null;
}

export interface InspectionDetail extends InspectionSummary {
  reinspections?: { id: string; created_at: string; verdict: Verdict | null; situations_passed: number | null; situations_total: number | null }[];
  photos: { id: string; position: string; r2_key: string; created_at: string }[];
  scenarios: { id: string; kind: "as_loaded" | "fixed"; draft: unknown; battery_ref: string | null; created_at: string }[];
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
    /** The planner's changes (`code`), or the seeded gallery fixes (`field`). */
    changes: ({ unit?: string; field: string; from: unknown; to: unknown } | import("@/lib/inspection/types").Change)[];
  }[];
}

export interface OrgPolicies {
  require_two_photos: boolean;
  certificate_requires_compliance: boolean;
  alert_after_hours: number;
}

export type FailureCode = string;

export interface OrgOverview {
  days: number;
  period: { from: string; to: string };
  policies: OrgPolicies;
  totals: {
    inspections: number;
    simulated: number;
    approved: number;
    holds_noncompliant: number;
    fails: number;
    needs_fix: number;
    fixed_and_proven: number;
    fixed_and_proven_rate: number | null;
    failed_no_proven_fix: number;
    reinspections: number;
    alerts: number;
  };
  failures: { code: FailureCode; inspections: number; share: number }[];
  drivers: { user_id: string; name: string | null; inspections: number; needs_fix: number; failure_rate: number | null; fixes_proven: number; open: number }[];
  weeks: { week: string; approved: number; holds_noncompliant: number; fails: number; pending: number }[];
}

export interface OrgAlert {
  id: string;
  title: string;
  author_id: string;
  author_name: string | null;
  created_at: string;
  verdict: Verdict;
  fixed_verdict: Verdict | null;
  truck_json: string | null;
  truck_size: string | null;
  truck_body: string | null;
  failure_codes: FailureCode[];
  hours_open: number;
}

export interface InspectionPage {
  inspections: (InspectionSummary & { failure_codes?: string | null; cargo_types?: string | null })[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditEvent {
  id: string;
  at: string;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  detail: Record<string, unknown>;
}

export type DraftEdit = { code: string; unit?: string; cargo?: string; field?: string; from?: unknown; to?: unknown; distance_m?: number };

export interface Audit {
  events: AuditEvent[];
  reading: { model: string | null; rows: { field: string; ai: unknown; driver: unknown; changed: boolean }[] } | null;
  edits: DraftEdit[] | null;
}

export type CertificateState = "approved" | "fixed_and_proven" | "holds_noncompliant";

export interface CertificateContent {
  certificate_id: string;
  issued_at: string;
  state: CertificateState;
  inspection_id: string;
  inspected_at: string;
  proof_inspection_id: string | null;
  proven_at: string | null;
  organization: { id: string; name: string | null; type: string | null } | null;
  truck: { size: string | null; style: string | null; body: string | null; bed_length_m: number | null; headboard_height_m: number | null };
  cargo: { weight_kg: number | null; weight_source: string | null; types: string[]; units: number };
  photo: { sha256: string; position: string } | null;
  results: { passed: number; total: number; situations: { id: string; status: string }[] };
  checks: { code: string; article: string | null; status: string }[];
  axle_loads: { group: string | null; load_kg: number; limit_kg: number }[];
  fix: string[] | null;
  disclaimer: string;
}

export interface Certificate {
  id: string;
  inspection_id: string;
  issued_at: string;
  content_hash: string;
  revoked_at: string | null;
  issued_by_name: string | null;
  authentic: boolean;
  disclaimer: string;
  content: CertificateContent;
  photo: { inspection_id: string; photo_id: string; path: string | null } | null;
}

export interface CertificateStatus {
  certificate_id: string | null;
  eligibility: { ok: true; state: CertificateState } | { ok: false; code: "not_simulated" | "fails_no_proven_fix" | "out_of_compliance" };
}

export interface OrgView {
  policies?: OrgPolicies;
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
  // Private photos need the session token: `usePhotoSrc` fetches them as blobs.
  return null;
}

/**
 * The address to show a stored photo: a sample's public path, or the private photo fetched
 * with the session token (the bucket is private) as an object URL, freed on unmount.
 */
export function usePhotoSrc(inspectionId: string, photoId: string | null, r2Key: string | null): string | null {
  const { getToken } = useMe();
  const isPublic = photoUrl(r2Key);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isPublic || !photoId || !r2Key) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const response = await fetch(`${API_URL}/inspections/${encodeURIComponent(inspectionId)}/photos/${encodeURIComponent(photoId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok || cancelled) return;
      url = URL.createObjectURL(await response.blob());
      if (cancelled) URL.revokeObjectURL(url);
      else setBlobUrl(url);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inspectionId, photoId, r2Key, isPublic, getToken]);
  return isPublic ?? blobUrl;
}
