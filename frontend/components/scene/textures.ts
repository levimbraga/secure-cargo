/**
 * Procedural textures of the scene, drawn on canvases in the browser: nothing to download and
 * no third-party image (so no licence to credit). Each uses a fixed pseudo-random pattern, so
 * every visit draws the same road.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

import type { RoadTexture } from "@/lib/scene/look";

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function finish(canvas: HTMLCanvasElement, wrapT = true): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  if (wrapT) texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Asphalt: dark binder with light and dark aggregate. One tile is 3 m by 3 m. */
function asphalt(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = "#6c6c68";
  context.fillRect(0, 0, 256, 256);
  const next = random(7);
  for (let i = 0; i < 5200; i++) {
    const shade = 70 + Math.floor(next() * 70);
    context.fillStyle = `rgb(${shade},${shade},${shade - 3})`;
    context.fillRect(Math.floor(next() * 256), Math.floor(next() * 256), 1 + Math.floor(next() * 2), 1);
  }
  // Two darker bands where the wheels of every lane run.
  context.fillStyle = "rgba(40,40,38,0.08)";
  for (const y of [40, 88, 168, 216]) context.fillRect(0, y, 256, 18);
  return canvas;
}

/**
 * A gravel or earth road across its whole width (v: 0 at one edge, 1 at the other), 6 m long:
 * ragged edges that fade into the verge, two compacted wheel tracks, loose stones between.
 */
function dirt(kind: "gravel" | "mud"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const gravel = kind === "gravel";
  const base: [number, number, number] = gravel ? [156, 132, 99] : [92, 72, 50];
  const verge: [number, number, number] = gravel ? [184, 166, 129] : [123, 106, 80];
  const next = random(gravel ? 19 : 23);
  context.fillStyle = `rgb(${base.join(",")})`;
  context.fillRect(0, 0, 256, 256);
  // Ragged edges: the verge reaches into the road by a different amount along the length.
  for (let x = 0; x < 256; x += 2) {
    const left = 6 + next() * 14 + Math.sin(x / 11) * 4;
    const right = 6 + next() * 14 + Math.cos(x / 9) * 4;
    context.fillStyle = `rgb(${verge.join(",")})`;
    context.fillRect(x, 0, 2, left);
    context.fillRect(x, 256 - right, 2, right);
  }
  // Wheel tracks of both directions: smoother and lighter on gravel, wet ruts in mud.
  const tracks = [78, 104, 152, 178];
  for (const y of tracks) {
    context.fillStyle = gravel ? "rgba(205,186,150,0.35)" : "rgba(38,28,18,0.55)";
    context.fillRect(0, y - 6, 256, 12);
  }
  // Stones (gravel) or clods and puddle sheen (mud).
  for (let i = 0; i < (gravel ? 4200 : 2200); i++) {
    const x = next() * 256;
    const y = 10 + next() * 236;
    const k = next();
    const tone = gravel ? [base[0] + 60 * k - 30, base[1] + 55 * k - 28, base[2] + 50 * k - 26] : [base[0] + 30 * k - 18, base[1] + 26 * k - 16, base[2] + 20 * k - 12];
    context.fillStyle = `rgb(${tone.map((c) => Math.max(0, Math.min(255, Math.round(c)))).join(",")})`;
    const size = gravel ? 1 + next() * 2.2 : 1.5 + next() * 3;
    context.fillRect(x, y, size, size * (0.6 + next() * 0.6));
  }
  return canvas;
}

export function roadTexture(kind: RoadTexture): CanvasTexture {
  return kind === "asphalt" ? finish(asphalt()) : finish(dirt(kind), false);
}

/** Size of one texture tile along and across the road [m]; `null` across: once over the width. */
export const ROAD_TILING: Record<RoadTexture, { along: number; across: number | null }> = {
  asphalt: { along: 3, across: 3 },
  gravel: { along: 6, across: null },
  mud: { along: 6, across: null },
};

/** Engineering ground: a light checker of 1 m squares (one tile is 2 m). */
export function checkerTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#d9d9d3";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#c2c2bb";
    context.fillRect(0, 0, 32, 32);
    context.fillRect(32, 32, 32, 32);
  }
  return finish(canvas);
}

/** A soft round dot, for drops of spray and puffs of dust. */
export function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new CanvasTexture(canvas);
  return texture;
}

/** A dark patch with soft edges, as the alpha of a small texture (the contact shadow). */
export function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(canvas.width, canvas.height);
    const ease = (k: number) => k * k * (3 - 2 * k);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const u = Math.min(x + 0.5, canvas.width - x - 0.5) / (canvas.width * 0.16);
        const v = Math.min(y + 0.5, canvas.height - y - 0.5) / (canvas.height * 0.3);
        image.data[(y * canvas.width + x) * 4 + 3] = 255 * ease(Math.min(u, 1)) * ease(Math.min(v, 1));
      }
    }
    context.putImageData(image, 0, 0);
  }
  return new CanvasTexture(canvas);
}
