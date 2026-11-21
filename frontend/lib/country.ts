"use client";

/**
 * Whose rules a load is checked against: Brazil (CONTRAN), the United States (FMCSA 393 and
 * 23 CFR 658) or the European Union (Directive 2014/47/EU Annex III and Directive 96/53/EC).
 * Independent of the page's language: a pt-BR page may show US or EU rules. The physics is the
 * same; the rules and the units change (US: lb, ft/in, mph, lbf; EU: metric, lashings in daN).
 *
 * The visitor's choice is remembered in this browser. A new visitor reading the English site
 * from the United States or an EU member state starts in that mode (the `sc_geo` cookie set by
 * `proxy.ts` from Vercel's IP country header); everyone else starts in Brazil.
 */

import { useLocale } from "next-intl";
import { useCallback, useSyncExternalStore } from "react";

export const COUNTRIES = ["BR", "US", "EU"] as const;
export type Country = (typeof COUNTRIES)[number];

const KEY = "securecargo.country";
const EVENT = "securecargo:country";

export function isCountry(value: unknown): value is Country {
  return value === "BR" || value === "US" || value === "EU";
}

function stored(): Country | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return isCountry(value) ? value : null;
  } catch {
    return null;
  }
}

function geo(): Country | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)sc_geo=(US|EU|BR)\b/.exec(document.cookie);
  return match ? (match[1] as Country) : null;
}

/** The country a new visitor starts in. */
export function defaultCountry(locale: string): Country {
  const visitor = geo();
  return locale === "en" && (visitor === "US" || visitor === "EU") ? visitor : "BR";
}

export function rememberCountry(country: Country): void {
  try {
    window.localStorage.setItem(KEY, country);
  } catch {
    // private mode: the choice lasts for this page only
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: country }));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The visitor's country (remembered in this browser, else the default), and a setter. */
export function useCountry(): [Country, (country: Country) => void] {
  const locale = useLocale();
  const country = useSyncExternalStore(
    subscribe,
    () => stored() ?? defaultCountry(locale),
    () => "BR" as Country,
  );
  const choose = useCallback((value: Country) => rememberCountry(value), []);
  return [country, choose];
}
