"use client";

import { useFrame } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry as Geometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  EdgesGeometry,
  type Group,
  Line,
  LineBasicMaterial,
  type LineSegments,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { unitName } from "@/lib/demo";
import { displacement, type KeyframeUnit, toThreeQuaternion, type Vec3 } from "@/lib/keyframes";

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
                  <RoundCargo unit={unit} kind={unitName(unit.id).kind} />
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

/** Box sizes in the simulation are [x, y, z] with Z up; three.js boxes are [x, y-up, z]. */
function boxArgs(size: Vec3): [number, number, number] {
  return [size[0], size[2], size[1]];
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

/** A coil, a drum or a pipe, filling exactly the cylinder the simulation used. */
function RoundCargo({ unit, kind }: { unit: KeyframeUnit; kind: string }) {
  const { diameter, length } = cylinderSize(unit);
  const radius = diameter / 2;
  const eye = (unit.inner_diameter_m ?? 0) / 2;
  const rotation = cylinderRotation(unit);
  if (kind === "drum") {
    return (
      <group rotation={rotation}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[radius, radius, length, 32]} />
          <meshStandardMaterial color="#2c5d93" metalness={0.45} roughness={0.45} />
        </mesh>
        {[-0.3, 0.3].map((share) => (
          <mesh key={share} position={[0, share * length, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, 0.012, 6, 32]} />
            <meshStandardMaterial color="#1f4470" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>
    );
  }
  const steel = kind === "pipe" ? "#7c8184" : "#9ea3a6";
  const inner = eye > 0 ? eye : kind === "pipe" ? radius * 0.85 : 0;
  return (
    <group rotation={rotation}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, length, 40, 1, inner > 0]} />
        <meshStandardMaterial color={steel} metalness={0.8} roughness={0.35} />
      </mesh>
      {inner > 0 && (
        <>
          <mesh>
            <cylinderGeometry args={[inner, inner, length, 32, 1, true]} />
            <meshStandardMaterial color="#3a3d3f" metalness={0.6} roughness={0.5} side={2} />
          </mesh>
          {[-1, 1].map((end) => (
            <mesh key={end} position={[0, (end * length) / 2, 0]} rotation={[(end * -Math.PI) / 2, 0, 0]}>
              <ringGeometry args={[inner, radius, 40]} />
              <meshStandardMaterial color="#868b8e" metalness={0.7} roughness={0.4} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
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

function canvasTexture(draw: (context: CanvasRenderingContext2D, size: number) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) draw(context, 128);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A grid of cartons, crates or planks: one cell of the pattern per tile. */
function gridTexture(base: string, seam: string, accent?: string): CanvasTexture {
  return canvasTexture((context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    if (accent) {
      context.fillStyle = accent;
      context.fillRect(size * 0.12, size * 0.3, size * 0.76, size * 0.4);
    }
    context.strokeStyle = seam;
    context.lineWidth = 3;
    context.strokeRect(0, 0, size, size);
  });
}

const PALLET_HEIGHT = 0.144;

/** A pallet: three runners and a deck of boards, as wide and long as the unit. */
function Pallet({ size, color, y }: { size: Vec3; color: string; y: number }) {
  const material = <meshStandardMaterial color={color} roughness={0.85} />;
  return (
    <group position={[0, y, 0]}>
      {[-1, 0, 1].map((row) => (
        <mesh key={row} position={[0, 0.05, row * (size[1] / 2 - 0.06)]} castShadow>
          <boxGeometry args={[size[0], 0.1, 0.1]} />
          {material}
        </mesh>
      ))}
      <mesh position={[0, 0.122, 0]} castShadow receiveShadow>
        <boxGeometry args={[size[0], 0.044, size[1]]} />
        {material}
      </mesh>
    </group>
  );
}

/** A block of goods standing on a pallet, with a repeating pattern on its faces. */
function Goods({
  size,
  texture,
  wrapped = false,
}: {
  size: Vec3;
  texture: CanvasTexture;
  wrapped?: boolean;
}) {
  const height = size[2] - PALLET_HEIGHT;
  const inset = 0.03;
  const maps = useMemo(() => {
    // Cells of about 0.4 m: a different repeat on the faces that are longer.
    const faces: [number, number][] = [
      [size[1], height],
      [size[1], height],
      [size[0], size[1]],
      [size[0], size[1]],
      [size[0], height],
      [size[0], height],
    ];
    return faces.map(([u, v]) => {
      const map = texture.clone();
      map.repeat.set(Math.max(Math.round(u / 0.4), 1), Math.max(Math.round(v / 0.33), 1));
      map.needsUpdate = true;
      return map;
    });
  }, [texture, size, height]);
  useEffect(() => () => maps.forEach((map) => map.dispose()), [maps]);

  return (
    <group position={[0, PALLET_HEIGHT / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[size[0] - inset * 2, height, size[1] - inset * 2]} />
        {maps.map((map, index) => (
          <meshStandardMaterial key={index} attach={`material-${index}`} map={map} roughness={0.8} />
        ))}
      </mesh>
      {wrapped && (
        // Stretch film: a glossy, nearly clear skin over the cartons.
        <mesh>
          <boxGeometry args={[size[0] - 0.01, height, size[1] - 0.01]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.16} roughness={0.05} metalness={0.1} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * What a unit looks like in the realistic view. Every model fills exactly the box the
 * simulation used (`size`, in metres), centred on the unit's centre; only its looks differ.
 */
function CargoModel({ kind, size }: { kind: string; size: Vec3 }): ReactNode {
  const cartons = useMemo(() => gridTexture("#c9a26b", "#8d6a3c"), []);
  const crates = useMemo(() => gridTexture("#c53a2b", "#7d1f15", "#e9c64a"), []);
  const planks = useMemo(() => gridTexture("#c2a172", "#7a5a34"), []);
  const sacks = useMemo(() => gridTexture("#e7e0cf", "#b8ad92"), []);
  useEffect(
    () => () => {
      cartons.dispose();
      crates.dispose();
      planks.dispose();
      sacks.dispose();
    },
    [cartons, crates, planks, sacks],
  );
  const [length, width, height] = size;
  const base = -height / 2;

  if (kind === "pallet") {
    return (
      <>
        <Pallet size={size} color="#b08a57" y={base} />
        <Goods size={size} texture={cartons} wrapped />
      </>
    );
  }
  if (kind === "sacks") {
    return (
      <>
        <Pallet size={size} color="#a98452" y={base} />
        <Goods size={size} texture={sacks} wrapped />
      </>
    );
  }
  if (kind === "carton") {
    return (
      <>
        <mesh castShadow receiveShadow>
          <boxGeometry args={boxArgs(size)} />
          <meshStandardMaterial color="#c9a26b" roughness={0.85} />
        </mesh>
        {/* Packing tape over the top and down the ends. */}
        <mesh position={[0, height / 2 + 0.002, 0]}>
          <boxGeometry args={[length + 0.004, 0.004, 0.07]} />
          <meshStandardMaterial color="#d9c49a" roughness={0.5} />
        </mesh>
      </>
    );
  }
  if (kind === "stack") {
    return (
      <>
        <Pallet size={size} color="#2b5d9e" y={base} />
        <Goods size={size} texture={crates} />
      </>
    );
  }
  if (kind === "crate") {
    return (
      <>
        <Pallet size={size} color="#a98452" y={base} />
        <Goods size={size} texture={planks} />
        {/* Corner battens of a wooden crate. */}
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <mesh key={`${x}:${z}`} position={[x * (length / 2 - 0.035), PALLET_HEIGHT / 2, z * (width / 2 - 0.035)]} castShadow>
              <boxGeometry args={[0.07, height - PALLET_HEIGHT, 0.07]} />
              <meshStandardMaterial color="#9a7848" roughness={0.85} />
            </mesh>
          )),
        )}
      </>
    );
  }
  if (kind === "cabinet") {
    const steel = <meshStandardMaterial color="#cfd3d4" metalness={0.55} roughness={0.38} />;
    return (
      <>
        <mesh position={[0, base + 0.05, 0]}>
          <boxGeometry args={[length - 0.06, 0.1, width - 0.06]} />
          <meshStandardMaterial color={COLOR.chassis} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[length, height - 0.1, width]} />
          {steel}
        </mesh>
        {/* Two doors on the side that faces the camera, with a seam and handles. */}
        <mesh position={[0, 0.05, width / 2 + 0.003]}>
          <boxGeometry args={[0.012, height - 0.2, 0.006]} />
          <meshStandardMaterial color="#6b6f71" />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.07, 0.1, width / 2 + 0.02]}>
            <boxGeometry args={[0.025, 0.28, 0.03]} />
            <meshStandardMaterial color="#3c3f41" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {/* Ventilation louvres near the top. */}
        {[0, 1, 2, 3].map((row) => (
          <mesh key={row} position={[0, height / 2 - 0.22 - row * 0.05, width / 2 + 0.004]}>
            <boxGeometry args={[length * 0.55, 0.018, 0.006]} />
            <meshStandardMaterial color="#8d9193" />
          </mesh>
        ))}
      </>
    );
  }
  if (kind === "machine") {
    const paint = <meshStandardMaterial color="#35566b" metalness={0.45} roughness={0.42} />;
    const skid = 0.16;
    return (
      <>
        {/* Steel skid: two beams the full length of the unit, the surface that meets the floor. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, base + skid / 2, side * (width / 2 - 0.09)]} castShadow>
            <boxGeometry args={[length, skid, 0.18]} />
            <meshStandardMaterial color="#5d6164" metalness={0.8} roughness={0.45} />
          </mesh>
        ))}
        {/* Machine base, the full footprint. */}
        <mesh position={[0, base + skid + 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.4, width]} />
          {paint}
        </mesh>
        {/* Housing up to the full height at one end, a motor and a control cabinet beside it. */}
        <mesh position={[-length * 0.2, (skid + 0.4) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[length * 0.6, height - skid - 0.4, width * 0.86]} />
          {paint}
        </mesh>
        <mesh position={[length * 0.3, base + skid + 0.4 + 0.24, -width * 0.14]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.22, 0.22, length * 0.36, 24]} />
          <meshStandardMaterial color="#8a8f92" metalness={0.85} roughness={0.35} />
        </mesh>
        <mesh position={[length * 0.34, base + skid + 0.4 + 0.3, width * 0.26]} castShadow>
          <boxGeometry args={[length * 0.24, 0.6, width * 0.3]} />
          <meshStandardMaterial color="#d6d8d8" metalness={0.4} roughness={0.45} />
        </mesh>
      </>
    );
  }
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={boxArgs(size)} />
      <meshStandardMaterial color={COLOR.wood} roughness={0.8} />
    </mesh>
  );
}
