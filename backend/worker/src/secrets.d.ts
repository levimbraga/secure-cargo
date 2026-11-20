// Secrets are not in wrangler.jsonc, so `wrangler types` only sees them when a local .dev.vars
// exists. Declaring them here keeps CI type-checks honest without any secret in the repo.
interface Env {
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	PLATFORM_ADMIN_EMAILS: string;
}
