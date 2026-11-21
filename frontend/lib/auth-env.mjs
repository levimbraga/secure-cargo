/**
 * Sign-in may be off only where nobody signs in: CI and local builds. A Vercel production
 * build (or any build that sets SECURECARGO_REQUIRE_AUTH=1) without both Clerk keys stops here,
 * so the live site can never run with sign-in silently off.
 *
 * Plain JavaScript: `next.config.ts` imports it before anything is compiled.
 */

/** The Clerk variables a signed-in site needs; returns the names that are missing. */
export function missingAuthKeys(env) {
  return ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"].filter((name) => !env[name]?.trim());
}

/** True for builds that must have sign-in: Vercel production, or an explicit opt-in. */
export function authRequired(env) {
  return env.VERCEL_ENV === "production" || env.SECURECARGO_REQUIRE_AUTH === "1";
}

/** Throws when this build must have sign-in and a key is missing. */
export function assertAuthConfigured(env) {
  if (!authRequired(env)) return;
  const missing = missingAuthKeys(env);
  if (missing.length > 0) {
    throw new Error(
      `Sign-in is required in production, but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
        "Add the Clerk keys to the Vercel project (Production) and redeploy.",
    );
  }
}
