"use client";

import { REDUCED_MOTION, useMediaQuery } from "./use-media-query";

/** A mouse or trackpad that can hover: a computer, not a phone or a tablet. */
export const HOVER_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Whether a simulation or a clip may start by itself. On a computer it does, as soon as it is
 * on screen; on a phone or a tablet it waits, paused, for the visitor to tap Play (the owner's
 * call, 2026-11-22: a phone should not spend data and battery on what nobody asked to watch).
 * With reduced motion it always waits.
 */
export function canAutostart(): boolean {
  return window.matchMedia(HOVER_POINTER).matches && !window.matchMedia(REDUCED_MOTION).matches;
}

/** `canAutostart` as a hook (false on the server and during hydration). */
export function useAutostart(): boolean {
  const hover = useMediaQuery(HOVER_POINTER);
  const reduced = useMediaQuery(REDUCED_MOTION);
  return hover && !reduced;
}
