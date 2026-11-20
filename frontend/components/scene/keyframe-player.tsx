"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import { type Group, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { type KeyframesDoc, sampleFrame, type Vec3 } from "@/lib/keyframes";
import { GRAVITY, type Impact, type Series, seriesAt } from "@/lib/replay";

import { AxisTriad, Units } from "./cargo";
import { Lighting, Road } from "./environment";
import { Contacts, ForceArrows, ImpactFlash, type LabelFormat, Labels, Lashings } from "./forces";
import type { Live, ViewMode } from "./shared";
import { TruckBody, Wheels } from "./truck";

export type CameraView = "hero" | "side" | "rear" | "top";
export type { LabelFormat, ViewMode };

const VIEW_DIRECTION: Record<CameraView, Vec3> = {
  hero: [-0.42, 0.4, 1],
  side: [0, 0.16, 1],
  rear: [-1, 0.5, 0.62],
  top: [-0.12, 1, 0.35],
};
/** The camera looks at a point just above the middle of the truck. */
const TARGET: Vec3 = [0.7, 1.35, 0];
/** Camera distance per view at a 16:10 frame, chosen so the truck fills most of it. */
const VIEW_DISTANCE: Record<CameraView, number> = { hero: 11.4, side: 12.4, rear: 12, top: 13.5 };

/** How the body of the truck answers the acceleration of the event; all of it is visual only. */
const PITCH_RAD_PER_G = 0.035; // nose dips two degrees per g of braking
const ROLL_RAD_PER_G = 0.07; // body leans four degrees per g sideways
const CAMERA_LAG_M_PER_G = 0.45; // the camera falls behind a truck that brakes
const RESPONSE_S = 0.14; // time constant of the suspension and of the camera

export type KeyframePlayerProps = {
  doc: KeyframesDoc;
  series: Series;
  impacts: Impact[];
  /** Replay time in seconds, written by the page; the scene reads it every frame. */
  time: RefObject<number>;
  mode: ViewMode;
  view?: CameraView;
  /** Element over the canvas that receives the text labels. */
  overlay: RefObject<HTMLDivElement | null>;
  format: LabelFormat;
  /** Render frames only while the scene is on screen. */
  active?: boolean;
  /** Keep the last frame readable from the canvas, for captures. */
  capture?: boolean;
};

/** Replays a keyframes document as a 3D scene of a flatbed truck. */
export default function KeyframePlayer({
  doc,
  series,
  impacts,
  time,
  mode,
  view = "hero",
  overlay,
  format,
  active = true,
  capture = false,
}: KeyframePlayerProps) {
  const realistic = mode === "realistic";

  return (
    <Canvas
      // The two views use different renderer settings: start a fresh canvas for each.
      key={mode}
      // ACES tone mapping and soft shadows for the realistic view; plain colours otherwise.
      flat={!realistic}
      shadows={realistic ? "soft" : false}
      scene={{ environmentIntensity: 0.55 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: capture }}
      camera={{ fov: 30, near: 0.5, far: 160 }}
      // OrbitControls turns touch gestures off on the canvas; this class keeps vertical page
      // scrolling (see `.scene-canvas` in globals.css).
      className="scene-canvas"
    >
      <Lighting mode={mode} />
      <CameraRig view={view} />
      <Stage doc={doc} series={series} impacts={impacts} time={time} mode={mode} overlay={overlay} format={format} />
    </Canvas>
  );
}

function Stage({
  doc,
  series,
  impacts,
  time,
  mode,
  overlay,
  format,
}: Pick<KeyframePlayerProps, "doc" | "series" | "impacts" | "time" | "mode" | "overlay" | "format">) {
  // The instant being drawn, shared by every part of the scene.
  const live = useRef<Live>({ t: 0, sample: sampleFrame(doc, 0), distance: 0, height: 0, activeStrap: -1 });
  const world = useRef<Group>(null);
  const wheels = useRef<Group>(null);
  const body = useRef<Group>(null);
  const motion = useRef({ pitch: 0, roll: 0, lag: 0 });
  const floorHeight = doc.bed.floor_height_m;

  // Runs before every other part of the scene, so they all draw the same instant.
  useFrame((_, delta) => {
    const state = live.current;
    const t = Math.min(Math.max(time.current, 0), doc.duration_s);
    state.t = t;
    state.sample = sampleFrame(doc, t);
    state.distance = seriesAt(doc, series.distance, t);
    state.height = seriesAt(doc, series.bedHeight, t);

    // Suspension and camera follow the acceleration with a short lag.
    const [ax, ay] = state.sample.bedAccel;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) / RESPONSE_S);
    const braking = -ax / GRAVITY;
    const sideways = ay / GRAVITY;
    const current = motion.current;
    current.pitch += (braking * PITCH_RAD_PER_G - current.pitch) * k;
    current.roll += (sideways * ROLL_RAD_PER_G - current.roll) * k;
    current.lag += (braking * CAMERA_LAG_M_PER_G - current.lag) * k;

    body.current?.position.setY(floorHeight + state.height);
    // Rotation about the truck's width: a negative angle lowers the front.
    body.current?.rotation.set(current.roll, 0, -current.pitch);
    wheels.current?.position.setY(state.height);
    world.current?.position.setX(current.lag);
  }, -1);

  const scene = { doc, series, impacts, live, mode };

  return (
    <>
      <group
        ref={world}
        onPointerMissed={() => {
          live.current.activeStrap = -1;
        }}
      >
        <Road live={live} mode={mode} />
        <group ref={wheels}>
          <Wheels bed={doc.bed} mode={mode} />
        </group>
        <group ref={body} position={[0, floorHeight, 0]}>
          <TruckBody bed={doc.bed} mode={mode} />
          <Units {...scene} />
          <Lashings {...scene} />
          <ForceArrows doc={doc} live={live} />
          <ImpactFlash impacts={impacts} live={live} />
          {mode === "engineering" && (
            <>
              <Contacts live={live} />
              <group position={[-doc.bed.length_m / 2, 0.02, -doc.bed.width_m / 2]}>
                <AxisTriad length={0.9} />
              </group>
            </>
          )}
        </group>
      </group>
      <Labels {...scene} overlay={overlay} format={format} anchor={body} />
    </>
  );
}

function CameraRig({ view }: { view: CameraView }) {
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
    };
    orbit.addEventListener("start", onStart);
    orbit.update();
    controls.current = orbit;
    return () => {
      orbit.removeEventListener("start", onStart);
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, canvas]);

  useFrame(() => controls.current?.update());
  return null;
}
