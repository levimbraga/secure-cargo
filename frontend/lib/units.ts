/**
 * Units for the page: metric in Brazil and the EU (EU lashings in daN, as on their labels), US
 * customary in US mode (lb, ft/in, mph, lbf), with the metric value next to it where it helps. Everything inside stays SI (kg, m, km/h, N); only what
 * is shown changes. The number formatting follows the page's language (1,234.5 or 1.234,5).
 */

import { useFormatter } from "next-intl";
import { useMemo } from "react";

import type { Country } from "./country";

export const LB_KG = 0.45359237;
export const FOOT_M = 0.3048;
export const INCH_M = 0.0254;
export const MILE_KM = 1.609344;
export const LBF_N = 4.4482216152605;
export const LBF_FT_NM = LBF_N * FOOT_M;

export const kgToLb = (kg: number) => kg / LB_KG;
export const lbToKg = (lb: number) => lb * LB_KG;
export const kmhToMph = (kmh: number) => kmh / MILE_KM;
export const mToFt = (m: number) => m / FOOT_M;
export const ftToM = (ft: number) => ft * FOOT_M;

/** Feet and inches of a length, the inches rounded (12 in carries to the next foot). */
export function feetInches(m: number): { feet: number; inches: number } {
  const total = Math.round(m / INCH_M);
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

/** The situations' speeds in mph, to the nearest mile (80 km/h is about 50 mph). */
export const mph = (kmh: number) => Math.round(kmhToMph(kmh));

type NumberOptions = { minimumFractionDigits?: number; maximumFractionDigits?: number };
type Number = (value: number, options?: NumberOptions) => string;

export type Units = {
  system: "metric" | "us";
  /** A cargo or axle weight: "19,842 lb (9.0 t)" or "9.0 t". Exact pounds when given. */
  weight: (kg: number, options?: { lb?: number; metric?: boolean }) => string;
  /** A small weight, in kg or lb: "900 kg" / "1,984 lb". */
  mass: (kg: number) => string;
  /** A length: "4 ft 0 in" / "1.22 m"; long ones in feet: "48 ft". */
  length: (m: number, options?: { metric?: boolean }) => string;
  /** A short distance (a gap, a slide): "6 in" / "15 cm", one decimal when small. */
  short: (m: number) => string;
  speed: (kmh: number) => string;
  /** A force: "15,000 lbf (66.7 kN)" / "66.7 kN". */
  force: (newtons: number, options?: { metric?: boolean }) => string;
  /** A lashing device's capacity or tension as marked: "2,500 daN" (EU), "5,620 lbf", "25.0 kN". */
  capacity: (newtons: number) => string;
  /** A moment: "12.0 kN·m" / "8,851 lbf·ft". */
  moment: (newtonMetres: number) => string;
  /** The unit of an entry field. */
  weightUnit: string;
  lengthUnit: string;
  /** Typed value (in the field's unit) to SI, and back. */
  weightIn: (value: number) => number;
  weightOut: (kg: number) => number;
  lengthIn: (value: number) => number;
  lengthOut: (m: number) => number;
};

export function units(country: Country, number: Number): Units {
  const us = country === "US";
  const eu = country === "EU";
  const tonnes = (kg: number) => `${number(kg / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
  const metres = (m: number) => `${number(m, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  const kn = (n: number) => `${number(n / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kN`;
  const ftIn = (m: number) => {
    const { feet, inches } = feetInches(m);
    return m >= 20 * FOOT_M && inches === 0 ? `${number(feet)} ft` : `${number(feet)} ft ${number(inches)} in`;
  };
  return {
    system: us ? "us" : "metric",
    weight: (kg, options = {}) => {
      if (!us) return kg >= 1000 ? tonnes(kg) : `${number(Math.round(kg))} kg`;
      const lb = `${number(Math.round(options.lb ?? kgToLb(kg)))} lb`;
      return options.metric === false ? lb : `${lb} (${kg >= 1000 ? tonnes(kg) : `${number(Math.round(kg))} kg`})`;
    },
    mass: (kg) => (us ? `${number(Math.round(kgToLb(kg)))} lb` : `${number(Math.round(kg))} kg`),
    length: (m, options = {}) => (us ? (options.metric ? `${ftIn(m)} (${metres(m)})` : ftIn(m)) : metres(m)),
    short: (m) => {
      const value = us ? m / INCH_M : m * 100;
      const digits = Math.abs(value) >= 10 ? 0 : 1;
      return `${number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${us ? "in" : "cm"}`;
    },
    speed: (kmh) => (us ? `${number(mph(kmh))} mph` : `${number(kmh)} km/h`),
    force: (newtons, options = {}) =>
      us ? `${number(Math.round(newtons / LBF_N))} lbf${options.metric === false ? "" : ` (${kn(newtons)})`}` : kn(newtons),
    capacity: (newtons) =>
      eu ? `${number(Math.round(newtons / 10))} daN` : us ? `${number(Math.round(newtons / LBF_N))} lbf` : kn(newtons),
    moment: (nm) => (us ? `${number(Math.round(nm / LBF_FT_NM))} lbf·ft` : `${number(nm / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kN·m`),
    weightUnit: us ? "lb" : "kg",
    lengthUnit: us ? "ft" : "m",
    weightIn: (value) => (us ? lbToKg(value) : value),
    weightOut: (kg) => (us ? kgToLb(kg) : kg),
    lengthIn: (value) => (us ? ftToM(value) : value),
    lengthOut: (m) => (us ? mToFt(m) : m),
  };
}

export function useUnits(country: Country): Units {
  const format = useFormatter();
  return useMemo(() => units(country, (value, options) => format.number(value, options)), [country, format]);
}
