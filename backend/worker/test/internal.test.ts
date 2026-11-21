import { describe, expect, it } from "vitest";

import { INTERNAL_HEADER, newInternalToken, toContainerRequest } from "../src/internal";

describe("requests forwarded to the physics container", () => {
	it("carry the Worker's token, never the one a client sent", () => {
		const incoming = new Request("https://api.securecargo.app/simulate?x=1", {
			method: "POST",
			headers: { [INTERNAL_HEADER]: "forged", "content-type": "application/json" },
			body: "{}",
		});
		const forwarded = toContainerRequest(incoming, "worker-token");
		expect(forwarded.headers.get(INTERNAL_HEADER)).toBe("worker-token");
		expect(forwarded.url).toBe("http://container/simulate?x=1");
		expect(forwarded.method).toBe("POST");
		expect(forwarded.headers.get("content-type")).toBe("application/json");
	});

	it("uses a fresh 256-bit token for each container", () => {
		const a = newInternalToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(newInternalToken()).not.toBe(a);
	});
});
