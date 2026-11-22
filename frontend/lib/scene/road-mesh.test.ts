import { describe, expect, it } from "vitest";

import type { KeyframesDoc } from "@/lib/keyframes";

import { buildScenePath, DRY, roadHeight } from "./motion";
import { bumpPaintMesh, markingsMesh, type MeshData, pathLineMesh, roadSurfaceMesh } from "./road-mesh";

function doc(events: { t: number; kind: string }[], ay: (t: number) => number, az = 0): KeyframesDoc {
  const fps = 30;
  const frames = Array.from({ length: 121 }, (_, index) => ({
    t: index / fps,
    truck_speed_mps: 20,
    bed_accel_mps2: [0, ay(index / fps), az] as [number, number, number],
    units: [],
    straps: [],
  }));
  return {
    version: 2,
    source: "simulation",
    fps,
    duration_s: 4,
    bed: { length_m: 6, width_m: 2.4, floor_height_m: 1.2, headboard_height_m: 1.2 },
    units: [],
    straps: [],
    events,
    frames,
    result: { status: "pass", unit_ids: [] },
  };
}

/** Every triangle faces up (three.js y), as the camera sees the road from above. */
function facesUp(mesh: MeshData): boolean {
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]].map((k) => (k as number) * 3) as [number, number, number];
    const ux = (p[b] as number) - (p[a] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const vx = (p[c] as number) - (p[a] as number);
    const vz = (p[c + 2] as number) - (p[a + 2] as number);
    // y component of u x v.
    const area = uz * vx - ux * vz;
    if (area < -1e-9) return false;
  }
  return true;
}

describe("road meshes", () => {
  const curve = buildScenePath(doc([{ t: 0.3, kind: "curve_start" }], (t) => (t > 0.5 ? 3 : 0)), DRY);
  it("face up, on a straight and on a curved road", () => {
    expect(facesUp(roadSurfaceMesh(curve, 5.5, { along: 3, across: 3 }))).toBe(true);
    expect(facesUp(markingsMesh(curve, 5.5))).toBe(true);
    expect(facesUp(pathLineMesh(curve))).toBe(true);
  });

  it("lie on the road surface, a speed bump included", () => {
    const bump = buildScenePath(doc([{ t: 1, kind: "speed_bump" }], () => 0), DRY);
    expect(bump.features).toHaveLength(1);
    const mesh = roadSurfaceMesh(bump, 5.5, { along: 3, across: 3 });
    expect(Math.max(...mesh.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(0.1, 2);
    const paint = bumpPaintMesh(bump, 5.5);
    expect(paint).not.toBeNull();
    const feature = bump.features[0];
    if (!feature) throw new Error("no bump");
    expect(roadHeight(bump, feature.start + feature.length / 2, 0)).toBeCloseTo(0.1, 6);
  });
});
