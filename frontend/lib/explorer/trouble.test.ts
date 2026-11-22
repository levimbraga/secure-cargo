import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/demo";

import { topOverId, troubleOf } from "./trouble";

const finding = (code: Finding["code"], unit: string | null, lashing: string | null = null, severity: Finding["severity"] = "fail"): Finding =>
  ({ code, severity, unit_id: unit, lashing_id: lashing, axle_group_id: null, value: 1, limit: 0 }) as Finding;

describe("where a load fails", () => {
  it("names each unit's worst failure per situation, and the overloaded lashings", () => {
    const trouble = troubleOf([
      { id: "emergency_braking", findings: [finding("unit_slid", "pallet-1"), finding("unit_hit_headboard", "pallet-1")] },
      { id: "long_vibration", findings: [finding("unit_tilted", "pallet-3"), finding("lashing_overloaded", "pallet-3", "pallet-3-s1")] },
      { id: "sharp_curve", findings: [] },
    ]);
    expect(trouble.units.get("pallet-1")?.get("emergency_braking")).toBe("unit_hit_headboard");
    expect(trouble.units.get("pallet-3")?.get("long_vibration")).toBe("unit_tilted");
    expect(trouble.lashings.get(topOverId("pallet-3", 1))).toEqual(["long_vibration"]);
  });

  it("leaves out warnings and rule findings (an axle overload is a rule)", () => {
    const trouble = troubleOf([
      { id: "emergency_braking", findings: [finding("unit_slid", "pallet-1", null, "warning"), finding("axle_overloaded", null)] },
    ]);
    expect(trouble.units.size).toBe(0);
    expect(trouble.lashings.size).toBe(0);
  });
});
