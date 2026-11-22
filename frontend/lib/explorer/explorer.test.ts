import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { choose, DEFAULT_CONFIG, fromSearch, toQuery } from "./config";
import {
  axleLoads,
  cycleStraps,
  editsToConfig,
  encodeDraft,
  type ExplorerLoad,
  footprints,
  type LoadDraft,
  moveUnit,
  parseDraft,
  strapRoom,
} from "./draft";

type StaticIndex = { queries: Record<string, { file: string; live: string; run?: string }> };
const index = JSON.parse(readFileSync("public/demo/explorer/index.json", "utf8")) as StaticIndex;
const summaries = JSON.parse(readFileSync("public/demo/summaries.json", "utf8")) as Record<
  string,
  { axle_loads: { axle_group_id: string; load_kg: number }[] }
>;

function load(file: string): ExplorerLoad {
  return JSON.parse(readFileSync(`public/demo/${file}`, "utf8")) as ExplorerLoad;
}

describe("explorer configuration", () => {
  it("writes the server's canonical query for every cached configuration", () => {
    for (const query of Object.keys(index.queries)) {
      expect(toQuery(fromSearch(`?${query}`))).toBe(query);
    }
  });

  it("is the server's default", () => {
    expect(toQuery(DEFAULT_CONFIG)).toBe(
      "body=flatbed&size=toco&cargo=wood_pallet&position=gap&restraint=top_over&speed=80&road=straight&weather=dry&event=emergency_braking",
    );
  });

  it("falls back to the defaults on a mistyped link", () => {
    const config = fromSearch("?cargo=anvil&speed=900&straps=1.x&moves=0_a_b");
    expect(config.cargo).toBe("wood_pallet");
    expect(config.speed_kmh).toBe(80);
    expect(config.straps).toBeNull();
    expect(config.moves).toEqual([]);
  });

  it("drops the editor's edits when the layout changes, not when the trip does", () => {
    const edited = { ...DEFAULT_CONFIG, straps: [1, 1, 1], moves: [{ index: 0, x_m: 1, y_m: 0 }] };
    expect(choose(edited, "road", "curvy").moves).toHaveLength(1);
    expect(choose(edited, "weather", "wet").straps).toEqual([1, 1, 1]);
    expect(choose(edited, "cargo", "crate")).toMatchObject({ moves: [], straps: null });
  });
});

describe("load editor", () => {
  const braking = Object.entries(index.queries).find(([query]) => query.includes("straps=1.1.1"));
  const base = load(braking?.[1].file ?? "");

  it("computes the axle loads the server computes, for every gallery load", () => {
    for (const entry of Object.values(index.queries)) {
      if (!entry.run) continue;
      const item = load(entry.file);
      const expected = summaries[entry.run.replace(".json", "")]?.axle_loads ?? [];
      const loads = axleLoads(item.scenario.vehicle, footprints(item.draft, item.scenario));
      expect(loads.map((axle) => axle.id)).toEqual(expected.map((axle) => axle.axle_group_id));
      loads.forEach((axle, position) => expect(axle.loadKg).toBeCloseTo(expected[position]?.load_kg ?? NaN, 0));
    }
  });

  it("snaps a dragged unit to 5 cm and keeps it on the bed", () => {
    const units = footprints(base.draft, base.scenario);
    const moved = moveUnit(base.draft, units, "pallet-3", -1.83, 0.52, base.scenario.bed);
    expect(moved?.units[2]).toMatchObject({ x_m: -1.85, y_m: 0.5 });
    const edge = moveUnit(base.draft, units, "pallet-3", -9, -9, base.scenario.bed);
    // A 1.2 m pallet on a 6.2 m bed: its centre stops 2.5 m behind the middle.
    expect(edge?.units[2]).toMatchObject({ x_m: -2.5, y_m: -0.7 });
  });

  it("refuses a drop on top of another unit", () => {
    const units = footprints(base.draft, base.scenario);
    expect(moveUnit(base.draft, units, "pallet-3", 0.4, 0, base.scenario.bed)).toBeNull();
  });

  it("moves a stack as one and puts the straps over its top", () => {
    const entry = Object.entries(index.queries).find(([query]) => query.includes("position=stacked"));
    const boxes = load(entry?.[1].file ?? "");
    const units = footprints(boxes.draft, boxes.scenario);
    const moved = moveUnit(boxes.draft, units, "carton-1", 0.4, 0.6, boxes.scenario.bed);
    const top = moved?.units.find((unit) => unit.on === "carton-1");
    expect(top).toMatchObject({ x_m: 0.4, y_m: 0.6 });
    const strapped = cycleStraps(boxes.draft, units, "carton-1", 3);
    expect(strapped.units.find((unit) => unit.on === "carton-1")?.straps).toBe(1);
  });

  it("cycles the straps over a unit up to what its anchors allow", () => {
    const units = footprints(base.draft, base.scenario);
    const pallet = units[0];
    if (!pallet) throw new Error("no pallet");
    // Anchors every 0.4 m: three pairs along a 1.2 m pallet.
    expect(strapRoom(base.scenario, pallet)).toBe(3);
    let draft = base.draft;
    const seen: number[] = [];
    for (let tap = 0; tap < 4; tap++) {
      draft = cycleStraps(draft, footprints(draft, base.scenario), "pallet-1", 3);
      seen.push(draft.units[0]?.straps ?? -1);
    }
    expect(seen).toEqual([2, 3, 0, 1]);
  });

  it("writes the edits back into the URL as the server reads them", () => {
    const units = footprints(base.draft, base.scenario);
    const moved = moveUnit(base.draft, units, "pallet-3", -1.85, 0, base.scenario.bed) as LoadDraft;
    const strapped = cycleStraps(moved, footprints(moved, base.scenario), "pallet-1", 3);
    const config = editsToConfig(fromSearch(`?${base.query}`), base.draft, strapped);
    expect(config && toQuery(config)).toBe(
      "body=flatbed&size=toco&cargo=wood_pallet&position=gap&restraint=top_over&speed=80&road=straight&weather=dry&event=emergency_braking&straps=2.1.1&moves=2_-1.85_0.00",
    );
  });

  it("leaves to the draft what the URL's configuration cannot say", () => {
    const config = fromSearch(`?${base.query}`);
    const heavier = { ...base.draft, units: base.draft.units.map((unit, n) => (n ? unit : { ...unit, mass_kg: 1400 })) };
    expect(editsToConfig(config, base.draft, heavier)).toBeNull();
    expect(editsToConfig(config, base.draft, { ...base.draft, restraint: "direct" })).toBeNull();
  });

  it("takes a draft from outside, as JSON or as link text", () => {
    const text = encodeDraft(base.draft);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseDraft(text)).toEqual(base.draft);
    const photo = parseDraft(
      JSON.stringify({ version: 1, source: "photo", units: [{ id: "a", cargo: "crate", x_m: 0, y_m: 0 }] }),
    );
    expect(photo.truck).toEqual({ body: "flatbed", size: "toco" });
    expect(photo.units[0]?.straps).toBe(0);
    expect(() => parseDraft('{"version": 2}')).toThrow();
  });
});
