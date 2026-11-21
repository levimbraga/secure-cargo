/**
 * The FastAPI + MuJoCo container: a stateless physics engine reached only through the Worker.
 * It has no public address, and it refuses requests without the token this object gives it
 * (`internal.ts`).
 *
 * Every physics request is routed to one named container instance, which is started on demand
 * and stopped after a period without traffic (scale to zero).
 */
import { DurableObject } from "cloudflare:workers";

import { INTERNAL_HEADER, newInternalToken, toContainerRequest } from "./internal";

const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
// The per-situation instances of the battery (`fanout.ts`) are kept for less time: memory is
// billed while an instance runs, and a battery wakes seven of them.
const SITUATION_INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;
const READINESS_POLL_MS = 200;
const READINESS_TIMEOUT_MS = 60_000;
const TOKEN_KEY = "internal_token";

export class ApiContainer extends DurableObject<Env> {
	private starting: Promise<void> | undefined;
	private monitoring: Promise<void> | undefined;
	/** The token the running container was started with (kept in storage across restarts). */
	private token: string | undefined;

	private readonly idleMs: number;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.idleMs = ctx.id.name?.includes("-s-") ? SITUATION_INACTIVITY_TIMEOUT_MS : INACTIVITY_TIMEOUT_MS;
		const container = ctx.container;
		if (container?.running) {
			// The Durable Object restarted (for example after a deploy) while its container kept
			// running: the inactivity timeout and the exit monitor have to be set up again.
			void ctx.blockConcurrencyWhile(() =>
				container.setInactivityTimeout(this.idleMs),
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

		const token = await this.currentToken();
		return container.getTcpPort(CONTAINER_PORT).fetch(toContainerRequest(request, token));
	}

	private async currentToken(): Promise<string> {
		this.token ??= await this.ctx.storage.get<string>(TOKEN_KEY);
		if (!this.token) {
			// Only possible if storage was lost while the container kept running: start over.
			throw new Error("The API container has no internal token");
		}
		return this.token;
	}

	private async startAndWaitUntilReady(container: Container): Promise<void> {
		if (!container.running) {
			// A new token for every container start: only this Durable Object knows it.
			this.token = newInternalToken();
			await this.ctx.storage.put(TOKEN_KEY, this.token);
			container.start({
				image: container.images.api,
				// 1/4 vCPU and 1 GiB: enough to import MuJoCo and serve the API.
				instance: "basic",
				// The API makes no outbound calls yet.
				enableInternet: false,
				env: {
					SECURECARGO_CORS_ORIGINS: this.env.CORS_ORIGINS,
					SECURECARGO_INTERNAL_TOKEN: this.token,
				},
			});
		}
		this.observeExit(container);
		await container.setInactivityTimeout(this.idleMs);

		// `running` only means that startup was requested; wait for the HTTP server itself.
		const port = container.getTcpPort(CONTAINER_PORT);
		const token = await this.currentToken();
		const deadline = Date.now() + READINESS_TIMEOUT_MS;
		while (Date.now() < deadline) {
			try {
				const response = await port.fetch("http://container/health", {
					headers: { [INTERNAL_HEADER]: token },
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
