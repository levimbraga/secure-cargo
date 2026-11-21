/**
 * Rewrites the stored verdicts of the seeded demo inspections with the three-state verdict
 * (src/verdict.ts), from their stored batteries, without touching anything else:
 *
 *   npx tsx seed/reverdict.ts > seed/out/reverdict.sql
 *   npx wrangler d1 execute securecargo --remote --file seed/out/reverdict.sql
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type BatteryLike, STORED, verdictState } from "../src/verdict";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "..", "..", "frontend", "public");
const sql = readFileSync(join(here, "out", "demo.sql"), "utf8");
const refs = new Map<string, { as_loaded?: string; fixed?: string }>();
for (const match of sql.matchAll(/INSERT INTO scenarios[^;]*?VALUES \('[^']*', '([^']*)', '(as_loaded|fixed)', '(?:[^']|'')*', '(static:[^']*)'/g)) {
	const [, id, kind, ref] = match as unknown as [string, string, "as_loaded" | "fixed", string];
	refs.set(id, { ...refs.get(id), [kind]: ref });
}
const state = (ref: string | undefined) => {
	if (!ref) return null;
	const battery = JSON.parse(readFileSync(join(site, ref.slice("static:".length)), "utf8")) as BatteryLike;
	return STORED[verdictState(battery)];
};
for (const [id, { as_loaded, fixed }] of refs) {
	const verdict = state(as_loaded);
	const fixedVerdict = state(fixed);
	console.log(
		`UPDATE inspections SET verdict = ${verdict ? `'${verdict}'` : "NULL"}, fixed_verdict = ${fixedVerdict ? `'${fixedVerdict}'` : "NULL"} WHERE id = '${id}' AND seeded = 1;`,
	);
}
