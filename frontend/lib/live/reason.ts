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
  | "slidesLoose"
  | "tips"
  | "leavesBed"
  | "lashingOverloaded"
  | "lashingBroke"
  | "headboardOverloaded"
  | "axleOverloaded"
  | "holds"
  | "holdsBarely";

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

/** What the truck's motion asks of a unit against what friction can give, at the worst instant. */
export function worstBalance(
  doc: KeyframesDoc,
  unitIndex: number,
): { inertia: number; friction: number; frame: number } {
  const unit = doc.units[unitIndex];
  let worst = { inertia: 0, friction: 0, frame: 0 };
  let margin = -Infinity;
  if (!unit) return worst;
  doc.frames.forEach((frame, index) => {
    const pose = frame.units[unitIndex];
    if (!pose) return;
    const forces = unitForces(
      unit.mass_kg ?? 0,
      unit.friction_coefficient ?? 0,
      pose.n ?? 0,
      frame.bed_accel_mps2 ?? [0, 0, 0],
    );
    // The instant friction is shortest of what is asked: the largest gap, relative to the ask.
    const gap = forces.inertiaMagnitude - forces.frictionLimit;
    if (forces.inertiaMagnitude > 1 && gap > margin) {
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

export function explain(result: ResultLike, doc: KeyframesDoc): Reason {
  const { findings } = result.verdict;
  const find = (code: Finding["code"]) => findings.find((item) => item.code === code && item.severity === "fail");
  const indexOf = (unitId: string | null) => doc.units.findIndex((unit) => unit.id === unitId);

  const axle = find("axle_overloaded");
  const tilted = find("unit_tilted");
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
  if (slid || hit) {
    // Explain the unit that moved the most.
    const moved = [...result.units].sort((a, b) => b.max_slide_m - a.max_slide_m)[0];
    const unitId = moved?.id ?? slid?.unit_id ?? hit?.unit_id ?? null;
    const balance = worstBalance(doc, indexOf(unitId));
    const values = {
      inertia: kN(balance.inertia),
      friction: kN(balance.friction),
      slide: (moved?.max_slide_m ?? 0) * 100,
    };
    if (left) return { key: "leavesBed", subject: unitId, values };
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

  // Nothing failed: show the unit that came closest to sliding.
  let closest = { inertia: 0, friction: 0, frame: 0 };
  let subject: string | null = null;
  doc.units.forEach((unit, index) => {
    const balance = worstBalance(doc, index);
    if (subject === null || balance.inertia - balance.friction > closest.inertia - closest.friction) {
      closest = balance;
      subject = unit.id;
    }
  });
  return {
    key: result.verdict.status === "warning" ? "holdsBarely" : "holds",
    subject,
    values: { inertia: kN(closest.inertia), friction: kN(closest.friction) },
  };
}
