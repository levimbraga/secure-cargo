/**
 * Hidden-line drawing of a three.js scene: the lines a pen would draw of the 3D model from one
 * camera, as SVG path data. Used at build time to draw the photo guides from the same 3D truck
 * the replay shows (`lib/inspection/photo-guide-art.test.ts` writes `photo-guide-art.json`).
 *
 * For every mesh, an edge is drawn when it is a silhouette (one of its two faces turns towards
 * the camera, the other away), a crease (the faces meet at more than `CREASE_DEG`) or the border
 * of an open surface. Each drawn edge is cut into short pieces, and a piece is kept only when a
 * ray from the camera reaches it before any other surface of the scene (hidden-line removal).
 * Thin cylinders listed as `wires` (straps) are drawn as their centre line.
 */

import {
  type BufferAttribute,
  BufferGeometry,
  type Camera,
  DoubleSide,
  type Material,
  type Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Faces meeting at more than this angle draw their shared edge [degrees]. */
const CREASE_DEG = 40;
/** A point is hidden when a surface lies this much nearer on its ray [m]. */
const HIDDEN_EPS_M = 0.012;
/** Length of the pieces an edge is cut into for the visibility test [drawing units]. */
const STEP = 0.5;
/** Pieces of line shorter than this are dropped [drawing units]. */
const MIN_LENGTH = 0.35;

export type Frame = { width: number; height: number; marginX: number; marginY: number };

export type LineArt = {
  /** Silhouettes and borders: the outline of each part. */
  outline: string;
  /** Creases inside the outline (panel edges, corners) and the straps. */
  detail: string;
  /** Bounding box of the drawn model [x0, y0, x1, y1], in drawing units. */
  box: [number, number, number, number];
};

type Segment = [number, number, number, number];

/** World-space triangles of a mesh, with shared vertices merged so neighbours can be found. */
function worldTriangles(mesh: Mesh): { positions: Float32Array; index: ArrayLike<number> } {
  const source = mesh.geometry as BufferGeometry;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", (source.getAttribute("position") as BufferAttribute).clone());
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.applyMatrix4(mesh.matrixWorld);
  const merged = mergeVertices(geometry, 1e-4);
  const positions = (merged.getAttribute("position") as BufferAttribute).array as Float32Array;
  const index = merged.index?.array ?? Array.from({ length: positions.length / 3 }, (_, n) => n);
  return { positions, index };
}

export class LineDrawing {
  private readonly raycaster = new Raycaster();
  private scale = 1;
  private offset = new Vector2();
  private readonly ndc = new Vector3();

  constructor(
    private readonly camera: OrthographicCamera | PerspectiveCamera,
    /** Every solid that hides what is behind it. */
    private readonly occluders: Mesh[],
    private readonly frame: Frame,
  ) {
    camera.updateMatrixWorld(true);
    for (const mesh of occluders) {
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
      for (const material of materials) material.side = DoubleSide;
      mesh.geometry.computeBoundingSphere();
    }
    this.fit();
  }

  /** Point of the scene → drawing units (y down), before the fit: the camera's image plane. */
  private image(point: Vector3): Vector2 {
    this.ndc.copy(point).project(this.camera);
    const aspect = this.frame.width / this.frame.height;
    return new Vector2(this.ndc.x * aspect, -this.ndc.y);
  }

  /** Scale and centre the model's image in the frame, inside the margins. */
  private fit() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const point = new Vector3();
    for (const mesh of this.occluders) {
      const { positions } = worldTriangles(mesh);
      for (let n = 0; n < positions.length; n += 3) {
        const p = this.image(point.set(positions[n]!, positions[n + 1]!, positions[n + 2]!));
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
    const { width, height, marginX, marginY } = this.frame;
    this.scale = Math.min((width - 2 * marginX) / (x1 - x0), (height - 2 * marginY) / (y1 - y0));
    this.offset.set(width / 2 - ((x0 + x1) / 2) * this.scale, height / 2 - ((y0 + y1) / 2) * this.scale);
  }

  /** Point of the scene → drawing units. */
  project(point: Vector3): [number, number] {
    const p = this.image(point);
    return [p.x * this.scale + this.offset.x, p.y * this.scale + this.offset.y];
  }

  /** True when no surface of the scene lies between the camera and the point. */
  private visible(point: Vector3, ignore?: Set<Mesh>): boolean {
    const p = this.ndc.copy(point).project(this.camera);
    if (p.z < -1 || p.z > 1) return false;
    this.raycaster.setFromCamera(new Vector2(p.x, p.y), this.camera as Camera);
    const distance = this.raycaster.ray.origin.distanceTo(point);
    this.raycaster.far = distance - HIDDEN_EPS_M;
    if (this.raycaster.far <= 0) return true;
    const hits = this.raycaster.intersectObjects(this.occluders, false);
    return !hits.some((hit) => !ignore?.has(hit.object as Mesh));
  }

  /** The visible pieces of a straight 3D segment, in drawing units. */
  private visiblePieces(a: Vector3, b: Vector3, ignore?: Set<Mesh>): Segment[] {
    const [ax, ay] = this.project(a);
    const [bx, by] = this.project(b);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
    const pieces: Segment[] = [];
    let start: number | null = null;
    const point = new Vector3();
    for (let n = 0; n <= steps; n++) {
      const t = n / steps;
      const seen = this.visible(point.copy(a).lerp(b, t), ignore);
      if (seen && start === null) start = t;
      if ((!seen || n === steps) && start !== null) {
        const end = seen ? t : (n - 1) / steps;
        if (end > start) {
          const p = this.project(point.copy(a).lerp(b, start));
          const q = this.project(point.copy(a).lerp(b, end));
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= MIN_LENGTH) pieces.push([p[0], p[1], q[0], q[1]]);
        }
        start = null;
      }
    }
    return pieces;
  }

  /** Direction from the camera to a point (the same for every point of an orthographic view). */
  private viewRay(point: Vector3): Vector3 {
    if (this.camera instanceof OrthographicCamera) return this.camera.getWorldDirection(new Vector3());
    return point.clone().sub(this.camera.position);
  }

  /** Silhouettes, creases and borders of the occluders, and the centre lines of the wires. */
  draw(wires: Mesh[] = []): LineArt {
    const outline: Segment[] = [];
    const detail: Segment[] = [];
    const crease = Math.cos((CREASE_DEG * Math.PI) / 180);
    for (const mesh of this.occluders) {
      const { positions, index } = worldTriangles(mesh);
      const vertex = (i: number) => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const normals: Vector3[] = [];
      const front: boolean[] = [];
      const edges = new Map<string, { a: number; b: number; faces: number[] }>();
      for (let face = 0; face * 3 < index.length; face++) {
        const ids = [index[face * 3]!, index[face * 3 + 1]!, index[face * 3 + 2]!];
        const [p, q, r] = ids.map(vertex) as [Vector3, Vector3, Vector3];
        const normal = q.clone().sub(p).cross(r.clone().sub(p));
        const area = normal.length();
        normals.push(area > 1e-10 ? normal.divideScalar(area) : normal);
        const centre = p.clone().add(q).add(r).divideScalar(3);
        front.push(area > 1e-10 && normal.dot(this.viewRay(centre)) < 0);
        if (area <= 1e-10) continue;
        for (const [i, j] of [
          [ids[0]!, ids[1]!],
          [ids[1]!, ids[2]!],
          [ids[2]!, ids[0]!],
        ] as const) {
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          const edge = edges.get(key) ?? { a: Math.min(i, j), b: Math.max(i, j), faces: [] };
          edge.faces.push(face);
          edges.set(key, edge);
        }
      }
      for (const { a, b, faces } of edges.values()) {
        const [f, g] = faces;
        if (f === undefined) continue;
        let kind: "outline" | "detail" | null = null;
        if (g === undefined || faces.length > 2) kind = front[f] ? "outline" : null;
        else if (front[f] !== front[g]) kind = "outline";
        else if (front[f] && normals[f]!.dot(normals[g]!) < crease) kind = "detail";
        if (!kind) continue;
        (kind === "outline" ? outline : detail).push(...this.visiblePieces(vertex(a), vertex(b)));
      }
    }
    // A strap is drawn as the line along its middle; it hides nothing.
    for (const wire of wires) {
      const a = wire.localToWorld(new Vector3(0, -0.5, 0));
      const b = wire.localToWorld(new Vector3(0, 0.5, 0));
      detail.push(...this.visiblePieces(a, b));
    }
    const all = [...outline, ...detail];
    const xs = all.flatMap(([x0, , x1]) => [x0, x1]);
    const ys = all.flatMap(([, y0, , y1]) => [y0, y1]);
    return {
      outline: toPath(outline),
      detail: toPath(detail),
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round) as LineArt["box"],
    };
  }

  /** A polyline of scene points, cut where it leaves the camera's view: e.g. the ground line. */
  polyline(points: Vector3[]): string {
    const segments: Segment[] = [];
    for (let n = 1; n < points.length; n++) {
      const a = points[n - 1]!;
      const b = points[n]!;
      const p = this.ndc.copy(a).project(this.camera).z;
      const q = this.ndc.copy(b).project(this.camera).z;
      if (Math.abs(p) > 1 || Math.abs(q) > 1) continue;
      const [ax, ay] = this.project(a);
      const [bx, by] = this.project(b);
      segments.push([ax, ay, bx, by]);
    }
    return toPath(segments);
  }
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Segments → compact SVG path data: coordinates to 0.1 unit, duplicates dropped, and pieces
 * that continue one another joined into one polyline.
 */
export function toPath(segments: Segment[]): string {
  const seen = new Set<string>();
  const unique: Segment[] = [];
  for (const segment of segments) {
    const [x0, y0, x1, y1] = segment.map(round) as Segment;
    if (x0 === x1 && y0 === y1) continue;
    const key = x0 < x1 || (x0 === x1 && y0 < y1) ? `${x0},${y0},${x1},${y1}` : `${x1},${y1},${x0},${y0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([x0, y0, x1, y1]);
  }
  // Chain segments end to start (either direction).
  const byPoint = new Map<string, number[]>();
  const pointKey = (x: number, y: number) => `${x},${y}`;
  unique.forEach(([x0, y0, x1, y1], n) => {
    for (const key of [pointKey(x0, y0), pointKey(x1, y1)]) byPoint.set(key, [...(byPoint.get(key) ?? []), n]);
  });
  const used = new Array<boolean>(unique.length).fill(false);
  const parts: string[] = [];
  const fmt = (x: number, y: number) => `${x} ${y}`;
  unique.forEach((segment, n) => {
    if (used[n]) return;
    used[n] = true;
    const points: [number, number][] = [
      [segment[0], segment[1]],
      [segment[2], segment[3]],
    ];
    // Extend at the end while another unused segment starts or ends there.
    for (;;) {
      const [x, y] = points[points.length - 1]!;
      const next = (byPoint.get(pointKey(x, y)) ?? []).find((m) => !used[m]);
      if (next === undefined) break;
      used[next] = true;
      const [a, b, c, d] = unique[next]!;
      points.push(a === x && b === y ? [c, d] : [a, b]);
    }
    parts.push(`M${points.map(([x, y]) => fmt(x, y)).join("L")}`);
  });
  return parts.join("");
}

