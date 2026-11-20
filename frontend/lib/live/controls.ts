/**
 * The controls of the live lab: what the visitor can change, and how a change turns the
 * scenario as authored into the scenario that is simulated.
 *
 * Only inputs change here. The MJCF, the bed motion and the rule checks of the changed scenario
 * still come from the server (`POST /mjcf`), so the browser never builds a model of its own.
 */

import type { EventKind, RoadSurface, Scenario, ScenarioLashing, ScenarioUnit, TripEventInput } from "./scenario";

export type LabControls = {
  event: EventKind;
  speedKmh: number;
  surface: RoadSurface;
  /** Top-over lashings on every unit that is not held by direct lashings; `null` keeps them as authored. */
  strapsPerUnit: number | null;
  /** Pretension of every top-over lashing [N]; `null` keeps it as authored. */
  pretensionN: number | null;
  /** Every unit's mass is multiplied by this. */
  massFactor: number;
  /** All units stand on a rubber anti-slip mat; `null` keeps each unit's base as authored. */
  antiSlipMat: boolean | null;
};

export const SPEED_RANGE = { min: 20, max: 100, step: 10 } as const;
export const PRETENSION_RANGE = { min: 500, max: 5000, step: 250 } as const;
export const MASS_FACTOR_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;

/** A web lashing as sold in Brazil: LC 2,500 daN (EN 12195-2 label). Used when a unit has none to copy. */
const DEFAULT_STRAP = { kind: "strap", lashing_capacity_n: 25_000, pretension_n: 3_000 } as const;
const RUBBER_MAT = "rubber_mat";
const FALLBACK_BASE = "sawn_wood";

export function defaultControls(event: TripEventInput): LabControls {
  return {
    event: event.kind,
    speedKmh: event.speed_kmh,
    surface: event.road_surface,
    strapsPerUnit: null,
    pretensionN: null,
    massFactor: 1,
    antiSlipMat: null,
  };
}

export function isDefault(controls: LabControls, event: TripEventInput): boolean {
  const base = defaultControls(event);
  return (Object.keys(base) as (keyof LabControls)[]).every((key) => base[key] === controls[key]);
}

function topOver(scenario: Scenario, unitId: string): ScenarioLashing[] {
  return scenario.lashings.filter((lashing) => lashing.unit_id === unitId && lashing.routing === "top_over");
}

function hasDirect(scenario: Scenario, unitId: string): boolean {
  return scenario.lashings.some((lashing) => lashing.unit_id === unitId && lashing.routing === "direct");
}

/** Anchor pairs (left, right) a top-over lashing over `unit` can use, from rear to front. */
export function anchorPairs(scenario: Scenario, unit: ScenarioUnit): { x: number; left: string; right: string }[] {
  const reach = unit.size_m[0] / 2 - 0.05;
  const left = scenario.bed.anchor_points.filter((anchor) => anchor.position_m[1] > unit.position_m[1]);
  const right = scenario.bed.anchor_points.filter((anchor) => anchor.position_m[1] < unit.position_m[1]);
  const pairs: { x: number; left: string; right: string }[] = [];
  for (const anchor of left) {
    const x = anchor.position_m[0];
    if (Math.abs(x - unit.position_m[0]) > reach) continue;
    const other = right.find((candidate) => Math.abs(candidate.position_m[0] - x) < 1e-6);
    if (other) pairs.push({ x, left: anchor.id, right: other.id });
  }
  return pairs.sort((a, b) => a.x - b.x);
}

/** Units whose top-over lashings the strap control changes: those not held by direct lashings. */
function strapUnits(scenario: Scenario): ScenarioUnit[] {
  return scenario.units.filter((unit) => !hasDirect(scenario, unit.id));
}

/** Most top-over lashings the anchor points allow on any unit. */
export function maxStrapsPerUnit(scenario: Scenario): number {
  return Math.max(0, ...strapUnits(scenario).map((unit) => anchorPairs(scenario, unit).length));
}

/** Top-over lashings per unit as authored, when every unit the control changes has the same number. */
export function authoredStrapsPerUnit(scenario: Scenario): number | null {
  const counts = new Set(strapUnits(scenario).map((unit) => topOver(scenario, unit.id).length));
  return counts.size === 1 ? ([...counts][0] ?? null) : null;
}

/** Pretension as authored, when every top-over lashing has the same. */
export function authoredPretension(scenario: Scenario): number | null {
  const values = new Set(
    scenario.lashings.filter((lashing) => lashing.routing === "top_over").map((lashing) => lashing.pretension_n),
  );
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

export function authoredMat(scenario: Scenario): boolean {
  return scenario.units.every((unit) => unit.material === RUBBER_MAT);
}

/** `count` of `pairs`, spread evenly along the unit. */
function spread<T>(pairs: T[], count: number): T[] {
  const take = Math.min(count, pairs.length);
  if (take === 0) return [];
  if (take === pairs.length) return pairs;
  return Array.from({ length: take }, (_, index) => {
    const position = ((index + 0.5) / take) * pairs.length - 0.5;
    return pairs[Math.min(Math.max(Math.round(position), 0), pairs.length - 1)] as T;
  }).filter((pair, index, all) => all.indexOf(pair) === index);
}

/**
 * The scenario and event the controls describe.
 *
 * `other` is the same load in its other version ("as loaded" for "fixed" and back): it tells
 * what a unit stands on when the mat is taken away from a version that was authored with one.
 */
export function applyControls(
  scenario: Scenario,
  event: TripEventInput,
  controls: LabControls,
  other?: Scenario,
): { scenario: Scenario; event: TripEventInput } {
  const units = scenario.units.map((unit) => {
    let material = unit.material;
    if (controls.antiSlipMat === true) material = RUBBER_MAT;
    if (controls.antiSlipMat === false && material === RUBBER_MAT) {
      const authored = other?.units.find((candidate) => candidate.id === unit.id)?.material;
      material = authored && authored !== RUBBER_MAT ? authored : FALLBACK_BASE;
    }
    const mass = Math.round(unit.mass_kg * controls.massFactor * 10) / 10;
    return { ...unit, material, mass_kg: mass };
  });

  let lashings = scenario.lashings;
  if (controls.strapsPerUnit !== null) {
    const changed = new Set(strapUnits(scenario).map((unit) => unit.id));
    lashings = scenario.lashings.filter(
      (lashing) => !(lashing.routing === "top_over" && changed.has(lashing.unit_id)),
    );
    for (const unit of scenario.units) {
      if (!changed.has(unit.id)) continue;
      const template = topOver(scenario, unit.id)[0] ?? scenario.lashings.find((l) => l.routing === "top_over");
      const pairs = spread(anchorPairs(scenario, unit), controls.strapsPerUnit);
      pairs.forEach((pair, index) => {
        lashings = [
          ...lashings,
          {
            id: `${unit.id}-s${index + 1}`,
            kind: template?.kind ?? DEFAULT_STRAP.kind,
            routing: "top_over",
            unit_id: unit.id,
            anchor_ids: [pair.left, pair.right],
            attachment_point_m: null,
            pretension_n: template?.pretension_n ?? DEFAULT_STRAP.pretension_n,
            lashing_capacity_n: template?.lashing_capacity_n ?? DEFAULT_STRAP.lashing_capacity_n,
            elongation_at_lc: template?.elongation_at_lc ?? null,
            breaking_strength_n: template?.breaking_strength_n ?? null,
          },
        ];
      });
    }
  }
  if (controls.pretensionN !== null) {
    const wanted = controls.pretensionN;
    lashings = lashings.map((lashing) =>
      lashing.routing === "top_over"
        ? // A lashing cannot be tensioned beyond its capacity (or its breaking strength).
          {
            ...lashing,
            pretension_n: Math.min(wanted, lashing.lashing_capacity_n, lashing.breaking_strength_n ?? Infinity),
          }
        : lashing,
    );
  }

  const sameKind = controls.event === event.kind;
  return {
    scenario: { ...scenario, units, lashings },
    event: {
      kind: controls.event,
      speed_kmh: controls.speedKmh,
      road_surface: controls.surface,
      fog: event.fog,
      // Curve radius and grade belong to the authored event; another event uses the defaults.
      curve_radius_m: sameKind ? event.curve_radius_m : null,
      grade_percent: sameKind ? event.grade_percent : null,
    },
  };
}
