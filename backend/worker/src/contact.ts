/**
 * The contact form: `POST /contact` (no sign-in).
 *
 * The message is emailed to the owner through the Cloudflare Email Service `send_email` binding
 * (Email Routing on securecargo.app; the destination is a verified address, kept only in the
 * `CONTACT_TO` secret, never in the repo or the site). Reply-To is the visitor's address, so a
 * reply from the inbox goes straight to them. Messages are not stored anywhere else.
 *
 * Anti-spam, in order: a per-minute IP limit (Workers rate limiting), a hidden honeypot field
 * (filled → answered "sent" without sending, so a bot learns nothing), server-side validation
 * (lengths, email format, no HTML, no control characters), Cloudflare Turnstile verified on the
 * server, and 5 messages per IP per hour counted in D1 under an HMAC of the IP.
 *
 * Idempotency: the browser sends a random `idempotency_key` per submission. The first request with
 * a key claims it (an HMAC of it, in D1); another request with the same key within 10 minutes is
 * answered "sent" and sends nothing. A request that fails releases its claim, so a retry can go.
 */
import type { Hono } from "hono";

import type { Db } from "./db";
import { fail, jsonBody } from "./http";

export const CONTACT_SUBJECTS = {
	general: "General question",
	insurers: "Insurers and carriers",
	partnership: "Partnership",
	press: "Press",
	privacy: "Privacy or data request",
	problem: "Report a problem",
} as const;
export type ContactSubject = keyof typeof CONTACT_SUBJECTS;

export const CONTACT_LIMITS = { name: 100, email: 254, message: 2000, messageMin: 10, perHour: 5 } as const;

export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{8,100}$/;

export const CONTACT_FROM = { email: "no-reply@securecargo.app", name: "SecureCargo contact form" } as const;

/** What the Worker needs to send one email (the binding's structured `send()`). */
export interface ContactMail {
	to: string;
	from: { email: string; name: string };
	replyTo: { email: string; name: string };
	subject: string;
	text: string;
	html: string;
}

export interface ContactDeps {
	db: Db;
	/** Per-minute anonymous limit (Workers rate limiting binding). */
	limitAnonymous(key: string): Promise<boolean>;
	/** Verifies a Turnstile token on the server; resolves true when Cloudflare accepts it. */
	verifyTurnstile(token: string, ip: string | null): Promise<boolean>;
	/** Sends the email; throws when the Email Service refuses it. */
	send(mail: ContactMail): Promise<void>;
	/** The owner's address (secret). Empty: the form answers 503. */
	to: string;
	/** Key for the HMAC of the IP in the hourly counter. */
	hashKey: string;
	/** Allowed page origins for the "page URL" line. */
	siteOrigins: readonly string[];
	now?: () => Date;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
// Any tag-like text: the form takes plain text only.
const HTML = /<\s*\/?\s*[a-z!][^>]*>/i;
// Control characters except tab and newline (and CR inside the message, which is normalized).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") fail(422, "invalid_field", `${key} must be text.`);
	return value;
}

export interface ContactInput {
	name: string;
	email: string;
	subject: ContactSubject;
	message: string;
	locale: "en" | "pt-BR";
	page: string | null;
}

/** Validates the form. Each failure has its own code, which the site translates. */
export function parseContact(body: Record<string, unknown>, siteOrigins: readonly string[]): ContactInput {
	const name = text(body, "name").trim();
	const email = text(body, "email").trim();
	const subject = text(body, "subject");
	const message = text(body, "message").replace(/\r\n?/g, "\n").trim();
	const locale = text(body, "locale") === "pt-BR" ? "pt-BR" : "en";

	if (!name || name.length > CONTACT_LIMITS.name || /[\r\n]/.test(name) || CONTROL.test(name) || HTML.test(name)) {
		fail(422, "invalid_name", `Enter your name (up to ${CONTACT_LIMITS.name} characters, plain text).`);
	}
	if (!email || email.length > CONTACT_LIMITS.email || !EMAIL.test(email)) {
		fail(422, "invalid_email", "Enter a valid email address.");
	}
	if (!(subject in CONTACT_SUBJECTS)) fail(422, "invalid_subject", "Pick a subject.");
	if (message.length < CONTACT_LIMITS.messageMin || message.length > CONTACT_LIMITS.message) {
		fail(422, "invalid_message", `Write a message of ${CONTACT_LIMITS.messageMin} to ${CONTACT_LIMITS.message} characters.`);
	}
	if (HTML.test(message) || CONTROL.test(message)) {
		fail(422, "html_not_allowed", "Write the message as plain text, without HTML.");
	}

	let page: string | null = null;
	const rawPage = text(body, "page");
	if (rawPage && rawPage.length <= 300) {
		try {
			const url = new URL(rawPage);
			if (siteOrigins.includes(url.origin)) page = url.href;
		} catch {
			// ignored: the page line is informational
		}
	}
	return { name, email, subject: subject as ContactSubject, message, locale, page };
}

/** "2026-11-21 22:07 BRT": Brasília has no daylight saving time since 2019 (UTC−3). */
export function brasiliaTime(at: Date): string {
	const local = new Date(at.getTime() - 3 * 60 * 60 * 1000);
	return `${local.toISOString().slice(0, 16).replace("T", " ")} BRT`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export function buildContactMail(input: ContactInput, to: string, at: Date): ContactMail {
	const subjectLabel = CONTACT_SUBJECTS[input.subject];
	const rows: [string, string][] = [
		["Name", input.name],
		["Email", input.email],
		["Subject", subjectLabel],
		["Language", input.locale],
		["Page", input.page ?? "(not given)"],
		["Date", brasiliaTime(at)],
	];
	const text = [
		...rows.map(([k, v]) => `${k}: ${v}`),
		"",
		"Message:",
		input.message,
		"",
		"--",
		"Sent from the contact form at securecargo.app. Reply to this email to answer the sender.",
	].join("\n");
	const html = [
		'<div style="font-family:system-ui,sans-serif;font-size:15px;color:#191918">',
		'<table cellpadding="4" style="border-collapse:collapse">',
		...rows.map(([k, v]) => `<tr><td style="color:#636361">${k}</td><td>${escapeHtml(v)}</td></tr>`),
		"</table>",
		`<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(input.message)}</p>`,
		'<p style="color:#636361;font-size:13px">Sent from the contact form at securecargo.app. Reply to this email to answer the sender.</p>',
		"</div>",
	].join("");
	return {
		to,
		from: { ...CONTACT_FROM },
		replyTo: { email: input.email, name: input.name },
		subject: `[SecureCargo] ${subjectLabel} — ${input.name}`,
		text,
		html,
	};
}

async function hmacHex(key: string, value: string): Promise<string> {
	const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Counts this message in the IP's current hour; false when the IP already sent the maximum. */
async function withinHourlyLimit(db: Db, ipHash: string, at: Date): Promise<boolean> {
	const window = at.toISOString().slice(0, 13); // "2026-11-21T22"
	const row = await db
		.prepare("SELECT count FROM contact_rate WHERE ip_hash = ? AND window_start = ?")
		.bind(ipHash, window)
		.first<{ count: number }>();
	if ((row?.count ?? 0) >= CONTACT_LIMITS.perHour) return false;
	await db
		.prepare(
			`INSERT INTO contact_rate (ip_hash, window_start, count) VALUES (?, ?, 1)
			 ON CONFLICT (ip_hash, window_start) DO UPDATE SET count = count + 1`,
		)
		.bind(ipHash, window)
		.run();
	return true;
}

/** Hourly cron: forget counters older than two hours. */
export async function purgeContactRate(db: Db, at: Date = new Date()): Promise<void> {
	const cutoff = new Date(at.getTime() - 2 * 60 * 60 * 1000).toISOString().slice(0, 13);
	await db.prepare("DELETE FROM contact_rate WHERE window_start < ?").bind(cutoff).run();
	const dedupeCutoff = new Date(at.getTime() - 60 * 60 * 1000).toISOString();
	await db.prepare("DELETE FROM contact_dedupe WHERE created_at < ?").bind(dedupeCutoff).run();
}

/**
 * Claims an idempotency key: true for the first request with it (or when its last claim is older
 * than the window), false for a duplicate. One atomic statement, so two parallel requests cannot
 * both win.
 */
async function claimKey(db: Db, keyHash: string, at: Date): Promise<boolean> {
	const stale = new Date(at.getTime() - DEDUPE_WINDOW_MS).toISOString();
	const row = await db
		.prepare(
			`INSERT INTO contact_dedupe (key_hash, created_at) VALUES (?, ?)
			 ON CONFLICT (key_hash) DO UPDATE SET created_at = excluded.created_at WHERE contact_dedupe.created_at < ?
			 RETURNING key_hash`,
		)
		.bind(keyHash, at.toISOString(), stale)
		.first<{ key_hash: string }>();
	return row !== null;
}

export function registerContact(app: Hono<any>, deps: ContactDeps): void {
	app.post("/contact", async (c) => {
		const ip = c.req.header("CF-Connecting-IP") ?? null;
		if (!(await deps.limitAnonymous(`contact:${ip ?? "unknown"}`))) {
			fail(429, "rate_limited", "Too many messages. Wait a minute and try again.");
		}
		const body = await jsonBody(c);
		c.header("Cache-Control", "no-store");
		// Honeypot: a field people never see. A bot that fills it is told "sent" and nothing is sent.
		if (text(body, "website").trim() !== "") return c.json({ ok: true });

		const input = parseContact(body, deps.siteOrigins);
		const at = deps.now?.() ?? new Date();

		// A repeated submission (same key within 10 minutes) is answered "sent" and not sent again.
		const key = text(body, "idempotency_key");
		if (key && !IDEMPOTENCY_KEY.test(key)) fail(422, "invalid_field", "idempotency_key is malformed.");
		const keyHash = key ? await hmacHex(deps.hashKey, `dedupe:${key}`) : null;
		if (keyHash && !(await claimKey(deps.db, keyHash, at))) return c.json({ ok: true, duplicate: true });

		let sent = false;
		try {
			const token = text(body, "turnstile_token");
			if (!token || token.length > 2048 || !(await deps.verifyTurnstile(token, ip))) {
				fail(422, "turnstile_failed", "We could not confirm you are not a robot. Try again.");
			}
			if (!deps.to) fail(503, "contact_unavailable", "The contact form is not available right now.");

			const ipHash = await hmacHex(deps.hashKey, ip ?? "unknown");
			if (!(await withinHourlyLimit(deps.db, ipHash, at))) {
				fail(429, "contact_hourly_limit", `You can send up to ${CONTACT_LIMITS.perHour} messages an hour. Try again later.`);
			}

			try {
				await deps.send(buildContactMail(input, deps.to, at));
			} catch (error) {
				const code = (error as { code?: string }).code ?? "unknown";
				console.error("Contact email failed:", code, (error as Error).message);
				fail(502, "send_failed", "Your message could not be sent. Try again in a few minutes.");
			}
			sent = true;
		} finally {
			// A request that did not send releases its key, so the visitor can retry.
			if (keyHash && !sent) await deps.db.prepare("DELETE FROM contact_dedupe WHERE key_hash = ?").bind(keyHash).run();
		}
		return c.json({ ok: true });
	});
}

/** Server-side Turnstile check (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
export async function siteverify(secret: string, token: string, ip: string | null, hostnames: readonly string[]): Promise<boolean> {
	if (!secret) return false;
	const form = new FormData();
	form.append("secret", secret);
	form.append("response", token);
	if (ip) form.append("remoteip", ip);
	form.append("idempotency_key", crypto.randomUUID());
	const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
	if (!response.ok) return false;
	const result = (await response.json()) as { success?: boolean; hostname?: string; action?: string };
	return result.success === true && (!result.hostname || hostnames.includes(result.hostname)) && (!result.action || result.action === "contact");
}
