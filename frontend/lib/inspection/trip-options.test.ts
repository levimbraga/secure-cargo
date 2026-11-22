import { describe, expect, it } from "vitest";

import { roadOptions, sameTrip, shownRoad, shownWeather, speedMatters, type Trip, weatherOptions, withChoice } from "./trip-options";

const trip = (event: Trip["event"], road: Trip["road"], weather: Trip["weather"] = "dry", speed_kmh = 60): Trip => ({ event, road, weather, speed_kmh });

describe("try another situation", () => {
  it("never offers the mountain descent as a road", () => {
    for (const event of ["emergency_braking", "lane_change", "sharp_curve", "pothole", "speed_bump", "mountain_descent", "long_vibration"]) {
      const roads = roadOptions(event);
      // Curves choose their bends (the mountain road's 40 m ones); the others only paved or dirt.
      if (event === "sharp_curve" || event === "mountain_descent") expect(roads).toEqual(["curvy", "mountain", "dirt"]);
      else expect(roads).toEqual(["straight", "dirt"]);
    }
  });

  it("offers rain only where the tyres' grip matters", () => {
    expect(weatherOptions("emergency_braking", "straight")).toContain("heavy_rain");
    expect(weatherOptions("long_vibration", "straight")).toContain("wet");
    expect(weatherOptions("speed_bump", "straight")).toEqual(["dry", "mud", "fog"]);
    // On a dirt road rain is mud.
    expect(weatherOptions("emergency_braking", "dirt")).toEqual(["dry", "mud", "fog"]);
  });

  it("matches a battery's situation by its physics, not its labels", () => {
    // The battery's speed bump runs on an "urban" road: the same as a paved one.
    expect(sameTrip(trip("speed_bump", "urban", "dry", 30), trip("speed_bump", "straight", "dry", 30))).toBe(true);
    // The mountain descent "in heavy rain" is the dry one: rain never binds there.
    expect(sameTrip(trip("mountain_descent", "mountain", "heavy_rain"), trip("mountain_descent", "mountain", "dry"))).toBe(true);
    expect(sameTrip(trip("mountain_descent", "mountain"), trip("mountain_descent", "curvy"))).toBe(false);
    expect(sameTrip(trip("emergency_braking", "straight", "wet"), trip("emergency_braking", "straight", "dry"))).toBe(false);
    expect(sameTrip(trip("pothole", "potholed", "dry", 60), trip("pothole", "straight", "dry", 80))).toBe(false);
    // The long vibration ends in a full stop at any speed.
    expect(speedMatters("long_vibration")).toBe(false);
    expect(sameTrip(trip("long_vibration", "dirt", "dry", 60), trip("long_vibration", "dirt", "dry", 90))).toBe(true);
  });

  it("shows the offered choice a trip is the same as", () => {
    expect(shownRoad(trip("speed_bump", "urban"))).toBe("straight");
    expect(shownRoad(trip("sharp_curve", "urban"))).toBe("mountain");
    expect(shownWeather(trip("lane_change", "straight", "heavy_rain"))).toBe("dry");
    expect(shownWeather(trip("emergency_braking", "dirt", "wet"))).toBe("mud");
  });

  it("keeps a changed trip within the offered choices", () => {
    expect(withChoice(trip("speed_bump", "urban", "heavy_rain"), { road: "dirt" })).toMatchObject({ road: "dirt", weather: "heavy_rain" });
    expect(withChoice(trip("sharp_curve", "potholed"), { weather: "fog" })).toMatchObject({ road: "curvy", weather: "fog" });
  });
});
