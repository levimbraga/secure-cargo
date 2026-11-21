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
import type { PhotoStore, Physics, SamplePhoto } from "./flow";
import { createClerkIdentity } from "./identity";
import { analyzePhotos, DEFAULT_MODEL } from "./perception/claude";
import samples from "./perception/samples.json";
import { parseEmailList } from "./principal";

export { ApiContainer } from "./container";

let cached: { key: string; app: ReturnType<typeof createApp> } | undefined;

function application(env: Env): ReturnType<typeof createApp> {
	// Build once per isolate; the key changes only if the configuration does.
	const model = env.ANALYSIS_MODEL || DEFAULT_MODEL;
	const key = `${env.CLERK_PUBLISHABLE_KEY}|${env.CORS_ORIGINS}|${env.PLATFORM_ADMIN_EMAILS}|${model}|${Boolean(env.ANTHROPIC_API_KEY)}|${env.VERSION.id}`;
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
		photos: r2PhotoStore(env.PHOTOS),
		physics: containerPhysics(env),
		analyzer: env.ANTHROPIC_API_KEY
			? { model, analyze: (photos) => analyzePhotos(env.ANTHROPIC_API_KEY as string, photos, model) }
			: null,
		samples: samples as Record<string, SamplePhoto>,
	});
	cached = { key, app };
	return app;
}

/** Physics endpoints that run a simulation or build a model: limited per IP for anonymous callers. */
const LIMITED_PHYSICS = new Set(["/simulate", "/mjcf", "/explorer/draft", "/perception/draft"]);
/** The battery (7 simulations) and the planner (up to 30): a tighter limit per IP. */
const LIMITED_BATTERY = new Set(["/battery", "/plan"]);

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (isAppRoute(url.pathname)) {
			return application(env).fetch(request, env, ctx);
		}
		if (request.method === "POST" && (LIMITED_PHYSICS.has(url.pathname) || LIMITED_BATTERY.has(url.pathname))) {
			const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
			const limiter = LIMITED_BATTERY.has(url.pathname) ? env.BATTERY_RATE_LIMITER : env.PHYSICS_RATE_LIMITER;
			const { success } = await limiter.limit({ key: `physics:${ip}` });
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

function r2PhotoStore(bucket: R2Bucket): PhotoStore {
	return {
		async put(key, bytes, contentType) {
			await bucket.put(key, bytes, { httpMetadata: { contentType } });
		},
		async get(key) {
			const object = await bucket.get(key);
			if (!object) return null;
			return {
				bytes: new Uint8Array(await object.arrayBuffer()),
				contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
			};
		},
	};
}

/** The Worker's own calls to the physics container (battery, planner). */
function containerPhysics(env: Env): Physics {
	return (path, body) =>
		env.API_CONTAINER.getByName(`api-${env.VERSION.id}`).fetch(
			new Request(`https://api.internal${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get("Origin") ?? "";
	const allowed = env.CORS_ORIGINS.split(",").map((o) => o.trim());
	return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}
