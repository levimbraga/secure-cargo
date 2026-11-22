/**
 * The photo guides are drawn from the 3D model, not by hand: this renders the replay's own truck
 * (`components/scene/truck.tsx`, a toco from the truck catalog with low drop sides) carrying ten
 * pallets under five top-over straps (`components/scene/cargo.tsx`, `forces.tsx`), and draws it
 * with hidden lines removed (`guide-lines.ts`) from two cameras:
 *
 * - "side": orthographic, square to the truck's left side;
 * - "rear_three_quarter": a phone held level at 1.5 m, behind the truck and 35° off its axis,
 *   with a phone camera's field of view (66° across the long side).
 *
 * The result is `photo-guide-art.json` (SVG path data), which `components/inspection/photo-guide.tsx`
 * draws. This test fails when the file no longer matches the model; regenerate it with
 *
 *   pnpm run guides
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ReactThreeTestRenderer from "@react-three/test-renderer";
import { createElement as h } from "react";
import { Box3, type Mesh, type Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { Units } from "@/components/scene/cargo";
import { Lashings } from "@/components/scene/forces";
import type { Live } from "@/components/scene/shared";
import { TruckBody, Wheels } from "@/components/scene/truck";
import type { KeyframesDoc, Sample } from "@/lib/keyframes";

import { type Frame, type LineArt, LineDrawing } from "./guide-lines";
import { TRUCK_CATALOG } from "./truck-catalog";

const OUT = fileURLToPath(new URL("./photo-guide-art.json", import.meta.url));

/** The guide's screen: a phone held sideways (16:9), in drawing units. */
const FRAME: Frame = { width: 320, height: 180, marginX: 28, marginY: 26 };

/** Eye level of the rear three-quarter camera above the road [m]. */
const EYE_M = 1.5;
/** Angle between the truck's axis and the line of sight, from behind [degrees]. */
const REAR_ANGLE_DEG = 35;
/** A phone's main camera across the long side of the picture [degrees]. */
const PHONE_HFOV_DEG = 66;
/** Height of the low drop sides drawn on the toco (the same as the 2D body drawings) [m]. */
const LOW_SIDES_M = 0.55;

const TOCO = TRUCK_CATALOG.toco;

/** Ten pallets in two rows against the headboard, under five top-over straps. */
function guideDoc(): KeyframesDoc {
  const { length_m: length, width_m: width, floor_m: floor, headboard_m: headboard } = TOCO.deck;
  const size: [number, number, number] = [1.2, 1.0, 1.1];
  const units: KeyframesDoc["units"] = [];
  const poses: Sample["units"] = [];
  const straps: KeyframesDoc["straps"] = [];
  for (let column = 0; column < 5; column++) {
    const x = length / 2 - 0.02 - size[0] / 2 - column * (size[0] + 0.02);
    for (const y of [0.52, -0.52]) {
      units.push({ id: `pallet-${units.length + 1}`, size_m: size, shape: "box" });
      poses.push({ p: [x, y, size[2] / 2], q: [1, 0, 0, 0], normal: 0 });
    }
    const top = size[2] + 0.03;
    straps.push({
      id: `strap-${column + 1}`,
      unit_id: `pallet-${column * 2 + 1}`,
      kind: "strap",
      routing: "top_over",
      path_m: [
        [x, width / 2 - 0.08, 0.02],
        [x, 1.04, top],
        [x, -1.04, top],
        [x, -width / 2 + 0.08, 0.02],
      ],
    });
  }
  return {
    version: 2,
    source: "simulation",
    fps: 30,
    duration_s: 0,
    bed: {
      length_m: length,
      width_m: width,
      floor_height_m: floor,
      headboard_height_m: headboard,
      side_rail_height_m: LOW_SIDES_M,
      body: "flatbed",
      truck_size: "toco",
    },
    units,
    straps,
    events: [],
    frames: [{ t: 0, units: poses.map(({ p, q }) => ({ p, q })), straps: straps.map(() => ({ tension_n: 0 })) }],
    result: { status: "pass", unit_ids: [] },
  };
}

/**
 * The textures of the realistic view paint on a 2D canvas: here a canvas without a 2D context
 * (nothing is painted). The test renderer gives the same canvas class a mock WebGL context.
 */
function stubDocument() {
  class Canvas {
    width = 0;
    height = 0;
    style = {};
    clientWidth = 1280;
    clientHeight = 800;
    addEventListener() {}
    removeEventListener() {}
    getContext(): null {
      return null;
    }
  }
  const scope = globalThis as { document?: unknown; HTMLCanvasElement?: unknown };
  scope.HTMLCanvasElement ??= Canvas;
  const CanvasClass = scope.HTMLCanvasElement as typeof Canvas;
  scope.document ??= { createElement: () => new CanvasClass(), createElementNS: () => new CanvasClass() };
}

async function buildScene(): Promise<{ root: Object3D; occluders: Mesh[]; wires: Mesh[] }> {
  stubDocument();
  const doc = guideDoc();
  const sample: Sample = {
    truckSpeed: 0,
    bedAccel: [0, 0, 0],
    units: doc.frames[0]!.units.map(({ p, q }) => ({ p, q, normal: 0 })),
    straps: doc.straps.map(() => ({ tension: 0, slide: 0 })),
    contacts: [],
  };
  const live = { current: { t: 0, sample, distance: 0, height: 0, activeStrap: -1 } satisfies Live };
  const props = { doc, live, mode: "realistic" as const, series: {} as never, impacts: [] };
  const renderer = await ReactThreeTestRenderer.create(
    h(
      "group",
      { name: "guide" },
      h(
        "group",
        { name: "truck" },
        h(TruckBody, { bed: doc.bed, mode: "realistic" }),
        // The wheels stand on the road, the floor's height below the bed (as in the replay).
        h("group", { position: [0, -doc.bed.floor_height_m, 0] }, h(Wheels, { bed: doc.bed, mode: "realistic" })),
      ),
      h("group", { name: "cargo" }, h(Units, props)),
      h("group", { name: "lashings" }, h(Lashings, props)),
    ),
  );
  await renderer.advanceFrames(1, 1 / 30);
  const root = renderer.scene.instance as Object3D;
  root.updateMatrixWorld(true);

  const occluders: Mesh[] = [];
  const wires: Mesh[] = [];
  const within = (object: Object3D, name: string) => {
    for (let node: Object3D | null = object; node; node = node.parent) if (node.name === name) return true;
    return false;
  };
  root.traverse((object) => {
    const mesh = object as Mesh;
    // Small parts (bolts, lamps, seams: `userData.fine`) would only clutter a line drawing.
    if (!mesh.isMesh || !mesh.visible || mesh.userData.fine) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Invisible hit areas and the clear stretch film are not drawn.
    const clear = materials.every((material) => material.transparent && material.opacity < 0.5);
    if (within(mesh, "lashings")) {
      if (mesh.geometry.type === "CylinderGeometry" && !clear) wires.push(mesh);
      else if (!clear) occluders.push(mesh);
      return;
    }
    if (within(mesh, "cargo") && clear) return;
    occluders.push(mesh);
  });
  return { root, occluders, wires };
}

type ShotArt = LineArt & { ground: string };

async function renderGuides(): Promise<Record<"side" | "rear_three_quarter", ShotArt>> {
  const { root, occluders, wires } = await buildScene();
  const bounds = new Box3();
  for (const mesh of occluders) bounds.expandByObject(mesh);
  const centre = bounds.getCenter(new Vector3());
  const road = bounds.min.y;
  const aspect = FRAME.width / FRAME.height;

  // Side: orthographic, from the truck's left (three.js -Z), the cab on the left of the picture.
  const side = new OrthographicCamera(-12, 12, 12 / aspect, -12 / aspect, 0.1, 200);
  side.position.set(centre.x, centre.y, -60);
  side.up.set(0, 1, 0);
  side.lookAt(centre.x, centre.y, 0);
  const sideDrawing = new LineDrawing(side, occluders, FRAME);
  const sideArt = sideDrawing.draw(wires);
  const sideGround = sideDrawing.polyline([new Vector3(centre.x - 40, road, 0), new Vector3(centre.x + 40, road, 0)]);

  // Rear three-quarter: a level phone at 1.5 m, behind the truck's left rear corner. Step back
  // until the whole truck fits in 85 % of the picture's width.
  const vfov = (2 * Math.atan(Math.tan((PHONE_HFOV_DEG * Math.PI) / 360) / aspect) * 180) / Math.PI;
  const angle = (REAR_ANGLE_DEG * Math.PI) / 180;
  const away = new Vector3(-Math.cos(angle), 0, -Math.sin(angle));
  const rear = new PerspectiveCamera(vfov, aspect, 0.1, 200);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      new Vector3(n & 1 ? bounds.max.x : bounds.min.x, n & 2 ? bounds.max.y : bounds.min.y, n & 4 ? bounds.max.z : bounds.min.z),
  );
  for (let distance = 6; distance < 60; distance += 0.25) {
    rear.position.copy(centre).addScaledVector(away, distance).setY(road + EYE_M);
    rear.lookAt(new Vector3(centre.x, road + EYE_M, centre.z));
    rear.updateMatrixWorld(true);
    const xs = corners.map((corner) => corner.clone().project(rear).x);
    if (Math.max(...xs) - Math.min(...xs) <= 1.7 && xs.every((x) => Math.abs(x) <= 0.95)) break;
  }
  const rearDrawing = new LineDrawing(rear, occluders, FRAME);
  const rearArt = rearDrawing.draw(wires);
  // The road's edge along the near side, out to the horizon.
  const edge = bounds.min.z - 0.6;
  const rearGround = rearDrawing.polyline(
    [-30, -12, -6, -3, 0, 3, 6, 12, 30, 80].map((x) => new Vector3(centre.x + x, road, edge)),
  );
  root.clear();
  return { side: { ...sideArt, ground: sideGround }, rear_three_quarter: { ...rearArt, ground: rearGround } };
}

/** Total length of the lines of an SVG path made of M and L commands [drawing units]. */
function pathLength(path: string): number {
  let length = 0;
  for (const part of path.split("M").filter(Boolean)) {
    const points = part.split("L").map((point) => point.split(" ").map(Number) as [number, number]);
    for (let n = 1; n < points.length; n++) {
      length += Math.hypot(points[n]![0] - points[n - 1]![0], points[n]![1] - points[n - 1]![1]);
    }
  }
  return length;
}

describe("photo guide drawings", () => {
  it(
    "match the 3D truck (regenerate with `pnpm run guides`)",
    async () => {
      const art = await renderGuides();
      if (process.env.WRITE_GUIDES) writeFileSync(OUT, `${JSON.stringify({ frame: FRAME, ...art }, null, 1)}\n`);
      const saved = JSON.parse(readFileSync(OUT, "utf8")) as typeof art & { frame: Frame };
      expect(saved.frame).toEqual(FRAME);
      // The same drawing, give or take the last rounding of a coordinate: the same box and the
      // same amount of line. A change to the 3D truck or the cameras changes both.
      for (const shot of ["side", "rear_three_quarter"] as const) {
        saved[shot].box.forEach((value, n) => expect(Math.abs(value - art[shot].box[n]!), `${shot} box`).toBeLessThan(0.5));
        for (const kind of ["outline", "detail", "ground"] as const) {
          const expected = pathLength(art[shot][kind]);
          expect(Math.abs(pathLength(saved[shot][kind]) - expected), `${shot} ${kind}`).toBeLessThan(expected * 0.01 + 1);
        }
      }
    },
    120_000,
  );
});
