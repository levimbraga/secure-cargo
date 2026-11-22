/**
 * Where a load fails, for the editor's top view: which units and which lashings a failing
 * situation of the battery names, and in which situations. The top view marks them in red; the
 * list under the verdict says the same in words.
 */

import type { Finding } from "@/lib/demo";
import type { SituationId } from "@/lib/inspection/types";

/** Physical failures (an axle overload is a rule, shown by the axle bars). */
const PHYSICAL = new Set<Finding["code"]>([
  "unit_slid",
  "unit_tilted",
  "unit_rolled",
  "unit_left_bed",
  "unit_hit_headboard",
  "headboard_overloaded",
  "lashing_overloaded",
  "lashing_broke",
]);

export type Trouble = {
  /** Unit id -> in each situation it fails in, how (the worst way). */
  units: Map<string, Map<SituationId, Finding["code"]>>;
  /** Lashing id -> the situations it is overloaded or breaks in. */
  lashings: Map<string, SituationId[]>;
};

type Situation = { id: SituationId; findings: Finding[] };

/** Which way of failing names a unit's failure when it fails in several: the worst. */
const RANK: Partial<Record<Finding["code"], number>> = {
  unit_left_bed: 6,
  unit_tilted: 5,
  unit_rolled: 5,
  lashing_broke: 4,
  unit_hit_headboard: 3,
  headboard_overloaded: 3,
  lashing_overloaded: 2,
  unit_slid: 1,
};

export function troubleOf(situations: Situation[]): Trouble {
  const units: Trouble["units"] = new Map();
  const lashings: Trouble["lashings"] = new Map();
  for (const situation of situations) {
    for (const finding of situation.findings) {
      if (finding.severity !== "fail" || !PHYSICAL.has(finding.code)) continue;
      if (finding.lashing_id) {
        const list = lashings.get(finding.lashing_id) ?? [];
        if (!list.includes(situation.id)) lashings.set(finding.lashing_id, [...list, situation.id]);
      }
      if (finding.unit_id) {
        const bySituation = units.get(finding.unit_id) ?? new Map<SituationId, Finding["code"]>();
        const known = bySituation.get(situation.id);
        if (!known || (RANK[finding.code] ?? 0) > (RANK[known] ?? 0)) bySituation.set(situation.id, finding.code);
        units.set(finding.unit_id, bySituation);
      }
    }
  }
  return { units, lashings };
}

/** The id the server gives a unit's `n`-th top-over lashing (`_over` in `build.py`), from 1. */
export function topOverId(unitId: string, n: number): string {
  return `${unitId}-s${n}`;
}
