/**
 * Sign-in is on when the Clerk keys are configured. Without them (CI, or a misconfigured
 * deploy) the site still works: landing, gallery, explorer and lab never depend on sign-in,
 * and the app pages show that sign-in is unavailable instead of failing.
 */
export const AUTH_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
