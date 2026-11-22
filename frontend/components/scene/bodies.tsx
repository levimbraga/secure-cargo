"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, PlaneGeometry } from "three";

import type { KeyframesDoc } from "@/lib/keyframes";

import { bodyTexture, type BodyTexture, TILE_M } from "./body-textures";
import { type Cut, useCutaway } from "./cutaway";
import { mergeParts, type Part } from "./merge";

type Bed = KeyframesDoc["bed"];
type V3 = [number, number, number];

/** Aluminium of the body's frame: top and bottom rails, corner posts, roof bows. */
const FRAME = { color: "#c3c7c9", metalness: 0.35, roughness: 0.45 } as const;
/** Galvanised steel of stakes and stanchions. */
const STAKE = { color: "#8b9093", metalness: 0.4, roughness: 0.5 } as const;

/** How far the body's skin stands out of the bed's edge [m]. */
const SKIN = 0.035;

/** A texture of the body, repeated once per tile along `along` metres and `across` times the other way. */
function useBodyTexture(kind: BodyTexture, along: number, across = 1) {
  const texture = useMemo(() => {
    const map = bodyTexture(kind);
    map.repeat.set(Math.max(along / TILE_M[kind], 1), across);
    return map;
  }, [kind, along, across]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** A plane in the XY plane, facing +Z, with vertical folds: a curtain pulled tight. */
function pleated(length: number, height: number, period = 0.32, depth = 0.016): BufferGeometry {
  const segments = Math.max(8, Math.round((length / period) * 6));
  const geometry = new PlaneGeometry(length, height, segments, 1);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    position.setZ(i, depth * Math.sin((2 * Math.PI * x) / period));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The visible body over the bed in the realistic view, built to the simulation's dimensions:
 * a box van, a curtain-sider, or a flatbed's drop sides. Its walls fade on the side the camera
 * looks from (`useCutaway`), so the cargo is always in view; the frame stays solid.
 */
export function RealisticWalls({ bed }: { bed: Bed }) {
  const body = bed.body ?? "flatbed";
  if (body === "box" || body === "curtain_sider") return <ClosedBody bed={bed} curtain={body === "curtain_sider"} />;
  return <DropSides bed={bed} />;
}

/** Height of a closed body's walls: the simulation's walls, or a typical van if none is given. */
function wallHeight(bed: Bed): number {
  const tall = Math.max(bed.headboard_height_m, bed.rear_wall_height_m ?? 0, bed.side_rail_height_m ?? 0);
  return tall > 0.5 ? tall : 2.4;
}

function ClosedBody({ bed, curtain }: { bed: Bed; curtain: boolean }) {
  const { length_m: length, width_m: width } = bed;
  const height = wallHeight(bed);
  const { group, cut } = useCutaway();
  const half = { l: length / 2, w: width / 2 };
  const side = useBodyTexture(curtain ? "curtain" : "panel", length);
  const end = useBodyTexture("panel", width);
  const roofMap = useBodyTexture("panel", length);
  const fabric = useMemo(() => (curtain ? pleated(length, height - 0.08) : null), [curtain, length, height]);
  useEffect(() => () => fabric?.dispose(), [fabric]);

  const wall = (faded: number, normal: V3, centre: V3, map = side) => (
    <meshStandardMaterial ref={cut(normal, centre, faded)} map={map} side={DoubleSide} roughness={curtain ? 0.85 : 0.45} metalness={curtain ? 0 : 0.15} />
  );
  // Posts of a curtain-sider that slide out of the way for side loading: thirds of the body.
  const stanchions = useMemo(() => (curtain ? [-length / 6, length / 6] : []), [curtain, length]);
  const bows = Math.max(Math.round(length / 1.2), 2);
  const { frame, markers } = useMemo(() => {
    const parts: Part[] = [];
    const add = (size: [number, number, number], at: [number, number, number]) => parts.push({ size, at, color: FRAME.color });
    for (const s of [1, -1]) {
      add([length + 0.1, 0.12, 0.05], [0, -0.04, s * (half.w + SKIN + 0.01)]);
      add([length + 0.12, 0.14, 0.08], [0, height + 0.02, s * (half.w + SKIN - 0.01)]);
      for (const x of [half.l + 0.03, -half.l - 0.03]) add([0.1, height + 0.1, 0.1], [x, height / 2, s * (half.w + SKIN - 0.01)]);
      for (const x of stanchions) add([0.07, height, 0.04], [x, height / 2, s * (half.w + SKIN + 0.03)]);
    }
    add([0.1, 0.18, width + 0.12], [-half.l - 0.05, height + 0.02, 0]);
    add([0.1, 0.1, width + 0.12], [-half.l - 0.05, 0.03, 0]);
    add([0.1, 0.16, width + 0.12], [half.l + 0.05, height + 0.02, 0]);
    for (let n = 1; n < bows; n++) add([0.05, 0.05, width + 0.04], [-half.l + (n * length) / bows, height + 0.04, 0]);
    const lights: Part[] = [];
    for (const s of [1, -1]) {
      for (const x of [half.l - 0.1, 0, -half.l + 0.1]) lights.push({ size: [0.1, 0.05, 0.02], at: [x, height + 0.06, s * (half.w + SKIN + 0.035)], color: "#f2a100" });
    }
    return { frame: mergeParts(parts), markers: mergeParts(lights) };
  }, [length, width, height, half.l, half.w, stanchions, bows]);
  useEffect(
    () => () => {
      frame.dispose();
      markers.dispose();
    },
    [frame, markers],
  );

  return (
    <group ref={group}>
      {/* Side walls: curtains or aluminium panels. */}
      {([1, -1] as const).map((s) => {
        const normal: V3 = [0, 0, s];
        const centre: V3 = [0, height / 2, s * half.w];
        const z = s * (half.w + SKIN);
        return fabric ? (
          <mesh key={s} geometry={fabric} position={[0, height / 2, z]} rotation={[0, s > 0 ? 0 : Math.PI, 0]} receiveShadow castShadow>
            {wall(0.22, normal, centre)}
          </mesh>
        ) : (
          <mesh key={s} position={[0, height / 2, z]} rotation={[0, s > 0 ? 0 : Math.PI, 0]} receiveShadow castShadow>
            <planeGeometry args={[length, height]} />
            {wall(0.18, normal, centre)}
          </mesh>
        );
      })}
      {/* Front wall (the headboard of the simulation) and roof. */}
      <mesh position={[half.l + 0.06, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow>
        <planeGeometry args={[width + 0.08, height]} />
        {wall(0.2, [1, 0, 0], [half.l, height / 2, 0], end)}
      </mesh>
      <mesh position={[0, height + 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <planeGeometry args={[length + 0.1, width + 0.08]} />
        <meshStandardMaterial
          ref={cut([0, 1, 0], [0, height, 0], 0.07)}
          map={roofMap}
          color={curtain ? "#e9ebe8" : "#ffffff"}
          side={DoubleSide}
          roughness={0.6}
        />
      </mesh>
      <RearDoors width={width} height={height} x={-half.l - 0.06} cut={cut} map={end} />
      {/* Frame (bottom and top rails, corner posts, stanchions, portals, roof bows), merged. */}
      <mesh geometry={frame} castShadow>
        <meshStandardMaterial vertexColors metalness={FRAME.metalness} roughness={FRAME.roughness} />
      </mesh>
      <mesh geometry={markers} userData={{ fine: true }}>
        <meshStandardMaterial vertexColors emissive="#f2a100" emissiveIntensity={0.35} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Two rear doors with their lock rods and handles; they fade like a wall. */
function RearDoors({ width, height, x, cut, map }: { width: number; height: number; x: number; cut: Cut; map: ReturnType<typeof bodyTexture> }) {
  const leaf = width / 2 - 0.03;
  const normal: V3 = [-1, 0, 0];
  const centre: V3 = [x, height / 2, 0];
  return (
    <group position={[x, height / 2, 0]}>
      {[1, -1].map((s) => (
        <group key={s} position={[0, 0, s * (leaf / 2 + 0.015)]}>
          <mesh rotation={[0, -Math.PI / 2, 0]} receiveShadow>
            <planeGeometry args={[leaf, height - 0.06]} />
            <meshStandardMaterial ref={cut(normal, centre, 0.18)} map={map} side={DoubleSide} roughness={0.45} metalness={0.15} />
          </mesh>
          {[-0.18, 0.22].map((offset) => (
            <mesh key={offset} position={[-0.03, 0, s * offset * leaf * 1.6]} userData={{ fine: true }}>
              <cylinderGeometry args={[0.018, 0.018, height - 0.1, 8]} />
              <meshStandardMaterial ref={cut(normal, centre, 0.2)} color="#a4a9ac" metalness={0.5} roughness={0.35} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** A flatbed's drop sides (and tailboard): wooden boards between steel stakes. */
function DropSides({ bed }: { bed: Bed }) {
  const { length_m: length, width_m: width } = bed;
  const sides = bed.side_rail_height_m ?? 0;
  const rear = bed.rear_wall_height_m ?? 0;
  const { group, cut } = useCutaway();
  const long = useBodyTexture("boards", length, Math.max(sides / 0.55, 0.5));
  const short = useBodyTexture("boards", width, Math.max(rear / 0.55, 0.5));
  const stakes = Math.max(Math.round(length / 1.3), 2);
  return (
    <group ref={group}>
      {sides > 0 &&
        ([1, -1] as const).map((s) => (
          <group key={s}>
            <mesh position={[0, sides / 2, s * (width / 2 + SKIN)]} castShadow receiveShadow>
              <boxGeometry args={[length, sides, 0.04]} />
              <meshStandardMaterial ref={cut([0, 0, s], [0, sides / 2, (s * width) / 2], 0.3)} map={long} roughness={0.8} />
            </mesh>
            {Array.from({ length: stakes + 1 }, (_, n) => -length / 2 + (n * length) / stakes).map((x) => (
              <mesh key={x} position={[Math.max(Math.min(x, length / 2 - 0.04), -length / 2 + 0.04), sides / 2 - 0.03, s * (width / 2 + SKIN + 0.035)]} castShadow>
                <boxGeometry args={[0.06, sides + 0.1, 0.04]} />
                <meshStandardMaterial {...STAKE} />
              </mesh>
            ))}
            <mesh position={[0, sides, s * (width / 2 + SKIN)]} castShadow>
              <boxGeometry args={[length, 0.04, 0.07]} />
              <meshStandardMaterial {...STAKE} />
            </mesh>
          </group>
        ))}
      {rear > 0 && (
        <mesh position={[-length / 2 - SKIN, rear / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.04, rear, width + 0.1]} />
          <meshStandardMaterial ref={cut([-1, 0, 0], [-length / 2, rear / 2, 0], 0.3)} map={short} roughness={0.8} />
        </mesh>
      )}
    </group>
  );
}
