import { API_URL } from "@/lib/api";
import { type Me, readError } from "@/lib/app-api";
import { writeSessionHint } from "@/lib/session-hint";

export type DemoRole = "driver" | "insurer";

/** Where each demo role starts: the driver on a new inspection's photo step, the insurer on the overview. */
export const DEMO_START: Record<DemoRole, string> = { driver: "/app/new?start=photos", insurer: "/app/org" };

/**
 * Start (or switch) the demo session: the Worker sets its httpOnly cookie and answers with the same
 * body as `/me`. An existing demo session keeps its sandbox, so switching roles keeps the data.
 */
export async function startDemoSession(role: DemoRole): Promise<Me> {
  const response = await fetch(`${API_URL}/demo/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ as: role }),
    credentials: "include",
  });
  if (!response.ok) throw await readError(response);
  const { me } = (await response.json()) as { me: Me };
  writeSessionHint(true);
  return me;
}

export async function endDemoSession(): Promise<void> {
  await fetch(`${API_URL}/demo/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
  writeSessionHint(false);
}

/** The demo role of a demo visitor's `/me`. */
export function demoRoleOf(me: Me): DemoRole {
  return me.org?.role === "org_admin" ? "insurer" : "driver";
}

/** The sign-in page's error query for a failed demo start (the page shows the reason). */
export function demoErrorCode(cause: unknown): "rate_limited" | "demo_unavailable" | "failed" {
  const code = (cause as { code?: string } | null)?.code;
  return code === "rate_limited" || code === "demo_unavailable" ? code : "failed";
}
