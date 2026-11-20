import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import { DEMO_IDS, type DemoRun, demoFile, isDemoId, summarize, unitName, VARIANTS } from "./demo";
import { demoSummary } from "./demo-summaries";
import { parseKeyframes, sampleFrame, strapPath } from "./keyframes";

function readRun(id: (typeof DEMO_IDS)[number], variant: (typeof VARIANTS)[number]): DemoRun {
  return JSON.parse(readFileSync(join(__dirname, "..", "public", demoFile(id, variant)), "utf8")) as DemoRun;
}

describe("static demo files written by the backend", () => {
  it.each(DEMO_IDS.flatMap((id) => VARIANTS.map((variant) => [id, variant] as const)))(
    "%s (%s) is a replayable simulation",
    (id, variant) => {
      const run = readRun(id, variant);
      const doc = parseKeyframes(run.result.keyframes);

      expect(run.id).toBe(id);
      expect(run.variant).toBe(variant);
      expect(doc.version).toBe(2);
      expect(doc.source).toBe("simulation");
      expect(doc.fps).toBe(30);
      expect(doc.frames).toHaveLength(Math.round(doc.duration_s * 30) + 1);
      expect(run.result.verdict.status).toBe(variant === "as_loaded" ? "fail" : "pass");

      // Every lashing can be drawn at the first and last frame.
      for (const time of [0, doc.duration_s]) {
        const sample = sampleFrame(doc, time);
        doc.straps.forEach((strap, index) => {
          const path = strapPath(doc, sample, index);
          expect(path).toHaveLength(strap.routing === "top_over" ? 4 : 2);
          expect(path.flat().every(Number.isFinite)).toBe(true);
        });
      }
    },
  );

  it("draws every lashing at the first frame where it was installed", () => {
    for (const id of DEMO_IDS) {
      const doc = parseKeyframes(readRun(id, "fixed").result.keyframes);
      const start = sampleFrame(doc, 0);
      doc.straps.forEach((strap, index) => {
        const path = strapPath(doc, start, index);
        path.forEach((point, pointIndex) => {
          const installed = strap.path_m[pointIndex] ?? [NaN, NaN, NaN];
          // Units settle a few millimetres onto the floor before the event starts.
          point.forEach((value, axis) => expect(value).toBeCloseTo(installed[axis] ?? NaN, 1));
        });
      });
    }
  });

  it("has copy for every scenario, variant and timeline marker", () => {
    const markers = new Set<string>();
    for (const id of DEMO_IDS) {
      expect(en.Scenario.titles[id]).toBeTruthy();
      for (const variant of VARIANTS) {
        expect(en.Scenario.sentences[id][variant]).toBeTruthy();
        expect(en.Scenario.explanations[id][variant]).toBeTruthy();
        readRun(id, variant).result.keyframes.events.forEach((event) => markers.add(event.kind));
      }
    }
    for (const marker of markers) expect(Object.keys(en.Scenario.markers)).toContain(marker);
  });

  it("names every unit and every finding the demos produce", () => {
    for (const id of DEMO_IDS) {
      for (const variant of VARIANTS) {
        const { result } = readRun(id, variant);
        for (const unit of result.units) {
          expect(Object.keys(en.Scenario.units)).toContain(unitName(unit.id).kind);
        }
        for (const finding of result.verdict.findings) {
          expect(Object.keys(en.Scenario.findings)).toContain(finding.code);
        }
      }
    }
  });
});

describe("demo summaries", () => {
  it("carry the verdict and margins but not the keyframes", () => {
    for (const id of DEMO_IDS) {
      const summary = demoSummary(id);

      expect(summary.runs.as_loaded.verdict.status).toBe("fail");
      expect(summary.runs.fixed.verdict.status).toBe("pass");
      expect(summary.runs.fixed.en_12195_1.every((check) => check.meets_standard)).toBe(true);
      expect(summary.runs.fixed.margins.max_slide_m).toBeLessThan(0.005);
      expect(JSON.stringify(summary)).not.toContain("keyframes");
      expect(JSON.stringify(summary).length).toBeLessThan(12_000);
    }
  });

  it("match what summarize() makes of the file", () => {
    expect(demoSummary("sharp-curve").runs.fixed).toEqual(summarize(readRun("sharp-curve", "fixed")));
  });
});

describe("helpers", () => {
  it("recognise the demo ids", () => {
    expect(isDemoId("weigh-station")).toBe(true);
    expect(isDemoId("unknown")).toBe(false);
  });

  it("split a unit id into its kind and number", () => {
    expect(unitName("pallet-2")).toEqual({ kind: "pallet", number: 2 });
    expect(unitName("machine")).toEqual({ kind: "machine", number: null });
  });
});
