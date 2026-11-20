import { useSyncExternalStore } from "react";

import { pickQuality, type Quality, type QualityInputs } from "./quality";

/** Renderer string of the GPU, from a throwaway WebGL context; `null` when the browser hides it. */
function readRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as unknown;
    // Browsers allow only a few live contexts per page: give this one back right away.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof renderer === "string" && renderer !== "" ? renderer : null;
  } catch {
    return null;
  }
}

/** Gathers in the browser what `pickQuality` decides on. */
export function readQualityInputs(): QualityInputs {
  const { hardwareConcurrency } = navigator;
  const { deviceMemory } = navigator as Navigator & { deviceMemory?: number };
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    viewportWidth: window.innerWidth,
    hardwareConcurrency,
    deviceMemory,
    renderer: readRenderer(),
  };
}

let detected: Quality | null = null;

/** Rendering quality for this device. Detected once per page load. */
export function detectQuality(): Quality {
  detected ??= pickQuality(readQualityInputs());
  return detected;
}

const subscribe = () => () => {};

/**
 * Rendering quality for this device: "low" on phones and weak or software GPUs. On the server
 * and during hydration it is "low", the cheaper of the two.
 */
export function useQuality(): Quality {
  return useSyncExternalStore(subscribe, detectQuality, () => "low");
}
