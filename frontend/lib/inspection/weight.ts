/**
 * The cargo weight: typed, read from the invoice, or estimated.
 *
 * An **estimate** ("I don't know") is a range from what the photo shows (each unit's cargo type
 * and volume) times a plausible density for that cargo. The battery then runs at the upper
 * bound (the harder case for the load and the axles), and the result says "weight estimated":
 * an estimate is never shown as measured. Densities (kg per m³ of a unit's outer volume) are our
 * assumptions, listed with their reasoning in the workspace's `notes/legal-limits.md`.
 *
 * The total is split over the units in proportion to their volume (`splitWeight`), or the
 * driver gives one weight per unit; the units always add up to the total.
 */

import type { Cargo } from "@/lib/explorer/config";
import type { LoadDraft } from "@/lib/explorer/draft";

import { sizeOf, splitWeight, weightOf } from "./review";

export type WeightSource = "measured" | "invoice" | "estimated";
export type WeightRange = { low_kg: number; high_kg: number };

/** Plausible density of each cargo's outer volume [kg/m³]: low and high. */
export const DENSITY_KG_M3: Record<Cargo, [number, number]> = {
  wood_pallet: [150, 600],
  plastic_pallet: [80, 350],
  crate: [150, 700],
  drum: [400, 1100],
  steel_coil: [2500, 4500],
  machine: [300, 1500],
  tall_cabinet: [80, 350],
  sacks: [600, 1000],
  long_pipes: [150, 900],
  stacked_boxes: [80, 350],
};

const STEP_KG = 50;

/** The range of the whole load, rounded outwards to 50 kg; `null` without units. */
export function estimateRange(draft: Pick<LoadDraft, "units">): WeightRange | null {
  if (!draft.units.length) return null;
  let low = 0;
  let high = 0;
  for (const unit of draft.units) {
    const [l, w, h] = sizeOf(unit);
    const [dLow, dHigh] = DENSITY_KG_M3[unit.cargo];
    low += l * w * h * dLow;
    high += l * w * h * dHigh;
  }
  const lowKg = Math.max(STEP_KG, Math.floor(low / STEP_KG) * STEP_KG);
  const highKg = Math.max(lowKg, Math.ceil(high / STEP_KG) * STEP_KG);
  return { low_kg: lowKg, high_kg: highKg };
}

/** The weight the battery runs at: the measured one, or the top of the estimated range. */
export function simulatedWeight(source: WeightSource, totalKg: number | null, range: WeightRange | null): number | null {
  if (source === "estimated") return range?.high_kg ?? null;
  return totalKg && totalKg > 0 ? totalKg : null;
}

/** How the total spreads over the units, for "≈600 kg each across 3 units". */
export function describeSplit(draft: Pick<LoadDraft, "units">):
  | { kind: "equal"; each: number; count: number }
  | { kind: "varied"; min: number; max: number; count: number }
  | null {
  const masses = draft.units.map((unit) => unit.mass_kg ?? 0);
  if (!masses.length || masses.some((m) => m <= 0)) return null;
  const min = Math.min(...masses);
  const max = Math.max(...masses);
  // Within 5 % (rounding of the volume split): "each".
  if (max - min <= Math.max(1, 0.05 * max)) {
    const each = masses.reduce((a, b) => a + b, 0) / masses.length;
    return { kind: "equal", each: Math.round(each / 10) * 10, count: masses.length };
  }
  return { kind: "varied", min: Math.round(min), max: Math.round(max), count: masses.length };
}

/** Weights per unit the driver typed: valid when every unit has one and they make the total. */
export function perUnitMatches(masses: (number | null)[], totalKg: number): boolean {
  if (masses.some((m) => !m || m <= 0)) return false;
  const sum = (masses as number[]).reduce((a, b) => a + b, 0);
  return Math.abs(sum - totalKg) <= Math.max(1, totalKg * 0.01);
}

/** The draft with the weight on it: split by volume, or the driver's own per-unit weights. */
export function withWeights(draft: LoadDraft, totalKg: number, perUnit: Record<string, number> | null): LoadDraft {
  if (perUnit && perUnitMatches(draft.units.map((u) => perUnit[u.id] ?? null), totalKg)) {
    return { ...draft, units: draft.units.map((unit) => ({ ...unit, mass_kg: perUnit[unit.id] ?? null })) };
  }
  return splitWeight(draft, totalKg);
}

export { weightOf };
