/**
 * Demo sessions, issued by the Worker (no Clerk account behind them).
 *
 * "Enter as demo driver / insurer" gets a signed token in an httpOnly cookie: HMAC-SHA256 with a
 * Worker secret over `{session, sandbox, role, issued, expires}`, valid for 24 hours. Each session
 * has its own sandbox: a demo visitor sees the seeded Demo Fleet inspections plus only the ones
 * made in their own sandbox. Switching between driver and insurer in the same browser keeps the
 * sandbox, so the visitor's new inspection shows up in "their" insurer dashboard.
 *
 * The token carries no account a visitor could change: no password, no profile, no devices.
 */

export const DEMO_COOKIE = "sc_demo";
export const DEMO_SESSION_TTL_S = 24 * 60 * 60;
export const DEMO_ROLES = ["driver", "insurer"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export interface DemoSession {
	/** Session id (one per "Enter as demo …" click). */
	sid: string;
	/** Sandbox id: shared by the driver and insurer sessions of one browser. */
	sbx: string;
	role: DemoRole;
	/** Issued at / expires at, in seconds since the epoch. */
	iat: number;
	exp: number;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
	try {
		const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function randomId(bytes = 16): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** `v1.<payload>.<signature>`, both base64url. */
export async function signDemoToken(session: DemoSession, secret: string): Promise<string> {
	const payload = base64url(encoder.encode(JSON.stringify(session)));
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`v1.${payload}`)));
	return `v1.${payload}.${base64url(signature)}`;
}

/** The session in a token, or null when it is malformed, tampered with or expired. */
export async function verifyDemoToken(token: string, secret: string, nowS: number = Date.now() / 1000): Promise<DemoSession | null> {
	if (!secret || token.length > 1024) return null;
	const parts = token.split(".");
	if (parts.length !== 3 || parts[0] !== "v1") return null;
	const [, payload, signature] = parts as [string, string, string];
	const signatureBytes = fromBase64url(signature);
	if (!signatureBytes) return null;
	// crypto.subtle.verify compares in constant time.
	const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signatureBytes, encoder.encode(`v1.${payload}`));
	if (!valid) return null;
	const json = fromBase64url(payload);
	if (!json) return null;
	let session: unknown;
	try {
		session = JSON.parse(new TextDecoder().decode(json));
	} catch {
		return null;
	}
	const s = session as Partial<DemoSession>;
	if (
		typeof s.sid !== "string" ||
		typeof s.sbx !== "string" ||
		!DEMO_ROLES.includes(s.role as DemoRole) ||
		typeof s.iat !== "number" ||
		typeof s.exp !== "number"
	) {
		return null;
	}
	if (s.exp <= nowS || s.iat > nowS + 60 || s.exp - s.iat > DEMO_SESSION_TTL_S) return null;
	return s as DemoSession;
}

/** A new session for `role`, keeping the sandbox of the browser's current demo session, if any. */
export function newDemoSession(role: DemoRole, previous: DemoSession | null, nowS: number = Math.floor(Date.now() / 1000)): DemoSession {
	return { sid: randomId(), sbx: previous?.sbx ?? randomId(), role, iat: nowS, exp: nowS + DEMO_SESSION_TTL_S };
}

/** The value of one cookie in a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=") || null;
	}
	return null;
}

/**
 * Set-Cookie for the demo session: httpOnly (scripts cannot read it), Secure, SameSite=Lax (sent
 * by the site, securecargo.app, to the API, api.securecargo.app: same site), 24 hours.
 */
export function demoCookie(token: string, maxAgeS: number = DEMO_SESSION_TTL_S): string {
	return `${DEMO_COOKIE}=${token}; Max-Age=${maxAgeS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearDemoCookie(): string {
	return `${DEMO_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
