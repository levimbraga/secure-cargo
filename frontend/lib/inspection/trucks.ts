/**
 * The trucks a driver picks from: five sizes (axles and a typical payload under each) and five
 * body styles, each simulated as one of the three physics bodies. The typical payloads are the
 * illustrative values of our parametric trucks (`backend/app/explorer/build.py`), not any
 * manufacturer's model (`notes/legal-limits.md`).
 */

import type { Country } from "@/lib/country";
import type { LoadDraft } from "@/lib/explorer/draft";

export const BR_TRUCK_SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"] as const;
/** US presets (US mode): typical values in `notes/us-rules.md` section 4, not a specific model. */
export const US_TRUCK_SIZES = ["us_box", "us_straight", "us_flatbed_48", "us_dry_van_53", "us_step_deck"] as const;
export const TRUCK_SIZES = [...BR_TRUCK_SIZES, ...US_TRUCK_SIZES] as const;
export type TruckSize = (typeof TRUCK_SIZES)[number];

/** The sizes on a country's truck cards. */
export function sizesOf(country: Country): readonly TruckSize[] {
  return country === "US" ? US_TRUCK_SIZES : BR_TRUCK_SIZES;
}

export function isUsSize(size: string): boolean {
  return (US_TRUCK_SIZES as readonly string[]).includes(size);
}

/**
 * The body styles a US preset comes in: a dry van and a box truck are boxes, the flatbeds open;
 * only the straight truck is offered with either. Brazilian sizes take every style.
 */
export const US_STYLES: Record<(typeof US_TRUCK_SIZES)[number], readonly BodyStyle[]> = {
  us_box: ["box"],
  us_straight: ["platform", "box", "curtain_sider"],
  us_flatbed_48: ["platform"],
  us_dry_van_53: ["box"],
  us_step_deck: ["platform"],
};

export function stylesOf(size: TruckSize): readonly BodyStyle[] {
  return isUsSize(size) ? US_STYLES[size as (typeof US_TRUCK_SIZES)[number]] : BODY_STYLES;
}
export const BODY_STYLES: readonly BodyStyle[] = ["open_low_sides", "open_tall_rack", "platform", "box", "curtain_sider"];
export type BodyStyle = "open_low_sides" | "open_tall_rack" | "platform" | "box" | "curtain_sider";
export type PhysicsBody = "flatbed" | "box" | "curtain_sider";

export const STYLE_BODY: Record<BodyStyle, PhysicsBody> = {
  open_low_sides: "flatbed",
  open_tall_rack: "flatbed",
  platform: "flatbed",
  box: "box",
  curtain_sider: "curtain_sider",
};

/**
 * Axles of the whole vehicle (a semi: a three-axle tractor and a three-axle trailer; a US
 * tractor-semitrailer: steer, drive tandem, trailer tandem). US presets: payload in pounds.
 */
export const SIZE_INFO: Record<TruckSize, { axles: number; payloadT: number; bedM: number; payloadLb?: number }> = {
  vuc: { axles: 2, payloadT: 4, bedM: 4.2 },
  three_quarter: { axles: 2, payloadT: 5, bedM: 5.2 },
  toco: { axles: 2, payloadT: 8, bedM: 6.2 },
  truck: { axles: 3, payloadT: 14, bedM: 8.0 },
  semi: { axles: 6, payloadT: 28, bedM: 12.4 },
  us_box: { axles: 2, payloadT: 5.4, bedM: 7.92, payloadLb: 11_900 },
  us_straight: { axles: 3, payloadT: 11, bedM: 7.32, payloadLb: 24_250 },
  us_flatbed_48: { axles: 5, payloadT: 21.8, bedM: 14.63, payloadLb: 48_000 },
  us_dry_van_53: { axles: 5, payloadT: 20.4, bedM: 16.0, payloadLb: 45_000 },
  us_step_deck: { axles: 5, payloadT: 21.3, bedM: 11.58, payloadLb: 47_000 },
};

export type TruckChoice = {
  size: TruckSize;
  style: BodyStyle;
  bed_length_m?: number | null;
  headboard_height_m?: number | null;
  anchors_per_side?: number | null;
  /** A truck from "My trucks". */
  truck_id?: string | null;
  nickname?: string | null;
};

export type SavedTruck = {
  id: string;
  nickname: string;
  size: TruckSize;
  style: BodyStyle;
  bed_length_m: number | null;
  headboard_height_m: number | null;
  anchors_per_side: number | null;
};

/** The draft's truck for a choice (the measurements only when known). */
export function draftTruck(choice: TruckChoice): LoadDraft["truck"] {
  return {
    body: STYLE_BODY[choice.style],
    size: choice.size,
    style: choice.style,
    ...(choice.bed_length_m ? { bed_length_m: choice.bed_length_m } : {}),
    ...(choice.headboard_height_m ? { headboard_height_m: choice.headboard_height_m } : {}),
    ...(choice.anchors_per_side ? { anchors_per_side: choice.anchors_per_side } : {}),
  };
}

/** The style the AI's body guess stands for (it only tells the three physics bodies apart). */
export function styleOfGuess(body: string | null | undefined): BodyStyle | null {
  if (body === "flatbed") return "open_low_sides";
  if (body === "box" || body === "curtain_sider") return body;
  return null;
}

export function sizeOfGuess(size: string | null | undefined): TruckSize | null {
  return (TRUCK_SIZES as readonly string[]).includes(size ?? "") ? (size as TruckSize) : null;
}

/** A draft truck (or a stored truck_json) back to a choice, for the summary and the cards. */
export function choiceOf(truck: Partial<LoadDraft["truck"]> & { truck_id?: string | null } | null | undefined): TruckChoice | null {
  if (!truck?.size) return null;
  const size = sizeOfGuess(truck.size) ?? "toco";
  const style = truck.style ?? styleOfGuess(truck.body) ?? "open_low_sides";
  return {
    size,
    style,
    bed_length_m: truck.bed_length_m ?? null,
    headboard_height_m: truck.headboard_height_m ?? null,
    anchors_per_side: truck.anchors_per_side ?? null,
    truck_id: truck.truck_id ?? null,
  };
}
