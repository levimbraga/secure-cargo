/**
 * Summaries of the eight demo runs, read from the static files at build time.
 *
 * For server components only: importing this from a client component would ship every
 * keyframe to the browser. Pages pass the small summaries down as props; the keyframes are
 * fetched by the replay when it mounts.
 */
import brakingAsLoaded from "../public/demo/emergency-braking.as_loaded.json";
import brakingFixed from "../public/demo/emergency-braking.fixed.json";
import ropeAsLoaded from "../public/demo/rope-lashing.as_loaded.json";
import ropeFixed from "../public/demo/rope-lashing.fixed.json";
import curveAsLoaded from "../public/demo/sharp-curve.as_loaded.json";
import curveFixed from "../public/demo/sharp-curve.fixed.json";
import weighAsLoaded from "../public/demo/weigh-station.as_loaded.json";
import weighFixed from "../public/demo/weigh-station.fixed.json";

import { type DemoId, type DemoRun, type RunSummary, summarize, type TripEvent, type Variant } from "./demo";

const RUNS: Record<DemoId, Record<Variant, unknown>> = {
  "emergency-braking": { as_loaded: brakingAsLoaded, fixed: brakingFixed },
  "weigh-station": { as_loaded: weighAsLoaded, fixed: weighFixed },
  "rope-lashing": { as_loaded: ropeAsLoaded, fixed: ropeFixed },
  "sharp-curve": { as_loaded: curveAsLoaded, fixed: curveFixed },
};

export type DemoSummary = {
  id: DemoId;
  event: TripEvent;
  runs: Record<Variant, RunSummary>;
};

export function demoSummary(id: DemoId): DemoSummary {
  const asLoaded = RUNS[id].as_loaded as DemoRun;
  const fixed = RUNS[id].fixed as DemoRun;
  return {
    id,
    event: {
      kind: asLoaded.event.kind,
      speed_kmh: asLoaded.event.speed_kmh,
      road_surface: asLoaded.event.road_surface,
      fog: asLoaded.event.fog,
    },
    runs: { as_loaded: summarize(asLoaded), fixed: summarize(fixed) },
  };
}
