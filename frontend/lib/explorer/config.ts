/**
 * Explorer configuration: one value per dimension, plus the load editor's edits, as it travels
 * in the page URL. The mirror of `backend/app/explorer/config.py`: `toQuery` writes the same
 * canonical string (fixed key order, defaults left out, two-decimal coordinates), which is also
 * the key of the static cache in `public/demo/explorer/index.json`.
 */

import type { Country } from "@/lib/country";

export const BODIES = ["flatbed", "box", "curtain_sider"] as const;
export const BR_SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"] as const;
/** US presets (US mode, `notes/us-rules.md` section 4): typical values, not a specific model. */
export const US_SIZES = ["us_box", "us_straight", "us_flatbed_48", "us_dry_van_53", "us_step_deck"] as const;
export const SIZES = [...BR_SIZES, ...US_SIZES] as const;
export const CARGOES = [
  "wood_pallet",
  "plastic_pallet",
  "crate",
  "drum",
  "steel_coil",
  "machine",
  "tall_cabinet",
  "sacks",
  "long_pipes",
  "stacked_boxes",
] as const;
export const POSITIONS = ["headboard", "gap", "rear", "side", "stacked"] as const;
export const RESTRAINTS = ["none", "top_over", "direct", "chain", "rope", "blocking", "mat", "cradle", "cradle_chain"] as const;
export const ROADS = ["straight", "curvy", "mountain", "dirt", "potholed", "urban"] as const;
export const WEATHERS = ["dry", "wet", "heavy_rain", "mud", "fog"] as const;
export const EVENTS = [
  "emergency_braking",
  "lane_change",
  "sharp_curve",
  "pothole",
  "speed_bump",
  "mountain_descent",
  "long_vibration",
  "full_trip",
] as const;
export const SPEED_MIN = 20;
export const SPEED_MAX = 100;
export const MAX_STRAPS_PER_UNIT = 6;

export type Body = (typeof BODIES)[number];
export type Size = (typeof SIZES)[number];
export type Cargo = (typeof CARGOES)[number];
export type Position = (typeof POSITIONS)[number];
export type Restraint = (typeof RESTRAINTS)[number];
export type Road = (typeof ROADS)[number];
export type Weather = (typeof WEATHERS)[number];
export type ExplorerEvent = (typeof EVENTS)[number];

export type UnitMove = { index: number; x_m: number; y_m: number };

export type ExplorerConfig = {
  body: Body;
  size: Size;
  cargo: Cargo;
  position: Position;
  restraint: Restraint;
  speed_kmh: number;
  road: Road;
  weather: Weather;
  event: ExplorerEvent;
  /** Edits of the load editor; `null` means "the cargo's default". */
  count: number | null;
  mass_kg: number | null;
  /** Lashings over each unit (each stack), in unit order. */
  straps: number[] | null;
  moves: UnitMove[];
  /** Whose rules the load is checked against (changes no physics). */
  country: Country;
};

/** The dimensions with a selector, in the order the page shows them. */
export const DIMENSIONS = {
  body: BODIES,
  size: SIZES,
  cargo: CARGOES,
  position: POSITIONS,
  restraint: RESTRAINTS,
  road: ROADS,
  weather: WEATHERS,
  event: EVENTS,
} as const;
export type Dimension = keyof typeof DIMENSIONS;

export const DEFAULT_CONFIG: ExplorerConfig = {
  body: "flatbed",
  size: "toco",
  cargo: "wood_pallet",
  position: "gap",
  restraint: "top_over",
  speed_kmh: 80,
  road: "straight",
  weather: "dry",
  event: "emergency_braking",
  count: null,
  mass_kg: null,
  straps: null,
  moves: [],
  country: "BR",
};

/** Two decimals, without a sign on zero, exactly as the server writes them. */
function coordinate(value: number): string {
  const text = value.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}

/** The canonical query string, without the leading "?". */
export function toQuery(config: ExplorerConfig): string {
  const parts: [string, string][] = [
    ["body", config.body],
    ["size", config.size],
    ["cargo", config.cargo],
    ["position", config.position],
    ["restraint", config.restraint],
    ["speed", String(config.speed_kmh)],
    ["road", config.road],
    ["weather", config.weather],
    ["event", config.event],
  ];
  if (config.count !== null) parts.push(["n", String(config.count)]);
  if (config.mass_kg !== null) parts.push(["kg", String(config.mass_kg)]);
  if (config.straps !== null) parts.push(["straps", config.straps.join(".")]);
  if (config.moves.length) {
    parts.push([
      "moves",
      config.moves.map((move) => `${move.index}_${coordinate(move.x_m)}_${coordinate(move.y_m)}`).join("*"),
    ]);
  }
  if (config.country !== "BR") parts.push(["country", config.country]);
  return parts.map(([key, value]) => `${key}=${value}`).join("&");
}

function pick<T extends string>(options: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function integer(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

/**
 * Reads a configuration from the page's query string. Unknown or invalid values fall back to
 * the defaults, so a mistyped link still opens the explorer.
 */
export function fromSearch(search: string): ExplorerConfig {
  const params = new URLSearchParams(search);
  const get = (key: string) => params.get(key);
  const straps = get("straps");
  const strapList = straps ? straps.split(".").map((value) => integer(value, 0, MAX_STRAPS_PER_UNIT)) : null;
  const moves: UnitMove[] = [];
  for (const item of (get("moves") ?? "").split("*").filter(Boolean)) {
    const [index, x, y] = item.split("_");
    const parsed = { index: Number(index), x_m: Number(x), y_m: Number(y) };
    if (Number.isInteger(parsed.index) && Number.isFinite(parsed.x_m) && Number.isFinite(parsed.y_m)) {
      moves.push(parsed);
    }
  }
  moves.sort((a, b) => a.index - b.index);
  return {
    body: pick(BODIES, get("body"), DEFAULT_CONFIG.body),
    size: pick(SIZES, get("size"), DEFAULT_CONFIG.size),
    cargo: pick(CARGOES, get("cargo"), DEFAULT_CONFIG.cargo),
    position: pick(POSITIONS, get("position"), DEFAULT_CONFIG.position),
    restraint: pick(RESTRAINTS, get("restraint"), DEFAULT_CONFIG.restraint),
    speed_kmh: integer(get("speed"), SPEED_MIN, SPEED_MAX) ?? DEFAULT_CONFIG.speed_kmh,
    road: pick(ROADS, get("road"), DEFAULT_CONFIG.road),
    weather: pick(WEATHERS, get("weather"), DEFAULT_CONFIG.weather),
    event: pick(EVENTS, get("event"), DEFAULT_CONFIG.event),
    count: integer(get("n"), 1, 20),
    mass_kg: integer(get("kg"), 10, 30_000),
    straps: strapList && strapList.every((value) => value !== null) ? (strapList as number[]) : null,
    moves,
    country: get("country") === "US" ? "US" : "BR",
  };
}

/**
 * A new choice in one dimension. Choices that change the layout (truck, cargo, position) drop
 * the editor's moves, strap counts and unit count, which belonged to the previous layout.
 */
export function choose<K extends Dimension>(config: ExplorerConfig, dimension: K, value: ExplorerConfig[K]): ExplorerConfig {
  const next = { ...config, [dimension]: value };
  const layout: Dimension[] = ["body", "size", "cargo", "position"];
  if (layout.includes(dimension)) {
    return { ...next, moves: [], straps: null, count: null, mass_kg: dimension === "cargo" ? null : config.mass_kg };
  }
  if (dimension === "restraint") return { ...next, straps: null };
  return next;
}
