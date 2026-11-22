import { describe, expect, it } from "vitest";

import type { Scenario, ScenarioLashing } from "@/lib/live/scenario";

import type { DraftLashing } from "./draft";
import { addLashing, anglesOf, attachmentPoint, defaultDiagonalAnchor, fromScenario } from "./lashings";

// A 6 m by 2.4 m bed with lashing points every 0.5 m at floor level, ids from the rear.
const anchors = Array.from({ length: 12 }, (_, n) => -2.75 + n * 0.5).flatMap((x, n) => [
  { id: `L${n}`, position_m: [x, 1.2, 0] as [number, number, number], rated_capacity_n: null },
  { id: `R${n}`, position_m: [x, -1.2, 0] as [number, number, number], rated_capacity_n: null },
]);
const bed = { bed: { anchor_points: anchors, length_m: 6, width_m: 2.4 } } as unknown as Pick<Scenario, "bed">;
// A 1.2 x 1.0 x 1.0 m crate in the middle of the bed.
const crate = { id: "crate-1", x: 0, y: 0, z: 0, length: 1.2, width: 1.0, height: 1.0, cargo: "crate" as const };

const lashing = (patch: Partial<ScenarioLashing>): ScenarioLashing => ({
  id: "x",
  kind: "strap",
  routing: "top_over",
  unit_id: "crate-1",
  anchor_ids: ["L5", "R5"],
  attachment_point_m: null,
  pretension_n: 3000,
  lashing_capacity_n: 25000,
  elongation_at_lc: null,
  breaking_strength_n: null,
  ...patch,
});

describe("lashings set by hand", () => {
  it("start from the server's lashings, with each diagonal's corner", () => {
    const list = fromScenario(
      [
        lashing({}),
        lashing({ kind: "chain", routing: "direct", anchor_ids: ["R1"], attachment_point_m: [-0.6, -0.5, 0.4] }),
        lashing({ unit_id: "crate-2" }),
      ],
      crate,
      bed,
    );
    expect(list).toEqual([
      { kind: "strap", routing: "top_over", anchors: ["L5", "R5"] },
      { kind: "chain", routing: "direct", anchors: ["R1"], corner: "rear_right" },
    ]);
  });

  it("add a strap over the top at the first free pair along the unit, and a diagonal at the next corner", () => {
    let list: DraftLashing[] = [{ kind: "strap", routing: "top_over", anchors: ["L5", "R5"] }];
    list = addLashing(list, bed, crate, "top_over", "chain") ?? [];
    expect(list[1]).toEqual({ kind: "chain", routing: "top_over", anchors: ["L6", "R6"] });
    list = addLashing(list, bed, crate, "direct", "strap") ?? [];
    expect(list[2]).toMatchObject({ routing: "direct", corner: "front_left" });
    // 0.9 m beyond the front end (x 0.6): the left point nearest x 1.5 is at 1.25 or 1.75.
    expect(["L8", "L9"]).toContain(list[2]?.anchors[0]);
  });

  it("put a diagonal on its corner, or through a coil's eye", () => {
    expect(attachmentPoint(crate, "rear_right")).toEqual([-0.6, -0.5, 0.4]);
    const coil = { ...crate, cargo: "steel_coil" as const, length: 1.6, width: 1.2, height: 1.6 };
    expect(attachmentPoint(coil, "front_left")).toEqual([0, 0.6, 0.8]);
    expect(defaultDiagonalAnchor(bed, crate, "rear_right").startsWith("R")).toBe(true);
  });

  it("give the angles that follow from the geometry", () => {
    // Over the top: 1 m up over 0.7 m across, about 55 degrees.
    expect(anglesOf({ kind: "strap", routing: "top_over", anchors: ["L5", "R5"] }, bed, crate)?.alpha).toBeCloseTo(55.0, 0);
    const diagonal = anglesOf({ kind: "strap", routing: "direct", anchors: ["L8"], corner: "front_left" }, bed, crate);
    // From (0.6, 0.5, 0.4) to (1.25, 1.2, 0): 0.65 along, 0.7 across, 0.4 down.
    expect(diagonal?.beta).toBeCloseTo((Math.atan2(0.7, 0.65) * 180) / Math.PI, 3);
    expect(diagonal?.alpha).toBeCloseTo((Math.atan2(0.4, Math.hypot(0.65, 0.7)) * 180) / Math.PI, 3);
  });
});
