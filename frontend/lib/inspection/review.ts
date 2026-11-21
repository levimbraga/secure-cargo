/**
 * The review step's edits of a load draft that the explorer's editor does not make: add,
 * remove and resize units, change their cargo, and the weights. Weights come only from the
 * user (a photo cannot show them): the total from the invoice split by volume, or one per unit.
 */

import type { Cargo } from "@/lib/explorer/config";
import type { DraftUnit, LoadDraft } from "@/lib/explorer/draft";

/** Usual size of each cargo [length, width, height] in metres (as `backend/app/explorer/build.py`). */
export const CARGO_SIZE: Record<Cargo, [number, number, number]> = {
  wood_pallet: [1.2, 1.0, 1.1],
  plastic_pallet: [1.2, 1.0, 1.3],
  crate: [1.2, 1.0, 1.0],
  drum: [0.6, 0.6, 0.9],
  steel_coil: [1.6, 1.2, 1.6],
  machine: [2.0, 1.6, 1.2],
  tall_cabinet: [1.0, 0.8, 2.2],
  sacks: [1.2, 1.0, 1.0],
  long_pipes: [6.0, 0.5, 0.5],
  stacked_boxes: [0.8, 0.6, 0.6],
};
/** Cargo the engine draws as a cylinder: its cross-section is fixed. */
export const ROUND_CARGO = new Set<Cargo>(["drum", "steel_coil", "long_pipes"]);

const GRID = 0.05;
const EPS = 0.005;

type Bed = { length_m: number; width_m: number };

export function sizeOf(unit: DraftUnit): [number, number, number] {
  return unit.size_m ?? CARGO_SIZE[unit.cargo];
}

function grid(value: number): number {
  return Math.round(value / GRID) * GRID + 0;
}

function overlaps(a: { x: number; y: number; l: number; w: number }, b: typeof a): boolean {
  return Math.abs(a.x - b.x) < (a.l + b.l) / 2 - EPS && Math.abs(a.y - b.y) < (a.w + b.w) / 2 - EPS;
}

function floorBoxes(draft: LoadDraft, except?: string) {
  return draft.units
    .filter((unit) => !unit.on && unit.id !== except)
    .map((unit) => {
      const [l, w] = sizeOf(unit);
      return { x: unit.x_m, y: unit.y_m, l, w };
    });
}

function nextId(draft: LoadDraft): string {
  let n = draft.units.length + 1;
  const ids = new Set(draft.units.map((unit) => unit.id));
  while (ids.has(`unit-${n}`)) n += 1;
  return `unit-${n}`;
}

/** A new unit at the first free spot from the headboard, or `null` when the bed is full. */
export function addUnit(draft: LoadDraft, bed: Bed, cargo: Cargo): LoadDraft | null {
  const [l, w, h] = CARGO_SIZE[cargo];
  if (l > bed.length_m || w > bed.width_m) return null;
  const boxes = floorBoxes(draft);
  const halfL = (bed.length_m - l) / 2;
  const halfW = (bed.width_m - w) / 2;
  for (let x = grid(halfL); x >= -halfL - 1e-9; x = grid(x - GRID)) {
    for (let y = grid(halfW); y >= -halfW - 1e-9; y = grid(y - GRID)) {
      const spot = { x, y, l, w };
      if (!boxes.some((box) => overlaps(spot, box))) {
        const unit: DraftUnit = { id: nextId(draft), cargo, size_m: [l, w, h], mass_kg: null, x_m: x, y_m: y, straps: 0 };
        return { ...draft, units: [...draft.units, unit] };
      }
    }
  }
  return null;
}

/** Remove a unit and whatever stands on it. */
export function removeUnit(draft: LoadDraft, id: string): LoadDraft | null {
  const gone = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const unit of draft.units) {
      if (unit.on && gone.has(unit.on) && !gone.has(unit.id)) {
        gone.add(unit.id);
        changed = true;
      }
    }
  }
  const units = draft.units.filter((unit) => !gone.has(unit.id));
  return units.length ? { ...draft, units } : null;
}

/**
 * A new size for a unit (snapped to 5 cm), kept on the bed; `null` when it would overlap
 * another unit. A unit standing on it keeps within its footprint.
 */
export function resizeUnit(draft: LoadDraft, bed: Bed, id: string, size: [number, number, number]): LoadDraft | null {
  const unit = draft.units.find((item) => item.id === id);
  if (!unit) return null;
  const round = ROUND_CARGO.has(unit.cargo);
  const [, w0, h0] = sizeOf(unit);
  const l = Math.min(Math.max(grid(size[0]), 0.2), bed.length_m);
  const w = round ? w0 : Math.min(Math.max(grid(size[1]), 0.2), bed.width_m);
  const h = round ? h0 : Math.min(Math.max(grid(size[2]), 0.1), 3.5);
  if (unit.on) {
    const base = draft.units.find((item) => item.id === unit.on);
    const [bl, bw] = base ? sizeOf(base) : [l, w];
    return setUnit(draft, id, { size_m: [Math.min(l, bl), Math.min(w, bw), h] });
  }
  const x = Math.min(Math.max(unit.x_m, -(bed.length_m - l) / 2), (bed.length_m - l) / 2);
  const y = Math.min(Math.max(unit.y_m, -(bed.width_m - w) / 2), (bed.width_m - w) / 2);
  if (floorBoxes(draft, id).some((box) => overlaps({ x, y, l, w }, box))) return null;
  return {
    ...draft,
    units: draft.units.map((item) =>
      item.id === id
        ? { ...item, size_m: [l, w, h], x_m: Number(x.toFixed(4)), y_m: Number(y.toFixed(4)) }
        : item.on === id
          ? { ...item, x_m: Number(x.toFixed(4)), y_m: Number(y.toFixed(4)), size_m: clampTo(sizeOf(item), l, w) }
          : item,
    ),
  };
}

function clampTo(size: [number, number, number], l: number, w: number): [number, number, number] {
  return [Math.min(size[0], l), Math.min(size[1], w), size[2]];
}

export function setUnit(draft: LoadDraft, id: string, patch: Partial<DraftUnit>): LoadDraft {
  return { ...draft, units: draft.units.map((unit) => (unit.id === id ? { ...unit, ...patch } : unit)) };
}

/** Another cargo for a unit: its size becomes the cargo's usual one when the shape changes. */
export function setCargo(draft: LoadDraft, bed: Bed, id: string, cargo: Cargo): LoadDraft | null {
  const unit = draft.units.find((item) => item.id === id);
  if (!unit) return null;
  const shapeChanges = ROUND_CARGO.has(cargo) || ROUND_CARGO.has(unit.cargo);
  const changed = setUnit(draft, id, { cargo });
  return shapeChanges ? resizeUnit(changed, bed, id, CARGO_SIZE[cargo]) : changed;
}

/** The total weight split over the units in proportion to their volume, in whole kilograms. */
export function splitWeight(draft: LoadDraft, totalKg: number): LoadDraft {
  const volumes = draft.units.map((unit) => {
    const [l, w, h] = sizeOf(unit);
    return l * w * h;
  });
  const sum = volumes.reduce((a, b) => a + b, 0);
  const masses = volumes.map((v) => Math.round((totalKg * v) / sum));
  const biggest = masses.indexOf(Math.max(...masses));
  masses[biggest] = (masses[biggest] ?? 0) + Math.round(totalKg) - masses.reduce((a, b) => a + b, 0);
  return { ...draft, units: draft.units.map((unit, n) => ({ ...unit, mass_kg: masses[n] ?? null })) };
}

export function weightOf(draft: LoadDraft): number {
  return draft.units.reduce((sum, unit) => sum + (unit.mass_kg ?? 0), 0);
}

/** Every unit has a weight, and together they make the total (within 1 %, as the API checks). */
export function weightsComplete(draft: LoadDraft, totalKg: number | null): boolean {
  if (!totalKg || totalKg <= 0) return false;
  if (draft.units.some((unit) => !unit.mass_kg || unit.mass_kg <= 0)) return false;
  return Math.abs(weightOf(draft) - totalKg) <= Math.max(1, totalKg * 0.01);
}
