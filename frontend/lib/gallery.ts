/**
 * The gallery's index and coverage matrix, read from the static files at build time
 * (`backend/scripts/precompute_demo.py`). For server components only.
 */
import coverageJson from "../public/demo/coverage.json";
import indexJson from "../public/demo/index.json";

import type { DemoId, Status, Variant } from "./demo";

type IndexEntry = {
  id: DemoId;
  variants: Record<Variant, { file: string; status: Status; explorer: string }>;
};

const INDEX = (indexJson as unknown as { scenarios: IndexEntry[] }).scenarios;

/** Canonical explorer query of each example's version. */
export function explorerQueries(variant: Variant): Record<string, string> {
  return Object.fromEntries(INDEX.map((entry) => [entry.id, entry.variants[variant].explorer]));
}

export type CoverageOption = {
  id: string;
  covered_by: { example: DemoId; variant: Variant; via?: string }[];
};
export type Coverage = { examples: DemoId[]; dimensions: { id: string; options: CoverageOption[] }[] };

export const COVERAGE = coverageJson as unknown as Coverage;

export function coverageTotals(coverage: Coverage): { covered: number; total: number } {
  const options = coverage.dimensions.flatMap((dimension) => dimension.options);
  return { covered: options.filter((option) => option.covered_by.length > 0).length, total: options.length };
}
