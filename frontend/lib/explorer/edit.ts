/**
 * The explorer's free-form edits of a load draft: add units of any cargo (several at once),
 * duplicate and remove them. Sizes, cargo and weights use the review step's operations
 * (`lib/inspection/review.ts`); this file adds what the explorer needs on top of them.
 *
 * New units get straps the way the configuration gives them: as many as the first unit on the
 * floor has, capped by the lashing points along the new unit, so an added pallet is secured like
 * its neighbours instead of standing loose.
 */

import { CARGO_SIZE, freeSpot, nextUnitId, ROUND_CARGO, sizeOf } from "@/lib/inspection/review";
import type { Scenario } from "@/lib/live/scenario";

import type { Cargo } from "./config";
import { type DraftUnit, type Footprint, type LoadDraft, strapRoom } from "./draft";

type Bed = {
  length_m: number;
  width_m: number;
  anchor_points: { position_m: [number, number, number] | number[] }[];
};

/**
 * Each cargo's id prefix and usual mass [kg], as `CARGO` in `backend/app/explorer/build.py`:
 * a new unit is named like the configuration names its units ("pallet-4" reads "Pallet 4").
 */
export const CARGO_UNIT: Record<Cargo, { prefix: string; massKg: number }> = {
  wood_pallet: { prefix: "pallet", massKg: 900 },
  plastic_pallet: { prefix: "stack", massKg: 800 },
  crate: { prefix: "crate", massKg: 1500 },
  drum: { prefix: "drum", massKg: 250 },
  steel_coil: { prefix: "coil", massKg: 10_000 },
  machine: { prefix: "machine", massKg: 6000 },
  tall_cabinet: { prefix: "cabinet", massKg: 700 },
  sacks: { prefix: "sacks", massKg: 1000 },
  long_pipes: { prefix: "pipe", massKg: 720 },
  stacked_boxes: { prefix: "carton", massKg: 80 },
};

/** The weight a unit is simulated with [kg]: its own, or its cargo's usual one. */
export function massOf(unit: DraftUnit): number {
  return unit.mass_kg ?? CARGO_UNIT[unit.cargo].massKg;
}

/** How many units the editor adds in one go at most. */
export const MAX_ADD = 20;
/** At most this many units in a draft (as `backend/app/explorer/draft.py`). */
export const MAX_UNITS = 40;

/** Anchor pairs facing each other along a footprint: how many top-over straps fit over it. */
export function strapRoomAt(bed: Bed, x: number, length: number, y: number, cargo: Cargo = "crate"): number {
  // The editor's own rule (`strapRoom`, the mirror of `_anchor_pairs` on the server), for a unit
  // that is not built yet.
  const unit = { x, y, length, width: 0, height: 0, cargo, round: ROUND_CARGO.has(cargo) } as unknown as Footprint;
  return strapRoom({ bed } as unknown as Scenario, unit);
}

/** The straps a new unit gets: as many as the first floor unit has, where they fit. */
function defaultStraps(draft: LoadDraft, bed: Bed, unit: DraftUnit): number {
  const first = draft.units.find((item) => !item.on);
  const wanted = first ? (draft.units.find((item) => item.on === first.id)?.straps ?? first.straps) : 2;
  const [l] = sizeOf(unit);
  return Math.min(wanted, strapRoomAt(bed, unit.x_m, l, unit.y_m, unit.cargo));
}

/**
 * `count` new units of `cargo`, each at the first free spot from the headboard. Returns the
 * draft with as many as fit (`added` may be fewer than asked; 0 leaves the draft unchanged).
 */
export function addUnits(draft: LoadDraft, bed: Bed, cargo: Cargo, count: number): { draft: LoadDraft; added: string[] } {
  let next = draft;
  const added: string[] = [];
  const [l, w, h] = CARGO_SIZE[cargo];
  for (let n = 0; n < Math.min(count, MAX_ADD) && next.units.length < MAX_UNITS; n++) {
    const spot = freeSpot(next, bed, l, w);
    if (!spot) break;
    const unit: DraftUnit = { id: nextUnitId(next, CARGO_UNIT[cargo].prefix), cargo, size_m: [l, w, h], mass_kg: null, x_m: spot.x, y_m: spot.y, straps: 0 };
    unit.straps = defaultStraps(next, bed, unit);
    next = { ...next, units: [...next.units, unit] };
    added.push(unit.id);
  }
  return { draft: next, added };
}

/** A copy of a floor unit (its size, weight and straps) at the first free spot, or `null` without room. */
export function duplicateUnit(draft: LoadDraft, bed: Bed, id: string): { draft: LoadDraft; id: string } | null {
  const unit = draft.units.find((item) => item.id === id);
  if (!unit || draft.units.length >= MAX_UNITS) return null;
  const [l, w] = sizeOf(unit);
  const spot = freeSpot(draft, bed, l, w);
  if (!spot) return null;
  const copy: DraftUnit = { ...unit, id: nextUnitId(draft, CARGO_UNIT[unit.cargo].prefix), size_m: sizeOf(unit), on: null, x_m: spot.x, y_m: spot.y };
  copy.straps = Math.min(unit.straps, strapRoomAt(bed, spot.x, l, spot.y, unit.cargo));
  return { draft: { ...draft, units: [...draft.units, copy] }, id: copy.id };
}
