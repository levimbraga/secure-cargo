/**
 * The sample photos: real photographs of loads (free licence, credited), each with its Claude
 * vision analysis computed once and the server's results for the load as the photo shows it.
 * They work without an account, without the API and without spending anything.
 *
 * Built by `backend/scripts/build_samples.py` into `public/demo/samples/`.
 */

import type { ServerRunResult } from "./types";
import type { Battery, Body, PerceptionDraft, PhotoAnalysis, Plan, SituationId, Size } from "./types";

export type Sample = {
  id: string;
  title: string;
  /** One-sentence story, shown on the sample card. */
  story: string;
  /** The same in Brazilian Portuguese. */
  title_pt: string;
  story_pt: string;
  photos: { position: string; path: string; width: number; height: number }[];
  credit: { photographer: string; url: string; source: string; license: string };
  /** The weight on the sample's (made-up) invoice. */
  weight_kg: number;
  truck: { body: Body; size: Size; style?: import("./trucks").BodyStyle };
  passed: number;
  fixed_passed: number;
};

export type SampleData = Sample & {
  analysis: PhotoAnalysis;
  model: string;
  perception: PerceptionDraft;
  battery: Battery;
  plan: Plan;
  /** Every situation's run with keyframes, for the replays: as loaded and fixed. */
  runs: Record<"as_loaded" | "fixed", Partial<Record<SituationId, string>>>;
};

/** The sample the landing page's "Try the demo" opens: a load that fails, then is fixed. */
export const DEMO_SAMPLE = "crates-ropes";

let index: Promise<Sample[]> | null = null;

export function fetchSamples(): Promise<Sample[]> {
  index ??= fetch("/demo/samples/index.json")
    .then((response) => {
      if (!response.ok) throw new Error("no samples");
      return response.json() as Promise<{ samples: Sample[] }>;
    })
    .then((body) => body.samples)
    .catch((cause: unknown) => {
      index = null;
      throw cause;
    });
  return index;
}

export async function fetchSample(id: string): Promise<SampleData> {
  const response = await fetch(`/demo/samples/${encodeURIComponent(id)}.json`);
  if (!response.ok) throw new Error(`no sample ${id}`);
  return (await response.json()) as SampleData;
}

/** A sample situation's stored run (static file), or `null` when there is none. */
export async function fetchSampleRun(path: string | undefined): Promise<ServerRunResult | null> {
  if (!path) return null;
  const response = await fetch(path);
  if (!response.ok) return null;
  return ((await response.json()) as { result: ServerRunResult }).result;
}
