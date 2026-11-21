/**
 * Perception evaluation: every annotated photo through Claude vision, per model, scored against a
 * hand-made ground truth, with the cost and time of each call.
 *
 *   pnpm eval:perception                         # all models in MODELS, every photo
 *   pnpm eval:perception claude-sonnet-5-5       # one model
 *
 * Inputs: the workspace's photo set (`photos/stock/loads/manifest.json`, outside the public
 * repository; override with PHOTOS_DIR) and ANTHROPIC_API_KEY from the environment or
 * `.dev.vars`. Answers are cached per model and photo in `<PHOTOS_DIR>/analyses/`, so a re-run
 * only pays for what is missing. Writes `docs/perception-eval.json` (the numbers) for
 * `docs/perception-eval.md`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePhotos, type AnalysisCall } from "../src/perception/claude";
import { toBase64 } from "../src/perception/metadata";

const here = dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = process.env.PHOTOS_DIR ?? join(here, "..", "..", "..", "..", "photos", "stock", "loads");
const OUT = join(here, "..", "..", "..", "docs", "perception-eval.json");
const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];

interface GroundTruth {
	truck_body: string;
	truck_size: string;
	units: number | null;
	cargo_types: string[];
	stacked: boolean;
	straps: number;
	chains: number;
	ropes: number;
	anti_slip_mat: string;
	blocking: string;
	strap_routing: string;
	visible_violations: string[];
	difficulty: string;
	notes: string;
}
interface Photo {
	file: string;
	source: string;
	photographer: string;
	description: string;
	view: string;
	ground_truth: GroundTruth;
}

function apiKey(): string {
	if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
	const line = readFileSync(join(here, "..", ".dev.vars"), "utf8")
		.split("\n")
		.find((l) => l.startsWith("ANTHROPIC_API_KEY="));
	const value = line?.slice("ANTHROPIC_API_KEY=".length).trim();
	if (!value) throw new Error("ANTHROPIC_API_KEY is not set (env or backend/worker/.dev.vars)");
	return value;
}

type Cached = AnalysisCall & { seconds: number };

async function analyse(key: string, model: string, photo: Photo): Promise<Cached> {
	const dir = join(PHOTOS_DIR, "analyses", model);
	const cache = join(dir, `${photo.file}.json`);
	if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Cached;
	const bytes = new Uint8Array(readFileSync(join(PHOTOS_DIR, photo.file)));
	const started = Date.now();
	const call = await analyzePhotos(key, [{ mediaType: "image/jpeg", base64: toBase64(bytes), position: photo.view }], model);
	const result = { ...call, seconds: (Date.now() - started) / 1000 };
	mkdirSync(dir, { recursive: true });
	writeFileSync(cache, JSON.stringify(result, null, 1));
	return result;
}

/** The product's cargo types; anything else in the ground truth ("other:...") has no match. */
function primaryCargo(truth: GroundTruth): string | null {
	const known = truth.cargo_types.find((c) => !c.startsWith("other:"));
	return known ?? null;
}

function count(call: Cached, kind: string): number {
	return call.analysis.restraints.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.count, 0);
}

function score(photo: Photo, call: Cached) {
	const truth = photo.ground_truth;
	const seen = call.analysis;
	const units = seen.units.length;
	const cargo = primaryCargo(truth);
	const majority = (() => {
		const tally = new Map<string, number>();
		for (const unit of seen.units) tally.set(unit.cargo, (tally.get(unit.cargo) ?? 0) + 1);
		return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	})();
	const straps = count(call, "strap");
	const chains = count(call, "chain");
	const ropes = count(call, "rope");
	const restraintKind = (s: number, c: number, r: number) => (r > 0 ? "rope" : c > 0 ? "chain" : s > 0 ? "strap" : "none");
	return {
		file: photo.file,
		difficulty: truth.difficulty,
		units_truth: truth.units,
		units_seen: units,
		units_exact: truth.units === null ? null : units === truth.units,
		units_within_20pct: truth.units === null ? null : Math.abs(units - truth.units) <= Math.max(1, 0.2 * truth.units),
		cargo_truth: cargo,
		cargo_seen: majority,
		cargo_match: cargo === null ? null : majority === cargo,
		body_truth: truth.truck_body,
		body_seen: seen.truck.body,
		body_match: truth.truck_body === "unknown" ? null : seen.truck.body === truth.truck_body,
		restraints_truth: { straps: truth.straps, chains: truth.chains, ropes: truth.ropes },
		restraints_seen: { straps, chains, ropes },
		restraint_count_error: Math.abs(straps - truth.straps) + Math.abs(chains - truth.chains) + Math.abs(ropes - truth.ropes),
		restraint_kind_match: restraintKind(straps, chains, ropes) === restraintKind(truth.straps, truth.chains, truth.ropes),
		rope_flagged: seen.violations.some((v) => v.code === "rope") || ropes > 0,
		rope_truth: truth.ropes > 0,
		confidence: seen.overall_confidence,
		input_tokens: call.inputTokens,
		output_tokens: call.outputTokens,
		cost_usd: call.costUsd,
		seconds: call.seconds,
		answered_by: call.model,
		summary: seen.summary,
	};
}

function share(values: (boolean | null)[]): { hits: number; of: number } {
	const known = values.filter((v): v is boolean => v !== null);
	return { hits: known.filter(Boolean).length, of: known.length };
}

async function main() {
	const key = apiKey();
	const photos = JSON.parse(readFileSync(join(PHOTOS_DIR, "manifest.json"), "utf8")) as Photo[];
	const models = process.argv.slice(2).length ? process.argv.slice(2) : MODELS;
	const report: Record<string, unknown> = {};
	for (const model of models) {
		const rows = [];
		for (const photo of photos) {
			try {
				rows.push(score(photo, await analyse(key, model, photo)));
				process.stdout.write(".");
			} catch (error) {
				console.error(`\n${model} ${photo.file}:`, (error as Error).message);
				rows.push({ file: photo.file, error: (error as Error).message });
			}
		}
		const ok = rows.filter((r): r is ReturnType<typeof score> => !("error" in r));
		const total = (pick: (r: ReturnType<typeof score>) => number) => ok.reduce((sum, r) => sum + pick(r), 0);
		report[model] = {
			photos: rows.length,
			errors: rows.length - ok.length,
			units_exact: share(ok.map((r) => r.units_exact)),
			units_within_20pct: share(ok.map((r) => r.units_within_20pct)),
			cargo_match: share(ok.map((r) => r.cargo_match)),
			body_match: share(ok.map((r) => r.body_match)),
			restraint_kind_match: share(ok.map((r) => r.restraint_kind_match)),
			ropes_found: share(ok.filter((r) => r.rope_truth).map((r) => r.rope_flagged)),
			ropes_false_alarm: share(ok.filter((r) => !r.rope_truth).map((r) => r.rope_flagged)),
			mean_restraint_count_error: ok.length ? total((r) => r.restraint_count_error) / ok.length : null,
			mean_cost_usd: ok.length ? total((r) => r.cost_usd) / ok.length : null,
			mean_seconds: ok.length ? total((r) => r.seconds) / ok.length : null,
			mean_input_tokens: ok.length ? total((r) => r.input_tokens) / ok.length : null,
			mean_output_tokens: ok.length ? total((r) => r.output_tokens) / ok.length : null,
			rows,
		};
		console.log(`\n${model}: done`);
	}
	writeFileSync(OUT, `${JSON.stringify({ evaluated_on: new Date().toISOString().slice(0, 10), report }, null, 1)}\n`);
	console.log(`Wrote ${OUT}`);
}

await main();
