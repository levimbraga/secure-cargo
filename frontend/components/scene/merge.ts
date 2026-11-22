/**
 * Many small parts drawn as one mesh: each part's geometry is placed, painted with its own
 * vertex colour, and merged, so a detailed truck or pallet costs one draw call per material
 * instead of one per part (the phone budget in docs/design.md).
 */

import { BoxGeometry, BufferAttribute, type BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Part = {
  /** A box of this size, or a geometry of its own (it is consumed: disposed after the merge). */
  size?: [number, number, number];
  geometry?: BufferGeometry;
  at: [number, number, number];
  /** Euler angles [x, y, z] in radians. */
  rotation?: [number, number, number];
  color: string;
};

const color = new Color();
const matrix = new Matrix4();

/** One geometry with a `color` attribute: draw it with `vertexColors`. */
export function mergeParts(parts: Part[]): BufferGeometry {
  const geometries = parts.map((part) => {
    const source = part.geometry ?? new BoxGeometry(...(part.size ?? [0.01, 0.01, 0.01]));
    // Merging needs the same attributes everywhere: drop what only some geometries have.
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    matrix.compose(new Vector3(...part.at), new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1));
    geometry.applyMatrix4(matrix);
    color.set(part.color);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(geometries) ?? new BoxGeometry(0.01, 0.01, 0.01);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}
