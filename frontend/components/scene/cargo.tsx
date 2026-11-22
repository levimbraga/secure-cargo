"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry as Geometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  EdgesGeometry,
  type Group,
  Line,
  LineBasicMaterial,
  type LineSegments,
} from "three";

import { unitName } from "@/lib/demo";
import { displacement, type KeyframeUnit, toThreeQuaternion, type Vec3 } from "@/lib/keyframes";

import { boxArgs, CargoModel, RoundCargo } from "./cargo-models";
import type { UnitHandlers } from "./push";
import { COLOR, type SceneProps, three } from "./shared";

/** A unit that moved more than this is drawn as failed [m]. */
const MOVED_M = 0.05;

/**
 * Cargo units at their simulated poses, with a dashed outline where each one started and a
 * trail of where its base has been.
 */
export function Units({
  doc,
  live,
  mode,
  unitHandlers,
}: SceneProps & {
  /** Pointer handlers of each unit, when the visitor may push the cargo (the live lab). */
  unitHandlers?: UnitHandlers;
}) {
  const groups = useRef<(Group | null)[]>([]);
  const edges = useRef<(LineBasicMaterial | null)[]>([]);
  const failing = useMemo(
    () => doc.units.map((unit) => doc.result.status === "fail" && doc.result.unit_ids.includes(unit.id)),
    [doc],
  );

  // Path of the centre of each unit's base over the whole run, on the bed floor.
  const trailLines = useMemo(
    () =>
      doc.units.map((unit, index) => {
        const positions = new Float32Array(doc.frames.length * 3);
        doc.frames.forEach((frame, frameIndex) => {
          const p = frame.units[index]?.p ?? [0, 0, 0];
          positions.set(three([p[0], p[1], Math.max(p[2] - unit.size_m[2] / 2, 0) + 0.015]), frameIndex * 3);
        });
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        const color = failing[index] ? COLOR.fail : COLOR.gray;
        return new Line(geometry, new LineBasicMaterial({ color }));
      }),
    [doc, failing],
  );
  useEffect(
    () => () =>
      trailLines.forEach((line) => {
        line.geometry.dispose();
        line.material.dispose();
      }),
    [trailLines],
  );

  useFrame(() => {
    const { sample, t } = live.current;
    const frame = Math.min(Math.round(t * doc.fps), doc.frames.length - 1);
    for (const [index, unit] of sample.units.entries()) {
      const group = groups.current[index];
      if (group) {
        group.position.set(...three(unit.p));
        group.quaternion.set(...toThreeQuaternion(unit.q));
      }
      const moved = failing[index] && displacement(doc, sample, index) > MOVED_M;
      edges.current[index]?.color.set(moved ? COLOR.fail : COLOR.ink);
      trailLines[index]?.geometry.setDrawRange(0, frame + 1);
    }
  });

  return (
    <>
      {doc.units.map((unit, index) => {
        const start = doc.frames[0]?.units[index];
        return (
          <group key={unit.id}>
            {start && <Ghost unit={unit} position={three(start.p)} quaternion={toThreeQuaternion(start.q)} />}
            {trailLines[index] && <primitive object={trailLines[index]} />}
            <group
              ref={(node) => {
                groups.current[index] = node;
              }}
              {...unitHandlers?.(index)}
            >
              {mode === "realistic" ? (
                isCylinder(unit) ? (
                  <RoundCargo
                    kind={unitName(unit.id).kind}
                    {...cylinderSize(unit)}
                    eye={(unit.inner_diameter_m ?? 0) / 2}
                    rotation={cylinderRotation(unit)}
                  />
                ) : (
                  <CargoModel kind={unitName(unit.id).kind} size={unit.size_m} />
                )
              ) : (
                <TranslucentBox unit={unit} />
              )}
              <Outline
                unit={unit}
                visible={mode === "engineering"}
                materialRef={(node) => {
                  edges.current[index] = node;
                }}
              />
            </group>
          </group>
        );
      })}
    </>
  );
}

function isCylinder(unit: KeyframeUnit): boolean {
  return unit.shape === "cylinder" && Boolean(unit.axis);
}

/** Diameter and length of a cylindrical unit, from the box around it. */
function cylinderSize(unit: KeyframeUnit): { diameter: number; length: number } {
  const axis = unit.axis === "x" ? 0 : unit.axis === "y" ? 1 : 2;
  const across = unit.size_m.filter((_, index) => index !== axis);
  return { diameter: across[0] ?? 0, length: unit.size_m[axis] ?? 0 };
}

/**
 * Rotation that turns a three.js cylinder (axis on three's Y, the simulation's Z) onto the
 * unit's axis: the simulation's X is three's X, its Y is three's -Z.
 */
function cylinderRotation(unit: KeyframeUnit): [number, number, number] {
  if (unit.axis === "x") return [0, 0, Math.PI / 2];
  if (unit.axis === "y") return [Math.PI / 2, 0, 0];
  return [0, 0, 0];
}

/** The shape of a unit as the simulation sees it: a box, or the cylinder inside it. */
function unitGeometry(unit: KeyframeUnit): Geometry {
  if (!isCylinder(unit)) return new BoxGeometry(...boxArgs(unit.size_m));
  const { diameter, length } = cylinderSize(unit);
  const geometry = new CylinderGeometry(diameter / 2, diameter / 2, length, 32);
  const [rx, , rz] = cylinderRotation(unit);
  if (rx) geometry.rotateX(rx);
  if (rz) geometry.rotateZ(rz);
  return geometry;
}

/** Dashed outline of where a unit stood when the event started. */
function Ghost({
  unit,
  position,
  quaternion,
}: {
  unit: KeyframeUnit;
  position: Vec3;
  quaternion: [number, number, number, number];
}) {
  const geometry = useMemo(() => new EdgesGeometry(unitGeometry(unit), 30), [unit]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const lines = useRef<LineSegments>(null);
  useEffect(() => {
    lines.current?.computeLineDistances();
  }, [geometry]);
  return (
    <lineSegments ref={lines} geometry={geometry} position={position} quaternion={quaternion}>
      <lineDashedMaterial color={COLOR.gray} dashSize={0.09} gapSize={0.07} />
    </lineSegments>
  );
}

/** Edges of a unit. In the realistic view they only appear, in red, once the unit has moved. */
function Outline({
  unit,
  visible,
  materialRef,
}: {
  unit: KeyframeUnit;
  visible: boolean;
  materialRef: (node: LineBasicMaterial | null) => void;
}) {
  const geometry = useMemo(() => new EdgesGeometry(unitGeometry(unit), 30), [unit]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useRef<LineBasicMaterial | null>(null);
  const lines = useRef<LineSegments>(null);
  useFrame(() => {
    if (lines.current && material.current) {
      lines.current.visible = visible || material.current.color.getHexString() === COLOR.fail.slice(1);
    }
  });
  return (
    <lineSegments ref={lines} geometry={geometry}>
      <lineBasicMaterial
        ref={(node) => {
          material.current = node;
          materialRef(node);
        }}
        color={COLOR.ink}
      />
    </lineSegments>
  );
}

function TranslucentBox({ unit }: { unit: KeyframeUnit }) {
  const geometry = useMemo(() => unitGeometry(unit), [unit]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <mesh geometry={geometry}>
        <meshLambertMaterial color={COLOR.wood} transparent opacity={0.42} depthWrite={false} />
      </mesh>
      {/* The unit's own axes: X red, Y green, Z blue, in the simulation's convention. */}
      <AxisTriad length={Math.min(...unit.size_m) * 0.45} />
    </>
  );
}

/** Axes of the simulation frame: X forward (red), Y left (green), Z up (blue). */
export function AxisTriad({ length }: { length: number }) {
  const lines = useMemo(() => {
    const axes: { to: Vec3; color: string }[] = [
      { to: [length, 0, 0], color: "#c2251a" },
      { to: [0, length, 0], color: "#1f8a3a" },
      { to: [0, 0, length], color: "#2f5fd0" },
    ];
    return axes.map((axis) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, ...three(axis.to)]), 3));
      return new Line(geometry, new LineBasicMaterial({ color: axis.color, depthTest: false }));
    });
  }, [length]);
  useEffect(
    () => () =>
      lines.forEach((line) => {
        line.geometry.dispose();
        line.material.dispose();
      }),
    [lines],
  );
  return (
    <>
      {lines.map((line, index) => (
        <primitive key={index} object={line} />
      ))}
    </>
  );
}
