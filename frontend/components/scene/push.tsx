"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { type Group, Matrix4, Raycaster, Vector2, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { KeyframesDoc, Vec3 } from "@/lib/keyframes";
import { GRAVITY } from "@/lib/replay";

import type { Live } from "./shared";

/** A force the visitor applies to a unit's centre [N], in the bed frame (X forward, Y left, Z up). */
export type UnitPush = { unit: number; force: Vec3 };

export type PushProps = {
  /**
   * The push right now, or `null`. The scene writes it every frame while a unit is dragged and
   * draws it as an arrow; the page may write it too (push buttons) and hands it to the engine.
   */
  state: RefObject<UnitPush | null>;
  /** A drag on a unit started (its index) or ended (`null`). */
  onDrag?: (unitIndex: number | null) => void;
};

/** The hardest push, as a multiple of the unit's weight. */
export const PUSH_MAX_WEIGHTS = 1.5;
/** Dragging this far from where the unit was grabbed asks for the hardest push [m]. */
const PUSH_REACH_M = 0.4;

/** Hardest push on a unit [N]. */
export function pushLimit(doc: KeyframesDoc, unitIndex: number): number {
  return PUSH_MAX_WEIGHTS * (doc.units[unitIndex]?.mass_kg ?? 0) * GRAVITY;
}

type Held = {
  unit: number;
  pointerId: number;
  /** Pointer position in normalized device coordinates. */
  pointer: Vector2;
  /** Height of the point that was grabbed above the bed floor [m]. */
  height: number;
  /** The grabbed point relative to the unit's centre, in the bed frame [m]. */
  offset: [number, number];
};

/**
 * Pressing on a cargo unit and dragging pushes it: a spring pulls the grabbed point toward the
 * pointer on a horizontal plane at the height of the grab, and the pull, capped at
 * `PUSH_MAX_WEIGHTS` times the unit's weight, is the force written to `push.state`.
 *
 * Returns the pointer handlers of a unit. While a unit is held the camera does not turn and a
 * touch does not scroll the page.
 */
export function useUnitPush({
  doc,
  live,
  body,
  orbit,
  push,
}: {
  doc: KeyframesDoc;
  live: RefObject<Live>;
  /** The group the cargo is drawn in (the bed frame, in three.js axes). */
  body: RefObject<Group | null>;
  orbit: RefObject<OrbitControls | null>;
  push: PushProps | undefined;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const held = useRef<Held | null>(null);
  const scratch = useMemo(
    () => ({ raycaster: new Raycaster(), inverse: new Matrix4(), local: new Vector3() }),
    [],
  );
  const enabled = push !== undefined;
  const latest = useRef(push);
  useEffect(() => {
    latest.current = push;
  });

  useEffect(() => {
    if (!enabled) return;
    const letGo = () => {
      held.current = null;
      if (orbit.current) orbit.current.enabled = true;
      canvas.style.cursor = "";
      const target = latest.current;
      if (target) {
        target.state.current = null;
        target.onDrag?.(null);
      }
      invalidate();
    };
    const release = (event: PointerEvent) => {
      if (held.current && event.pointerId === held.current.pointerId) letGo();
    };
    const move = (event: PointerEvent) => {
      const current = held.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const box = canvas.getBoundingClientRect();
      current.pointer.set(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        -((event.clientY - box.top) / box.height) * 2 + 1,
      );
      invalidate();
    };
    // The canvas lets one finger scroll the page (`touch-action: pan-y`); a finger that holds
    // a unit must not. `pointerdown` comes first and marks the unit as held.
    const keepPage = (event: TouchEvent) => {
      if (held.current && event.cancelable) event.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    canvas.addEventListener("touchstart", keepPage, { passive: false });
    canvas.addEventListener("touchmove", keepPage, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      canvas.removeEventListener("touchstart", keepPage);
      canvas.removeEventListener("touchmove", keepPage);
      if (held.current) letGo();
    };
  }, [enabled, canvas, orbit, invalidate]);

  // The pull of the spring, every frame while a unit is held: the unit moves under it.
  useFrame(() => {
    const current = held.current;
    const target = latest.current;
    const group = body.current;
    if (!current || !target || !group) return;
    const pose = live.current.sample.units[current.unit];
    if (!pose) return;
    // The ray of the pointer, in the frame of the bed.
    scratch.raycaster.setFromCamera(current.pointer, camera);
    const { ray } = scratch.raycaster;
    ray.applyMatrix4(scratch.inverse.copy(group.matrixWorld).invert());
    // Where it crosses the horizontal plane at the height of the grab (three.js: Y is up).
    const distance = Math.abs(ray.direction.y) > 1e-4 ? (current.height - ray.origin.y) / ray.direction.y : -1;
    if (distance <= 0) return;
    scratch.local.copy(ray.origin).addScaledVector(ray.direction, distance);
    const dx = scratch.local.x - (pose.p[0] + current.offset[0]);
    const dy = -scratch.local.z - (pose.p[1] + current.offset[1]);
    const stretch = Math.hypot(dx, dy);
    const size = Math.min(stretch / PUSH_REACH_M, 1) * pushLimit(doc, current.unit);
    const force: Vec3 = stretch > 1e-6 ? [(dx / stretch) * size, (dy / stretch) * size, 0] : [0, 0, 0];
    target.state.current = { unit: current.unit, force };
  });

  if (!enabled) return undefined;
  return (index: number) => ({
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      const group = body.current;
      const pose = live.current.sample.units[index];
      if (held.current || event.button !== 0 || !group || !pose) return;
      // The nearest unit under the pointer takes the push, not the ones behind it.
      event.stopPropagation();
      const local = group.worldToLocal(event.point.clone());
      held.current = {
        unit: index,
        pointerId: event.pointerId,
        pointer: event.pointer.clone(),
        height: local.y,
        offset: [local.x - pose.p[0], -local.z - pose.p[1]],
      };
      if (orbit.current) orbit.current.enabled = false;
      canvas.style.cursor = "grabbing";
      const target = latest.current;
      if (target) {
        target.state.current = { unit: index, force: [0, 0, 0] };
        target.onDrag?.(index);
      }
      invalidate();
    },
    onPointerOver: () => {
      if (!held.current) canvas.style.cursor = "grab";
    },
    onPointerOut: () => {
      if (!held.current) canvas.style.cursor = "";
    },
  });
}

export type UnitHandlers = ReturnType<typeof useUnitPush>;
