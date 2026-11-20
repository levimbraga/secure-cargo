/**
 * Loads the MuJoCo WebAssembly module on demand.
 *
 * The module is about 2.8 MB gzipped, so only pages that step a model ask for it, and only when
 * they need it. The single-threaded build is used: it needs no cross-origin isolation headers
 * and runs in every browser that has WebAssembly.
 *
 * In the browser the module is imported at run time from `/mujoco/<version>/` (copied there by
 * `scripts/copy-mujoco.mjs`), not through the bundler. Tests in Node import the package itself.
 */

import type { MainModule } from "@mujoco/mujoco";

export type Mujoco = MainModule;

/** Version of `@mujoco/mujoco` in package.json; a test keeps the two equal. */
export const MUJOCO_VERSION = "4.0.1";
const MODULE_URL = `/mujoco/${MUJOCO_VERSION}/mujoco.js`;

let pending: Promise<Mujoco> | null = null;

export function webAssemblySupported(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}

/** Resolves with the engine; rejects when the browser cannot run it. Loads once per page. */
export function loadMujoco(): Promise<Mujoco> {
  if (!pending) {
    pending = (async () => {
      if (!webAssemblySupported()) throw new Error("WebAssembly is not available");
      const { default: factory } = (await import(/* webpackIgnore: true */ MODULE_URL)) as {
        default: () => Promise<Mujoco>;
      };
      return factory();
    })();
    // A failed load may be retried (for example after the network comes back).
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
