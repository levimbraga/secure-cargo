import { describe, expect, it } from "vitest";

import { API_URL, ApiError, fetchHealth, parseHealth } from "./api";

const VALID = { status: "ok", version: "0.1.0", mujoco_version: "4.0.1" };

function stubFetch(response: Response | Error): typeof fetch {
  return async () => {
    if (response instanceof Error) throw response;
    return response;
  };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).code;
}

describe("parseHealth", () => {
  it("maps the API payload to the client shape", () => {
    expect(parseHealth(VALID)).toEqual({
      status: "ok",
      version: "0.1.0",
      mujocoVersion: "4.0.1",
    });
  });

  it.each([
    null,
    "ok",
    {},
    { ...VALID, status: "degraded" },
    { ...VALID, version: 1 },
    { status: "ok", version: "0.1.0" },
  ])("rejects an unexpected payload: %j", (payload) => {
    expect(() => parseHealth(payload)).toThrowError(ApiError);
  });
});

describe("fetchHealth", () => {
  it("requests /health on the configured API and parses the answer", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return Response.json(VALID);
    };

    const health = await fetchHealth(undefined, fetchImpl);

    expect(calls).toEqual([`${API_URL}/health`]);
    expect(health.mujocoVersion).toBe("4.0.1");
  });

  it("reports a network failure as unreachable", async () => {
    const failing = stubFetch(new TypeError("fetch failed"));
    expect(await errorCodeOf(fetchHealth(undefined, failing))).toBe(
      "unreachable",
    );
  });

  it("reports a non-2xx answer as bad_status", async () => {
    const failing = stubFetch(new Response("boom", { status: 503 }));
    expect(await errorCodeOf(fetchHealth(undefined, failing))).toBe(
      "bad_status",
    );
  });

  it("reports invalid JSON as bad_payload", async () => {
    const failing = stubFetch(new Response("<html>", { status: 200 }));
    expect(await errorCodeOf(fetchHealth(undefined, failing))).toBe(
      "bad_payload",
    );
  });
});
