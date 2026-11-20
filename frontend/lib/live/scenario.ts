/** The load scenario and trip event as the API takes them (`backend/app/scenario/models.py`). */

import type { Vec3 } from "@/lib/keyframes";

export const EVENT_KINDS = [
  "emergency_braking",
  "lane_change",
  "sharp_curve",
  "pothole",
  "speed_bump",
  "mountain_descent",
  "long_vibration",
  "full_trip",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const ROAD_SURFACES = ["dry", "wet", "heavy_rain", "mud", "gravel"] as const;
export type RoadSurface = (typeof ROAD_SURFACES)[number];

export type TripEventInput = {
  kind: EventKind;
  speed_kmh: number;
  road_surface: RoadSurface;
  fog: boolean;
  curve_radius_m: number | null;
  grade_percent: number | null;
  /** Full trip only: its events in order; null for the default trip. */
  segments?: EventKind[] | null;
};

export type AnchorPoint = { id: string; position_m: Vec3; rated_capacity_n: number | null };

export type ScenarioUnit = {
  id: string;
  label: string;
  size_m: Vec3;
  mass_kg: number;
  position_m: Vec3;
  material: string;
  friction_coefficient: number | null;
  stackable: boolean;
};

export type ScenarioLashing = {
  id: string;
  kind: "strap" | "chain" | "rope";
  routing: "top_over" | "direct";
  unit_id: string;
  anchor_ids: string[];
  attachment_point_m: Vec3 | null;
  pretension_n: number;
  lashing_capacity_n: number;
  elongation_at_lc: number | null;
  breaking_strength_n: number | null;
};

export type Scenario = {
  schema_version: 1;
  id: string;
  name: string;
  bed: {
    length_m: number;
    width_m: number;
    floor_height_m: number;
    floor_material: string;
    headboard: { height_m: number; rated_capacity_n: number | null } | null;
    side_rail_height_m: number;
    anchor_points: AnchorPoint[];
  };
  vehicle: unknown;
  units: ScenarioUnit[];
  lashings: ScenarioLashing[];
};
