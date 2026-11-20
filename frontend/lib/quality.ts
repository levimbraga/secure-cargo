/**
 * Rendering quality of the 3D scene (replay and live lab). "low" is for phones and weak or
 * software GPUs: no shadow maps and no image-based lighting. See the mobile performance budget
 * in docs/design.md.
 */

export type Quality = "high" | "low";

export type QualityInputs = {
  /** The primary pointer is a finger: `(pointer: coarse)`. */
  coarsePointer: boolean;
  /** Width of the viewport in CSS pixels. */
  viewportWidth: number;
  /** `navigator.hardwareConcurrency`, where the browser reports it. */
  hardwareConcurrency?: number | null;
  /** `navigator.deviceMemory` in GiB (Chromium only). */
  deviceMemory?: number | null;
  /** Renderer string of the GPU (WEBGL_debug_renderer_info), where the browser gives it. */
  renderer?: string | null;
};

export type QualitySettings = {
  /** Soft shadow maps from the sun. Without them the truck gets one flat contact shadow. */
  shadows: boolean;
  /** Image-based lighting from the studio environment generated in the browser. */
  environment: boolean;
  /** Multisampling. Kept at both levels: it is cheap on tile-based phone GPUs and thin lashings need it. */
  antialias: boolean;
  /** Upper bound of the device pixel ratio the canvas is drawn at. */
  maxDpr: number;
};

/** The canvas never draws more than 1.5 device pixels per CSS pixel. */
export const MAX_DPR = 1.5;

export const QUALITY_SETTINGS: Record<Quality, QualitySettings> = {
  high: { shadows: true, environment: true, antialias: true, maxDpr: MAX_DPR },
  low: { shadows: false, environment: false, antialias: true, maxDpr: MAX_DPR },
};

/** Viewports narrower than this, on a touch device, are phones. */
const PHONE_MAX_WIDTH = 768;
/** At most this many logical cores, or this much memory [GiB], counts as a low-end device. */
const LOW_END_CORES = 4;
const LOW_END_MEMORY_GIB = 4;

/** CPU rasterizers: every pixel of a shadow map is paid for on the processor. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;
/** GPU families that only exist in phones, tablets and single-board computers. */
const MOBILE_RENDERER = /\b(mali|immortalis|adreno|powervr|videocore|vivante|tegra|xclipse)\b/i;
/** Safari reports "Apple GPU" on phones, tablets and laptops alike; only the touch ones are mobile. */
const APPLE_RENDERER = /\bapple\b/i;

/** Picks the rendering quality from what the browser tells about the device. Unknown values are ignored. */
export function pickQuality({
  coarsePointer,
  viewportWidth,
  hardwareConcurrency,
  deviceMemory,
  renderer,
}: QualityInputs): Quality {
  if (renderer) {
    if (SOFTWARE_RENDERER.test(renderer) || MOBILE_RENDERER.test(renderer)) return "low";
    if (coarsePointer && APPLE_RENDERER.test(renderer)) return "low";
  }
  if (coarsePointer && viewportWidth < PHONE_MAX_WIDTH) return "low";
  if (typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= LOW_END_CORES) {
    return "low";
  }
  if (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory <= LOW_END_MEMORY_GIB) {
    return "low";
  }
  return "high";
}
