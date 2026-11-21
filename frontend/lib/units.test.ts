import { describe, expect, it } from "vitest";

import { fromSearch, toQuery } from "./explorer/config";
import { type AxleGroup, axleLoads, type Footprint } from "./explorer/draft";
import { geoCountry } from "./geo";
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

describe("EU mode", () => {
  it("stays metric and writes lashing capacities in daN, as on an EU label", () => {
    const eu = units("EU", number);
    expect(eu.weight(9000)).toBe("9.0 t");
    expect(eu.speed(80)).toBe("80 km/h");
    expect(eu.capacity(25_000)).toBe("2,500 daN");
    expect(units("BR", number).capacity(25_000)).toBe("25.0 kN");
  });

  it("puts the country and the body code in the explorer's address", () => {
    const config = fromSearch("body=curtain_sider&size=eu_semi_136&country=EU&code=XL");
    expect(config).toMatchObject({ country: "EU", body_code: "XL", size: "eu_semi_136" });
    expect(toQuery(config)).toContain("&country=EU&code=XL");
    expect(fromSearch("code=XXL").body_code).toBeNull();
  });

  it("starts visitors from the 27 member states in EU mode", () => {
    expect(geoCountry("DE")).toBe("EU");
    expect(geoCountry("PT")).toBe("EU");
    expect(geoCountry("GB")).toBe("BR");
    expect(geoCountry("US")).toBe("US");
    expect(geoCountry("BR")).toBe("BR");
  });

  it("names the worst roadside class first", () => {
    const battery = {
      situations: [{ id: "emergency_braking", findings: [] }],
      contran_945: [],
      country: "EU",
      rules: {
        EU: {
          securing: [
            { code: "eu_forward", status: "fail", deficiency: "major" as const },
            { code: "eu_sideways", status: "fail", deficiency: "dangerous" as const },
          ],
          checklist: { weight: [], protection: [], dimensions: [] },
        },
      },
    };
    const verdict = verdictOf(battery);
    expect(verdict.state).toBe("holds_noncompliant");
    expect(verdict.problem).toMatchObject({ code: "eu_sideways", deficiency: "dangerous" });
  });

  it("checks axle loads against 96/53/EC on an EU articulated preset", () => {
    const vehicle = {
      axle_groups: [
        { id: "tractor", kind: "tandem_2_axles" as const, position_x_m: 5.2, tare_load_kg: 4400 },
        { id: "trailer", kind: "tandem_3_axles" as const, position_x_m: -2.6, tare_load_kg: 4800 },
      ] as [AxleGroup, AxleGroup],
      payload_kg: 25000,
    };
    const loads = axleLoads(vehicle, [{ x: 0, y: 0, mass: 25000 } as Footprint], "EU", "eu_semi_136");
    expect(loads[1]?.limitKg).toBe(24_000);
    expect(loads.every((load) => load.ratio <= 1)).toBe(true);
    expect(axleLoads(vehicle, [{ x: 0, y: 0, mass: 25000 } as Footprint], "BR")[1]?.limitKg).toBe(25_500);
  });
});
