/**
 * How each road surface and the weather look in the realistic view. Only what the run's
 * conditions say is drawn: rain only on the surfaces the simulation calls wet, dust only on
 * gravel, fog only when the run has fog. None of it changes the physics, which is decided by
 * the surface's tyre grip, the cargo friction cap of a dirty deck and the road roughness
 * (`backend/physics/conditions/surfaces.py`).
 */

import { type Conditions, ROAD_HALF_WIDTH } from "./motion";

export type RoadTexture = "asphalt" | "gravel" | "mud";
export type Spray = "none" | "water" | "dust" | "mud";

export type Look = {
  /** Sky behind the scene; `null` keeps the page colour (the design's default). */
  sky: string | null;
  fogColor: string;
  fog: [near: number, far: number];
  /** Intensity factor of the sun and of the sky light. */
  sun: number;
  hemisphere: [sky: string, ground: string];
  road: { texture: RoadTexture; color: string; roughness: number; metalness: number; envIntensity: number };
  markings: boolean;
  halfWidth: number;
  shoulder: string;
  verge: string;
  /** Rain drops: 0 none, 1 rain, 2 heavy rain. */
  rain: 0 | 1 | 2;
  spray: Spray;
  /** Puddles on the road (heavy rain). */
  puddles: boolean;
};

const PAGE = "#e9e9e4";

export function lookOf(conditions: Conditions): Look {
  const base: Look = {
    sky: null,
    fogColor: PAGE,
    fog: [38, 95],
    sun: 1,
    hemisphere: ["#ffffff", "#8d8d86"],
    road: { texture: "asphalt", color: "#ffffff", roughness: 0.95, metalness: 0, envIntensity: 1 },
    markings: true,
    halfWidth: ROAD_HALF_WIDTH,
    shoulder: "#d8d7cf",
    verge: "#c4c2b6",
    rain: 0,
    spray: "none",
    puddles: false,
  };
  let look: Look;
  switch (conditions.surface) {
    case "wet":
      look = {
        ...base,
        sky: "#b7bcc0",
        fogColor: "#b7bcc0",
        fog: [30, 88],
        sun: 0.62,
        hemisphere: ["#dfe5ea", "#6f7275"],
        road: { texture: "asphalt", color: "#d3d5d7", roughness: 0.42, metalness: 0, envIntensity: 1.6 },
        shoulder: "#b9bab3",
        verge: "#a3a59c",
        rain: 1,
        spray: "water",
      };
      break;
    case "heavy_rain":
      look = {
        ...base,
        sky: "#9aa1a7",
        fogColor: "#9aa1a7",
        fog: [20, 70],
        sun: 0.45,
        hemisphere: ["#cfd6dc", "#5c5f62"],
        road: { texture: "asphalt", color: "#c3c6c9", roughness: 0.3, metalness: 0, envIntensity: 2 },
        shoulder: "#a7a9a3",
        verge: "#91948c",
        rain: 2,
        spray: "water",
        puddles: true,
      };
      break;
    case "gravel":
      look = {
        ...base,
        fogColor: "#e6e1d6",
        sky: null,
        hemisphere: ["#fff8ec", "#9a8b72"],
        road: { texture: "gravel", color: "#ffffff", roughness: 1, metalness: 0, envIntensity: 0.6 },
        markings: false,
        halfWidth: 5.2,
        shoulder: "#cdbf9f",
        verge: "#b8a681",
        spray: "dust",
      };
      break;
    case "mud":
      look = {
        ...base,
        sky: "#c9c7be",
        fogColor: "#c9c7be",
        fog: [32, 90],
        sun: 0.75,
        hemisphere: ["#ecebe4", "#6e604c"],
        road: { texture: "mud", color: "#ffffff", roughness: 0.55, metalness: 0.02, envIntensity: 1.1 },
        markings: false,
        halfWidth: 5.2,
        shoulder: "#8f7d61",
        verge: "#7b6a50",
        spray: "mud",
      };
      break;
    default:
      look = base;
  }
  if (conditions.fog) {
    look = { ...look, sky: "#d2d5d5", fogColor: "#d2d5d5", fog: [5, 42], sun: Math.min(look.sun, 0.55) };
  }
  return look;
}
