/** Client for the SecureCargo API. */

const DEFAULT_API_URL = "http://localhost:8000";
const HEALTH_TIMEOUT_MS = 15_000; // generous: the API container may be cold-starting

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL
).replace(/\/+$/, "");

export type Health = {
  status: "ok";
  version: string;
  mujocoVersion: string;
};

/** Stable error codes; the UI translates them (see `App.health.errors` in `messages/`). */
export type ApiErrorCode = "unreachable" | "bad_status" | "bad_payload";

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
  }
}

export function parseHealth(payload: unknown): Health {
  if (typeof payload === "object" && payload !== null) {
    const { status, version, mujoco_version } = payload as Record<
      string,
      unknown
    >;
    if (
      status === "ok" &&
      typeof version === "string" &&
      typeof mujoco_version === "string"
    ) {
      return { status, version, mujocoVersion: mujoco_version };
    }
  }
  throw new ApiError("bad_payload", "Unexpected /health payload");
}

export async function fetchHealth(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Health> {
  const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}/health`, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    throw new ApiError("unreachable", "Could not reach the API", { cause });
  }

  if (!response.ok) {
    throw new ApiError("bad_status", `API answered ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiError("bad_payload", "API answered with invalid JSON", {
      cause,
    });
  }
  return parseHealth(payload);
}

/**
 * Wakes the API up without waiting for the answer.
 *
 * The API container stops when idle, so its first request after a pause is slow. Calling this
 * from the landing page gets the container started before the visitor opens the app.
 * Fire-and-forget: it never throws and never rejects.
 */
export function warmUpApi(fetchImpl: typeof fetch = fetch): void {
  try {
    void fetchImpl(`${API_URL}/health`, {
      cache: "no-store",
      // Lets the request finish even if the visitor navigates away right after.
      keepalive: true,
    })
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  } catch {
    // Nothing to do: warming up is only an optimization.
  }
}
