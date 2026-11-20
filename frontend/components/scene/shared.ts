import type { RefObject } from "react";

import type { KeyframesDoc, Sample, Vec3 } from "@/lib/keyframes";
import type { Impact, Series } from "@/lib/replay";

/** Scene colours. The neutral ones mirror the design tokens in app/globals.css. */
export const COLOR = {
  ink: "#191918",
  paper: "#f8f8f3",
  surface: "#e9e9e4",
  hairline: "#c9c9c1",
  gray: "#8a8a86",
  amber: "#f2a100",
  fail: "#b42318",
  pass: "#136f33",
  wood: "#c9a877",
  steel: "#b9bcbd",
  chassis: "#2f3031",
  tire: "#1d1d1c",
  asphalt: "#6f6f6a",
  marking: "#f1f1ea",
} as const;

export type ViewMode = "realistic" | "engineering";

/** State of the replay at the frame being drawn, shared by every part of the scene. */
export type Live = {
  t: number;
  sample: Sample;
  /** Distance the truck has covered on the road [m]. */
  distance: number;
  /** Height of the bed above its starting level [m]. */
  height: number;
  /** Index of the strap under the pointer (or last tapped), or -1. */
  activeStrap: number;
};

export type SceneProps = {
  doc: KeyframesDoc;
  series: Series;
  impacts: Impact[];
  live: RefObject<Live>;
  mode: ViewMode;
};

/** Metres of arrow per newton: 1 m for 10 kN, the same for every unit and every scenario. */
export const FORCE_SCALE = 1e-4;
/** Forces below this are not drawn [N]. */
export const FORCE_MIN = 250;

/** Simulation frame (X forward, Y left, Z up) to three.js (Y up): [x, y, z] -> [x, z, -y]. */
export function three([x, y, z]: Vec3): Vec3 {
  return [x, z, -y];
}
