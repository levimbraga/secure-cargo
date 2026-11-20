import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Always `false` on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const noop = () => () => {};

/** `false` on the server and during hydration, `true` afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
