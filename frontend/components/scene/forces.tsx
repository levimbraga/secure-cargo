"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
  Color,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";

import { strapPath, type Vec3 } from "@/lib/keyframes";
import { tensionColor, unitForces } from "@/lib/replay";

import { COLOR, FORCE_MIN, FORCE_SCALE, type SceneProps, three } from "./shared";

const Y_AXIS = new Vector3(0, 1, 0);
const MAX_CONTACTS = 64;
/** Seconds a headboard impact stays highlighted. */
const FLASH_S = 0.6;

/** Points a unit cylinder (along Y, 1 m long) from `from` to `to`. */
function aim(mesh: Object3D, from: Vector3, to: Vector3, scratch: Vector3): number {
  scratch.subVectors(to, from);
  const length = scratch.length();
  mesh.position.copy(from).addScaledVector(scratch, 0.5);
  mesh.scale.set(1, Math.max(length, 1e-6), 1);
  if (length > 1e-6) mesh.quaternion.setFromUnitVectors(Y_AXIS, scratch.normalize());
  return length;
}

/**
 * Lashings follow their unit and are coloured by the tension they carry: neutral when slack,
 * amber at half their capacity, red at the capacity. Pointing at one (or tapping it) selects
 * it for the force label.
 */
export function Lashings({ doc, live, mode }: SceneProps) {
  const segments = useRef<(Mesh | null)[][]>([]);
  const ratchets = useRef<(Mesh | null)[]>([]);
  const colors = useMemo(() => doc.straps.map(() => new Color(COLOR.gray)), [doc]);
  const scratch = useMemo(() => ({ from: new Vector3(), to: new Vector3(), along: new Vector3() }), []);
  const realistic = mode === "realistic";

  useFrame(() => {
    const { sample } = live.current;
    for (let index = 0; index < doc.straps.length; index++) {
      const strap = doc.straps[index];
      const path = strapPath(doc, sample, index);
      const parts = segments.current[index] ?? [];
      const [r, g, b] = tensionColor(sample.straps[index]?.tension ?? 0, strap?.lashing_capacity_n ?? 0);
      colors[index]?.setRGB(r, g, b);
      for (let part = 0; part < parts.length; part++) {
        const mesh = parts[part];
        const start = path[part];
        const end = path[part + 1];
        if (!mesh || !start || !end) continue;
        scratch.from.set(...three(start));
        scratch.to.set(...three(end));
        aim(mesh, scratch.from, scratch.to, scratch.along);
        const color = colors[index];
        if (color) (mesh.material as MeshStandardMaterial).color.copy(color);
        if (part === 0) {
          const ratchet = ratchets.current[index];
          if (ratchet) {
            ratchet.position.copy(scratch.from).lerp(scratch.to, 0.38);
            ratchet.quaternion.copy(mesh.quaternion);
          }
        }
      }
    }
  });

  const select = (index: number) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    live.current.activeStrap = index;
  };

  return (
    <>
      {doc.straps.map((strap, index) => (
        <group key={strap.id}>
          {strap.path_m.slice(1).map((_, part) => (
            <mesh
              key={part}
              castShadow={realistic}
              ref={(node) => {
                (segments.current[index] ??= [])[part] = node;
              }}
            >
              <cylinderGeometry args={[strap.kind === "chain" ? 0.03 : 0.024, strap.kind === "chain" ? 0.03 : 0.024, 1, 8]} />
              {realistic ? (
                <meshStandardMaterial roughness={strap.kind === "chain" ? 0.4 : 0.75} metalness={strap.kind === "chain" ? 0.8 : 0} />
              ) : (
                <meshBasicMaterial />
              )}
              {/* A wide, invisible sleeve around the lashing: something a finger can hit. */}
              <mesh onPointerOver={select(index)} onPointerDown={select(index)}>
                <cylinderGeometry args={[0.14, 0.14, 1, 6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </mesh>
          ))}
          {realistic && strap.kind === "strap" && (
            <mesh
              ref={(node) => {
                ratchets.current[index] = node;
              }}
              castShadow
            >
              <boxGeometry args={[0.07, 0.2, 0.09]} />
              <meshStandardMaterial color="#2c2d2e" metalness={0.85} roughness={0.35} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

/** A straight arrow: a shaft and a head, set every frame from a start point, a direction and a length. */
function useArrow() {
  const group = useRef<Group>(null);
  const shaft = useRef<Mesh>(null);
  const head = useRef<Mesh>(null);
  const scratch = useMemo(() => new Vector3(), []);
  const set = (origin: Vector3, direction: Vector3, length: number, color: string) => {
    if (!group.current || !shaft.current || !head.current) return;
    group.current.visible = length > 0.02;
    if (!group.current.visible) return;
    const headLength = Math.min(0.22, length * 0.45);
    group.current.position.copy(origin);
    group.current.quaternion.setFromUnitVectors(Y_AXIS, scratch.copy(direction).normalize());
    shaft.current.scale.set(1, length - headLength, 1);
    shaft.current.position.set(0, (length - headLength) / 2, 0);
    head.current.scale.set(1, headLength, 1);
    head.current.position.set(0, length - headLength / 2, 0);
    (shaft.current.material as MeshBasicMaterial).color.set(color);
    (head.current.material as MeshBasicMaterial).color.set(color);
  };
  const node = (
    <group ref={group} visible={false}>
      <mesh ref={shaft}>
        <cylinderGeometry args={[0.035, 0.035, 1, 10]} />
        <meshBasicMaterial depthTest={false} transparent />
      </mesh>
      <mesh ref={head}>
        <coneGeometry args={[0.1, 1, 14]} />
        <meshBasicMaterial depthTest={false} transparent />
      </mesh>
    </group>
  );
  return { node, set };
}

/**
 * Two arrows above each unit, to the same scale everywhere (1 m for 10 kN): what the motion of
 * the truck asks of the unit (mass times acceleration), and against it the most that friction
 * can give (friction factor times the force of the floor). When the first is longer, the unit
 * slides, and it turns red.
 */
function UnitArrows({ doc, live, index }: Pick<SceneProps, "doc" | "live"> & { index: number }) {
  const inertia = useArrow();
  const friction = useArrow();
  const scratch = useMemo(() => ({ origin: new Vector3(), direction: new Vector3() }), []);
  const unit = doc.units[index];

  useFrame(() => {
    const { sample } = live.current;
    const pose = sample.units[index];
    if (!unit || !pose) return;
    const forces = unitForces(unit.mass_kg ?? 0, unit.friction_coefficient ?? 0, pose.normal, sample.bedAccel);
    const shown = forces.inertiaMagnitude >= FORCE_MIN;
    const [fx, fy] = forces.inertia;
    // Just above the unit, wherever it is now.
    scratch.origin.set(...three([pose.p[0], pose.p[1], pose.p[2] + unit.size_m[2] / 2 + 0.22]));
    scratch.direction.set(...three([fx, fy, 0]));
    const slipping = forces.inertiaMagnitude > forces.frictionLimit;
    inertia.set(scratch.origin, scratch.direction, shown ? forces.inertiaMagnitude * FORCE_SCALE : 0, slipping ? COLOR.fail : COLOR.ink);
    scratch.direction.negate();
    friction.set(scratch.origin, scratch.direction, shown ? forces.frictionLimit * FORCE_SCALE : 0, COLOR.pass);
  });

  return (
    <>
      {inertia.node}
      {friction.node}
    </>
  );
}

export function ForceArrows({ doc, live }: Pick<SceneProps, "doc" | "live">) {
  return (
    <>
      {doc.units.map((unit, index) => (
        <UnitArrows key={unit.id} doc={doc} live={live} index={index} />
      ))}
    </>
  );
}

/** Direction in which a contact pushes the unit, in three.js axes, by what the unit touches. */
function contactNormal(kind: string, position: Vec3): Vec3 {
  if (kind === "headboard") return [-1, 0, 0];
  if (kind === "rail") return [0, 0, position[1] > 0 ? 1 : -1];
  return [0, 1, 0];
}

/** Contact points of the solver with their normal forces: the engineering view only. */
export function Contacts({ live }: Pick<SceneProps, "live">) {
  const points = useRef<InstancedMesh>(null);
  const vectors = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const scratch = useMemo(() => ({ from: new Vector3(), to: new Vector3(), along: new Vector3() }), []);

  useFrame(() => {
    const { contacts } = live.current.sample;
    const count = Math.min(contacts.length, MAX_CONTACTS);
    if (!points.current || !vectors.current) return;
    for (let index = 0; index < count; index++) {
      const contact = contacts[index];
      if (!contact) continue;
      const [x, y, z, force, kind] = contact;
      dummy.position.set(...three([x, y, z]));
      dummy.scale.setScalar(1);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      points.current.setMatrixAt(index, dummy.matrix);
      const normal = contactNormal(kind, [x, y, z]);
      scratch.from.set(...three([x, y, z]));
      scratch.to.copy(scratch.from).addScaledVector(scratch.along.set(...normal), force * FORCE_SCALE);
      aim(dummy, scratch.from, scratch.to, scratch.along);
      dummy.updateMatrix();
      vectors.current.setMatrixAt(index, dummy.matrix);
    }
    points.current.count = count;
    vectors.current.count = count;
    points.current.instanceMatrix.needsUpdate = true;
    vectors.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={points} args={[undefined, undefined, MAX_CONTACTS]} frustumCulled={false}>
        <sphereGeometry args={[0.055, 12, 8]} />
        <meshBasicMaterial color={COLOR.amber} depthTest={false} transparent />
      </instancedMesh>
      <instancedMesh ref={vectors} args={[undefined, undefined, MAX_CONTACTS]} frustumCulled={false}>
        <cylinderGeometry args={[0.018, 0.018, 1, 6]} />
        <meshBasicMaterial color={COLOR.fail} depthTest={false} transparent />
      </instancedMesh>
    </>
  );
}

/** A red ring that opens where a unit hits the headboard, and fades. */
export function ImpactFlash({ impacts, live }: Pick<SceneProps, "impacts" | "live">) {
  const rings = useRef<(Mesh | null)[]>([]);

  useFrame(() => {
    const { t } = live.current;
    impacts.forEach((impact, index) => {
      const ring = rings.current[index];
      if (!ring) return;
      const age = (t - impact.t) / FLASH_S;
      ring.visible = age >= 0 && age <= 1;
      if (!ring.visible) return;
      ring.scale.setScalar(0.35 + age * 1.5);
      (ring.material as MeshBasicMaterial).opacity = 1 - age;
    });
  });

  return (
    <>
      {impacts.map((impact, index) => (
        <mesh
          key={index}
          ref={(node) => {
            rings.current[index] = node;
          }}
          position={three([impact.position[0] - 0.03, impact.position[1], impact.position[2]])}
          rotation={[0, Math.PI / 2, 0]}
          visible={false}
        >
          <ringGeometry args={[0.32, 0.42, 40]} />
          <meshBasicMaterial color={COLOR.fail} transparent depthTest={false} side={2} />
        </mesh>
      ))}
    </>
  );
}

export type LabelFormat = {
  /** "312 daN" */
  force: (newtons: number) => string;
  /** "12 % of LC" */
  ofCapacity: (ratio: number) => string;
  /** "6.7 kN" */
  kilonewtons: (newtons: number) => string;
  inertia: string;
  friction: string;
};

/**
 * Text that follows things in the scene, as plain HTML over the canvas: the force of the
 * lashing under the pointer and, in the engineering view, the tension of every lashing and
 * the two forces on every unit.
 */
export function Labels({
  doc,
  live,
  mode,
  overlay,
  format,
  anchor,
}: SceneProps & {
  overlay: RefObject<HTMLDivElement | null>;
  format: LabelFormat;
  /** The group the cargo is drawn in: label positions are given in its frame. */
  anchor: RefObject<Group | null>;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const nodes = useRef<{ straps: HTMLSpanElement[]; units: HTMLSpanElement[] }>({ straps: [], units: [] });
  const scratch = useMemo(() => new Vector3(), []);
  const engineering = mode === "engineering";

  useEffect(() => {
    const container = overlay.current;
    if (!container) return;
    const make = () => {
      const span = document.createElement("span");
      span.className =
        "absolute top-0 left-0 hidden rounded-sm bg-paper/90 px-1 py-px font-mono text-[0.6875rem] leading-tight whitespace-nowrap text-ink";
      container.appendChild(span);
      return span;
    };
    const created = { straps: doc.straps.map(make), units: doc.units.map(make) };
    nodes.current = created;
    return () => {
      [...created.straps, ...created.units].forEach((span) => span.remove());
      nodes.current = { straps: [], units: [] };
    };
  }, [doc, overlay]);

  const place = (span: HTMLSpanElement, position: Vec3, text: string) => {
    scratch.set(...three(position));
    if (anchor.current) scratch.applyMatrix4(anchor.current.matrixWorld);
    scratch.project(camera);
    if (scratch.z > 1) {
      span.style.display = "none";
      return;
    }
    const x = ((scratch.x + 1) / 2) * size.width;
    const y = ((1 - scratch.y) / 2) * size.height;
    span.style.display = "block";
    span.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -130%)`;
    if (span.textContent !== text) span.textContent = text;
  };

  useFrame(() => {
    const { sample, activeStrap } = live.current;
    nodes.current.straps.forEach((span, index) => {
      const strap = doc.straps[index];
      if (!strap || !(engineering || index === activeStrap)) {
        span.style.display = "none";
        return;
      }
      const path = strapPath(doc, sample, index);
      // Middle of the stretch over the unit (top-over) or of the lashing itself (direct).
      const a = path.length === 4 ? path[1] : path[0];
      const b = path.length === 4 ? path[2] : path[1];
      if (!a || !b) return;
      const tension = sample.straps[index]?.tension ?? 0;
      const text =
        index === activeStrap
          ? `${format.force(tension)} · ${format.ofCapacity(tension / (strap.lashing_capacity_n ?? 1))}`
          : format.force(tension);
      place(span, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], text);
    });
    nodes.current.units.forEach((span, index) => {
      const unit = doc.units[index];
      const pose = sample.units[index];
      if (!engineering || !unit || !pose) {
        span.style.display = "none";
        return;
      }
      const forces = unitForces(unit.mass_kg ?? 0, unit.friction_coefficient ?? 0, pose.normal, sample.bedAccel);
      if (forces.inertiaMagnitude < FORCE_MIN) {
        span.style.display = "none";
        return;
      }
      const text = `${format.inertia} ${format.kilonewtons(forces.inertiaMagnitude)} · ${format.friction} ${format.kilonewtons(forces.frictionLimit)}`;
      // Neighbouring units are close together: every other label sits a little higher.
      const lift = 0.5 + (index % 2) * 0.32;
      place(span, [pose.p[0], pose.p[1], pose.p[2] + unit.size_m[2] / 2 + lift], text);
    });
  });

  return null;
}
