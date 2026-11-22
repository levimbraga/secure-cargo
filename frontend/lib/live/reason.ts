/**
 * The reason behind a verdict, in one sentence with numbers from the run: what the motion of
 * the truck asked of the cargo against what held it.
 *
 * Returns a message key and its values; the page translates it (`Lab.reason.*` in `messages/`).
 */

import type { AxleLoad, Finding, Status } from "@/lib/demo";
import type { KeyframesDoc } from "@/lib/keyframes";
import { GRAVITY, unitForces } from "@/lib/replay";

export type ReasonKey =
  | "slides"
  | "slidesIntoHeadboard"
  | "slidesIntoWall"
  | "slidesAfterLoosening"
  | "slidesLoose"
  | "rolls"
  | "rollsIntoHeadboard"
  | "tips"
  | "leavesBed"
  | "lashingOverloaded"
  | "lashingBroke"
  | "headboardOverloaded"
  | "axleOverloaded"
  | "holds"
  | "holdsBarely"
  | "holdsUpright"
  | "holdsUprightBarely"
  | "holdsTall";

export type Reason = {
  key: ReasonKey;
  /** Unit, lashing or axle group the sentence is about. */
  subject: string | null;
  values: Record<string, number>;
};

type ResultLike = {
  verdict: { status: Status; findings: Finding[] };
  units: { id: string; max_slide_m: number; max_tilt_deg: number }[];
  axle_loads?: AxleLoad[];
};

/** What the truck's motion asks of a unit against what friction can give, when it asks the most. */
export function worstBalance(
  doc: KeyframesDoc,
  unitIndex: number,
): { inertia: number; friction: number; frame: number } {
  const unit = doc.units[unitIndex];
  let worst = { inertia: 0, friction: 0, frame: 0 };
  let margin = -Infinity;
  if (!unit) return worst;
  // Instants when the unit stands on the floor with at least half its weight. When it bounces
  // (after hitting the unit in front, over a pothole) the floor force is not what braking
  // fights, and friction would read far lower than it was.
  const weight = (unit.mass_kg ?? 0) * GRAVITY;
  const standing = doc.frames.some((frame) => (frame.units[unitIndex]?.n ?? 0) >= 0.5 * weight);
  doc.frames.forEach((frame, index) => {
    const pose = frame.units[unitIndex];
    if (!pose) return;
    if (standing && (pose.n ?? 0) < 0.5 * weight) return;
    const forces = unitForces(
      unit.mass_kg ?? 0,
      unit.friction_coefficient ?? 0,
      pose.n ?? 0,
      frame.bed_accel_mps2 ?? [0, 0, 0],
    );
    // The first instant of the largest ask (by more than 1 N): when braking peaks, before the
    // load has hit anything and bounced.
    const gap = forces.inertiaMagnitude;
    if (forces.inertiaMagnitude > 1 && gap > margin + 1) {
      margin = gap;
      worst = { inertia: forces.inertiaMagnitude, friction: forces.frictionLimit, frame: index };
    }
  });
  return worst;
}

/** Moments about the edge a tall unit tips over: what overturns it and what holds it down [N m]. */
export function tippingBalance(doc: KeyframesDoc, unitIndex: number): { overturning: number; restoring: number } {
  const unit = doc.units[unitIndex];
  if (!unit) return { overturning: 0, restoring: 0 };
  const mass = unit.mass_kg ?? 0;
  const [length, width, height] = unit.size_m;
  // What presses the unit on the floor before the event: its weight plus the lashings.
  const pressed = doc.frames[0]?.units[unitIndex]?.n ?? mass * GRAVITY;
  let overturning = 0;
  let restoring = 0;
  for (const frame of doc.frames) {
    const [ax, ay] = frame.bed_accel_mps2 ?? [0, 0, 0];
    for (const [acceleration, base] of [
      [Math.abs(ax), length],
      [Math.abs(ay), width],
    ] as const) {
      const moment = (mass * acceleration * height) / 2;
      const holding = (pressed * base) / 2;
      if (moment - holding > overturning - restoring || overturning === 0) {
        overturning = moment;
        restoring = holding;
      }
    }
  }
  return { overturning, restoring };
}

const kN = (newtons: number) => newtons / 1000;

/** Height over the narrower side of the base above which a unit counts as tall. */
const TALL_RATIO = 1.5;

/** A tall unit may tip before it slides, so its tipping margin is worth stating. */
function isTall(doc: KeyframesDoc, unitIndex: number): boolean {
  const unit = doc.units[unitIndex];
  if (!unit) return false;
  const [length, width, height] = unit.size_m;
  return height > TALL_RATIO * Math.min(length, width);
}

/** Tension of a unit's straps when the event starts, and their lowest before the given frame [N]. */
function strapLoosening(doc: KeyframesDoc, unitId: string | null, beforeFrame: number): { start: number; low: number } {
  const straps = doc.straps.flatMap((strap, index) => (strap.unit_id === unitId || (unitId !== null && strap.point_unit_ids?.includes(unitId)) ? [index] : []));
  if (!straps.length) return { start: 0, low: 0 };
  const total = (frame: number) =>
    straps.reduce((sum, index) => sum + (doc.frames[frame]?.straps[index]?.tension_n ?? 0), 0) / straps.length;
  let low = total(0);
  for (let frame = 0; frame <= beforeFrame && frame < doc.frames.length; frame++) low = Math.min(low, total(frame));
  return { start: total(0), low };
}

/** Share of their tension the straps must lose before it counts as loosening. */
const LOOSENED_SHARE = 0.75;

export function explain(result: ResultLike, doc: KeyframesDoc): Reason {
  const { findings } = result.verdict;
  const find = (code: Finding["code"]) => findings.find((item) => item.code === code && item.severity === "fail");
  const indexOf = (unitId: string | null) => doc.units.findIndex((unit) => unit.id === unitId);

  const axle = find("axle_overloaded");
  const tilted = find("unit_tilted");
  const rolled = find("unit_rolled");
  const left = find("unit_left_bed");
  const slid = find("unit_slid");
  const hit = find("unit_hit_headboard");
  const broke = find("lashing_broke");
  const overloaded = find("lashing_overloaded");
  const headboard = find("headboard_overloaded");

  if (tilted) {
    const balance = tippingBalance(doc, indexOf(tilted.unit_id));
    return {
      key: "tips",
      subject: tilted.unit_id,
      values: { overturning: kN(balance.overturning), restoring: kN(balance.restoring), tilt: tilted.value },
    };
  }
  if (rolled) {
    // A cylinder on its side has nothing but what stands in front of it: it rolls at any braking.
    const balance = worstBalance(doc, indexOf(rolled.unit_id));
    const hitToo = findings.some((item) => item.code === "unit_hit_headboard" && item.unit_id === rolled.unit_id);
    return {
      key: hitToo ? "rollsIntoHeadboard" : "rolls",
      subject: rolled.unit_id,
      values: { inertia: kN(balance.inertia), slide: rolled.value * 100 },
    };
  }
  if (slid || hit) {
    // Explain the unit that moved the most.
    const moved = [...result.units].sort((a, b) => b.max_slide_m - a.max_slide_m)[0];
    const unitId = moved?.id ?? slid?.unit_id ?? hit?.unit_id ?? null;
    const balance = worstBalance(doc, indexOf(unitId));
    const values: Record<string, number> = {
      inertia: kN(balance.inertia),
      friction: kN(balance.friction),
      slide: (moved?.max_slide_m ?? 0) * 100,
    };
    if (left) return { key: "leavesBed", subject: unitId, values };
    // The wall gave way to more than it is rated for: that is the consequence that matters.
    if (headboard) {
      return {
        key: "slidesIntoWall",
        subject: unitId,
        values: { ...values, force: kN(headboard.value), capacity: kN(headboard.limit) },
      };
    }
    // Straps that lost their tension before the slide (vibration) are why friction fell short.
    const straps = strapLoosening(doc, unitId, balance.frame);
    if (straps.start > 0 && straps.low < LOOSENED_SHARE * straps.start) {
      return {
        key: "slidesAfterLoosening",
        subject: unitId,
        values: { ...values, before: kN(straps.start), after: kN(straps.low) },
      };
    }
    if (balance.inertia <= balance.friction) return { key: "slidesLoose", subject: unitId, values };
    return { key: hit ? "slidesIntoHeadboard" : "slides", subject: unitId, values };
  }
  if (left) return { key: "leavesBed", subject: left.unit_id, values: { inertia: 0, friction: 0, slide: left.value * 100 } };
  if (broke) return { key: "lashingBroke", subject: broke.lashing_id, values: { force: kN(broke.value), capacity: kN(broke.limit) } };
  if (overloaded) {
    return {
      key: "lashingOverloaded",
      subject: overloaded.lashing_id,
      values: { force: kN(overloaded.value), capacity: kN(overloaded.limit) },
    };
  }
  if (headboard) {
    return { key: "headboardOverloaded", subject: null, values: { force: kN(headboard.value), capacity: kN(headboard.limit) } };
  }
  if (axle) {
    return { key: "axleOverloaded", subject: axle.axle_group_id, values: { load: axle.value / 1000, limit: axle.limit / 1000 } };
  }

  // Nothing failed. Say which way the load came closest to failing: the unit and the mode
  // (sliding or tipping) with the largest share of its limit used.
  const barely = result.verdict.status === "warning";
  let governing = { index: -1, mode: "slide" as "slide" | "tip", ratio: -Infinity };
  doc.units.forEach((unit, index) => {
    const slide = worstBalance(doc, index);
    const tip = tippingBalance(doc, index);
    const slideRatio = slide.friction > 0 ? slide.inertia / slide.friction : 0;
    const tipRatio = tip.restoring > 0 ? tip.overturning / tip.restoring : 0;
    // Lashed units can exceed friction without moving; tipping only counts for tall units.
    const candidates: ["slide" | "tip", number][] = [["slide", slideRatio]];
    if (isTall(doc, index)) candidates.push(["tip", tipRatio]);
    for (const [mode, ratio] of candidates) {
      if (ratio > governing.ratio) governing = { index, mode, ratio };
    }
  });
  const unitIndex = Math.max(governing.index, 0);
  const subject = doc.units[unitIndex]?.id ?? null;
  const slide = worstBalance(doc, unitIndex);
  const tip = tippingBalance(doc, unitIndex);
  const moments = { overturning: kN(tip.overturning), restoring: kN(tip.restoring) };
  // Whether lashings, or only walls and blocks, take what friction cannot (1 or 0).
  const lashed = doc.straps.some((strap) => strap.unit_id === subject) ? 1 : 0;
  const forces = { inertia: kN(slide.inertia), friction: kN(slide.friction), lashed };
  if (governing.mode === "tip") {
    return { key: barely ? "holdsUprightBarely" : "holdsUpright", subject, values: { ...moments, ...forces } };
  }
  if (isTall(doc, unitIndex)) {
    // Sliding governs, but a tall unit's tipping margin is worth stating too.
    return { key: "holdsTall", subject, values: { ...forces, ...moments } };
  }
  return { key: barely ? "holdsBarely" : "holds", subject, values: forces };
}
