/**
 * The slice of the D1 API the application uses.
 *
 * Production passes the real `D1Database` binding; the tests pass an adapter over `node:sqlite`
 * that runs the same SQL migrations, so every query is exercised against real SQLite.
 */
export interface Statement {
	bind(...values: unknown[]): Statement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<unknown>;
}

export interface Db {
	prepare(sql: string): Statement;
	batch(statements: Statement[]): Promise<unknown[]>;
}

export function now(): string {
	return new Date().toISOString();
}

export function newId(prefix: string): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${prefix}_${hex}`;
}

/** Brazil has had no daylight saving time since 2019: Brasília time is UTC-3 all year. */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Start of the current day and month in Brasília time, as UTC ISO strings. */
export function periodStarts(at: Date = new Date()): { day: string; month: string } {
	const local = new Date(at.getTime() - BRT_OFFSET_MS);
	const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
	const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
	return {
		day: new Date(day + BRT_OFFSET_MS).toISOString(),
		month: new Date(month + BRT_OFFSET_MS).toISOString(),
	};
}
