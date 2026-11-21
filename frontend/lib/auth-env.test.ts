import { describe, expect, it } from "vitest";

import { assertAuthConfigured, authRequired, missingAuthKeys } from "./auth-env.mjs";

const keys = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x", CLERK_SECRET_KEY: "sk_live_x" };

describe("sign-in configuration of a build", () => {
  it("lets CI and local builds run with sign-in off", () => {
    expect(() => assertAuthConfigured({})).not.toThrow();
    expect(() => assertAuthConfigured({ CI: "true" })).not.toThrow();
    expect(() => assertAuthConfigured({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  it("fails a Vercel production build without the Clerk keys", () => {
    expect(() => assertAuthConfigured({ VERCEL_ENV: "production" })).toThrow(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY/);
    expect(() => assertAuthConfigured({ VERCEL_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk" })).toThrow(/CLERK_SECRET_KEY is not set/);
    expect(() => assertAuthConfigured({ VERCEL_ENV: "production", ...keys, CLERK_SECRET_KEY: "  " })).toThrow();
  });

  it("passes a production build with both keys, and honours the explicit opt-in", () => {
    expect(() => assertAuthConfigured({ VERCEL_ENV: "production", ...keys })).not.toThrow();
    expect(authRequired({ SECURECARGO_REQUIRE_AUTH: "1" })).toBe(true);
    expect(missingAuthKeys(keys)).toEqual([]);
  });
});
