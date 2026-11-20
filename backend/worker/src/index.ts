/**
 * Worker in front of api.securecargo.app.
 *
 * - The application API (auth, organizations, inspections, quotas, admin) runs here, next to
 *   D1 and R2 (`app.ts`), so lists and dashboards never wake the container.
 * - Everything else (physics: /health, /simulate, /mjcf, /scenarios, /explorer) goes to the
 *   FastAPI container. Anonymous POSTs to it are rate-limited by IP.
 *
 * The container instance name includes the Worker version. A deploy does not restart a Durable
 * Object whose container is still running, so without this the previous code, image and
 * environment would keep serving until the container went idle. With it, each deploy gets a
 * fresh instance and the previous one stops by itself after the inactivity timeout.
 */
import { createApp, isAppRoute } from "./app";
import { createClerkIdentity } from "./identity";
import { parseEmailList } from "./principal";

export { ApiContainer } from "./container";

let cached: { key: string; app: ReturnType<typeof createApp> } | undefined;

function application(env: Env): ReturnType<typeof createApp> {
	// Build once per isolate; the key changes only if the configuration does.
	const key = `${env.CLERK_PUBLISHABLE_KEY}|${env.CORS_ORIGINS}|${env.PLATFORM_ADMIN_EMAILS}`;
	if (cached?.key === key) return cached.app;
	const corsOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
	const app = createApp({
		db: env.DB,
		identity: createClerkIdentity({
			secretKey: env.CLERK_SECRET_KEY,
			publishableKey: env.CLERK_PUBLISHABLE_KEY,
			authorizedParties: corsOrigins,
		}),
		platformAdminEmails: parseEmailList(env.PLATFORM_ADMIN_EMAILS),
		corsOrigins,
		siteUrl: env.SITE_URL,
		limitAnonymous: async (k) => (await env.ANON_RATE_LIMITER.limit({ key: k })).success,
	});
	cached = { key, app };
	return app;
}

/** Physics endpoints that run a simulation or build a model: limited per IP for anonymous callers. */
const LIMITED_PHYSICS = new Set(["/simulate", "/mjcf", "/explorer/draft"]);

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (isAppRoute(url.pathname)) {
			return application(env).fetch(request, env, ctx);
		}
		if (request.method === "POST" && LIMITED_PHYSICS.has(url.pathname)) {
			const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
			const { success } = await env.PHYSICS_RATE_LIMITER.limit({ key: `physics:${ip}` });
			if (!success) {
				return Response.json(
					{ detail: { code: "rate_limited", message: "Too many simulations. Wait a minute and try again." } },
					{ status: 429, headers: corsHeaders(request, env) },
				);
			}
		}
		try {
			return await env.API_CONTAINER.getByName(`api-${env.VERSION.id}`).fetch(request);
		} catch (error) {
			console.error("Could not reach the API container:", error);
			return Response.json(
				{ code: "api_unavailable", message: "The API is starting or unavailable. Try again." },
				{ status: 503, headers: { "Retry-After": "5", ...corsHeaders(request, env) } },
			);
		}
	},
} satisfies ExportedHandler<Env>;

function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get("Origin") ?? "";
	const allowed = env.CORS_ORIGINS.split(",").map((o) => o.trim());
	return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}
