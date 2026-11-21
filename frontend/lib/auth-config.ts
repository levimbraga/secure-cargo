/**
 * Sign-in is on when the Clerk keys are configured. Without them (CI and local builds only:
 * a production build without the keys fails, see `auth-env.mjs`) the site still works: landing,
 * gallery, explorer and lab never depend on sign-in, and the app pages say sign-in is unavailable.
 */
export const AUTH_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
