"use client";

/**
 * The country a part of the page is shown in (its rules and units), for the components deep
 * inside it: the checklist, the simulation's reason sentence, the replay's speed. Outside any
 * provider everything is Brazilian (metric).
 */

import { createContext, type ReactNode, useContext } from "react";

import type { Country } from "@/lib/country";
import { type Units, useUnits } from "@/lib/units";

const ShownCountry = createContext<Country>("BR");

export function UnitsProvider({ country, children }: { country: Country; children: ReactNode }) {
  return <ShownCountry.Provider value={country}>{children}</ShownCountry.Provider>;
}

export function useShownCountry(): Country {
  return useContext(ShownCountry);
}

export function useShownUnits(): Units {
  return useUnits(useContext(ShownCountry));
}
