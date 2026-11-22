"use client";

import { useFrame } from "@react-three/fiber";
import { type RefObject, useCallback, useRef } from "react";
import { type Group, type Material, Vector3 } from "three";

/**
 * A body's panels turn see-through on the side the camera looks from, as in a cutaway drawing:
 * the cargo inside stays in view from any angle, and the far walls, the frame and the posts keep
 * the body's shape. A panel is given by its outward normal and a point on it, in the frame of the
 * group the hook is attached to; its opacity follows the angle between that normal and the line
 * to the camera, so orbiting fades a wall in or out smoothly, with no animation to wait for (a
 * paused replay renders on demand).
 */

type Panel = { material: Material; normal: Vector3; centre: Vector3; faded: number };

/** A ref callback for a panel's material (React 19 calls the cleanup it returns on detach). */
export type Cut = (
  normal: [number, number, number],
  centre: [number, number, number],
  faded?: number,
) => (material: Material | null) => (() => void) | undefined;

function smoothstep(low: number, high: number, value: number): number {
  const k = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return k * k * (3 - 2 * k);
}

/** Opacity of a panel whose outward normal makes `cosine` with the line to the camera. */
export function cutawayOpacity(cosine: number, faded: number): number {
  return 1 + (faded - 1) * smoothstep(-0.05, 0.3, cosine);
}

export function useCutaway(): { group: RefObject<Group | null>; cut: Cut } {
  const group = useRef<Group | null>(null);
  const panels = useRef(new Map<string, Panel>());
  const camera = useRef(new Vector3());
  const line = useRef(new Vector3());

  const cut = useCallback<Cut>(
    (normal, centre, faded = 0.16) =>
      (material) => {
        if (!material) return;
        panels.current.set(material.uuid, { material, normal: new Vector3(...normal).normalize(), centre: new Vector3(...centre), faded });
        return () => {
          panels.current.delete(material.uuid);
        };
      },
    [],
  );

  useFrame((state) => {
    const node = group.current;
    if (!node) return;
    node.updateWorldMatrix(true, false);
    const eye = node.worldToLocal(camera.current.copy(state.camera.position));
    for (const panel of panels.current.values()) {
      const cosine = line.current.subVectors(eye, panel.centre).normalize().dot(panel.normal);
      const opacity = cutawayOpacity(cosine, panel.faded);
      const clear = opacity < 0.995;
      panel.material.opacity = opacity;
      if (panel.material.transparent !== clear) {
        panel.material.transparent = clear;
        panel.material.depthWrite = !clear;
        panel.material.needsUpdate = true;
      }
    }
  });

  return { group, cut };
}
