import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LoadDraft } from "@/lib/explorer/draft";

import { fixSteps } from "./fix-steps";
import type { Change } from "./types";

const demo = (file: string) => JSON.parse(readFileSync(path.join(__dirname, "../../public/demo", file), "utf8"));

/** A gallery inspection: its load as loaded, and the planner's tested fix. */
function inspection(id: string) {
  const loaded = demo(`inspections/${id}.as_loaded.json`) as { draft: LoadDraft };
  const plan = demo(`inspections/${id}.plan.json`) as { draft: LoadDraft; changes: Change[] };
  return fixSteps(plan.changes, loaded.draft, plan.draft);
}

describe("fix steps", () => {
  it("joins diagonals and the extra strap into one step, with the count of the tested load", () => {
    const sample = demo("samples/crates-ropes.json") as { battery: { draft: LoadDraft }; plan: { draft: LoadDraft; changes: Change[] } };
    const steps = fixSteps(sample.plan.changes, sample.battery.draft, sample.plan.draft);
    expect(steps.map((step) => step.kind)).toEqual(["change", "restraintStraps", "change"]);
    expect(steps[1]).toMatchObject({ restraint: "direct", to: 2, unitIds: ["unit-3"], every: false, rest: 1 });
    // No step says "1 → 2 straps" beside "instead of top over".
    expect(steps.some((step) => step.kind === "straps")).toBe(false);
  });

  it("says 'diagonals and 2 straps over each' when every unit gets both", () => {
    expect(inspection("sharp-curve")).toEqual([
      expect.objectContaining({ kind: "restraintStraps", restraint: "direct", to: 2, every: true, rest: null }),
    ]);
  });

  it("says cradles instead of the straps when the straps go", () => {
    expect(inspection("us-steel-coils")).toEqual([expect.objectContaining({ kind: "restraintInstead", restraint: "cradle_chain" })]);
  });

  it("keeps the straps when only a cradle is added", () => {
    expect(inspection("overloaded-strap")).toEqual([expect.objectContaining({ kind: "restraint", restraint: "cradle", keep: true })]);
  });

  it("writes straps over the top as one step for every unit", () => {
    expect(inspection("eu-curtain-pallets")).toEqual([expect.objectContaining({ kind: "straps", to: 2, from: 0, every: true })]);
  });

  it("leaves the other changes as they are", () => {
    expect(inspection("weigh-station").map((step) => step.kind)).toEqual(["change"]);
  });
});
