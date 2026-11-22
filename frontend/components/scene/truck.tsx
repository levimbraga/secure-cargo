"use client";

import { type ReactNode, type RefObject, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  type Group,
} from "three";

import type { KeyframesDoc } from "@/lib/keyframes";
import { truckLayout, wheelLayout } from "@/lib/scene/truck-geometry";

import { RealisticWalls } from "./bodies";
import { mergeParts } from "./merge";
import { bodyTexture, TILE_M } from "./body-textures";
import { CAB_BOTTOM_M, CabOver, ConventionalCab, useTyre } from "./cabs";
import { COLOR, type ViewMode } from "./shared";

type Bed = KeyframesDoc["bed"];

/** Receives the groups that turn with a semi's tractor about the kingpin (the scene sets their yaw). */
export type TractorRegister = (slot: number, group: Group | null) => void;

/**
 * Everything of a semi's tractor: drawn in the bed's frame, turned about the kingpin by the
 * articulation angle the scene computes from the road (`articulationAngle` in `motion.ts`).
 * The physics runs on the trailer bed only; the angle is visual. A rigid truck draws its
 * children as they are.
 */
function Tractor({
  kingpin,
  slot,
  register,
  children,
}: {
  kingpin: number | null;
  slot: number;
  register?: TractorRegister;
  children: ReactNode;
}) {
  if (kingpin === null) return <>{children}</>;
  return (
    <group
      position={[kingpin, 0, 0]}
      ref={(node) => register?.(slot, node)}
    >
      <group position={[-kingpin, 0, 0]}>{children}</group>
    </group>
  );
}

/**
 * Wheels and axles, in the truck's frame, for the truck the run was on (`truckLayout`: its
 * axles, wheel size and twin tyres from the truck catalog). They are drawn apart from the body
 * because the body dips and rolls on its suspension while each wheel rests on the road under
 * it: the scene moves every wheel to its own height (`truckPose` in `lib/scene/motion.ts`)
 * through `wheelRefs`, and each axle to the mean of its wheels through `axleRefs`.
 */
export function Wheels({
  bed,
  mode,
  wheelRefs,
  axleRefs,
  registerTractor,
}: {
  bed: Bed;
  mode: ViewMode;
  wheelRefs?: RefObject<(Group | null)[]>;
  axleRefs?: RefObject<(Group | null)[]>;
  registerTractor?: TractorRegister;
}) {
  const layout = truckLayout(bed);
  const wheels = wheelLayout(bed);
  const realistic = mode === "realistic";
  const kingpin = layout.tractor?.kingpin ?? null;
  const onTractor = (group: string) => kingpin !== null && group !== "rear" && group !== "trailer";
  const wheelSets = (tractor: boolean) =>
    wheels.map((wheel, index) => ({ wheel, index })).filter(({ wheel }) => onTractor(layout.axles[wheel.axleIndex]?.group ?? "") === tractor);
  const axleSets = (tractor: boolean) => layout.axles.map((axle, index) => ({ axle, index })).filter(({ axle }) => onTractor(axle.group) === tractor);

  const draw = (tractor: boolean) => (
    <>
      {wheelSets(tractor).map(({ wheel, index }) => (
        <group
          key={`${wheel.x}:${wheel.y}`}
          ref={(node) => {
            if (wheelRefs?.current) wheelRefs.current[index] = node;
          }}
          position={[wheel.x, wheel.radius, -wheel.y]}
        >
          <group rotation={[Math.PI / 2, 0, 0]}>
            {realistic ? (
              <Wheel radius={wheel.radius} width={wheel.width} dual={wheel.width > 0.4} outward={wheel.y > 0 ? -1 : 1} />
            ) : (
              <mesh>
                <cylinderGeometry args={[wheel.radius, wheel.radius, wheel.width, 36]} />
                <meshLambertMaterial color="#55554f" transparent opacity={0.55} />
              </mesh>
            )}
          </group>
        </group>
      ))}
      {realistic &&
        axleSets(tractor).map(({ axle, index }) => (
          <group
            key={`${axle.group}:${axle.x}`}
            ref={(node) => {
              if (axleRefs?.current) axleRefs.current[index] = node;
            }}
            position={[axle.x, layout.wheelRadius, 0]}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.07, 0.07, bed.width_m - 0.5, 12]} />
              <meshStandardMaterial color={COLOR.chassis} roughness={0.6} metalness={0.5} />
            </mesh>
          </group>
        ))}
    </>
  );

  return (
    <group>
      {draw(false)}
      {kingpin !== null && (
        <Tractor kingpin={kingpin} slot={0} register={registerTractor}>
          {draw(true)}
        </Tractor>
      )}
    </group>
  );
}

/**
 * One wheel set, its axis on Y (the wheel group turns it onto the axle): a tyre, or twin tyres,
 * with the steel rim, hub and nuts on the outer face. `outward` is the side of +Y that faces
 * away from the truck.
 */
function Wheel({ radius, width, dual, outward }: { radius: number; width: number; dual: boolean; outward: 1 | -1 }) {
  const tyreWidth = dual ? width / 2 - 0.02 : width;
  const tyre = useTyre(radius, tyreWidth);
  const { tyres, steel } = useMemo(() => {
    const offsets = dual ? [-(tyreWidth / 2 + 0.02), tyreWidth / 2 + 0.02] : [0];
    const face = outward * (width / 2 - 0.035);
    const tyres = mergeParts(offsets.map((offset) => ({ geometry: tyre.clone(), at: [0, offset, 0], color: COLOR.tire })));
    // Rim (inner barrel and the disc on the outer face), hub and the ring of wheel nuts.
    const steel = mergeParts([
      { geometry: new CylinderGeometry(radius * 0.6, radius * 0.6, width - 0.06, 20, 1, true), at: [0, 0, 0], color: "#2a2b2c" },
      { geometry: new CylinderGeometry(radius * 0.6, radius * 0.6, 0.02, 24), at: [0, face, 0], color: "#d7d9d8" },
      { geometry: new CylinderGeometry(radius * 0.2, radius * 0.24, 0.07, 16), at: [0, face + outward * 0.03, 0], color: "#9a9ea0" },
      ...Array.from({ length: 8 }, (_, n) => (n * Math.PI) / 4).map((angle) => ({
        geometry: new CylinderGeometry(0.022, 0.022, 0.04, 6),
        at: [Math.cos(angle) * radius * 0.32, face + outward * 0.02, Math.sin(angle) * radius * 0.32] as [number, number, number],
        color: "#6f7477",
      })),
    ]);
    return { tyres, steel };
  }, [tyre, radius, width, dual, outward, tyreWidth]);
  useEffect(
    () => () => {
      tyres.dispose();
      steel.dispose();
    },
    [tyres, steel],
  );
  return (
    <group>
      <mesh geometry={tyres} castShadow>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
      <mesh geometry={steel}>
        <meshStandardMaterial vertexColors metalness={0.3} roughness={0.4} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * The body of the truck: bed, headboard, chassis and cab. Bed and headboard have exactly the
 * dimensions the simulation used; the rest is there to make it a truck. The origin is the
 * middle of the bed floor.
 */
export function TruckBody({ bed, mode, registerTractor }: { bed: Bed; mode: ViewMode; registerTractor?: TractorRegister }) {
  return (
    <>
      {mode === "realistic" ? <RealisticBody bed={bed} registerTractor={registerTractor} /> : <EngineeringBody bed={bed} registerTractor={registerTractor} />}
      {mode === "realistic" ? <RealisticWalls bed={bed} /> : <Walls bed={bed} mode={mode} />}
      <Blocks bed={bed} mode={mode} />
    </>
  );
}

/**
 * Side walls and rear doors of a box body, curtains of a curtain-sider, low side rails of a
 * flatbed: all with the simulation's dimensions. They are see-through, so the cargo stays in
 * view; a curtain is drawn as fabric because it restrains nothing.
 */
function Walls({ bed, mode }: { bed: Bed; mode: ViewMode }) {
  const { length_m: length, width_m: width } = bed;
  const body = bed.body ?? "flatbed";
  const sides = bed.side_rail_height_m ?? 0;
  const rear = bed.rear_wall_height_m ?? 0;
  const tall = Math.max(bed.headboard_height_m, rear, sides);
  const engineering = mode === "engineering";
  const panel = engineering ? "#aeb2b6" : "#f1f1ec";
  const roof = useMemo(() => new EdgesGeometry(new BoxGeometry(length, 0.001, width)), [length, width]);
  useEffect(() => () => roof.dispose(), [roof]);
  return (
    <group>
      {sides > 0 &&
        [-1, 1].map((side) => (
          <Slab
            key={side}
            size={[length, sides, 0.05]}
            position={[0, sides / 2, side * (width / 2 + 0.03)]}
            color={panel}
            opacity={side > 0 ? 0.16 : 0.3}
          />
        ))}
      {rear > 0 && (
        <Slab size={[0.05, rear, width]} position={[-length / 2 - 0.03, rear / 2, 0]} color={panel} opacity={0.22} />
      )}
      {body === "curtain_sider" &&
        [-1, 1].map((side) => (
          <mesh key={side} position={[0, tall / 2, side * (width / 2 + 0.03)]}>
            <boxGeometry args={[length, tall, 0.02]} />
            <meshStandardMaterial color="#2e5c8a" transparent opacity={side > 0 ? 0.14 : 0.28} roughness={0.9} depthWrite={false} />
          </mesh>
        ))}
      {body !== "flatbed" && (
        // Roof frame of the body.
        <lineSegments position={[0, tall, 0]} geometry={roof}>
          <lineBasicMaterial color={engineering ? COLOR.ink : "#8d9194"} />
        </lineSegments>
      )}
    </group>
  );
}

/** Chocks, beams and cradle sides fixed to the bed (they stop cargo by contact). */
function Blocks({ bed, mode }: { bed: Bed; mode: ViewMode }) {
  return (
    <group>
      {(bed.blocks ?? []).map((block) => {
        const [x, y] = block.position_m;
        const [sx, sy, sz] = block.size_m;
        const position: [number, number, number] = [x, sz / 2, -y];
        return mode === "engineering" ? (
          <Slab key={block.id} size={[sx, sz, sy]} position={position} color="#8a6a43" opacity={0.75} />
        ) : (
          <mesh key={block.id} position={position} castShadow receiveShadow>
            <boxGeometry args={[sx, sz, sy]} />
            <meshStandardMaterial color={block.kind === "cradle" ? "#5b4126" : "#9b7648"} roughness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

const GALVANISED = { color: "#8f9598", metalness: 0.35, roughness: 0.45 } as const;

/** Height of a tractor's frame above the road [m]. */
const TRACTOR_FRAME_M = 1.0;

function EngineeringBody({ bed, registerTractor }: { bed: Bed; registerTractor?: TractorRegister }) {
  const { length_m: length, width_m: width, headboard_height_m: headboard, floor_height_m: floor } = bed;
  const layout = truckLayout(bed);
  const { cab, upperDeck } = layout;
  const cabHeight = cab.height - CAB_BOTTOM_M;
  return (
    <group>
      <Slab size={[length, 0.14, width]} position={[0, -0.07, 0]} color="#aeb2b6" opacity={0.9} />
      {headboard > 0 && (
        <Slab size={[0.1, headboard, width]} position={[length / 2 + 0.05, headboard / 2, 0]} color="#aeb2b6" opacity={0.55} />
      )}
      {upperDeck && (
        <Slab size={[upperDeck.length, 0.14, width]} position={[upperDeck.front - upperDeck.length / 2, upperDeck.rise - 0.07, 0]} color="#aeb2b6" opacity={0.9} />
      )}
      <Tractor kingpin={layout.tractor?.kingpin ?? null} slot={1} register={registerTractor}>
        <Slab size={[cab.length, cabHeight, width]} position={[cab.front - cab.length / 2, -floor + CAB_BOTTOM_M + cabHeight / 2, 0]} color="#d9d9d3" opacity={0.35} />
      </Tractor>
    </group>
  );
}

/** A translucent box with ink edges: the look of a physics debug view. */
function Slab({
  size,
  position,
  color,
  opacity,
}: {
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  opacity: number;
}) {
  const geometry = useMemo(() => new BoxGeometry(...size), [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position}>
      <meshLambertMaterial color={color} transparent opacity={opacity} depthWrite={opacity > 0.8} />
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={COLOR.ink} />
      </lineSegments>
    </mesh>
  );
}

function RealisticBody({ bed, registerTractor }: { bed: Bed; registerTractor?: TractorRegister }) {
  const { length_m: length, width_m: width, headboard_height_m: headboard, floor_height_m: floor } = bed;
  const front = length / 2;
  const layout = truckLayout(bed);
  const deck = useMemo(() => {
    const texture = bodyTexture("planks");
    texture.repeat.set(length / TILE_M.planks, 1);
    return texture;
  }, [length]);
  useEffect(() => () => deck.dispose(), [deck]);

  const dark = <meshStandardMaterial color={COLOR.chassis} metalness={0.5} roughness={0.55} />;
  const steel = <meshStandardMaterial color="#8d9194" metalness={0.7} roughness={0.45} />;
  const ground = -floor;
  const { cab, tractor, upperDeck } = layout;
  const cabBack = cab.front - cab.length;
  // A rigid truck's frame runs from the bumper to the rear; a tractor's ends behind its drive
  // axles, and the trailer rests on its fifth wheel.
  const railTop = tractor ? Math.min(ground + TRACTOR_FRAME_M, upperDeck ? upperDeck.rise - 0.25 : -0.5) : -0.2;
  const railEnd = tractor ? tractor.frameEnd : -front;
  const trailerFront = upperDeck ? upperDeck.front : front;
  const closed = bed.body === "box" || bed.body === "curtain_sider";
  // Underside of the trailer's beams over the fifth wheel.
  const kingpinTop = upperDeck ? upperDeck.rise - 0.46 : -0.46;
  const legX = tractor ? tractor.frameEnd - 0.6 : 0;
  const legTop = upperDeck && legX > front ? kingpinTop : -0.46;
  const lastAxle = Math.min(...layout.axles.map((axle) => axle.x));
  const sheet = Math.min(headboard * 0.4, 0.6);
  const barCount = Math.max(Math.floor((width - 0.2) / 0.14), 1);
  const bars = Array.from({ length: barCount }, (_, n) => -width / 2 + 0.1 + ((n + 0.5) * (width - 0.2)) / barCount);
  const wallTop = Math.max(bed.headboard_height_m, bed.rear_wall_height_m ?? 0) - 0.05;

  return (
    <group>
      {/* Deck: wooden planks on a steel frame. Its top is the bed floor of the simulation. */}
      <mesh position={[0, -0.03, 0]} receiveShadow castShadow>
        <boxGeometry args={[length, 0.06, width]} />
        <meshStandardMaterial map={deck} roughness={0.82} />
      </mesh>
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[length + 0.04, 0.12, width + 0.04]} />
        {steel}
      </mesh>
      {/* Side beams along both edges of the deck, with the lashing rail. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, -0.1, side * (width / 2 + 0.035)]} castShadow>
          <boxGeometry args={[length + 0.04, 0.2, 0.05]} />
          {dark}
        </mesh>
      ))}
      {/* A step deck's upper level over the fifth wheel: its deck, side beams and the step. */}
      {upperDeck && (
        <group>
          <mesh position={[upperDeck.front - upperDeck.length / 2, upperDeck.rise - 0.03, 0]} castShadow receiveShadow>
            <boxGeometry args={[upperDeck.length, 0.06, width]} />
            <meshStandardMaterial map={deck} roughness={0.82} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[upperDeck.front - upperDeck.length / 2, upperDeck.rise - 0.1, side * (width / 2 + 0.035)]} castShadow>
              <boxGeometry args={[upperDeck.length + 0.04, 0.2, 0.05]} />
              {dark}
            </mesh>
          ))}
          <mesh position={[front + 0.03, upperDeck.rise / 2 - 0.1, 0]} castShadow>
            <boxGeometry args={[0.06, upperDeck.rise + 0.2, width + 0.1]} />
            {dark}
          </mesh>
          <mesh position={[upperDeck.front + 0.02, upperDeck.rise - 0.14, 0]} castShadow>
            <boxGeometry args={[0.06, 0.28, width + 0.1]} />
            {dark}
          </mesh>
        </group>
      )}
      {/* Headboard of a flatbed (a closed body's front wall is its own): a galvanised frame, a
          solid sheet below and a grille of bars above, the way Brazilian bodies build it. */}
      {headboard > 0 && !closed && (
        <group position={[front + 0.05, 0, 0]}>
          <mesh position={[0, sheet / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.04, sheet, width]} />
            <meshStandardMaterial color="#a7acaf" metalness={0.3} roughness={0.45} />
          </mesh>
          {bars.map((z) => (
            <mesh key={z} position={[0, (sheet + headboard) / 2, z]} castShadow>
              <boxGeometry args={[0.03, headboard - sheet, 0.035]} />
              <meshStandardMaterial {...GALVANISED} />
            </mesh>
          ))}
          {[-width / 2 + 0.04, width / 2 - 0.04].map((z) => (
            <mesh key={z} position={[0.02, headboard / 2, z]} castShadow>
              <boxGeometry args={[0.1, headboard, 0.08]} />
              <meshStandardMaterial {...GALVANISED} />
            </mesh>
          ))}
          {[headboard - 0.04, sheet].map((y) => (
            <mesh key={y} position={[0.02, y, 0]} castShadow>
              <boxGeometry args={[0.1, 0.08, width]} />
              <meshStandardMaterial {...GALVANISED} />
            </mesh>
          ))}
        </group>
      )}
      {/* Chassis rails of a rigid truck (a tractor's turn with its cab, below). */}
      {!tractor && <ChassisRails from={cab.front - 0.1} to={railEnd} top={railTop} dark={dark} />}
      {tractor && (
        <group>
          {/* The trailer's main beams (up under a step deck's upper level) and its landing gear. */}
          {[-0.42, 0.42].map((z) => (
            <group key={z}>
              <mesh position={[0, -0.32, z]} castShadow>
                <boxGeometry args={[length, 0.28, 0.1]} />
                {dark}
              </mesh>
              {trailerFront > front && (
                <>
                  <mesh position={[(front + trailerFront) / 2, kingpinTop + 0.14, z]} castShadow>
                    <boxGeometry args={[trailerFront - front, 0.28, 0.1]} />
                    {dark}
                  </mesh>
                  <mesh position={[front, (kingpinTop + 0.28 - 0.46) / 2, z]} castShadow>
                    <boxGeometry args={[0.3, kingpinTop + 0.28 + 0.46, 0.1]} />
                    {dark}
                  </mesh>
                </>
              )}
            </group>
          ))}
          {[-1, 1].map((side) => (
            <group key={side} position={[legX, 0, side * (width / 2 - 0.35)]}>
              <mesh position={[0, (ground + 0.12 + legTop) / 2, 0]}>
                <boxGeometry args={[0.12, legTop - ground - 0.12, 0.12]} />
                {dark}
              </mesh>
              <mesh position={[0, ground + 0.06, 0]}>
                <boxGeometry args={[0.3, 0.05, 0.3]} />
                {dark}
              </mesh>
            </group>
          ))}
          <mesh position={[legX, legTop - 0.25, 0]}>
            <boxGeometry args={[0.06, 0.06, width - 0.7]} />
            {dark}
          </mesh>
        </group>
      )}
      {/* Mud flaps behind the last axle. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[lastAxle - layout.wheelRadius - 0.2, ground + 0.5, side * (width / 2 - 0.3)]} userData={{ fine: true }}>
          <boxGeometry args={[0.02, 0.6, 0.55]} />
          <meshStandardMaterial color="#1c1c1b" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[-front - 0.02, -0.42, 0]}>
        <boxGeometry args={[0.08, 0.14, width]} />
        {dark}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[-front - 0.07, -0.42, side * (width / 2 - 0.3)]}>
          <boxGeometry args={[0.03, 0.1, 0.34]} />
          <meshStandardMaterial color="#8c1f15" roughness={0.4} />
        </mesh>
      ))}
      {/* The cab and what turns with it: a tractor's rails and fifth wheel, the fuel tank. */}
      <Tractor kingpin={tractor?.kingpin ?? null} slot={2} register={registerTractor}>
        {tractor && (
          <>
            <ChassisRails from={cab.front - 0.1} to={railEnd} top={railTop} dark={dark} />
            <mesh position={[tractor.kingpin, (railTop + kingpinTop) / 2, 0]} castShadow>
              <cylinderGeometry args={[0.55, 0.55, Math.max(kingpinTop - railTop, 0.06), 24]} />
              <meshStandardMaterial color="#2c2f31" metalness={0.6} roughness={0.5} />
            </mesh>
          </>
        )}
        {cab.kind === "cab_over" && (
        <mesh position={[cabBack - 0.6, ground + 0.75, width / 2 - 0.42]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, 1.1, 20]} />
          <meshStandardMaterial color="#c4c7c9" metalness={0.5} roughness={0.3} />
        </mesh>
        )}
        {cab.kind === "conventional" ? (
          <ConventionalCab layout={layout} width={width} ground={ground} />
        ) : (
          <CabOver layout={layout} width={width} ground={ground} deflectorTop={tractor && closed ? wallTop : null} />
        )}
      </Tractor>
    </group>
  );
}

function ChassisRails({ from, to, top, dark }: { from: number; to: number; top: number; dark: ReactNode }) {
  return (
    <>
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[(from + to) / 2, top - 0.14, z]} castShadow>
          <boxGeometry args={[from - to, 0.28, 0.1]} />
          {dark}
        </mesh>
      ))}
    </>
  );
}
