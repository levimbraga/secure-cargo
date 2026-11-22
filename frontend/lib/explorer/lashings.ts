/**
 * Lashings set by hand in the explorer: a unit's lashings as a list the editor changes one by
 * one (device, route, lashing point, corner), and the angles that follow from the geometry.
 *
 * A unit starts with the usual lashings the server builds (its straps and the restraint's
 * diagonals). The first change to one of them copies them all into the draft (`lashings` on the
 * unit), so from then on the unit's lashings are exactly the list. The server builds them in
 * `_by_hand` (`backend/app/explorer/build.py`), with the same attachment points as here.
 */

import type { Scenario, ScenarioLashing } from "@/lib/live/scenario";

import type { DraftLashing, DraftUnit, Footprint, LoadDraft } from "./draft";
import { strapPairs } from "./draft";

export type Corner = NonNullable<DraftLashing["corner"]>;
export const CORNERS: Corner[] = ["front_left", "front_right", "rear_left", "rear_right"];
export const KINDS: DraftLashing["kind"][] = ["strap", "chain", "rope"];
/** At most this many lashings set by hand on one unit (as the server). */
export const MAX_LASHINGS = 16;

/** Rated capacity LC of each device the explorer uses [daN] (`STRAP`, `CHAIN`, `ROPE` in `build.py`). */
export const CAPACITY_DAN: Record<DraftLashing["kind"], number> = { strap: 2500, chain: 4000, rope: 100 };

type Bed = Pick<Scenario, "bed">;
type Unit = Pick<Footprint, "id" | "x" | "y" | "z" | "length" | "width" | "height" | "cargo">;

function anchorOf(bed: Bed, id: string) {
  return bed.bed.anchor_points.find((anchor) => anchor.id === id);
}

/** A coil lying across the truck is chained through its eye (as `_diagonals` on the server). */
function throughEye(unit: Pick<Unit, "cargo">): boolean {
  return unit.cargo === "steel_coil";
}

/** Where a diagonal is fixed on the unit, from the centre of its bottom face [m]. */
export function attachmentPoint(unit: Unit, corner: Corner): [number, number, number] {
  const end = corner.startsWith("front") ? 1 : -1;
  const side = corner.endsWith("left") ? 1 : -1;
  if (throughEye(unit)) return [0, (side * unit.width) / 2, unit.height / 2];
  return [(end * unit.length) / 2, (side * unit.width) / 2, Math.min(0.4, unit.height / 2)];
}

/** A unit's lashings as the server built them, as a list set by hand. */
export function fromScenario(lashings: ScenarioLashing[], unit: Pick<Unit, "id" | "x">, bed: Bed): DraftLashing[] {
  return lashings
    .filter((lashing) => lashing.unit_id === unit.id)
    .map((lashing) => {
      if (lashing.routing === "top_over") return { kind: lashing.kind, routing: "top_over", anchors: [...lashing.anchor_ids] };
      const [px = 0, py = 0] = lashing.attachment_point_m ?? [0, 0, 0];
      const anchorX = anchorOf(bed, lashing.anchor_ids[0] ?? "")?.position_m[0] ?? unit.x;
      const front = px !== 0 ? px > 0 : anchorX > unit.x;
      const corner = `${front ? "front" : "rear"}_${py > 0 ? "left" : "right"}` as Corner;
      return { kind: lashing.kind, routing: "direct", anchors: [...lashing.anchor_ids], corner };
    });
}

/** The unit's lashings as a list set by hand: its own, or the server's usual ones. */
export function lashingsOf(draft: LoadDraft, scenario: Scenario, unit: Unit): DraftLashing[] {
  const own = draft.units.find((item) => item.id === unit.id)?.lashings;
  return own ? own : fromScenario(scenario.lashings, unit, scenario);
}

export function setLashings(draft: LoadDraft, id: string, lashings: DraftLashing[]): LoadDraft {
  return { ...draft, units: draft.units.map((unit): DraftUnit => (unit.id === id ? { ...unit, lashings } : unit)) };
}

/** Back to the usual lashings of the load's securing. */
export function resetLashings(draft: LoadDraft, id: string): LoadDraft {
  return { ...draft, units: draft.units.map((unit): DraftUnit => (unit.id === id ? { ...unit, lashings: null } : unit)) };
}

/** The lashing points on one side of the bed, rear first. */
export function sidePoints(bed: Bed, left: boolean) {
  return bed.bed.anchor_points
    .filter((anchor) => (anchor.position_m[1] > 0) === left)
    .sort((a, b) => a.position_m[0] - b.position_m[0]);
}

/** The diagonal's lashing point by default: on its corner's side, 0.9 m beyond that end of the unit. */
export function defaultDiagonalAnchor(bed: Bed, unit: Unit, corner: Corner): string {
  const end = corner.startsWith("front") ? 1 : -1;
  const target = unit.x + end * (unit.length / 2 + 0.9);
  const points = sidePoints(bed, corner.endsWith("left"));
  const best = points.reduce((a, b) => (Math.abs(b.position_m[0] - target) < Math.abs(a.position_m[0] - target) ? b : a), points[0]!);
  return best.id;
}

/** One more lashing on a unit: over the top at the first pair not yet used, or a diagonal at the next free corner. */
export function addLashing(list: DraftLashing[], bed: Bed, unit: Unit, routing: DraftLashing["routing"], kind: DraftLashing["kind"]): DraftLashing[] | null {
  if (list.length >= MAX_LASHINGS) return null;
  if (routing === "top_over") {
    const used = new Set(list.filter((item) => item.routing === "top_over").map((item) => item.anchors[0]));
    const pairs = strapPairs(bed, unit);
    const pair = pairs.find((item) => !used.has(item.left)) ?? pairs[Math.floor(pairs.length / 2)];
    if (!pair) return null;
    return [...list, { kind, routing, anchors: [pair.left, pair.right] }];
  }
  const taken = list.filter((item) => item.routing === "direct").map((item) => item.corner);
  const corner = CORNERS.find((item) => !taken.includes(item)) ?? "front_left";
  return [...list, { kind, routing, anchors: [defaultDiagonalAnchor(bed, unit, corner)], corner }];
}

/** Angles of a lashing [degrees]: vertical α (to the bed), and for a diagonal β (to the length of the truck). */
export function anglesOf(lashing: DraftLashing, bed: Bed, unit: Unit): { alpha: number; beta: number | null } | null {
  const deg = (radians: number) => (radians * 180) / Math.PI;
  if (lashing.routing === "top_over") {
    const anchor = anchorOf(bed, lashing.anchors[0] ?? "");
    if (!anchor) return null;
    const [, ay, az] = anchor.position_m;
    const side = ay > unit.y ? 1 : -1;
    const across = Math.abs(ay - (unit.y + (side * unit.width) / 2));
    const up = unit.z + unit.height - az;
    return { alpha: deg(Math.atan2(up, across)), beta: null };
  }
  const anchor = anchorOf(bed, lashing.anchors[0] ?? "");
  if (!anchor) return null;
  const [px, py, pz] = attachmentPoint(unit, lashing.corner ?? "front_left");
  const dx = anchor.position_m[0] - (unit.x + px);
  const dy = anchor.position_m[1] - (unit.y + py);
  const dz = anchor.position_m[2] - (unit.z + pz);
  return { alpha: deg(Math.atan2(Math.abs(dz), Math.hypot(dx, dy))), beta: deg(Math.atan2(Math.abs(dy), Math.abs(dx))) };
}
