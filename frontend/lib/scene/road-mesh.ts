/**
 * Geometry of the road the truck drives on, built once per run from its scene path: the
 * surface (with the run's pothole or speed bump in it, and the grade of a descent), the
 * shoulders, the lane markings and the paint of a speed bump. Plain arrays in three.js
 * coordinates (x forward, y up, z to the right), so they can be tested without a renderer.
 */

import { LANE_WIDTH, roadFrame, roadHeight, roadPoint, type ScenePath } from "./motion";

export type MeshData = {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
};

const BEHIND = 110;
const AHEAD = 190;
const STEP = 1;
/** Sampling of the road inside a pothole or over a bump [m]. */
const FINE = 0.04;

/** Stations of the road's cross sections: every metre, and finely across the run's features. */
export function roadStations(path: ScenePath): number[] {
  const end = path.s[path.s.length - 1] ?? 0;
  const stations = new Set<number>();
  for (let s = -BEHIND; s <= end + AHEAD; s += STEP) stations.add(Math.round(s * 1000) / 1000);
  for (const feature of path.features) {
    for (let s = feature.start - 0.3; s <= feature.start + feature.length + 0.3; s += FINE) stations.add(Math.round(s * 1000) / 1000);
    stations.add(feature.start);
    stations.add(feature.start + feature.length);
  }
  return [...stations].sort((a, b) => a - b);
}

type Paint = (s: number, d: number) => [number, number, number];

/** A grid over the given stations and offsets, lying on the road surface (+ `lift`). */
function grid(
  path: ScenePath,
  stations: number[],
  offsets: number[],
  uv: (s: number, d: number) => [number, number],
  paint: Paint,
  lift = 0,
  height: (s: number, d: number) => number = (s, d) => roadHeight(path, s, d),
): MeshData {
  const rows = stations.length;
  const columns = offsets.length;
  const positions = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const colors = new Float32Array(rows * columns * 3);
  let vertex = 0;
  for (const s of stations) {
    for (const d of offsets) {
      const [x, y] = roadPoint(path.road, s, d);
      positions.set([x, height(s, d) + lift, -y], vertex * 3);
      uvs.set(uv(s, d), vertex * 2);
      colors.set(paint(s, d), vertex * 3);
      vertex++;
    }
  }
  const indices = new Uint32Array((rows - 1) * (columns - 1) * 6);
  let index = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const e = c + 1;
      // Counter-clockwise seen from above (three.js: y up, z to the right of the road).
      indices.set([a, c, b, b, c, e], index);
      index += 6;
    }
  }
  return { positions, uvs, colors, indices };
}

function unique(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/** Offsets of the surface's columns: its edges, and the walls of any pothole. */
function surfaceOffsets(path: ScenePath, halfWidth: number): number[] {
  const offsets = [-halfWidth, -halfWidth + 0.5, 0, halfWidth - 0.5, halfWidth];
  for (const feature of path.features) {
    if (feature.kind !== "pothole") continue;
    for (const track of feature.tracks) {
      for (const k of [-1, 1]) offsets.push(track + k * (feature.halfWidth + 0.25), track + k * feature.halfWidth, track + k * (feature.halfWidth - 0.04), track + k * 0.2);
    }
  }
  return unique(offsets.filter((d) => Math.abs(d) <= halfWidth));
}

/** Darkness of the road inside a pothole: its depth, as a share of the hole's depth. */
function potholeShade(path: ScenePath, s: number, d: number): number {
  const level = roadFrame(path.road, s).z;
  const depth = level - roadHeight(path, s, d);
  return depth > 1e-4 ? Math.min(depth / 0.05, 1) : 0;
}

/** 1 at the edge of a pothole, fading to 0 a quarter of a metre away. */
function potholeRim(path: ScenePath, s: number, d: number): number {
  let rim = 0;
  for (const feature of path.features) {
    if (feature.kind !== "pothole") continue;
    const along = Math.max(feature.start - s, s - feature.start - feature.length, 0);
    for (const track of feature.tracks) {
      const across = Math.max(Math.abs(d - track) - feature.halfWidth, 0);
      const distance = Math.hypot(along, across);
      if (distance > 0) rim = Math.max(rim, 1 - distance / 0.25);
    }
  }
  return rim;
}

export type SurfaceTiling = { along: number; across: number | null };

/**
 * The road surface. `tiling.across` null: the texture spans the whole width once (a gravel or
 * mud road, whose texture has its own edges); otherwise it repeats every `across` metres.
 */
export function roadSurfaceMesh(path: ScenePath, halfWidth: number, tiling: SurfaceTiling): MeshData {
  const stations = roadStations(path);
  return grid(
    path,
    stations,
    surfaceOffsets(path, halfWidth),
    (s, d) => [s / tiling.along, tiling.across === null ? (d + halfWidth) / (2 * halfWidth) : d / tiling.across],
    (s, d) => {
      // Inside a pothole: dark, wet-looking bottom; around it, a ring of broken, lighter asphalt.
      const shade = potholeShade(path, s, d);
      if (shade > 0) {
        const k = 1 - 0.7 * shade;
        return [k, k * 0.96, k * 0.9];
      }
      const rim = potholeRim(path, s, d);
      return rim > 0 ? [1 + 0.35 * rim, 1 + 0.33 * rim, 1 + 0.3 * rim] : [1, 1, 1];
    },
  );
}

/** Ground on both sides of the road, out to where the fog hides it. */
export function shoulderMeshes(path: ScenePath, halfWidth: number, verge: [number, number, number], ground: [number, number, number]): MeshData[] {
  const stations = roadStations(path).filter((_, index, all) => index % 2 === 0 || index === all.length - 1);
  const height = (s: number) => (path.flat ? 0 : roadFrame(path.road, s).z) - 0.01;
  return [1, -1].map((side) => {
    const offsets = [halfWidth - 0.05, halfWidth + 1.2, halfWidth + 3.5, halfWidth + 24, halfWidth + 110].map((d) => side * d);
    if (side < 0) offsets.reverse();
    return grid(
      path,
      stations,
      offsets,
      (s, d) => [s / 4, d / 4],
      (_s, d) => (Math.abs(d) < halfWidth + 1.3 ? verge : ground),
      0,
      (s) => height(s),
    );
  });
}

/** A strip of paint along the road between stations `from` and `to`, centred on offset `d`. */
function strip(path: ScenePath, stations: number[], from: number, to: number, d: number, width: number): MeshData | null {
  const inside = stations.filter((s) => s > from && s < to);
  const rows = [from, ...inside, to];
  if (to - from < 0.05) return null;
  return grid(path, rows, [d - width / 2, d + width / 2], () => [0, 0], () => [1, 1, 1], 0.006);
}

export function mergeMeshes(meshes: (MeshData | null)[]): MeshData {
  const parts = meshes.filter((m): m is MeshData => m !== null);
  const vertices = parts.reduce((sum, m) => sum + m.positions.length / 3, 0);
  const total = parts.reduce((sum, m) => sum + m.indices.length, 0);
  const out: MeshData = {
    positions: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    colors: new Float32Array(vertices * 3),
    indices: new Uint32Array(total),
  };
  let vertex = 0;
  let index = 0;
  for (const part of parts) {
    out.positions.set(part.positions, vertex * 3);
    out.uvs.set(part.uvs, vertex * 2);
    out.colors.set(part.colors, vertex * 3);
    for (let i = 0; i < part.indices.length; i++) out.indices[index + i] = (part.indices[i] as number) + vertex;
    vertex += part.positions.length / 3;
    index += part.indices.length;
  }
  return out;
}

/** Dash and gap of the lane lines [m] (Brazilian highways: 4 m of paint every 12 m). */
const DASH = 4;
const DASH_PERIOD = 12;

/** Edge lines and the dashed lines between the three lanes. */
export function markingsMesh(path: ScenePath, halfWidth: number): MeshData {
  const stations = roadStations(path);
  const first = stations[0] ?? 0;
  const last = stations[stations.length - 1] ?? 0;
  const parts: (MeshData | null)[] = [];
  for (const side of [-1, 1]) parts.push(strip(path, stations, first, last, side * (halfWidth - 0.3), 0.15));
  for (let start = Math.ceil(first / DASH_PERIOD) * DASH_PERIOD; start < last; start += DASH_PERIOD) {
    for (const side of [-1, 1]) parts.push(strip(path, stations, start, Math.min(start + DASH, last), (side * LANE_WIDTH) / 2, 0.13));
  }
  return mergeMeshes(parts);
}

/** Yellow and black blocks across a speed bump, as Brazilian bumps are painted. */
export function bumpPaintMesh(path: ScenePath, halfWidth: number): MeshData | null {
  const stations = roadStations(path);
  const parts: MeshData[] = [];
  for (const feature of path.features) {
    if (feature.kind !== "speed_bump") continue;
    const rows = stations.filter((s) => s >= feature.start && s <= feature.start + feature.length);
    const block = 0.9;
    for (let d = -halfWidth, index = 0; d < halfWidth - 1e-6; d += block, index++) {
      const color: [number, number, number] = index % 2 === 0 ? [0.95, 0.63, 0] : [0.12, 0.12, 0.11];
      parts.push(grid(path, rows, [d, Math.min(d + block, halfWidth)], () => [0, 0], () => color, 0.004));
    }
  }
  return parts.length ? mergeMeshes(parts) : null;
}

/** Engineering view: the truck's path over the run, as a thin strip on the ground. */
export function pathLineMesh(path: ScenePath, width = 0.08): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const every = 4;
  for (let k = 0; k < path.t.length; k += every) {
    const s = path.s[k] as number;
    const d = path.d[k] as number;
    const [x, y] = roadPoint(path.road, s, d);
    const heading = path.yaw[k] as number;
    const nx = -Math.sin(heading) * (width / 2);
    const ny = Math.cos(heading) * (width / 2);
    positions.push(x + nx, 0.012, -(y + ny), x - nx, 0.012, -(y - ny));
    const base = positions.length / 3 - 2;
    // Counter-clockwise seen from above, like the road.
    if (base >= 2) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
  }
  const vertices = positions.length / 3;
  return {
    positions: Float32Array.from(positions),
    uvs: new Float32Array(vertices * 2),
    colors: new Float32Array(vertices * 3).fill(1),
    indices: Uint32Array.from(indices),
  };
}

/** Puddles of a road in heavy rain: flat patches at fixed places (a fixed pseudo-random pattern). */
export function puddles(path: ScenePath, halfWidth: number): { s: number; d: number; length: number; width: number; yaw: number }[] {
  const end = path.s[path.s.length - 1] ?? 0;
  const out: { s: number; d: number; length: number; width: number; yaw: number }[] = [];
  let seed = 11;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let s = -80; s < end + 150; s += 6 + next() * 10) {
    const d = (next() * 2 - 1) * (halfWidth - 1);
    // Never under a pothole or a bump: they keep their own surface.
    if (path.features.some((f) => s > f.start - 3 && s < f.start + f.length + 3)) continue;
    out.push({ s, d, length: 1.2 + next() * 2.6, width: 0.6 + next() * 1.2, yaw: roadFrame(path.road, s).heading });
  }
  return out;
}
