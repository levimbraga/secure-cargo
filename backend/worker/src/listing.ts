/**
 * Filters, search and pagination of the inspections table, and its CSV export.
 *
 * The filter only ever narrows the authorization clause (`authz.inspectionListFilter`): it is
 * appended with AND and never replaces it. Every value is bound, never interpolated.
 */
import { fail } from "./http";
import { FAILURE_CODES, unpackList } from "./summary";

export const STATES = ["approved", "holds_noncompliant", "fails", "proven", "open", "pending"] as const;
export const TRUCK_SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"] as const;

export interface ListFilters {
	from?: string; // YYYY-MM-DD, Brasília time
	to?: string; // YYYY-MM-DD inclusive
	driver?: string;
	state?: (typeof STATES)[number];
	truck?: (typeof TRUCK_SIZES)[number];
	cargo?: string;
	failure?: string;
	q?: string;
	page: number;
	pageSize: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the filters from a query string; anything malformed is a 422. */
export function parseFilters(query: (key: string) => string | undefined, defaults = { pageSize: 200 }): ListFilters {
	const filters: ListFilters = { page: 1, pageSize: defaults.pageSize };
	const value = (key: string) => {
		const v = query(key)?.trim();
		return v ? v : undefined;
	};
	for (const key of ["from", "to"] as const) {
		const v = value(key);
		if (v !== undefined) {
			if (!DATE.test(v) || Number.isNaN(Date.parse(v))) fail(422, "invalid_filter", `${key} must be a date (YYYY-MM-DD).`);
			filters[key] = v;
		}
	}
	const driver = value("driver");
	if (driver !== undefined) {
		if (driver.length > 64) fail(422, "invalid_filter", "driver is too long.");
		filters.driver = driver;
	}
	const state = value("state");
	if (state !== undefined) {
		if (!STATES.includes(state as ListFilters["state"] & string)) fail(422, "invalid_filter", `state must be one of ${STATES.join(", ")}.`);
		filters.state = state as ListFilters["state"];
	}
	const truck = value("truck");
	if (truck !== undefined) {
		if (!TRUCK_SIZES.includes(truck as ListFilters["truck"] & string)) fail(422, "invalid_filter", `truck must be one of ${TRUCK_SIZES.join(", ")}.`);
		filters.truck = truck as ListFilters["truck"];
	}
	const cargo = value("cargo");
	if (cargo !== undefined) {
		if (!/^[a-z_]{2,40}$/.test(cargo)) fail(422, "invalid_filter", "cargo must be a cargo type.");
		filters.cargo = cargo;
	}
	const failure = value("failure");
	if (failure !== undefined) {
		if (!FAILURE_CODES.includes(failure)) fail(422, "invalid_filter", "failure must be a failure type.");
		filters.failure = failure;
	}
	const q = value("q");
	if (q !== undefined) filters.q = q.slice(0, 80);
	const page = value("page");
	if (page !== undefined) {
		const n = Number(page);
		if (!Number.isInteger(n) || n < 1 || n > 10_000) fail(422, "invalid_filter", "page must be a positive whole number.");
		filters.page = n;
	}
	const size = value("page_size");
	if (size !== undefined) {
		const n = Number(size);
		if (!Number.isInteger(n) || n < 1 || n > 200) fail(422, "invalid_filter", "page_size must be from 1 to 200.");
		filters.pageSize = n;
	}
	return filters;
}

/** Brasília midnight of a date, as a UTC ISO string (UTC-3 all year). */
export function brtStart(date: string, plusDays = 0): string {
	const t = Date.parse(`${date}T03:00:00.000Z`) + plusDays * 86_400_000;
	return new Date(t).toISOString();
}

const PROVEN = "EXISTS (SELECT 1 FROM inspections rp WHERE rp.reinspection_of = i.id AND rp.verdict = 'pass')";

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The SQL clauses of the filters (to AND onto the authorization clause), with their values. */
export function filterClauses(filters: ListFilters): { where: string[]; params: unknown[] } {
	const where: string[] = [];
	const params: unknown[] = [];
	if (filters.from) {
		where.push("i.created_at >= ?");
		params.push(brtStart(filters.from));
	}
	if (filters.to) {
		where.push("i.created_at < ?");
		params.push(brtStart(filters.to, 1));
	}
	if (filters.driver) {
		where.push("i.author_id = ?");
		params.push(filters.driver);
	}
	switch (filters.state) {
		case "approved":
			where.push("i.verdict = 'pass'");
			break;
		case "holds_noncompliant":
			where.push("i.verdict = 'warning'");
			break;
		case "fails":
			where.push("i.verdict = 'fail'");
			break;
		case "proven":
			where.push(`i.verdict IN ('fail', 'warning') AND ${PROVEN}`);
			break;
		case "open":
			where.push(`i.verdict IN ('fail', 'warning') AND i.reinspection_of IS NULL AND NOT ${PROVEN}`);
			break;
		case "pending":
			where.push("i.verdict IS NULL");
			break;
	}
	if (filters.truck) {
		where.push("COALESCE(json_extract(i.truck_json, '$.size'), i.truck_size) = ?");
		params.push(filters.truck);
	}
	if (filters.cargo) {
		where.push("i.cargo_types LIKE ?");
		params.push(`%,${filters.cargo},%`);
	}
	if (filters.failure) {
		where.push("i.failure_codes LIKE ?");
		params.push(`%,${filters.failure},%`);
	}
	if (filters.q) {
		const like = `%${escapeLike(filters.q)}%`;
		where.push("(i.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR i.id LIKE ? ESCAPE '\\')");
		params.push(like, like, like);
	}
	return { where, params };
}

// ---- CSV ------------------------------------------------------------------------------------

export interface CsvRow {
	id: string;
	created_at: string;
	author_name: string | null;
	title: string;
	truck_json: string | null;
	truck_size: string | null;
	truck_body: string | null;
	cargo_types: string | null;
	cargo_weight_kg: number | null;
	weight_source: string | null;
	verdict: string | null;
	fixed_verdict: string | null;
	proven_by: string | null;
	situations_passed: number | null;
	situations_total: number | null;
	failure_codes: string | null;
	reinspection_of: string | null;
}

export const CSV_COLUMNS = [
	"id",
	"created_at",
	"driver",
	"title",
	"truck_size",
	"truck_style",
	"cargo_types",
	"cargo_weight_kg",
	"weight_source",
	"state",
	"situations_passed",
	"situations_total",
	"fix",
	"failure_types",
	"reinspection_of",
] as const;

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
	let text = value === null || value === undefined ? "" : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r']/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvRow[]): string {
	const state = (v: string | null) => (v === "pass" ? "approved" : v === "warning" ? "holds_noncompliant" : v === "fail" ? "fails" : "pending");
	const lines = [CSV_COLUMNS.join(",")];
	for (const r of rows) {
		let truck: { size?: string; style?: string } = {};
		try {
			truck = r.truck_json ? (JSON.parse(r.truck_json) as typeof truck) : {};
		} catch {
			// keep the columns
		}
		const fix = r.proven_by ? "fixed_and_proven" : r.fixed_verdict === "pass" ? "fix_simulated" : r.verdict === "fail" || r.verdict === "warning" ? "none" : "";
		lines.push(
			[
				r.id,
				r.created_at,
				r.author_name,
				r.title,
				truck.size ?? r.truck_size,
				truck.style ?? r.truck_body,
				unpackList(r.cargo_types).join(" "),
				r.cargo_weight_kg,
				r.weight_source,
				state(r.verdict),
				r.situations_passed,
				r.situations_total,
				fix,
				unpackList(r.failure_codes).join(" "),
				r.reinspection_of,
			]
				.map(csvCell)
				.join(","),
		);
	}
	// A byte-order mark so that spreadsheet programs read the accents right.
	return `﻿${lines.join("\r\n")}\r\n`;
}
