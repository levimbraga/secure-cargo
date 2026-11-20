"use client";

import { useEffect, useMemo } from "react";
import { BoxGeometry, CanvasTexture, ExtrudeGeometry, RepeatWrapping, Shape, SRGBColorSpace } from "three";

import type { KeyframesDoc } from "@/lib/keyframes";

import { COLOR, type ViewMode } from "./shared";

type Bed = KeyframesDoc["bed"];

const WHEEL_RADIUS = 0.5;

/** Position of the axles along the truck, relative to the middle of the bed [m]. */
export function axlePositions(bed: Bed): { front: number; rear: number } {
  return { front: bed.length_m / 2 + 0.9, rear: -bed.length_m / 2 + 2.3 };
}

/**
 * Wheels and axles. They are drawn apart from the body because the body dips and rolls on
 * its suspension while the wheels stay on the road.
 */
export function Wheels({ bed, mode }: { bed: Bed; mode: ViewMode }) {
  const { front, rear } = axlePositions(bed);
  const half = bed.width_m / 2;
  const wheels = [
    { x: front, z: half - 0.17, width: 0.3 },
    { x: rear, z: half - 0.3, width: 0.58 },
  ];
  const realistic = mode === "realistic";

  return (
    <group position={[0, WHEEL_RADIUS, 0]}>
      {wheels.flatMap((wheel) =>
        [-wheel.z, wheel.z].map((z) => (
          <group key={`${wheel.x}:${z}`} position={[wheel.x, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow={realistic}>
              <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, wheel.width, 36]} />
              {realistic ? (
                <meshStandardMaterial color={COLOR.tire} roughness={0.92} />
              ) : (
                <meshLambertMaterial color="#55554f" transparent opacity={0.55} />
              )}
            </mesh>
            {realistic && (
              <mesh>
                <cylinderGeometry args={[0.27, 0.27, wheel.width + 0.02, 24]} />
                <meshStandardMaterial color="#a9acad" metalness={0.85} roughness={0.35} />
              </mesh>
            )}
          </group>
        )),
      )}
      {realistic &&
        [front, rear].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, bed.width_m - 0.5, 12]} />
            <meshStandardMaterial color={COLOR.chassis} roughness={0.6} metalness={0.5} />
          </mesh>
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
  return mode === "realistic" ? <RealisticBody bed={bed} /> : <EngineeringBody bed={bed} />;
}

function EngineeringBody({ bed }: { bed: Bed }) {
  const { length_m: length, width_m: width, headboard_height_m: headboard } = bed;
  return (
    <group>
      <Slab size={[length, 0.14, width]} position={[0, -0.07, 0]} color="#aeb2b6" opacity={0.9} />
      {headboard > 0 && (
        <Slab size={[0.1, headboard, width]} position={[length / 2 + 0.05, headboard / 2, 0]} color="#aeb2b6" opacity={0.55} />
      )}
      <Slab size={[1.9, 2.2, width]} position={[length / 2 + 1.2, 0.55, 0]} color="#d9d9d3" opacity={0.35} />
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
  const { length_m: length, width_m: width, headboard_height_m: headboard } = bed;
  const front = length / 2;
  const deck = useMemo(() => {
    const texture = deckTexture();
    texture.repeat.set(length / 2.4, 1);
    return texture;
  }, [length]);
  useEffect(() => () => deck.dispose(), [deck]);

  // Side profile of a cab-over cab: flat front, raked windscreen, rounded roof edge.
  const cab = useMemo(() => {
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
  useEffect(() => () => cab.dispose(), [cab]);

  const paint = <meshStandardMaterial color="#eeeeea" metalness={0.15} roughness={0.32} />;
  const dark = <meshStandardMaterial color={COLOR.chassis} metalness={0.5} roughness={0.55} />;
  const glass = <meshStandardMaterial color="#1c2226" metalness={0.9} roughness={0.08} />;
  const cabX = front + 0.32;
  const cabY = -0.62;

  return (
    <group>
      {/* Deck: wooden planks on a steel frame. Its top is the bed floor of the simulation. */}
      <mesh position={[0, -0.03, 0]} receiveShadow castShadow>
        <boxGeometry args={[length, 0.06, width]} />
        <meshStandardMaterial map={deck} roughness={0.82} />
      </mesh>
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[length + 0.04, 0.12, width + 0.04]} />
        <meshStandardMaterial color="#8d9194" metalness={0.7} roughness={0.45} />
      </mesh>
      {/* Lashing rail along both sides of the deck. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, -0.06, side * (width / 2 + 0.04)]}>
          <boxGeometry args={[length, 0.05, 0.04]} />
          {dark}
        </mesh>
      ))}
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
      {/* Chassis rails, fuel tank and rear bumper. */}
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[0.9, -0.34, z]} castShadow>
          <boxGeometry args={[length + 1.9, 0.28, 0.1]} />
          {dark}
        </mesh>
      ))}
      <mesh position={[front - 1.6, -0.5, width / 2 - 0.42]} rotation={[0, 0, Math.PI / 2]} castShadow>
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
      {/* Cab. */}
      <group position={[cabX, cabY, 0]}>
        <mesh geometry={cab} castShadow receiveShadow>
          {paint}
        </mesh>
        {/* Windscreen, following the rake of the profile. */}
        <mesh position={[1.795, 1.63, 0]} rotation={[0, 0, 0.281]}>
          <boxGeometry args={[0.03, 0.86, width - 0.5]} />
          {glass}
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[1.05, 1.66, side * (width / 2 - 0.02)]}>
            <boxGeometry args={[1.0, 0.72, 0.03]} />
            {glass}
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
    </group>
  );
}
