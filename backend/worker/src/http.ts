/** Error answers in the API's shape: a stable code plus English text (the UI translates by code). */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
	constructor(
		readonly status: ContentfulStatusCode,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

export function fail(status: ContentfulStatusCode, code: string, message: string): never {
	throw new ApiError(status, code, message);
}

export function notFound(): never {
	return fail(404, "not_found", "No such record.");
}

export function forbidden(): never {
	return fail(403, "forbidden", "Your role cannot do this.");
}

export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await c.req.json();
		if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	return fail(422, "invalid_body", "Expected a JSON object.");
}

/** Field readers that reject anything unexpected with a 422. */
export const field = {
	optionalString(body: Record<string, unknown>, key: string, max: number): string | undefined {
		const value = body[key];
		if (value === undefined) return undefined;
		if (typeof value !== "string" || value.length > max) {
			return fail(422, "invalid_field", `${key} must be a string of at most ${max} characters.`);
		}
		return value;
	},
	optionalEnum<T extends string>(body: Record<string, unknown>, key: string, options: readonly T[]): T | null | undefined {
		const value = body[key];
		if (value === undefined || value === null) return value as null | undefined;
		if (typeof value !== "string" || !options.includes(value as T)) {
			return fail(422, "invalid_field", `${key} must be one of ${options.join(", ")}.`);
		}
		return value as T;
	},
	optionalNumber(body: Record<string, unknown>, key: string, min: number, max: number): number | null | undefined {
		const value = body[key];
		if (value === undefined || value === null) return value as null | undefined;
		if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
			return fail(422, "invalid_field", `${key} must be a number from ${min} to ${max}.`);
		}
		return value;
	},
	optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
		const value = body[key];
		if (value === undefined) return undefined;
		if (typeof value !== "boolean") return fail(422, "invalid_field", `${key} must be true or false.`);
		return value;
	},
};
