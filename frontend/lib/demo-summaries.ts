/**
 * Summaries of the demo runs, without keyframes, read from the static files at build time.
 *
 * For server components only. Pages pass the small summaries down as props; the keyframes are
 * fetched by the replay when it mounts. `public/demo/summaries.json` is written by
 * `backend/scripts/precompute_demo.py`.
 */
import summaries from "../public/demo/summaries.json";

import type { DemoId, RunSummary, TripEvent, Variant } from "./demo";

type StoredSummary = RunSummary & { event: TripEvent };
const RUNS = summaries as unknown as Record<string, StoredSummary>;

export type DemoSummary = {
  id: DemoId;
  event: TripEvent;
  runs: Record<Variant, RunSummary>;
};

function run(id: DemoId, variant: Variant): RunSummary {
  const stored = RUNS[`${id}.${variant}`];
  if (!stored) throw new Error(`No summary for ${id}.${variant}: run backend/scripts/precompute_demo.py`);
  const summary: Partial<StoredSummary> = { ...stored };
  delete summary.event;
  return summary as RunSummary;
}

export function demoSummary(id: DemoId): DemoSummary {
  const event = RUNS[`${id}.as_loaded`]?.event;
  if (!event) throw new Error(`No summary for ${id}`);
  return {
    id,
    event: { kind: event.kind, speed_kmh: event.speed_kmh, road_surface: event.road_surface, fog: event.fog },
    runs: { as_loaded: run(id, "as_loaded"), fixed: run(id, "fixed") },
  };
}
