"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CylinderGeometry,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  displacement,
  distanceAt,
  type KeyframesDoc,
  type Sample,
  sampleFrame,
  strapPath,
  toThreePosition,
  toThreeQuaternion,
  type Vec3,
} from "@/lib/keyframes";

/** Scene colors. They mirror the design tokens in app/globals.css. */
const COLOR = {
  ink: "#191918",
  paper: "#f8f8f3",
  surface: "#e9e9e4",
  hairline: "#c9c9c1",
  amber: "#f2a100",
  fail: "#b42318",
  wood: "#d3bb93",
  steel: "#c4c4bc",
  chassis: "#3a3a37",
  tire: "#4a4a46",
  chain: "#5b5b57",
  rope: "#b08d57",
} as const;

/** Pushes filled faces slightly back so the edge lines drawn on top of them stay solid. */
const BEHIND_EDGES = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

/** Seconds the last frame is held before the replay loops. */
const HOLD_S = 1.2;
/** A unit that moved more than this is drawn as failed. */
const MOVED_M = 0.05;

export type CameraView = "hero" | "side" | "rear" | "top";

const VIEW_DIRECTION: Record<CameraView, Vec3> = {
  hero: [-0.42, 0.4, 1],
  side: [0, 0.16, 1],
  rear: [-1, 0.5, 0.62],
  top: [-0.12, 1, 0.35],
};

type Clock = { t: number; playing: boolean; sample: Sample };

export type KeyframePlayerProps = {
  doc: KeyframesDoc;
  /** Render frames only while the scene is on screen. */
  active?: boolean;
  /** Start playing on mount and loop. When false, the first frame is shown until a replay. */
  autoPlay?: boolean;
  /** Change this value to restart the replay from the first frame. */
  replayToken?: number;
  view?: CameraView;
  /** Called once the WebGL canvas exists. */
  onReady?: () => void;
  /** Called when the visitor starts to orbit the camera. */
  onInteract?: () => void;
  /** When set, the scene shows this time (seconds) instead of running its own clock. */
  controlledTime?: RefObject<number>;
  /** Keep the last frame readable from the canvas, for captures. */
  capture?: boolean;
};

/** Replays a keyframes document as a 3D scene of a flatbed truck. */
export default function KeyframePlayer({
  doc,
  active = true,
  autoPlay = true,
  replayToken = 0,
  view = "hero",
  onReady,
  onInteract,
  controlledTime,
  capture = false,
}: KeyframePlayerProps) {
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: capture }}
      camera={{ fov: 30, near: 0.5, far: 120 }}
      onCreated={() => onReady?.()}
      // OrbitControls turns touch gestures off on the canvas; this class keeps vertical page
      // scrolling (see `.scene-canvas` in globals.css).
      className="scene-canvas"
    >
      <ambientLight intensity={1.9} />
      <directionalLight position={[-5, 9, 6]} intensity={2.3} />
      <Replay
        doc={doc}
        autoPlay={autoPlay}
        replayToken={replayToken}
        controlledTime={controlledTime}
        view={view}
        onInteract={onInteract}
      />
    </Canvas>
  );
}

function Replay({
  doc,
  autoPlay,
  replayToken,
  controlledTime,
  view,
  onInteract,
}: Required<Pick<KeyframePlayerProps, "doc" | "autoPlay" | "replayToken" | "view">> &
  Pick<KeyframePlayerProps, "controlledTime" | "onInteract">) {
  const clock = useRef<Clock>({ t: 0, playing: autoPlay, sample: sampleFrame(doc, 0) });
  const firstRun = useRef(true);

  // Restart on a new document or an explicit replay.
  useEffect(() => {
    clock.current.t = 0;
    clock.current.playing = firstRun.current ? autoPlay : true;
    clock.current.sample = sampleFrame(doc, 0);
    firstRun.current = false;
  }, [doc, replayToken, autoPlay]);

  useFrame((_, delta) => {
    const state = clock.current;
    if (controlledTime) {
      state.t = controlledTime.current;
    } else if (state.playing) {
      state.t += Math.min(delta, 0.1);
      if (state.t > doc.duration_s + HOLD_S) {
        if (autoPlay) state.t = 0;
        else state.playing = false;
      }
    }
    state.sample = sampleFrame(doc, Math.min(state.t, doc.duration_s));
  });

  return (
    <>
      <CameraRig view={view} onInteract={onInteract} />
      <Road doc={doc} clock={clock} />
      <group position={[0, doc.bed.floor_height_m, 0]}>
        <Truck bed={doc.bed} />
        <Straps doc={doc} clock={clock} />
        <Units doc={doc} clock={clock} />
      </group>
    </>
  );
}

/** The camera looks at a point just above the middle of the truck. */
const TARGET: Vec3 = [0.7, 1.35, 0];
/** Camera distance per view at a 16:10 frame, chosen so the truck fills most of it. */
const VIEW_DISTANCE: Record<CameraView, number> = { hero: 11.4, side: 12.4, rear: 12, top: 13.5 };

function CameraRig({ view, onInteract }: { view: CameraView; onInteract?: () => void }) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const aspect = useThree((state) => state.size.width / state.size.height);
  const controls = useRef<OrbitControls | null>(null);
  const touched = useRef(false);

  // Frame the whole truck: narrower viewports need the camera further away.
  useEffect(() => {
    if (touched.current) return;
    const distance = VIEW_DISTANCE[view] * Math.max(1, 1.6 / aspect);
    const direction = new Vector3(...VIEW_DIRECTION[view]).normalize();
    camera.position.set(
      TARGET[0] + direction.x * distance,
      TARGET[1] + direction.y * distance,
      TARGET[2] + direction.z * distance,
    );
    camera.lookAt(...TARGET);
    controls.current?.update();
  }, [aspect, camera, view]);

  useEffect(() => {
    const orbit = new OrbitControls(camera, canvas);
    orbit.target.set(...TARGET);
    orbit.enablePan = false;
    orbit.enableZoom = false; // the page keeps the scroll wheel
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.rotateSpeed = 0.6;
    orbit.minPolarAngle = 0.35;
    orbit.maxPolarAngle = 1.5; // never below the road
    const onStart = () => {
      touched.current = true;
      onInteract?.();
    };
    orbit.addEventListener("start", onStart);
    orbit.update();
    controls.current = orbit;
    return () => {
      orbit.removeEventListener("start", onStart);
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, canvas, onInteract]);

  useFrame(() => controls.current?.update());
  return null;
}

/** Box mesh with ink edges: the flat, drawn look of the scene. */
function OutlinedBox({
  size,
  color,
  position,
  edgeColor = COLOR.ink,
}: {
  size: Vec3;
  color: string;
  position?: Vec3;
  edgeColor?: string;
}) {
  const geometry = useMemo(() => new BoxGeometry(...size), [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position}>
      <meshLambertMaterial color={color} {...BEHIND_EDGES} />
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={edgeColor} />
      </lineSegments>
    </mesh>
  );
}

/**
 * A two-axle rigid truck drawn around the simulated bed. Only the bed and the headboard take
 * part in the simulation; cab, chassis and wheels are there to show which way is forward.
 */
function Truck({ bed }: { bed: KeyframesDoc["bed"] }) {
  const { length_m: length, width_m: width, floor_height_m: floorHeight } = bed;
  const front = length / 2;
  const wheelRadius = 0.5;
  const single = useMemo(() => new CylinderGeometry(wheelRadius, wheelRadius, 0.3, 32), []);
  const dual = useMemo(() => new CylinderGeometry(wheelRadius, wheelRadius, 0.56, 32), []);
  useEffect(
    () => () => {
      single.dispose();
      dual.dispose();
    },
    [single, dual],
  );

  const wheelY = wheelRadius - floorHeight;
  // Front axle under the cab, rear axle (dual tyres) under the rear third of the bed.
  const wheels = [
    { x: front + 0.9, z: width / 2 - 0.17, geometry: single },
    { x: -front + 2.3, z: width / 2 - 0.3, geometry: dual },
  ];

  return (
    <group>
      {/* Bed floor and headboard */}
      <OutlinedBox size={[length, 0.14, width]} color={COLOR.steel} position={[0, -0.07, 0]} />
      {bed.headboard_height_m > 0 && (
        <OutlinedBox
          size={[0.1, bed.headboard_height_m, width]}
          color={COLOR.steel}
          position={[front + 0.05, bed.headboard_height_m / 2, 0]}
        />
      )}
      {/* Chassis rail */}
      <OutlinedBox
        size={[length + 1.5, 0.22, 0.9]}
        color={COLOR.chassis}
        position={[0.75, -0.26, 0]}
      />
      {/* Cab */}
      <OutlinedBox size={[1.9, 2.2, width]} color={COLOR.paper} position={[front + 1.2, 0.55, 0]} />
      <OutlinedBox
        size={[0.8, 0.75, width + 0.02]}
        color={COLOR.surface}
        position={[front + 1.6, 1.1, 0]}
      />
      {/* Wheels */}
      {wheels.flatMap((wheel) =>
        [-wheel.z, wheel.z].map((z) => (
          <mesh
            key={`${wheel.x}:${z}`}
            geometry={wheel.geometry}
            position={[wheel.x, wheelY, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <meshLambertMaterial color={COLOR.tire} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Units({ doc, clock }: { doc: KeyframesDoc; clock: RefObject<Clock> }) {
  const groups = useRef<(Group | null)[]>([]);
  const edges = useRef<(LineBasicMaterial | null)[]>([]);
  const failing = useMemo(
    () => doc.units.map((unit) => doc.result.status === "fail" && doc.result.unit_ids.includes(unit.id)),
    [doc],
  );

  useFrame(() => {
    const { sample } = clock.current;
    for (const [index, unit] of sample.units.entries()) {
      const group = groups.current[index];
      if (!group) continue;
      group.position.set(...toThreePosition(unit.p));
      group.quaternion.set(...toThreeQuaternion(unit.q));
      const moved = failing[index] && displacement(doc, sample, index) > MOVED_M;
      edges.current[index]?.color.set(moved ? COLOR.fail : COLOR.ink);
    }
  });

  return (
    <>
      {doc.units.map((unit, index) => (
        <group
          key={unit.id}
          ref={(node) => {
            groups.current[index] = node;
          }}
        >
          <UnitBox
            size={unit.size_m}
            edgeRef={(node) => {
              edges.current[index] = node;
            }}
          />
        </group>
      ))}
    </>
  );
}

function UnitBox({
  size,
  edgeRef,
}: {
  size: Vec3;
  edgeRef: (node: LineBasicMaterial | null) => void;
}) {
  // Simulation sizes are [x, y, z] with Z up; three.js boxes are [x, y-up, z].
  const geometry = useMemo(() => new BoxGeometry(size[0], size[2], size[1]), [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial color={COLOR.wood} {...BEHIND_EDGES} />
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial ref={edgeRef} color={COLOR.ink} />
      </lineSegments>
    </mesh>
  );
}

const LASHING_COLOR = { strap: COLOR.amber, chain: COLOR.chain, rope: COLOR.rope } as const;
const Y_AXIS = new Vector3(0, 1, 0);

/**
 * Lashings follow their unit: each one is a chain of thin cylinders between the points of its
 * path, repositioned every frame. Straps are the only amber objects in the scene.
 */
function Straps({ doc, clock }: { doc: KeyframesDoc; clock: RefObject<Clock> }) {
  const segment = useMemo(() => new CylinderGeometry(0.028, 0.028, 1, 6), []);
  useEffect(() => () => segment.dispose(), [segment]);
  const meshes = useRef<(Mesh | null)[][]>([]);
  const scratch = useMemo(() => ({ from: new Vector3(), to: new Vector3(), along: new Vector3() }), []);

  useFrame(() => {
    const { sample } = clock.current;
    for (let index = 0; index < doc.straps.length; index++) {
      const path = strapPath(doc, sample, index);
      const segments = meshes.current[index] ?? [];
      for (let part = 0; part < segments.length; part++) {
        const mesh = segments[part];
        const start = path[part];
        const end = path[part + 1];
        if (!mesh || !start || !end) continue;
        scratch.from.set(...toThreePosition(start));
        scratch.to.set(...toThreePosition(end));
        scratch.along.subVectors(scratch.to, scratch.from);
        const length = scratch.along.length();
        mesh.position.copy(scratch.from).addScaledVector(scratch.along, 0.5);
        mesh.scale.set(1, Math.max(length, 1e-6), 1);
        mesh.quaternion.setFromUnitVectors(Y_AXIS, scratch.along.normalize());
      }
    }
  });

  return (
    <>
      {doc.straps.map((strap, index) => (
        <group key={strap.id}>
          {strap.path_m.slice(1).map((_, part) => (
            <mesh
              key={part}
              geometry={segment}
              ref={(node) => {
                (meshes.current[index] ??= [])[part] = node;
              }}
            >
              <meshBasicMaterial color={LASHING_COLOR[strap.kind ?? "strap"]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

const DASH_SPACING = 6;
const DASH_COUNT = 9;

/** Lane markings that move under the truck, so braking reads as the road slowing down. */
function Road({ doc, clock }: { doc: KeyframesDoc; clock: RefObject<Clock> }) {
  const group = useRef<Group>(null);

  useFrame(() => {
    if (!group.current) return;
    const travelled = distanceAt(doc, Math.min(clock.current.t, doc.duration_s));
    group.current.position.x = -(travelled % DASH_SPACING);
  });

  const dashes = useMemo(() => {
    const items: { key: string; position: Vec3 }[] = [];
    for (let i = 0; i < DASH_COUNT; i++) {
      const x = (i - Math.floor(DASH_COUNT / 2)) * DASH_SPACING + 1;
      for (const z of [-3.1, 3.1]) items.push({ key: `${i}:${z}`, position: [x, 0.005, z] });
    }
    return items;
  }, []);

  return (
    <group ref={group}>
      {dashes.map((dash) => (
        <mesh key={dash.key} position={dash.position}>
          <boxGeometry args={[2.4, 0.01, 0.14]} />
          <meshBasicMaterial color={COLOR.hairline} />
        </mesh>
      ))}
    </group>
  );
}
