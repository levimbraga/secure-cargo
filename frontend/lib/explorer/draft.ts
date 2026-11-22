/**
 * The load draft and the load editor's operations on it. The mirror of
 * `backend/app/explorer/draft.py`.
 *
 * A draft is the document the editor edits: the truck, the trip and the cargo units with their
 * place on the bed and the straps over each one. It comes from an explorer configuration (the
 * server expands it), from a photo analysis or from a saved inspection, and goes back to the
 * server (`POST /explorer/draft`) to become the scenario the physics engine simulates.
 */

import type { Country } from "@/lib/country";

import type { LiveModel } from "@/lib/live/model";
import type { Scenario, TripEventInput } from "@/lib/live/scenario";

import type { Body, Cargo, ExplorerConfig, ExplorerEvent, Restraint, Road, Size, UnitMove, Weather } from "./config";

/** A lashing set by hand (`DraftLashing` in `backend/app/explorer/draft.py`). */
export type DraftLashing = {
  kind: "strap" | "chain" | "rope";
  routing: "top_over" | "direct";
  /** Over the top: a left and a right lashing point; diagonal: one. */
  anchors: string[];
  /** Diagonal: the corner of the unit it is fixed to. */
  corner?: "front_left" | "front_right" | "rear_left" | "rear_right" | null;
};

export type DraftUnit = {
  id: string;
  cargo: Cargo;
  label?: string;
  /** Length, width, height [m]; `null`: the cargo's usual size. */
  size_m?: [number, number, number] | null;
  /** `null`: the cargo's usual mass. */
  mass_kg?: number | null;
  /** Centre of the unit's footprint in the bed frame (X forward, Y left) [m]. */
  x_m: number;
  y_m: number;
  /** Id of the unit it stands on. */
  on?: string | null;
  /** Top-over lashings over this unit. */
  straps: number;
  /** With diagonals or chains: sets of four on this unit (1 to 3; the planner adds them on heavy units). */
  diagonal_sets?: number;
  /** Every lashing on this unit, set by hand, in place of `straps` and the restraint's diagonals. */
  lashings?: DraftLashing[] | null;
};

export type LoadDraft = {
  version: 1;
  source: "explorer" | "photo" | "manual";
  /** Whose rules the load is checked against; absent: Brazil (`backend/app/explorer/draft.py`). */
  country?: Country;
  truck: {
    body: Body;
    size: Size;
    /** The body style on the truck cards (`lib/inspection/trucks.ts`). */
    style?: "open_low_sides" | "open_tall_rack" | "platform" | "box" | "curtain_sider";
    /** From "My trucks"; `headboard_height_m` unset: the art. 8 check asks for it. */
    bed_length_m?: number;
    headboard_height_m?: number;
    anchors_per_side?: number;
    /** EN 12642 code of the body (EU mode): an XL curtain-sider's curtains are side walls. */
    body_code?: "L" | "XL" | null;
    /** Declared forward rating of the headboard or front wall [kg of force] (US, 49 CFR 393.114(c)). */
    front_end_rating_kg?: number | null;
  };
  trip: { speed_kmh: number; road: Road; weather: Weather; event: ExplorerEvent };
  restraint: Restraint;
  units: DraftUnit[];
};

export type AxleGroup = {
  id: string;
  kind: "single_2_tyres" | "single_4_tyres" | "tandem_2_axles" | "tandem_3_axles";
  position_x_m: number;
  tare_load_kg: number;
};
export type ExplorerScenario = Scenario & {
  vehicle: { axle_groups: [AxleGroup, AxleGroup]; payload_kg: number | null } | null;
};

/** What the server answers for a configuration or a draft (`ExplorerResponse`). */
export type ExplorerLoad = {
  query: string | null;
  config: ExplorerConfig | null;
  draft: LoadDraft;
  scenario: ExplorerScenario;
  event: TripEventInput;
  live: LiveModel;
};

/** A unit as the editor draws it: the draft's place, the scenario's size and mass. */
export type Footprint = {
  index: number;
  id: string;
  cargo: Cargo;
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  height: number;
  mass: number;
  round: boolean;
  /** The unit this one stands on, and the unit standing on it. */
  on: string | null;
  carries: string | null;
  straps: number;
};

/** Grid the editor snaps positions to [m]. */
export const SNAP_M = 0.05;
const TOLERANCE_M = 0.005;

/** The units of a draft with their sizes; the scenario was built from the same units, in order. */
export function footprints(draft: LoadDraft, scenario: Scenario): Footprint[] {
  const carriedBy = new Map(draft.units.flatMap((unit) => (unit.on ? [[unit.on, unit.id] as const] : [])));
  return draft.units.map((unit, index) => {
    const built = scenario.units.find((item) => item.id === unit.id) ?? scenario.units[index];
    const [length, width, height] = unit.size_m ?? built?.size_m ?? [1, 1, 1];
    return {
      index,
      id: unit.id,
      cargo: unit.cargo,
      x: unit.x_m,
      y: unit.y_m,
      z: built?.position_m[2] ?? 0,
      length,
      width,
      height,
      mass: unit.mass_kg ?? built?.mass_kg ?? 0,
      round: (built as { shape?: string } | undefined)?.shape === "cylinder",
      on: unit.on ?? null,
      carries: carriedBy.get(unit.id) ?? null,
      straps: unit.lashings ? unit.lashings.filter((lashing) => lashing.routing === "top_over").length : unit.straps,
    };
  });
}

function snap(value: number): number {
  return Math.round(value / SNAP_M) * SNAP_M + 0;
}

function overlaps(a: { x: number; y: number; length: number; width: number }, b: typeof a): boolean {
  return (
    Math.abs(a.x - b.x) < (a.length + b.length) / 2 - TOLERANCE_M &&
    Math.abs(a.y - b.y) < (a.width + b.width) / 2 - TOLERANCE_M
  );
}

/**
 * Moves a unit (and whatever stands on it) to `x`, `y`, snapped to the grid and kept on the bed.
 * Returns `null` when it would overlap another unit on the floor.
 */
export function moveUnit(
  draft: LoadDraft,
  units: Footprint[],
  id: string,
  x: number,
  y: number,
  bed: { length_m: number; width_m: number },
): LoadDraft | null {
  const unit = units.find((item) => item.id === id);
  if (!unit || unit.on) return null;
  const halfX = (bed.length_m - unit.length) / 2;
  const halfY = (bed.width_m - unit.width) / 2;
  const clampedX = Number(Math.min(Math.max(snap(x), -halfX), halfX).toFixed(4));
  const clampedY = Number(Math.min(Math.max(snap(y), -halfY), halfY).toFixed(4));
  const moved = { ...unit, x: clampedX, y: clampedY };
  if (units.some((other) => other.id !== id && !other.on && overlaps(moved, other))) return null;
  // A stack moves as one.
  const stack = new Set([id]);
  for (let carried = unit.carries; carried; carried = units.find((item) => item.id === carried)?.carries ?? null) {
    stack.add(carried);
  }
  return {
    ...draft,
    units: draft.units.map((item) => (stack.has(item.id) ? { ...item, x_m: clampedX, y_m: clampedY } : item)),
  };
}

/** Anchor pairs facing each other along a unit: how many top-over straps it can take. */
export function strapRoom(scenario: Scenario, unit: Footprint): number {
  return strapPairs(scenario, unit).length;
}

/** The left and right lashing points facing each other along a unit, rear first: where a strap can go over it. */
export function strapPairs(
  scenario: Pick<Scenario, "bed">,
  unit: Pick<Footprint, "x" | "y" | "length" | "cargo">,
): { x: number; left: string; right: string }[] {
  // Mirrors _strap_reach in backend/app/explorer/build.py: 5 cm inside the unit's ends, and on
  // a coil lying across the truck within a quarter of its diameter of the crest.
  const reach = unit.cargo === "steel_coil" ? unit.length / 4 : unit.length / 2 - 0.05;
  const anchors = scenario.bed.anchor_points;
  const left = new Map(anchors.filter((anchor) => anchor.position_m[1] > unit.y).map((anchor) => [anchor.position_m[0], anchor.id]));
  return anchors
    .filter(
      (anchor) =>
        anchor.position_m[1] < unit.y && left.has(anchor.position_m[0]) && Math.abs(anchor.position_m[0] - unit.x) <= reach + 1e-6,
    )
    .map((anchor) => ({ x: anchor.position_m[0], left: left.get(anchor.position_m[0]) as string, right: anchor.id }))
    .sort((a, b) => a.x - b.x);
}

/** The unit whose straps a tap on `id` changes: the top of its stack (straps go over the stack). */
export function lashedUnit(units: Footprint[], id: string): Footprint | undefined {
  let unit = units.find((item) => item.id === id);
  while (unit?.carries) unit = units.find((item) => item.id === unit?.carries);
  return unit;
}

/** One more strap over a unit's stack, back to none after the last one that fits. */
export function cycleStraps(draft: LoadDraft, units: Footprint[], id: string, room: number): LoadDraft {
  const lashed = lashedUnit(units, id);
  if (!lashed) return draft;
  const next = lashed.straps + 1 > Math.min(room, 6) ? 0 : lashed.straps + 1;
  return setStraps(draft, lashed.id, next);
}

export function setStraps(draft: LoadDraft, id: string, straps: number): LoadDraft {
  return { ...draft, units: draft.units.map((unit) => (unit.id === id ? { ...unit, straps } : unit)) };
}

export type AxleLoad = { id: string; kind: AxleGroup["kind"]; loadKg: number; limitKg: number; ratio: number };

/** Legal limits of CONTRAN Resolution 882/2021, art. 6 (as `backend/rules/axle_loads.py`). */
export const AXLE_LIMIT_KG: Record<AxleGroup["kind"], number> = {
  single_2_tyres: 6000,
  single_4_tyres: 10_000,
  tandem_2_axles: 17_000,
  tandem_3_axles: 25_500,
};

const LB_KG = 0.45359237;
const EU_SIZES = new Set(["eu_7_5t", "eu_18t", "eu_26t", "eu_semi_136", "eu_flatbed_136"]);
const EU_ARTICULATED = new Set(["eu_semi_136", "eu_flatbed_136"]);
// EU mode (`backend/rules/eu_weights.py`, `group_limits_kg`): a rigid's front axle 10 t, its driving
// axle 11.5 t or driving tandem 19 t (EU presets, air) / 18 t; a trailer's tri-axle 24 t (1.31 m) or
// 21 t (Brazil's 1.25 m); a Brazilian or US semi's kingpin group as a motor-vehicle tandem.
// An EU articulated preset's kingpin group: the load that keeps the 4x2 tractor's steer (10 t) and
// driving axle (11.5 t) legal.
const EU_TO_STEER = 0.55 / 3.7;
function euLimitKg(group: AxleGroup, size: string | undefined, front: boolean): number {
  const eu = Boolean(size && EU_SIZES.has(size));
  if (front && group.id === "tractor" && size && EU_ARTICULATED.has(size)) {
    return 2400 + Math.min((10_000 - 5000) / EU_TO_STEER, (11_500 - 2400) / (1 - EU_TO_STEER));
  }
  if (front && group.id !== "tractor") return 10_000;
  switch (group.kind) {
    case "single_2_tyres":
    case "single_4_tyres":
      return 11_500;
    case "tandem_2_axles":
      if (group.id === "trailer") return size?.startsWith("us_") ? 16_000 : 18_000;
      return eu ? 19_000 : 18_000;
    case "tandem_3_axles":
      return eu ? 24_000 : 21_000;
  }
}
const US_SIZES = new Set(["us_box", "us_straight", "us_flatbed_48", "us_dry_van_53", "us_step_deck"]);
// US mode (`backend/rules/us_weights.py`, `group_limits_kg`): 20,000 lb on one axle, 34,000 lb on
// a tandem, a Brazilian triple at the bridge formula's 42,000 lb (its axles are 98 in apart).
// A US semi's kingpin group is the drive tandem: its limit keeps the steer and drive axles legal.
export const US_AXLE_LIMIT_KG: Record<AxleGroup["kind"], number> = {
  single_2_tyres: 20_000 * LB_KG,
  single_4_tyres: 20_000 * LB_KG,
  tandem_2_axles: 34_000 * LB_KG,
  tandem_3_axles: 42_000 * LB_KG,
};
const STEER_TARE_KG = 11_000 * LB_KG;
const DRIVE_TARE_KG = 8_000 * LB_KG;
const TO_STEER = 0.3 / 5.6; // fifth wheel 0.3 m ahead of the drive tandem, 5.6 m wheelbase

function usLimitKg(group: AxleGroup, size: string | undefined): number {
  if (group.id === "tractor" && size && US_SIZES.has(size)) {
    const bySteer = (20_000 * LB_KG - STEER_TARE_KG) / TO_STEER;
    const byDrive = (34_000 * LB_KG - DRIVE_TARE_KG) / (1 - TO_STEER);
    return DRIVE_TARE_KG + Math.min(bySteer, byDrive);
  }
  return US_AXLE_LIMIT_KG[group.kind];
}

/**
 * Load on each axle group: tare plus the cargo, shared by a moment balance (beam statics), against
 * the limits of the country's rules (Brazil: CONTRAN 882; US: 23 CFR 658.17; EU: 96/53/EC).
 */
export function axleLoads(
  vehicle: ExplorerScenario["vehicle"],
  units: Footprint[],
  country: Country = "BR",
  size?: string,
): AxleLoad[] {
  if (!vehicle) return [];
  const [front, rear] = vehicle.axle_groups;
  const span = front.position_x_m - rear.position_x_m;
  let frontCargo = 0;
  let rearCargo = 0;
  for (const unit of units) {
    const share = (unit.x - rear.position_x_m) / span;
    frontCargo += unit.mass * share;
    rearCargo += unit.mass * (1 - share);
  }
  return [
    [front, frontCargo],
    [rear, rearCargo],
  ].map(([group, cargo]) => {
    const axle = group as AxleGroup;
    const loadKg = axle.tare_load_kg + (cargo as number);
    const limitKg =
      country === "US" ? usLimitKg(axle, size) : country === "EU" ? euLimitKg(axle, size, axle === front) : AXLE_LIMIT_KG[axle.kind];
    return { id: axle.id, kind: axle.kind, loadKg, limitKg, ratio: loadKg / limitKg };
  });
}

/** Centre of mass of the cargo on the bed [m], or `null` without cargo. */
export function centreOfMass(units: Footprint[]): { x: number; y: number } | null {
  const total = units.reduce((sum, unit) => sum + unit.mass, 0);
  if (total <= 0) return null;
  return {
    x: units.reduce((sum, unit) => sum + unit.mass * unit.x, 0) / total,
    y: units.reduce((sum, unit) => sum + unit.mass * unit.y, 0) / total,
  };
}

/**
 * The editor's changes to a draft that came from `config`, written back into the configuration
 * (moves and strap counts), so the page URL describes the edited load. `base` is the draft the
 * server made of `config`. Returns `null` when the changes cannot be written that way.
 */
export function editsToConfig(config: ExplorerConfig, base: LoadDraft, draft: LoadDraft): ExplorerConfig | null {
  if (base.units.length !== draft.units.length) return null;
  // Anything but moves and strap counts (a unit's cargo, size or weight, the securing, the truck)
  // has no place in the configuration: the address then carries the whole draft.
  const rest = (value: LoadDraft) =>
    JSON.stringify({ ...value, units: value.units.map((unit) => ({ ...unit, x_m: 0, y_m: 0, straps: 0 })) });
  if (rest(base) !== rest(draft)) return null;
  const floor = base.units.filter((unit) => !unit.on).length;
  const moves: UnitMove[] = [];
  for (let index = 0; index < floor; index++) {
    const before = base.units[index];
    const after = draft.units[index];
    if (!before || !after || before.id !== after.id) return null;
    if (Math.abs(before.x_m - after.x_m) > 1e-6 || Math.abs(before.y_m - after.y_m) > 1e-6) {
      moves.push({ index, x_m: after.x_m, y_m: after.y_m });
    }
  }
  const strapsOf = (units: DraftUnit[]) =>
    units.slice(0, floor).map((unit) => units.find((item) => item.on === unit.id)?.straps ?? unit.straps);
  const straps = strapsOf(draft.units);
  const changed = straps.some((value, index) => value !== strapsOf(base.units)[index]);
  return {
    ...config,
    moves,
    straps: changed || config.straps !== null ? straps : null,
  };
}

/** A draft as text for a URL fragment (`#draft=`): base64url of its JSON. */
export function encodeDraft(draft: LoadDraft): string {
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

/**
 * Reads a draft from outside the explorer (a photo analysis, a saved inspection, a shared link):
 * its JSON, or the base64url text of `encodeDraft`. Only the shape is checked here; the server
 * checks the rest when it builds the scenario.
 */
export function parseDraft(input: string | unknown): LoadDraft {
  let value: unknown = input;
  if (typeof input === "string") {
    const text = input.trim().startsWith("{")
      ? input
      : new TextDecoder().decode(
          Uint8Array.from(atob(input.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)),
        );
    value = JSON.parse(text);
  }
  const draft = value as Partial<LoadDraft> | null;
  if (typeof draft !== "object" || draft === null || draft.version !== 1) throw new DraftError("Not a load draft");
  if (!Array.isArray(draft.units) || draft.units.length === 0) throw new DraftError("A load draft needs units");
  for (const unit of draft.units) {
    if (typeof unit?.id !== "string" || typeof unit.x_m !== "number" || typeof unit.y_m !== "number") {
      throw new DraftError("Every unit needs an id and a place on the bed");
    }
  }
  return {
    source: "manual",
    truck: { body: "flatbed", size: "toco" },
    trip: { speed_kmh: 80, road: "straight", weather: "dry", event: "emergency_braking" },
    restraint: "top_over",
    ...draft,
    units: draft.units.map((unit) => ({ ...unit, straps: unit.straps ?? 0 })),
  } as LoadDraft;
}
