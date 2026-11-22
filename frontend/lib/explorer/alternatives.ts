/**
 * Bigger changes to try when the planner cannot make a load pass on its own truck: the same load
 * on a bigger truck of the same family, or fewer units on this trip (the rest on a second one).
 * Each alternative is a load draft the planner then fixes and proves on the server, like the
 * load itself (`POST /plan`); the explorer ranks what comes back (`rankOptions`).
 *
 * The planner already does what can be done on this truck: arrange the units (against the
 * headboard, off an overloaded axle, unstacked), secure them (straps, mats, diagonals, chains,
 * blocking, cradles) and replace what the rules forbid (ropes).
 */

import { BR_SIZES, EU_SIZES, type Size, US_SIZES } from "./config";
import type { LoadDraft } from "./draft";
import { massOf } from "./edit";
import { SIZE_INFO } from "@/lib/inspection/trucks";

export type OptionKind = "this_truck" | "bigger_truck" | "fewer_units";

export type Alternative = {
  kind: Exclude<OptionKind, "this_truck">;
  draft: LoadDraft;
  /** Bigger truck: its size. */
  size?: Size;
  /** Fewer units: the units left for a second trip. */
  removed?: string[];
};

/** How many bigger trucks are tried at most (each costs a planner run). */
export const MAX_TRUCKS = 2;

function family(size: Size): readonly Size[] {
  if (size.startsWith("us_")) return US_SIZES;
  if (size.startsWith("eu_")) return EU_SIZES;
  return BR_SIZES;
}

export function loadMassKg(draft: LoadDraft): number {
  return draft.units.reduce((sum, unit) => sum + massOf(unit), 0);
}

export function payloadKg(size: Size): number {
  return SIZE_INFO[size].payloadT * 1000;
}

/**
 * The same load on the next bigger trucks of the family that can carry its weight, lightest
 * first. The units keep their distance to the headboard (a longer bed adds room at the rear);
 * lashings set by hand are dropped, since the lashing points of another bed are not the same.
 */
export function biggerTrucks(draft: LoadDraft, max = MAX_TRUCKS): Alternative[] {
  const current = draft.truck.size;
  const mass = loadMassKg(draft);
  const now = SIZE_INFO[current];
  const sizes = [...family(current)]
    .filter((size) => size !== current && SIZE_INFO[size].payloadT > now.payloadT && payloadKg(size) >= mass)
    .sort((a, b) => SIZE_INFO[a].payloadT - SIZE_INFO[b].payloadT || SIZE_INFO[a].bedM - SIZE_INFO[b].bedM)
    .slice(0, max);
  return sizes.map((size) => {
    const shift = (SIZE_INFO[size].bedM - (draft.truck.bed_length_m ?? now.bedM)) / 2;
    const truck: LoadDraft["truck"] = { body: draft.truck.body, size, body_code: draft.truck.body_code ?? null };
    if (draft.truck.style) truck.style = draft.truck.style;
    return {
      kind: "bigger_truck",
      size,
      draft: {
        ...draft,
        truck,
        units: draft.units.map((unit) => ({ ...unit, x_m: Number((unit.x_m + shift).toFixed(4)), lashings: null })),
      },
    };
  });
}

/** A unit and everything standing on it. */
function stackOf(draft: LoadDraft, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const unit of draft.units) if (unit.on === out[i]) out.push(unit.id);
  }
  return out;
}

/**
 * The load with fewer units: enough stacks taken off to be within the truck's payload (the
 * heaviest first), or else one stack, the one that fails most often (`failing`, from the
 * planner's best try) or the rearmost. `null` when only one stack is left.
 */
export function fewerUnits(draft: LoadDraft, failing: string[] = []): Alternative | null {
  const floor = draft.units.filter((unit) => !unit.on);
  if (floor.length < 2) return null;
  const weight = (id: string) => stackOf(draft, id).reduce((sum, item) => sum + massOf(draft.units.find((u) => u.id === item)!), 0);
  const payload = payloadKg(draft.truck.size);
  let removed: string[] = [];
  let mass = loadMassKg(draft);
  if (mass > payload) {
    for (const unit of [...floor].sort((a, b) => weight(b.id) - weight(a.id))) {
      if (mass <= payload || removed.length >= floor.length - 1) break;
      removed = [...removed, ...stackOf(draft, unit.id)];
      mass -= weight(unit.id);
    }
  } else {
    const floorIds = new Set(floor.map((unit) => unit.id));
    // A failing unit's stack: the floor unit under it.
    const base = (id: string): string => {
      const unit = draft.units.find((item) => item.id === id);
      return unit?.on ? base(unit.on) : id;
    };
    const target = failing.map(base).find((id) => floorIds.has(id)) ?? [...floor].sort((a, b) => a.x_m - b.x_m)[0]!.id;
    removed = stackOf(draft, target);
  }
  if (!removed.length || removed.length >= draft.units.length) return null;
  const gone = new Set(removed);
  return { kind: "fewer_units", removed, draft: { ...draft, units: draft.units.filter((unit) => !gone.has(unit.id)) } };
}

export type RankedOption<P> = { kind: OptionKind; plan: P; alternative: Alternative | null };

/**
 * Options in the order to recommend them: those proven (they hold everywhere and comply)
 * first; then those that at least arrive intact; then the rest. Within each, the smallest
 * change first: this truck, then a bigger truck (the lightest first), then fewer units.
 */
export function rankOptions<P extends { verified: boolean }>(options: RankedOption<P>[], holds: (plan: P) => boolean): RankedOption<P>[] {
  const order: Record<OptionKind, number> = { this_truck: 0, bigger_truck: 1, fewer_units: 2 };
  const grade = (option: RankedOption<P>) => (option.plan.verified ? 0 : holds(option.plan) ? 1 : 2);
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => grade(a.option) - grade(b.option) || order[a.option.kind] - order[b.option.kind] || a.index - b.index)
    .map(({ option }) => option);
}
