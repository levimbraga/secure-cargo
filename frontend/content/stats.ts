/**
 * Figures for the landing-page stats row.
 *
 * Every figure needs a value AND a source. Until all of them have both, the row is hidden in
 * production and shows `TODO(source)` placeholders in development. Sources are also recorded
 * in the workspace `notes/` folder.
 */
export type Stat = {
  id: "one" | "two" | "three" | "four";
  value: number | null;
  unit?: string;
  sourceUrl: string | null;
};

export const STATS: Stat[] = [
  { id: "one", value: null, sourceUrl: null }, // TODO(source)
  { id: "two", value: null, sourceUrl: null }, // TODO(source)
  { id: "three", value: null, sourceUrl: null }, // TODO(source)
  { id: "four", value: null, sourceUrl: null }, // TODO(source)
];

export function statsAreSourced(stats: Stat[] = STATS): boolean {
  return stats.every((stat) => stat.value !== null && Boolean(stat.sourceUrl));
}
