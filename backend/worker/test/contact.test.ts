import { describe, expect, it } from "vitest";

import { brasiliaTime, buildContactMail, type ContactMail, parseContact, purgeContactRate } from "../src/contact";
import { createTestDb, setup } from "./helpers";

const TO = "owner-inbox@example.com";
const SITE = ["https://securecargo.app"];

function contactSetup(options: { turnstile?: boolean; sendFails?: boolean; to?: string } = {}) {
	const sent: ContactMail[] = [];
	const env = setup({
		extra: {
			contact: {
				to: options.to ?? TO,
				hashKey: "test-key",
				siteOrigins: SITE,
				verifyTurnstile: async (token) => (options.turnstile ?? true) && token === "ok-token",
				send: async (mail) => {
					if (options.sendFails) throw Object.assign(new Error("refused"), { code: "E_DELIVERY_FAILED" });
					sent.push(mail);
				},
				now: () => new Date("2026-11-22T01:30:00.000Z"),
			},
		},
	});
	const post = (body: Record<string, unknown>, ip = "203.0.113.7") =>
		env.app.request("/contact", {
			method: "POST",
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
			body: JSON.stringify(body),
		});
	return { ...env, sent, post };
}

const VALID = {
	name: "Ana Example",
	email: "ana@example.com",
	subject: "insurers",
	message: "We would like to try SecureCargo with our drivers.",
	locale: "pt-BR",
	page: "https://securecargo.app/pt-BR/contact",
	turnstile_token: "ok-token",
	website: "",
};

async function code(response: Response) {
	return ((await response.json()) as { detail?: { code: string } }).detail?.code;
}

describe("POST /contact", () => {
	it("emails the owner with Reply-To set to the visitor", async () => {
		const { post, sent } = contactSetup();
		const response = await post(VALID);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		const mail = sent[0] as ContactMail;
		expect(mail.to).toBe(TO);
		expect(mail.from.email).toBe("no-reply@securecargo.app");
		expect(mail.replyTo).toEqual({ email: "ana@example.com", name: "Ana Example" });
		expect(mail.subject).toBe("[SecureCargo] Insurers and carriers — Ana Example");
		expect(mail.text).toContain("Language: pt-BR");
		expect(mail.text).toContain("Page: https://securecargo.app/pt-BR/contact");
		expect(mail.text).toContain("Date: 2026-11-21 22:30 BRT");
		expect(mail.text).toContain(VALID.message);
	});

	it("never answers with the destination address", async () => {
		const { post } = contactSetup();
		const body = await (await post(VALID)).text();
		expect(body).not.toContain(TO);
	});

	it("answers 'sent' to a filled honeypot without sending", async () => {
		const { post, sent } = contactSetup();
		const response = await post({ ...VALID, website: "https://spam.example" });
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(0);
	});

	it("rejects a failed Turnstile check", async () => {
		const { post, sent } = contactSetup({ turnstile: false });
		const response = await post(VALID);
		expect(response.status).toBe(422);
		expect(await code(response)).toBe("turnstile_failed");
		expect(sent).toHaveLength(0);
	});

	it("rejects a missing Turnstile token", async () => {
		const { post } = contactSetup();
		expect(await code(await post({ ...VALID, turnstile_token: "" }))).toBe("turnstile_failed");
	});

	it.each([
		[{ name: "" }, "invalid_name"],
		[{ name: "x".repeat(101) }, "invalid_name"],
		[{ name: "Ana\r\nBcc: victim@example.com" }, "invalid_name"],
		[{ email: "not-an-email" }, "invalid_email"],
		[{ email: "a@b" }, "invalid_email"],
		[{ subject: "sales" }, "invalid_subject"],
		[{ message: "short" }, "invalid_message"],
		[{ message: "x".repeat(2001) }, "invalid_message"],
		[{ message: "Hello <script>alert(1)</script> there" }, "html_not_allowed"],
		[{ message: 'Click <a href="https://spam.example">here</a> now' }, "html_not_allowed"],
	])("rejects %o with %s", async (change, expected) => {
		const { post, sent } = contactSetup();
		const response = await post({ ...VALID, ...change });
		expect(response.status).toBe(422);
		expect(await code(response)).toBe(expected);
		expect(sent).toHaveLength(0);
	});

	it("accepts a plain-text comparison like 2 < 3 and 5 > 4", async () => {
		const { post, sent } = contactSetup();
		expect((await post({ ...VALID, message: "Is 2 < 3 and 5 > 4 in your model?" })).status).toBe(200);
		expect(sent).toHaveLength(1);
	});

	it("allows 5 messages per IP per hour, then refuses", async () => {
		const { post, sent } = contactSetup();
		for (let n = 0; n < 5; n++) expect((await post(VALID)).status).toBe(200);
		const sixth = await post(VALID);
		expect(sixth.status).toBe(429);
		expect(await code(sixth)).toBe("contact_hourly_limit");
		// Another IP is not affected.
		expect((await post(VALID, "198.51.100.9")).status).toBe(200);
		expect(sent).toHaveLength(6);
	});

	it("stores no IP address, only its HMAC", async () => {
		const { post, db } = contactSetup();
		await post(VALID);
		const rows = db.raw.prepare("SELECT ip_hash FROM contact_rate").all() as { ip_hash: string }[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
	});

	it("answers 429 when the per-minute limiter refuses", async () => {
		const sent: ContactMail[] = [];
		const env = setup({
			rateLimitAllows: () => false,
			extra: { contact: { to: TO, hashKey: "k", siteOrigins: SITE, verifyTurnstile: async () => true, send: async (m) => void sent.push(m) } },
		});
		const response = await env.app.request("/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID) });
		expect(response.status).toBe(429);
		expect(sent).toHaveLength(0);
	});

	it("reports a failed send without leaking details", async () => {
		const { post } = contactSetup({ sendFails: true });
		const response = await post(VALID);
		expect(response.status).toBe(502);
		expect(await code(response)).toBe("send_failed");
	});

	it("answers 503 without a configured destination", async () => {
		const { post } = contactSetup({ to: "" });
		expect(await code(await post(VALID))).toBe("contact_unavailable");
	});

	it("refuses every message when the contact form is not configured", async () => {
		const env = setup();
		const response = await env.app.request("/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID) });
		expect(response.status).toBe(422); // Turnstile cannot be verified without a secret
	});
});

describe("contact helpers", () => {
	it("drops a page URL from another origin", () => {
		const input = parseContact({ ...VALID, page: "https://evil.example/x" }, SITE);
		expect(input.page).toBeNull();
	});

	it("escapes the message in the HTML part", () => {
		const mail = buildContactMail({ ...parseContact({ ...VALID, message: "Tom & Jerry say 2 < 3 \"quoted\"" }, SITE) }, TO, new Date());
		expect(mail.html).toContain("Tom &amp; Jerry say 2 &lt; 3 &quot;quoted&quot;");
	});

	it("writes Brasília time (UTC−3)", () => {
		expect(brasiliaTime(new Date("2026-11-22T00:05:00.000Z"))).toBe("2026-11-21 21:05 BRT");
	});

	it("purges counters older than two hours", async () => {
		const db = createTestDb();
		db.raw.exec(`INSERT INTO contact_rate (ip_hash, window_start, count) VALUES ('a', '2026-11-21T20', 1), ('b', '2026-11-21T23', 1)`);
		await purgeContactRate(db, new Date("2026-11-22T00:30:00.000Z"));
		const rows = db.raw.prepare("SELECT ip_hash FROM contact_rate").all() as { ip_hash: string }[];
		expect(rows.map((r) => r.ip_hash)).toEqual(["b"]);
	});
});
