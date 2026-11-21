"use client";

import { useTranslations } from "next-intl";

/** A failure type's short name ("Slides on the deck"); the code itself when it has none. */
export function useFailureLabel() {
  const t = useTranslations("Manager.failures");
  return (code: string) => (t.has(code as never) ? t(code as never) : code);
}

/** Failure types that are physics (the rest are rules). */
export const PHYSICAL_FAILURES = new Set([
  "unit_slid",
  "unit_hit_headboard",
  "headboard_overloaded",
  "unit_left_bed",
  "unit_tilted",
  "unit_rolled",
  "lashing_broke",
  "lashing_overloaded",
]);
