/**
 * Loads the MuJoCo WebAssembly module on demand.
 *
 * The module is about 2.8 MB gzipped, so it is only imported by pages that step a model, and
 * only when they ask for it. The single-threaded build is used: it needs no cross-origin
 * isolation headers and runs in every browser that has WebAssembly.
 */

import type { MainModule } from "@mujoco/mujoco";

export type Mujoco = MainModule;

let pending: Promise<Mujoco> | null = null;

export function webAssemblySupported(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}

/** Resolves with the engine; rejects when the browser cannot run it. Loads once per page. */
export function loadMujoco(): Promise<Mujoco> {
  if (!pending) {
    pending = (async () => {
      if (!webAssemblySupported()) throw new Error("WebAssembly is not available");
      const { default: factory } = await import("@mujoco/mujoco");
      return factory();
    })();
    // A failed load may be retried (for example after the network comes back).
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
