/**
 * Canvas textures of the truck bodies (realistic view): a curtain-sider's fabric, a box body's
 * aluminium panels, the wooden boards of drop sides. Painted in the browser with a fixed
 * pseudo-random pattern: nothing to download, nothing to credit. Each texture is one tile along
 * the body (`TILE_M`) and the body's whole height.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

export type BodyTexture = "curtain" | "panel" | "boards" | "planks";

/** Length of one tile along the body [m]. */
export const TILE_M: Record<BodyTexture, number> = { curtain: 1.2, panel: 0.6, boards: 1.2, planks: 2.4 };

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function canvas(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (context) draw(context);
  const texture = new CanvasTexture(element);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Curtain fabric: PVC-coated polyester, a hem at the top and the bottom, and the tensioner
 * straps with their buckles along the bottom edge (two per tile). v = 0 is the bottom.
 */
function curtain(context: CanvasRenderingContext2D): void {
  const [w, h] = [256, 512];
  const gradient = context.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#4b6a88");
  gradient.addColorStop(0.5, "#43617f");
  gradient.addColorStop(1, "#3a5674");
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  const next = random(31);
  for (let i = 0; i < 1600; i++) {
    context.fillStyle = next() > 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.03)";
    context.fillRect(next() * w, next() * h, 1, 3 + next() * 10);
  }
  // Welded seams: a hem at the top, a wider one at the bottom.
  context.fillStyle = "rgba(15,25,38,0.35)";
  context.fillRect(0, 0, w, 14);
  context.fillRect(0, h - 44, w, 44);
  context.fillStyle = "rgba(255,255,255,0.08)";
  context.fillRect(0, 14, w, 2);
  context.fillRect(0, h - 46, w, 2);
  // Tensioner straps down to the bottom rail, each with a buckle.
  for (const x of [62, 190]) {
    context.fillStyle = "#1d2630";
    context.fillRect(x - 6, h - 92, 12, 92);
    context.fillStyle = "#b9bec2";
    context.fillRect(x - 9, h - 70, 18, 14);
    context.fillStyle = "#6f767b";
    context.fillRect(x - 9, h - 58, 18, 2);
  }
}

/** Aluminium box panel: a riveted joint every tile, slightly lighter towards the roof. */
function panel(context: CanvasRenderingContext2D): void {
  const [w, h] = [128, 512];
  const gradient = context.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#f4f5f3");
  gradient.addColorStop(1, "#dfe1df");
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  context.fillStyle = "rgba(90,96,100,0.35)";
  context.fillRect(0, 0, 2, h);
  context.fillStyle = "rgba(255,255,255,0.7)";
  context.fillRect(2, 0, 1, h);
  context.fillStyle = "rgba(90,96,100,0.45)";
  for (let y = 10; y < h; y += 22) context.fillRect(6, y, 2, 2);
  // A scuffed band where the bottom rail is.
  context.fillStyle = "rgba(80,84,86,0.12)";
  context.fillRect(0, h - 26, w, 26);
}

/** Drop-side boards: horizontal planks of varnished wood with dark seams. */
function boards(context: CanvasRenderingContext2D): void {
  const [w, h] = [256, 256];
  const planks = 5;
  const next = random(41);
  for (let plank = 0; plank < planks; plank++) {
    const y = (plank * h) / planks;
    const shade = 150 + Math.floor(next() * 30);
    context.fillStyle = `rgb(${shade + 20},${shade - 8},${shade - 62})`;
    context.fillRect(0, y, w, h / planks);
    for (let i = 0; i < 40; i++) {
      context.fillStyle = "rgba(90,55,20,0.12)";
      context.fillRect(0, y + next() * (h / planks), w, 1);
    }
    context.fillStyle = "rgba(50,30,12,0.7)";
    context.fillRect(0, y, w, 2);
  }
}

/** The deck: long planks along the bed, with the joints staggered. */
function planks(context: CanvasRenderingContext2D): void {
  const [w, h] = [512, 256];
  const rows = 10;
  const next = random(53);
  for (let row = 0; row < rows; row++) {
    const y = (row * h) / rows;
    const shade = 168 + Math.floor(next() * 26);
    context.fillStyle = `rgb(${shade + 14},${shade - 14},${shade - 64})`;
    context.fillRect(0, y, w, h / rows);
    for (let i = 0; i < 26; i++) {
      context.fillStyle = next() > 0.5 ? "rgba(110,70,30,0.12)" : "rgba(255,240,210,0.08)";
      context.fillRect(0, y + 2 + next() * (h / rows - 4), w, 1);
    }
    context.fillStyle = "rgba(55,35,15,0.6)";
    context.fillRect(0, y, w, 1.5);
    const joint = Math.floor(next() * w);
    context.fillRect(joint, y, 2, h / rows);
  }
  // Wear: two lighter bands where forklifts and pallets run.
  context.fillStyle = "rgba(255,255,255,0.05)";
  context.fillRect(0, h * 0.25, w, h * 0.12);
  context.fillRect(0, h * 0.63, w, h * 0.12);
}

const PAINTERS: Record<BodyTexture, [number, number, (context: CanvasRenderingContext2D) => void]> = {
  curtain: [256, 512, curtain],
  panel: [128, 512, panel],
  boards: [256, 256, boards],
  planks: [512, 256, planks],
};

export function bodyTexture(kind: BodyTexture): CanvasTexture {
  const [width, height, draw] = PAINTERS[kind];
  return canvas(width, height, draw);
}
