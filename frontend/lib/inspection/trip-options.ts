/**
 * "Try another situation" on the result page: which road, weather and speed choices actually
 * change the physics of a situation, so the page offers only those.
 *
 * The table mirrors `backend/app/explorer/build.py` (`trip_event`) and
 * `backend/physics/conditions/events.py`; it was checked by building every combination's motion
 * profile on the server and comparing them (`notes/result-page-report.md`, "Honesty check"):
 *
 * - the road matters only through its curve radius (sharp curve, mountain descent: curvy 60 m,
 *   mountain 40 m; urban 30 m equals mountain for a sharp curve, the grip limit binds first) and a
 *   dirt surface (lower grip, dirty deck); straight, potholed and urban roads are the same road
 *   for every other event;
 * - rain lowers the tyres' grip, which only an emergency stop uses (emergency braking, the stop
 *   after a long vibration); the other events never ask for more grip than a wet road gives, and
 *   rain does not lower cargo friction (EN 12195-1). On a dirt road rain is mud;
 * - fog is real everywhere: the hazard is seen late and the driver brakes hard;
 * - the long vibration ends in a full stop whatever the speed, so speed changes nothing there.
 */

import type { LoadDraft } from "@/lib/explorer/draft";

export type Trip = LoadDraft["trip"];
type Road = Trip["road"];
type Weather = Trip["weather"];

const CURVES = new Set<string>(["sharp_curve", "mountain_descent"]);
/** Events that end in an emergency stop: the tyres' grip (dry, wet, heavy rain) sets how hard. */
const GRIP_EVENTS = new Set<string>(["emergency_braking", "long_vibration"]);
const SPEEDLESS = new Set<string>(["long_vibration"]);

export function isCurve(event: string): boolean {
  return CURVES.has(event);
}

/** The roads worth offering for an event. */
export function roadOptions(event: string): Road[] {
  return isCurve(event) ? ["curvy", "mountain", "dirt"] : ["straight", "dirt"];
}

/** The weathers worth offering for an event on a road. */
export function weatherOptions(event: string, road: Road): Weather[] {
  if (road === "dirt") return ["dry", "mud", "fog"];
  return GRIP_EVENTS.has(event) ? ["dry", "wet", "heavy_rain", "mud", "fog"] : ["dry", "mud", "fog"];
}

/** Whether rain was left out because it changes nothing in this event (said on the page). */
export function rainChangesNothing(event: string, road: Road): boolean {
  return road !== "dirt" && !GRIP_EVENTS.has(event);
}

export function speedMatters(event: string): boolean {
  return !SPEEDLESS.has(event);
}

/** The offered road a trip's road is the same as (a speed bump's "urban" is a paved road). */
export function shownRoad(trip: Trip): Road {
  if (trip.road === "dirt") return "dirt";
  if (!isCurve(trip.event)) return "straight";
  if (trip.road === "curvy" || trip.road === "mountain") return trip.road;
  // A sharp curve on a city street is as tight as on a mountain road (the grip limit binds).
  if (trip.road === "urban" && trip.event === "sharp_curve") return "mountain";
  return trip.road;
}

/** The offered weather a trip's weather is the same as. */
export function shownWeather(trip: Trip): Weather {
  if (trip.road === "dirt") return trip.weather === "dry" || trip.weather === "fog" ? trip.weather : "mud";
  if (rainChangesNothing(trip.event, trip.road) && (trip.weather === "wet" || trip.weather === "heavy_rain")) return "dry";
  return trip.weather;
}

/** Two trips with the same physics have the same key: a battery's situation is found by it. */
export function tripKey(trip: Trip): string {
  return [trip.event, shownRoad(trip), shownWeather(trip), speedMatters(trip.event) ? trip.speed_kmh : "-"].join("|");
}

export function sameTrip(a: Trip, b: Trip): boolean {
  return tripKey(a) === tripKey(b);
}

/** A trip moved to another road or weather, kept within what is offered. */
export function withChoice(trip: Trip, patch: Partial<Pick<Trip, "road" | "weather" | "speed_kmh">>): Trip {
  const next = { ...trip, ...patch };
  if (!roadOptions(next.event).includes(shownRoad(next))) next.road = isCurve(next.event) ? "curvy" : "straight";
  if (!weatherOptions(next.event, next.road).includes(shownWeather(next))) next.weather = "dry";
  return next;
}
