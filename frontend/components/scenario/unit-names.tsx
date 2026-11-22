"use client";

/**
 * Where each unit sits on the bed (front, middle, rear, on top), so a page can name a unit the
 * same way everywhere: "Unit 1 (front)" in the headline, the checklist, "What went wrong", the
 * fix and the labels of the 3D scene. Without a provider, units keep their plain names.
 */

import { createContext, type ReactNode, useContext, useMemo } from "react";

export type UnitPlace = "front" | "middle" | "rear" | "top";

const UnitPlaces = createContext<ReadonlyMap<string, UnitPlace> | null>(null);

/** Below this spread along the bed [m], the units stand side by side: no front or rear. */
const SPREAD_M = 0.3;

type Placed = { id: string; x: number; on?: string | null };

/**
 * Front, middle or rear by the unit's place within the load's own length (the front is towards
 * the headboard, +x); stacked units are "on top". A single unit, or units side by side, get none.
 */
export function unitPlaces(units: readonly Placed[]): Map<string, UnitPlace> {
  const places = new Map<string, UnitPlace>();
  if (units.length < 2) return places;
  const floor = units.filter((unit) => !unit.on);
  for (const unit of units) if (unit.on) places.set(unit.id, "top");
  if (floor.length < 2) return places;
  const xs = floor.map((unit) => unit.x);
  const low = Math.min(...xs);
  const high = Math.max(...xs);
  if (high - low < SPREAD_M) return places;
  for (const unit of floor) {
    const share = (unit.x - low) / (high - low);
    if (floor.length === 2) places.set(unit.id, share >= 0.5 ? "front" : "rear");
    else places.set(unit.id, share > 2 / 3 ? "front" : share < 1 / 3 ? "rear" : "middle");
  }
  return places;
}

export function UnitPlacesProvider({ units, children }: { units: readonly Placed[]; children: ReactNode }) {
  const key = units.map((unit) => `${unit.id}:${unit.x}:${unit.on ?? ""}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when a unit moves, not on every render
  const places = useMemo(() => unitPlaces(units), [key]);
  return <UnitPlaces.Provider value={places}>{children}</UnitPlaces.Provider>;
}

export function useUnitPlaces(): ReadonlyMap<string, UnitPlace> | null {
  return useContext(UnitPlaces);
}
