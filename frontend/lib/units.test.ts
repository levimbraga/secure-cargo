import { describe, expect, it } from "vitest";

import { fromSearch, toQuery } from "./explorer/config";
import { activeBattery, type Battery, hasRules } from "./inspection/types";
import { verdictOf } from "./inspection/verdict";
import { feetInches, kgToLb, mph, units } from "./units";

const number = (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) =>
  new Intl.NumberFormat("en", options).format(value);

describe("US units", () => {
  it("converts the battery's speeds to mph (the same physics)", () => {
    expect([80, 60, 30].map(mph)).toEqual([50, 37, 19]);
  });

  it("writes lengths in feet and inches, weights in pounds with the metric value", () => {
    expect(feetInches(1.2192)).toEqual({ feet: 4, inches: 0 });
    expect(feetInches(0.3048 * 13.5)).toEqual({ feet: 13, inches: 6 });
    const us = units("US", number);
    expect(us.length(1.2192)).toBe("4 ft 0 in");
    expect(us.length(14.6304)).toBe("48 ft");
    expect(us.weight(9071.847, { lb: 20_000, metric: false })).toBe("20,000 lb");
    expect(us.weight(9000)).toBe("19,842 lb (9.0 t)");
    expect(us.speed(80)).toBe("50 mph");
    expect(us.force(66_723.3, { metric: false })).toBe("15,000 lbf");
    expect(Math.round(kgToLb(9000))).toBe(19_842);
  });

  it("keeps Brazil metric", () => {
    const br = units("BR", number);
    expect(br.speed(80)).toBe("80 km/h");
    expect(br.weight(9000)).toBe("9.0 t");
    expect(br.length(1.2)).toBe("1.20 m");
    expect(br.short(0.15)).toBe("15 cm");
    expect(br.force(12_300)).toBe("12.3 kN");
  });

  it("puts the country in the explorer's address only when it is the US", () => {
    const config = fromSearch("size=us_flatbed_48&cargo=steel_coil&country=US");
    expect(config.country).toBe("US");
    expect(toQuery(config).endsWith("&country=US")).toBe(true);
    expect(toQuery(fromSearch("cargo=crate"))).not.toContain("country");
  });
});

describe("the same battery under two countries' rules", () => {
  const situation = { id: "emergency_braking", severity: 0, findings: [] };
  const battery = {
    situations: [situation],
    contran_945: [{ code: "devices_allowed", status: "fail", article: "Art. 4 §3", unit_ids: [], message: "" }],
    checklist: { weight: [], protection: [], dimensions: [] },
    country: "BR",
    rules: {
      BR: { country: "BR", securing: [{ code: "devices_allowed", status: "fail", article: "CONTRAN 945/2022, Art. 4 §3", unit_ids: [], message: "" }], checklist: { weight: [], protection: [], dimensions: [] } },
      US: { country: "US", securing: [{ code: "rope_tiedowns", status: "to_confirm", article: "49 CFR 393.104(f)", unit_ids: [], message: "" }], checklist: { weight: [], protection: [], dimensions: [] } },
    },
  } as unknown as Battery;

  it("switches the verdict without touching the physics", () => {
    expect(verdictOf(activeBattery(battery, "BR")).state).toBe("holds_noncompliant");
    const us = activeBattery(battery, "US");
    expect(verdictOf(us).state).toBe("approved");
    expect(us.situations).toBe(battery.situations);
    expect(us.contran_945[0]?.code).toBe("rope_tiedowns");
  });

  it("shows an older battery (no rule sets) under Brazil's rules only", () => {
    const old = { ...battery, rules: undefined, country: undefined } as Battery;
    expect(hasRules(old, "US")).toBe(false);
    expect(activeBattery(old, "US").country).toBe("BR");
  });
});
