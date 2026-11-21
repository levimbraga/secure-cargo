/**
 * How the Worker talks to the physics container.
 *
 * Cloudflare gives a container no public address: it is reached only through its Durable
 * Object (`container.ts`). On top of that, the container refuses any request that lacks the
 * token the Durable Object generated when it started the container (`SECURECARGO_INTERNAL_TOKEN`),
 * so a request can only ever reach it through this Worker.
 */

export const INTERNAL_HEADER = "x-securecargo-internal";

/** A fresh random token (256 bits, hex). */
export function newInternalToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The request as the container receives it: same method, path, query and body, addressed to
 * the container, with the Worker's token. Whatever a client put in the internal header is
 * replaced, never passed on.
 */
export function toContainerRequest(request: Request, token: string): Request {
	const url = new URL(request.url);
	url.protocol = "http:";
	url.host = "container";
	const forwarded = new Request(url, request);
	forwarded.headers.delete("host");
	forwarded.headers.set(INTERNAL_HEADER, token);
	return forwarded;
}
