/**
 * The trucks as they are drawn: the simulation's bed, deck height, walls, payload and axle
 * groups (`backend/app/explorer/build.py`), plus the cab and the tractor's own axles, which the
 * simulation does not model. Exported from the backend by `scripts/export_truck_catalog.py`
 * (a backend test fails when this file is stale). Positions in metres from the front bumper.
 */

import data from "./truck-catalog.json";
import type { TruckSize } from "./trucks";

export type CatalogTruck = {
  country: "BR" | "US" | "EU";
  /** Bumper to the rear end of the deck. */
  length_m: number;
  axle_count: number;
  axles: { x_m: number; group: "steer" | "drive" | "rear" | "trailer" }[];
  wheel_m: number;
  cab: { kind: "cab_over" | "conventional"; length_m: number; height_m: number };
  /** The deck the cargo stands on (a step deck's lower deck). */
  deck: { front_x_m: number; length_m: number; width_m: number; floor_m: number; wall_m: number; headboard_m: number };
  upper_deck: { front_x_m: number; length_m: number; floor_m: number } | null;
  coupling: { kingpin_x_m: number; trailer_front_x_m: number; frame_end_x_m: number } | null;
  slider: boolean;
  payload_kg: number;
  /** Gross vehicle weight: tare plus payload (the tractor's steer axle included). */
  gvw_kg: number;
  /** US presets: the gross weight in pounds, to the nearest 100 lb. */
  gvw_lb: number | null;
  /** EU presets: the overall length the rules check (96/53/EC Annex I 1.1). */
  catalog_length_m: number | null;
};

export const TRUCK_CATALOG = data as Record<TruckSize, CatalogTruck>;

/** The longest truck: every drawing is scaled against it, so a VUC is visibly smaller. */
export const LONGEST_M = Math.max(...Object.values(TRUCK_CATALOG).map((truck) => truck.length_m));
