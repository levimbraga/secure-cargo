"use client";

import { useEffect, useMemo } from "react";
import { DoubleSide, ExtrudeGeometry, LatheGeometry, Shape, Vector2 } from "three";

import type { TruckLayout } from "@/lib/scene/truck-geometry";

import { COLOR } from "./shared";

/** Height of the cab's floor above the road [m]. */
export const CAB_BOTTOM_M = 0.55;

const PAINT = { color: "#f2f2ee", metalness: 0.1, roughness: 0.35 } as const;
const TRIM = { color: "#3a3d40", metalness: 0.2, roughness: 0.6 } as const;
const GLASS = { color: "#20282e", metalness: 0.6, roughness: 0.12 } as const;
const CHROME = { color: "#cfd3d6", metalness: 0.6, roughness: 0.25 } as const;
const LAMP = { color: "#f6f3e8", emissive: "#f6f3e8", emissiveIntensity: 0.3, roughness: 0.2 } as const;
const AMBER = { color: COLOR.amber, emissive: COLOR.amber, emissiveIntensity: 0.3, roughness: 0.3 } as const;

/**
 * A closed side profile (x forward, y up, in metres) extruded across the truck, centred on it,
 * with softened edges.
 */
function useProfile(points: [number, number][], depth: number, bevel = 0.04) {
  const key = JSON.stringify(points);
  const geometry = useMemo(() => {
    const parsed = JSON.parse(key) as [number, number][];
    const shape = new Shape(parsed.map(([x, y]) => new Vector2(x, y)));
    const extruded = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8 });
    extruded.translate(0, 0, -depth / 2);
    return extruded;
  }, [key, depth, bevel]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** A mudguard over a wheel: the upper half of a thin open cylinder across the truck. */
export function Fender({ x, y, z, radius, width, color = TRIM.color }: { x: number; y: number; z: number; radius: number; width: number; color?: string }) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[radius, radius, width, 20, 1, true, -Math.PI / 2, Math.PI]} />
      <meshStandardMaterial color={color} roughness={0.6} side={DoubleSide} />
    </mesh>
  );
}

/** The dark wheel well painted on a cab's side over a wheel. */
function WheelWell({ x, y, z, radius }: { x: number; y: number; z: number; radius: number }) {
  return (
    <mesh position={[x, y, z]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
      <circleGeometry args={[radius, 24, 0, Math.PI]} />
      <meshStandardMaterial color="#1b1c1d" roughness={0.9} />
    </mesh>
  );
}

function steerAxle(layout: TruckLayout) {
  return layout.axles.find((axle) => axle.group === "steer") ?? layout.axles[0];
}

/**
 * A cab-over cab (Brazilian and European trucks): flat front, raked windscreen, rounded roof,
 * the steer wheels in arches under the doors. A tractor pulling a closed body gets a roof
 * deflector up to the body's height.
 */
export function CabOver({ layout, width, ground, deflectorTop }: { layout: TruckLayout; width: number; ground: number; deflectorTop: number | null }) {
  const { cab, wheelRadius } = layout;
  const back = cab.front - cab.length;
  const bottom = ground + CAB_BOTTOM_M;
  const top = ground + cab.height;
  const h = top - bottom;
  const at = (k: number) => bottom + h * k;
  const L = cab.length;
  const f = cab.front;
  // Side profile, as fractions of the cab's height and absolute lengths from its front.
  const body = useProfile(
    [
      [back, bottom],
      [f - 0.08, bottom],
      [f, at(0.1)],
      [f, at(0.5)],
      [f - 0.06, at(0.56)],
      [f - 0.26, at(0.9)],
      [f - 0.4, at(0.99)],
      [f - 0.55, at(1)],
      [back + 0.1, at(1)],
      [back, at(0.97)],
    ],
    width - 0.2,
    0.03,
  );
  const deflector = useProfile(
    deflectorTop !== null && deflectorTop > top + 0.2
      ? [
          [back + 0.05, top - 0.02],
          [f - 0.55, top - 0.02],
          [back + 0.25, deflectorTop],
          [back + 0.05, deflectorTop],
        ]
      : [
          [0, 0],
          [0.01, 0],
          [0, 0.01],
        ],
    width - 0.5,
    0.04,
  );
  const steer = steerAxle(layout);
  const half = width / 2;
  // Windscreen on the rake between the front face and the roof.
  const rake = Math.atan2(at(0.9) - at(0.56), 0.2);
  return (
    <group>
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial {...PAINT} />
      </mesh>
      {deflectorTop !== null && deflectorTop > top + 0.2 && (
        <mesh geometry={deflector} castShadow>
          <meshStandardMaterial {...PAINT} />
        </mesh>
      )}
      <mesh position={[f - 0.13, at(0.73), 0]} rotation={[0, 0, Math.PI / 2 - rake]}>
        <boxGeometry args={[0.02, Math.hypot(0.2, at(0.9) - at(0.56)) * 0.92, width - 0.45]} />
        <meshStandardMaterial {...GLASS} />
      </mesh>
      {/* Sun visor over the windscreen. */}
      <mesh position={[f - 0.27, at(0.93), 0]} castShadow>
        <boxGeometry args={[0.22, 0.04, width - 0.3]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {/* Door windows, door seams and the steps below the doors. */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[f - 0.32 - L * 0.17, at(0.72), s * (half - 0.06)]}>
            <boxGeometry args={[L * 0.36, h * 0.27, 0.02]} />
            <meshStandardMaterial {...GLASS} />
          </mesh>
          <mesh position={[f - 0.12 - L * 0.42, at(0.45), s * (half - 0.065)]} userData={{ fine: true }}>
            <boxGeometry args={[0.012, h * 0.82, 0.01]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
          {[0.14, 0.36].map((y) => (
            <mesh key={y} position={[f - 0.12 - L * 0.21, ground + y, s * (half - 0.12)]} castShadow>
              <boxGeometry args={[L * 0.3, 0.035, 0.26]} />
              <meshStandardMaterial {...TRIM} />
            </mesh>
          ))}
          {/* Mirror on its arm. */}
          <mesh position={[f - 0.22, at(0.72), s * (half + 0.12)]} userData={{ fine: true }}>
            <boxGeometry args={[0.03, 0.03, 0.26]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
          <mesh position={[f - 0.2, at(0.65), s * (half + 0.26)]} castShadow>
            <boxGeometry args={[0.06, h * 0.22, 0.16]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
          {steer && (
            <>
              <WheelWell x={steer.x} y={ground + wheelRadius} z={s * (half - 0.065)} radius={wheelRadius + 0.08} />
              <Fender x={steer.x} y={ground + wheelRadius} z={s * (half - 0.16)} radius={wheelRadius + 0.08} width={0.36} />
            </>
          )}
          {/* Head and corner lights. */}
          <mesh position={[f + 0.04, at(0.17), s * (half - 0.38)]}>
            <boxGeometry args={[0.03, 0.15, 0.36]} />
            <meshStandardMaterial {...LAMP} />
          </mesh>
          <mesh position={[f + 0.035, at(0.17), s * (half - 0.14)]}>
            <boxGeometry args={[0.03, 0.15, 0.12]} />
            <meshStandardMaterial {...AMBER} />
          </mesh>
        </group>
      ))}
      {/* Grille with its slats, and the bumper. */}
      <mesh position={[f + 0.04, at(0.32), 0]}>
        <boxGeometry args={[0.02, h * 0.2, width - 1.1]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {[0.27, 0.32, 0.37].map((k) => (
        <mesh key={k} position={[f + 0.055, at(k), 0]} userData={{ fine: true }}>
          <boxGeometry args={[0.015, 0.025, width - 1.14]} />
          <meshStandardMaterial {...CHROME} />
        </mesh>
      ))}
      <mesh position={[f - 0.04, ground + 0.42, 0]} castShadow>
        <boxGeometry args={[0.2, 0.3, width - 0.02]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {/* Marker lights on the roof. */}
      {[-0.3, -0.1, 0.1, 0.3].map((k) => (
        <mesh key={k} position={[f - 0.5, top + 0.03, k * width]} userData={{ fine: true }}>
          <boxGeometry args={[0.06, 0.04, 0.08]} />
          <meshStandardMaterial {...AMBER} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A conventional US tractor: a long hood over the steer axle with its fenders and grille, the
 * cab, then a sleeper whose roof fairing rises to the catalog's height; fuel tanks, steps and
 * exhaust stacks.
 */
export function ConventionalCab({ layout, width, ground }: { layout: TruckLayout; width: number; ground: number }) {
  const { cab, wheelRadius } = layout;
  const hood = Math.min(1.9, cab.length * 0.42);
  const cabin = Math.min(1.4, cab.length - hood);
  const sleeper = Math.max(cab.length - hood - cabin, 0);
  const x0 = cab.front;
  const g = (y: number) => ground + y;
  const roof = 3.0;
  const top = Math.max(cab.height, roof + 0.2);
  const s0 = x0 - hood - cabin;
  const back = s0 - sleeper;
  const half = width / 2;
  const hoodGeometry = useProfile(
    [
      [x0 - hood - 0.05, g(0.85)],
      [x0 - 0.02, g(0.85)],
      [x0 - 0.02, g(1.62)],
      [x0 - 0.12, g(1.84)],
      [x0 - hood * 0.6, g(1.97)],
      [x0 - hood - 0.05, g(2.04)],
    ],
    width - 0.72,
    0.06,
  );
  const cabGeometry = useProfile(
    [
      [s0, g(CAB_BOTTOM_M + 0.2)],
      [x0 - hood, g(CAB_BOTTOM_M + 0.2)],
      [x0 - hood, g(2.06)],
      [x0 - hood - 0.48, g(roof - 0.04)],
      [x0 - hood - 0.62, g(roof)],
      [s0, g(roof)],
    ],
    width - 0.16,
    0.05,
  );
  const sleeperGeometry = useProfile(
    sleeper > 0
      ? [
          [back, g(CAB_BOTTOM_M + 0.2)],
          [s0 + 0.02, g(CAB_BOTTOM_M + 0.2)],
          [s0 + 0.02, g(roof - 0.05)],
          [x0 - hood - 0.62, g(roof - 0.01)],
          [s0 + 0.35, g(top - 0.12)],
          [s0 + 0.05, g(top)],
          [back + 0.1, g(top)],
          [back, g(top - 0.1)],
        ]
      : [
          [0, 0],
          [0.01, 0],
          [0, 0.01],
        ],
    width - 0.16,
    0.05,
  );
  const steer = steerAxle(layout);
  const drive = layout.axles.filter((axle) => axle.group === "drive");
  const tankFront = steer ? steer.x - wheelRadius - 0.25 : x0 - hood - 0.3;
  const tankBack = drive.length ? Math.max(...drive.map((axle) => axle.x)) + wheelRadius + 0.2 : back;
  const tankLength = Math.max(Math.min(tankFront - tankBack, 1.4), 0.4);
  const windscreen = Math.atan2(roof - 0.04 - 2.06, 0.48);

  return (
    <group>
      <mesh geometry={hoodGeometry} castShadow receiveShadow>
        <meshStandardMaterial {...PAINT} />
      </mesh>
      <mesh geometry={cabGeometry} castShadow receiveShadow>
        <meshStandardMaterial {...PAINT} />
      </mesh>
      {sleeper > 0 && (
        <mesh geometry={sleeperGeometry} castShadow receiveShadow>
          <meshStandardMaterial {...PAINT} />
        </mesh>
      )}
      {/* Grille, bumper, headlights. */}
      <mesh position={[x0 + 0.05, g(1.24), 0]}>
        <boxGeometry args={[0.04, 0.78, 1.08]} />
        <meshStandardMaterial {...CHROME} />
      </mesh>
      <mesh position={[x0 + 0.07, g(1.24), 0]}>
        <boxGeometry args={[0.02, 0.66, 0.94]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {[0.98, 1.1, 1.22, 1.34, 1.46].map((y) => (
        <mesh key={y} position={[x0 + 0.085, g(y), 0]} userData={{ fine: true }}>
          <boxGeometry args={[0.015, 0.025, 0.92]} />
          <meshStandardMaterial {...CHROME} />
        </mesh>
      ))}
      <mesh position={[x0 + 0.08, g(0.62), 0]} castShadow>
        <boxGeometry args={[0.22, 0.32, width + 0.02]} />
        <meshStandardMaterial {...CHROME} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s}>
          {steer && <Fender x={steer.x} y={ground + wheelRadius} z={s * (half - 0.2)} radius={wheelRadius + 0.1} width={0.46} color={PAINT.color} />}
          <mesh position={[x0 - 0.12, g(1.42), s * (half - 0.36)]}>
            <boxGeometry args={[0.24, 0.16, 0.28]} />
            <meshStandardMaterial {...LAMP} />
          </mesh>
          {/* Side windows, mirror, steps, fuel tank, exhaust stack. */}
          <mesh position={[x0 - hood - cabin / 2 - 0.1, g(2.45), s * (half - 0.02)]}>
            <boxGeometry args={[cabin * 0.62, 0.6, 0.03]} />
            <meshStandardMaterial {...GLASS} />
          </mesh>
          <mesh position={[x0 - hood - 0.08, g(2.25), s * (half + 0.22)]} castShadow>
            <boxGeometry args={[0.07, 0.62, 0.2]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
          <mesh position={[x0 - hood - 0.04, g(2.0), s * (half + 0.08)]} userData={{ fine: true }}>
            <boxGeometry args={[0.03, 0.03, 0.26]} />
            <meshStandardMaterial {...CHROME} />
          </mesh>
          {[0.42, 0.72].map((y) => (
            <mesh key={y} position={[x0 - hood - cabin / 2, g(y), s * (half - 0.14)]} castShadow>
              <boxGeometry args={[0.5, 0.04, 0.26]} />
              <meshStandardMaterial {...CHROME} />
            </mesh>
          ))}
          <mesh position={[tankBack + tankLength / 2, g(0.72), s * (half - 0.32)]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.31, 0.31, tankLength, 24]} />
            <meshStandardMaterial {...CHROME} />
          </mesh>
          <mesh position={[back - 0.08, g((1.3 + top + 0.45) / 2), s * (half - 0.14)]} castShadow>
            <cylinderGeometry args={[0.065, 0.065, top + 0.45 - 1.3, 12]} />
            <meshStandardMaterial {...CHROME} />
          </mesh>
          {/* A dark skirt under the cab and the sleeper. */}
          <mesh position={[(s0 + back) / 2 + cabin / 2, g(CAB_BOTTOM_M + 0.28), s * (half - 0.06)]} userData={{ fine: true }}>
            <boxGeometry args={[cabin + sleeper, 0.16, 0.02]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
        </group>
      ))}
      {/* Windscreen on the cab's rake, sun visor and roof marker lights. */}
      <mesh position={[x0 - hood - 0.2, g(2.54), 0]} rotation={[0, 0, Math.PI / 2 - windscreen]}>
        <boxGeometry args={[0.02, Math.hypot(0.48, roof - 2.1) * 0.9, width - 0.5]} />
        <meshStandardMaterial {...GLASS} />
      </mesh>
      <mesh position={[x0 - hood - 0.56, g(roof + 0.03), 0]} castShadow>
        <boxGeometry args={[0.24, 0.05, width - 0.3]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {[-0.3, -0.15, 0, 0.15, 0.3].map((k) => (
        <mesh key={k} position={[x0 - hood - 0.5, g(roof + 0.08), k * width]} userData={{ fine: true }}>
          <boxGeometry args={[0.06, 0.05, 0.08]} />
          <meshStandardMaterial {...AMBER} />
        </mesh>
      ))}
    </group>
  );
}

/** A tyre's cross-section, turned about the axle: rounded shoulders, sidewalls down to the rim. */
export function useTyre(radius: number, width: number) {
  const geometry = useMemo(() => {
    const rim = radius * 0.6;
    const w = width / 2;
    const shoulder = Math.min(0.06, w * 0.4);
    const points = [
      new Vector2(rim, -w + 0.01),
      new Vector2(radius - shoulder, -w),
      new Vector2(radius - shoulder * 0.3, -w + shoulder * 0.3),
      new Vector2(radius, -w + shoulder),
      new Vector2(radius, w - shoulder),
      new Vector2(radius - shoulder * 0.3, w - shoulder * 0.3),
      new Vector2(radius - shoulder, w),
      new Vector2(rim, w - 0.01),
    ];
    return new LatheGeometry(points, 32);
  }, [radius, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}
