/**
 * The FastAPI + MuJoCo container: a stateless physics engine reached only through the Worker.
 *
 * Every physics request is routed to one named container instance, which is started on demand
 * and stopped after a period without traffic (scale to zero).
 */
import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const READINESS_POLL_MS = 200;
const READINESS_TIMEOUT_MS = 60_000;

export class ApiContainer extends DurableObject<Env> {
	private starting: Promise<void> | undefined;
	private monitoring: Promise<void> | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const container = ctx.container;
		if (container?.running) {
			// The Durable Object restarted (for example after a deploy) while its container kept
			// running: the inactivity timeout and the exit monitor have to be set up again.
			void ctx.blockConcurrencyWhile(() =>
				container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
			);
			this.observeExit(container);
		}
	}

	async fetch(request: Request): Promise<Response> {
		const container = this.ctx.container;
		if (!container) {
			throw new Error("No container is configured for ApiContainer");
		}

		// Concurrent requests during a cold start share one startup attempt.
		this.starting ??= this.startAndWaitUntilReady(container).finally(() => {
			this.starting = undefined;
		});
		await this.starting;

		const url = new URL(request.url);
		url.protocol = "http:";
		url.host = "container";
		const forwarded = new Request(url, request);
		forwarded.headers.delete("host");
		return container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
	}

	private async startAndWaitUntilReady(container: Container): Promise<void> {
		if (!container.running) {
			container.start({
				image: container.images.api,
				// 1/4 vCPU and 1 GiB: enough to import MuJoCo and serve the API.
				instance: "basic",
				// The API makes no outbound calls yet.
				enableInternet: false,
				env: {
					SECURECARGO_CORS_ORIGINS: this.env.CORS_ORIGINS,
				},
			});
		}
		this.observeExit(container);
		await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

		// `running` only means that startup was requested; wait for the HTTP server itself.
		const port = container.getTcpPort(CONTAINER_PORT);
		const deadline = Date.now() + READINESS_TIMEOUT_MS;
		while (Date.now() < deadline) {
			try {
				const response = await port.fetch("http://container/health", {
					signal: AbortSignal.timeout(1000),
				});
				await response.body?.cancel();
				if (response.ok) return;
			} catch {
				// The port is not listening yet.
			}
			await scheduler.wait(READINESS_POLL_MS);
		}
		throw new Error(`Container was not ready on port ${CONTAINER_PORT} in time`);
	}

	private observeExit(container: Container): void {
		if (this.monitoring) return;
		this.monitoring = container
			.monitor()
			.then(() => console.log("API container exited"))
			.catch((error: unknown) => console.error("API container failed:", error))
			.finally(() => {
				this.monitoring = undefined;
			});
		this.ctx.waitUntil(this.monitoring);
	}
}
