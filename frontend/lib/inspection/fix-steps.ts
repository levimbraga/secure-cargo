/**
 * "How to make it safe" as steps a driver can follow without contradictions.
 *
 * The planner lists its changes one by one ("secure with diagonals instead of top over", then
 * "unit 3: 1 → 2 straps over it"), which reads as if the diagonals replaced the straps over the
 * top while also asking for more of them. Here a change of restraint and the straps it goes with
 * become one step, and the strap counts are read from the tested (fixed) load itself, so the
 * text always says what was simulated: "Add diagonal straps to every unit, and 2 straps over
 * Unit 3 (1 over each of the others)".
 */

import type { LoadDraft } from "@/lib/explorer/draft";

import type { Change } from "./types";

export type FixStep =
  | { kind: "change"; change: Change; unitIds?: string[] }
  /** Restraint changed; straps over the top kept as they were (`keep`), or none. */
  | { kind: "restraint"; restraint: string; keep: boolean; article: string | null }
  /** Restraint changed together with straps over the top: `to` over `unitIds` (all: `every`), `rest` over the others. */
  | { kind: "restraintStraps"; restraint: string; to: number; unitIds: string[]; every: boolean; rest: number | null; article: string | null }
  /** Cradles (or blocking) instead of the straps over the top. */
  | { kind: "restraintInstead"; restraint: string; article: string | null }
  /** Straps over the top only: `to` over `unitIds` (all: `every`). */
  | { kind: "straps"; to: number; from: number; unitIds: string[]; every: boolean; article: string | null };

type Unit = LoadDraft["units"][number];

/** Units grouped by their new strap count, in load order. */
function byCount(units: { id: string; to: number }[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const unit of units) groups.set(unit.to, [...(groups.get(unit.to) ?? []), unit.id]);
  return groups;
}

export function fixSteps(changes: Change[], before: LoadDraft | null, after: LoadDraft | null): FixStep[] {
  const restraintChange = changes.find((change) => change.code === "restraint");
  const strapChanges = changes.filter((change) => change.code === "straps");
  const beforeUnits = new Map<string, Unit>((before?.units ?? []).map((unit) => [unit.id, unit]));
  const all = (after ?? before)?.units ?? [];
  // The tested load says how many straps each unit has; the planner's list only says what changed.
  const strapsNow = (id: string): number => {
    const tested = after?.units.find((unit) => unit.id === id);
    if (tested) return tested.straps;
    const change = strapChanges.find((item) => item.unit_id === id);
    return Number(change?.after ?? beforeUnits.get(id)?.straps ?? 0);
  };
  const strapsBefore = (id: string): number => {
    const change = strapChanges.find((item) => item.unit_id === id);
    return Number(change?.before ?? beforeUnits.get(id)?.straps ?? 0);
  };
  const changed = all
    .map((unit) => ({ id: unit.id, from: strapsBefore(unit.id), to: strapsNow(unit.id) }))
    .filter((unit) => unit.from !== unit.to || strapChanges.some((change) => change.unit_id === unit.id));
  const restraint = after?.restraint ?? (restraintChange ? String(restraintChange.after) : null);

  const strapSteps = (): FixStep[] => {
    const steps: FixStep[] = [];
    for (const [to, unitIds] of byCount(changed)) {
      const from = strapsBefore(unitIds[0] as string);
      steps.push({ kind: "straps", to, from, unitIds, every: unitIds.length === all.length && all.length > 1, article: null });
    }
    return steps;
  };

  const restraintStep = (change: Change): FixStep[] => {
    const target = restraint ?? String(change.after);
    const article = change.article;
    // Straps over the top are the restraint itself: one step, "2 straps over each unit".
    if (target === "top_over") return strapSteps().map((step) => ({ ...step, article }));
    if (!changed.length) {
      // Diagonals, chains, cradles and blocking come on top of the straps over the top, which stay.
      const keep = target !== "mat" && target !== "none" && all.some((unit) => strapsNow(unit.id) > 0);
      return [{ kind: "restraint", restraint: target, keep, article }];
    }
    if (changed.every((unit) => unit.to === 0)) return [{ kind: "restraintInstead", restraint: target, article }];
    const groups = [...byCount(changed)];
    if (groups.length === 1) {
      const [to, unitIds] = groups[0] as [number, string[]];
      const others = all.filter((unit) => !unitIds.includes(unit.id)).map((unit) => strapsNow(unit.id));
      const rest = others.length && others.every((count) => count === others[0]) && (others[0] ?? 0) > 0 ? (others[0] as number) : null;
      return [{ kind: "restraintStraps", restraint: target, to, unitIds, every: unitIds.length === all.length && all.length > 1, rest, article }];
    }
    // Different counts on different units: the restraint, then one strap step per count.
    return [{ kind: "restraint", restraint: target, keep: false, article }, ...strapSteps()];
  };

  const steps: FixStep[] = [];
  let strapsDone = false;
  for (const change of changes) {
    if (change.code === "restraint") {
      steps.push(...restraintStep(change));
      strapsDone = true;
    } else if (change.code === "straps") {
      if (strapsDone || restraintChange) continue;
      steps.push(...strapSteps());
      strapsDone = true;
    } else {
      steps.push({ kind: "change", change });
    }
  }
  return steps;
}
