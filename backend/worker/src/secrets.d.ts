// Secrets are not in wrangler.jsonc, so `wrangler types` only sees them when a local .dev.vars
// exists. Declaring them here keeps CI type-checks honest without any secret in the repo.
interface Env {
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	PLATFORM_ADMIN_EMAILS: string;
	/** Signs the demo sessions (HMAC-SHA256); without it the demo buttons answer 503. */
	DEMO_SESSION_SECRET?: string;
	/** Photo analysis; without it the analysis answers "demo mode" (sample photos still work). */
	ANTHROPIC_API_KEY?: string;
	/** Optional override of the analysis model (default in src/perception/claude.ts). */
	ANALYSIS_MODEL?: string;
}
