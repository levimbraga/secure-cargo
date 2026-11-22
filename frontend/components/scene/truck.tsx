"use client";

import { type RefObject, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  ExtrudeGeometry,
  type Group,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
} from "three";

import type { KeyframesDoc } from "@/lib/keyframes";
import { type TruckLayout, truckLayout, wheelLayout } from "@/lib/scene/truck-geometry";

import { COLOR, type ViewMode } from "./shared";

type Bed = KeyframesDoc["bed"];

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
}: {
  bed: Bed;
  mode: ViewMode;
  wheelRefs?: RefObject<(Group | null)[]>;
  axleRefs?: RefObject<(Group | null)[]>;
}) {
  const layout = truckLayout(bed);
  const wheels = wheelLayout(bed);
  const realistic = mode === "realistic";

  return (
    <group>
      {wheels.map((wheel, index) => (
        <group
          key={`${wheel.x}:${wheel.y}`}
          ref={(node) => {
            if (wheelRefs?.current) wheelRefs.current[index] = node;
          }}
          position={[wheel.x, wheel.radius, -wheel.y]}
        >
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow={realistic}>
              <cylinderGeometry args={[wheel.radius, wheel.radius, wheel.width, 36]} />
              {realistic ? (
                <meshStandardMaterial color={COLOR.tire} roughness={0.92} />
              ) : (
                <meshLambertMaterial color="#55554f" transparent opacity={0.55} />
              )}
            </mesh>
            {realistic && (
              <mesh>
                <cylinderGeometry args={[wheel.radius * 0.54, wheel.radius * 0.54, wheel.width + 0.02, 24]} />
                <meshStandardMaterial color="#a9acad" metalness={0.85} roughness={0.35} />
              </mesh>
            )}
          </group>
        </group>
      ))}
      {realistic &&
        layout.axles.map((axle, index) => (
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
    </group>
  );
}

/** Planks running along the bed, with darker seams: the deck of a Brazilian wooden body. */
function deckTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const planks = 8;
    for (let plank = 0; plank < planks; plank++) {
      const shade = [0xb9, 0x9a, 0x6c].map((c) => c - ((plank * 37) % 22));
      context.fillStyle = `rgb(${shade.join(",")})`;
      context.fillRect(0, (plank * 128) / planks, 256, 128 / planks);
      context.fillStyle = "rgba(60,40,20,0.55)";
      context.fillRect(0, (plank * 128) / planks, 256, 1.5);
      context.fillRect((plank * 97) % 256, (plank * 128) / planks, 1.5, 128 / planks);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The body of the truck: bed, headboard, chassis and cab. Bed and headboard have exactly the
 * dimensions the simulation used; the rest is there to make it a truck. The origin is the
 * middle of the bed floor.
 */
export function TruckBody({ bed, mode }: { bed: Bed; mode: ViewMode }) {
  return (
    <>
      {mode === "realistic" ? <RealisticBody bed={bed} /> : <EngineeringBody bed={bed} />}
      <Walls bed={bed} mode={mode} />
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

/** Height of the cab's floor and of a tractor's frame above the road [m]. */
const CAB_BOTTOM_M = 0.55;
const TRACTOR_FRAME_M = 1.0;

function EngineeringBody({ bed }: { bed: Bed }) {
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
      <Slab size={[cab.length, cabHeight, width]} position={[cab.front - cab.length / 2, -floor + CAB_BOTTOM_M + cabHeight / 2, 0]} color="#d9d9d3" opacity={0.35} />
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

function RealisticBody({ bed }: { bed: Bed }) {
  const { length_m: length, width_m: width, headboard_height_m: headboard, floor_height_m: floor } = bed;
  const front = length / 2;
  const layout = truckLayout(bed);
  const deck = useMemo(() => {
    const texture = deckTexture();
    texture.repeat.set(length / 2.4, 1);
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
      {/* Lashing rail along both sides of the deck. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, -0.06, side * (width / 2 + 0.04)]}>
          <boxGeometry args={[length, 0.05, 0.04]} />
          {dark}
        </mesh>
      ))}
      {/* A step deck's upper level, over the fifth wheel. */}
      {upperDeck && (
        <group>
          <mesh position={[upperDeck.front - upperDeck.length / 2, upperDeck.rise - 0.09, 0]} castShadow receiveShadow>
            <boxGeometry args={[upperDeck.length, 0.18, width]} />
            <meshStandardMaterial map={deck} roughness={0.82} />
          </mesh>
          <mesh position={[front + 0.02, (upperDeck.rise - 0.18) / 2, 0]}>
            <boxGeometry args={[0.04, Math.max(upperDeck.rise - 0.18, 0.05), width]} />
            {steel}
          </mesh>
        </group>
      )}
      {/* Headboard: a steel frame with a sheet. */}
      {headboard > 0 && (
        <group position={[front + 0.05, headboard / 2, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.06, headboard, width]} />
            <meshStandardMaterial color="#9da1a4" metalness={0.75} roughness={0.4} />
          </mesh>
          {[-width / 2 + 0.04, 0, width / 2 - 0.04].map((z) => (
            <mesh key={z} position={[0.03, 0, z]}>
              <boxGeometry args={[0.1, headboard, 0.08]} />
              {dark}
            </mesh>
          ))}
          <mesh position={[0.03, headboard / 2 - 0.04, 0]}>
            <boxGeometry args={[0.1, 0.08, width]} />
            {dark}
          </mesh>
        </group>
      )}
      {/* Chassis rails: the truck's, or the tractor's. */}
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[(cab.front - 0.1 + railEnd) / 2, railTop - 0.14, z]} castShadow>
          <boxGeometry args={[cab.front - 0.1 - railEnd, 0.28, 0.1]} />
          {dark}
        </mesh>
      ))}
      {tractor && (
        <group>
          {/* The trailer's own rails, its fifth-wheel plate under the kingpin, and its landing gear. */}
          {[-0.42, 0.42].map((z) => (
            <mesh key={z} position={[(trailerFront - front) / 2, -0.32, z]} castShadow>
              <boxGeometry args={[trailerFront + front, 0.28, 0.1]} />
              {dark}
            </mesh>
          ))}
          <mesh position={[tractor.kingpin, (railTop + (upperDeck ? upperDeck.rise - 0.18 : -0.46)) / 2, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, Math.max((upperDeck ? upperDeck.rise - 0.18 : -0.46) - railTop, 0.06), 24]} />
            <meshStandardMaterial color="#2c2f31" metalness={0.6} roughness={0.5} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[tractor.frameEnd - 0.6, (ground + 0.2 - 0.46) / 2, side * (width / 2 - 0.35)]}>
              <boxGeometry args={[0.12, -0.46 - ground - 0.2, 0.12]} />
              {dark}
            </mesh>
          ))}
        </group>
      )}
      <mesh position={[cabBack - 0.6, ground + 0.75, width / 2 - 0.42]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 1.1, 20]} />
        <meshStandardMaterial color="#b4b7b9" metalness={0.9} roughness={0.3} />
      </mesh>
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
      {cab.kind === "conventional" ? <ConventionalCab layout={layout} width={width} ground={ground} /> : <CabOver layout={layout} width={width} ground={ground} />}
    </group>
  );
}

const PAINT = { color: "#eeeeea", metalness: 0.15, roughness: 0.32 } as const;
const GLASS = { color: "#1c2226", metalness: 0.9, roughness: 0.08 } as const;

/** A cab-over cab (Brazilian and European trucks): flat front, raked windscreen, rounded roof. */
function CabOver({ layout, width, ground }: { layout: TruckLayout; width: number; ground: number }) {
  const { cab } = layout;
  // The profile is drawn 1.95 m long and 2.3 m tall, then scaled to the catalog's cab (the
  // windscreen and the windows scale with it, so they stay on the rake of the profile).
  const profile = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.82, 0);
    shape.lineTo(1.9, 0.25);
    shape.lineTo(1.9, 1.15);
    shape.lineTo(1.62, 2.12);
    shape.quadraticCurveTo(1.56, 2.3, 1.36, 2.3);
    shape.lineTo(0.12, 2.3);
    shape.quadraticCurveTo(0, 2.3, 0, 2.18);
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, {
      depth: width - 0.16,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 3,
    });
    geometry.translate(0, 0, -(width - 0.16) / 2);
    return geometry;
  }, [width]);
  useEffect(() => () => profile.dispose(), [profile]);
  const sx = cab.length / 1.95;
  const sy = (cab.height - CAB_BOTTOM_M) / 2.3;
  const dark = <meshStandardMaterial color={COLOR.chassis} metalness={0.5} roughness={0.55} />;
  return (
    <group position={[cab.front - cab.length, ground + CAB_BOTTOM_M, 0]} scale={[sx, sy, 1]}>
      <mesh geometry={profile} castShadow receiveShadow>
        <meshStandardMaterial {...PAINT} />
      </mesh>
      {/* Windscreen, following the rake of the profile. */}
      <mesh position={[1.795, 1.63, 0]} rotation={[0, 0, 0.281]}>
        <boxGeometry args={[0.03, 0.86, width - 0.5]} />
        <meshStandardMaterial {...GLASS} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[1.05, 1.66, side * (width / 2 - 0.02)]}>
          <boxGeometry args={[1.0, 0.72, 0.03]} />
          <meshStandardMaterial {...GLASS} />
        </mesh>
      ))}
      {/* Grille, bumper and headlights. */}
      <mesh position={[1.955, 0.78, 0]}>
        <boxGeometry args={[0.03, 0.46, width - 1.0]} />
        {dark}
      </mesh>
      <mesh position={[1.9, 0.14, 0]} castShadow>
        <boxGeometry args={[0.2, 0.3, width - 0.04]} />
        {dark}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[1.96, 0.72, side * (width / 2 - 0.36)]}>
          <boxGeometry args={[0.03, 0.2, 0.34]} />
          <meshStandardMaterial color="#f4f1e6" emissive="#f4f1e6" emissiveIntensity={0.25} roughness={0.2} />
        </mesh>
      ))}
      {/* Mirrors. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[1.7, 1.72, side * (width / 2 + 0.12)]}>
          <boxGeometry args={[0.05, 0.42, 0.2]} />
          {dark}
        </mesh>
      ))}
    </group>
  );
}

/** A conventional US tractor: a long hood ahead of the cab, then a sleeper. */
function ConventionalCab({ layout, width, ground }: { layout: TruckLayout; width: number; ground: number }) {
  const { cab } = layout;
  const hood = Math.min(1.9, cab.length * 0.42);
  const cabin = Math.min(1.4, cab.length - hood);
  const sleeper = Math.max(cab.length - hood - cabin, 0);
  const bottom = ground + CAB_BOTTOM_M;
  const hoodTop = ground + 1.75;
  const x0 = cab.front;
  const dark = <meshStandardMaterial color={COLOR.chassis} metalness={0.5} roughness={0.55} />;
  return (
    <group>
      {/* Hood with its grille. */}
      <mesh position={[x0 - hood / 2, (bottom + hoodTop) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[hood, hoodTop - bottom, width - 0.6]} />
        <meshStandardMaterial {...PAINT} />
      </mesh>
      <mesh position={[x0 + 0.01, (bottom + hoodTop) / 2 + 0.05, 0]}>
        <boxGeometry args={[0.03, (hoodTop - bottom) * 0.7, width - 1.0]} />
        <meshStandardMaterial color="#b9bcbe" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[x0 + 0.05, bottom + 0.1, 0]} castShadow>
        <boxGeometry args={[0.2, 0.3, width - 0.04]} />
        {dark}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[x0 + 0.02, hoodTop - 0.35, side * (width / 2 - 0.5)]}>
          <boxGeometry args={[0.03, 0.18, 0.3]} />
          <meshStandardMaterial color="#f4f1e6" emissive="#f4f1e6" emissiveIntensity={0.25} roughness={0.2} />
        </mesh>
      ))}
      {/* Cab, with its windscreen. */}
      <mesh position={[x0 - hood - cabin / 2, (bottom + ground + 3.0) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[cabin, ground + 3.0 - bottom, width - 0.16]} />
        <meshStandardMaterial {...PAINT} />
      </mesh>
      <mesh position={[x0 - hood + 0.01, ground + 2.45, 0]}>
        <boxGeometry args={[0.03, 0.7, width - 0.5]} />
        <meshStandardMaterial {...GLASS} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[x0 - hood - cabin / 2, ground + 2.4, side * (width / 2 - 0.07)]}>
          <boxGeometry args={[cabin * 0.7, 0.62, 0.03]} />
          <meshStandardMaterial {...GLASS} />
        </mesh>
      ))}
      {/* Sleeper, as tall as the catalog's cab. */}
      {sleeper > 0 && (
        <mesh position={[x0 - hood - cabin - sleeper / 2, (bottom + ground + cab.height) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[sleeper, ground + cab.height - bottom, width - 0.16]} />
          <meshStandardMaterial {...PAINT} />
        </mesh>
      )}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[x0 - hood - 0.1, ground + 2.3, side * (width / 2 + 0.12)]}>
          <boxGeometry args={[0.05, 0.5, 0.2]} />
          {dark}
        </mesh>
      ))}
    </group>
  );
}
