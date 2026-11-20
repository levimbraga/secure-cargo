"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import { type Group, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { type KeyframesDoc, type Sample, sampleFrame, type Vec3 } from "@/lib/keyframes";
import { type Quality, QUALITY_SETTINGS } from "@/lib/quality";
import { GRAVITY, type Impact, type Series, seriesAt } from "@/lib/replay";
import { useQuality } from "@/lib/use-quality";
import { usePageVisible } from "@/lib/use-scene-visibility";

import { AxisTriad, Units } from "./cargo";
import { ContactShadow, Lighting, Road } from "./environment";
import { Contacts, ForceArrows, ImpactFlash, type LabelFormat, Labels, Lashings, PushArrow } from "./forces";
import { type PushProps, useUnitPush } from "./push";
import type { Live, ViewMode } from "./shared";
import { TruckBody, Wheels } from "./truck";

export type CameraView = "hero" | "side" | "rear" | "top";
export type { LabelFormat, PushProps, Quality, ViewMode };

/**
 * The state of a model that is being stepped right now, drawn instead of the keyframes.
 * `time` is the event time it has reached [s]; it keeps growing after the end of the event.
 */
export type LiveState = { sample: Sample; time: number };

/** At most this wide [CSS px], the engineering view uses numbered markers instead of text labels. */
export const COMPACT_LABELS_MAX_WIDTH = 480;

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
  /** While playing the scene renders every frame; otherwise only when something changes. */
  playing: boolean;
  /** Changes whenever the replay time changes while paused (scrubbing), to draw a new frame. */
  revision: number;
  /** Keep the last frame readable from the canvas, for captures. */
  capture?: boolean;
  /** Rendering quality. Default: picked for this device (`useQuality`). */
  quality?: Quality;
  /**
   * Phone labelling of the engineering view: one numbered marker per unit instead of text.
   * Default: when the canvas is at most `COMPACT_LABELS_MAX_WIDTH` wide.
   */
  compactLabels?: boolean;
  /** Index of the unit whose marker is drawn as selected (its details are open), or `null`. */
  selectedUnit?: number | null;
  /** A unit marker was tapped or activated from the keyboard. Without it the markers are not buttons. */
  onSelectUnit?: (unitIndex: number) => void;
  /**
   * The live lab: a function that returns the state of the engine it is stepping, or `null`
   * to draw the keyframes at `time`. It is asked once per frame.
   */
  sampler?: RefObject<(() => LiveState | null) | null>;
  /** The live lab: pressing on a unit and dragging pushes it (see `useUnitPush`). */
  push?: PushProps;
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
  playing,
  revision,
  capture = false,
  quality,
  compactLabels,
  selectedUnit = null,
  onSelectUnit,
  sampler,
  push,
}: KeyframePlayerProps) {
  const realistic = mode === "realistic";
  // Shared by the camera and by the push: the camera stands still while a unit is dragged.
  const orbit = useRef<OrbitControls | null>(null);
  const detected = useQuality();
  const level = quality ?? detected;
  const settings = QUALITY_SETTINGS[level];
  // A hidden tab draws nothing, whatever the page asks for.
  const pageVisible = usePageVisible();
  const awake = active && pageVisible;

  return (
    <Canvas
      // The views and the quality levels use different renderer settings: a fresh canvas for each.
      key={`${mode}:${level}`}
      // ACES tone mapping for the realistic view (part of the material shaders, not a pass);
      // plain colours otherwise.
      flat={!realistic}
      // Soft shadow maps only at high quality: phones and weak GPUs get a flat contact shadow.
      shadows={realistic && settings.shadows ? "soft" : false}
      scene={{ environmentIntensity: 0.55 }}
      dpr={[1, settings.maxDpr]}
      // Idle costs nothing: frames are drawn while playing, on demand when paused, and never
      // while the scene is off screen or the tab is hidden.
      frameloop={!awake ? "never" : playing ? "always" : "demand"}
      gl={{ antialias: settings.antialias, alpha: true, preserveDrawingBuffer: capture }}
      camera={{ fov: 30, near: 0.5, far: 160 }}
      // OrbitControls turns touch gestures off on the canvas; this class keeps vertical page
      // scrolling (see `.scene-canvas` in globals.css).
      className="scene-canvas"
      data-quality={level}
    >
      <Lighting mode={mode} quality={level} />
      <CameraRig view={view} controlsRef={orbit} />
      <Stage
        doc={doc}
        series={series}
        impacts={impacts}
        time={time}
        mode={mode}
        overlay={overlay}
        format={format}
        revision={revision}
        contactShadow={realistic && !settings.shadows}
        compactLabels={compactLabels}
        selectedUnit={selectedUnit}
        onSelectUnit={onSelectUnit}
        sampler={sampler}
        push={push}
        orbit={orbit}
      />
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
  revision,
  contactShadow,
  compactLabels,
  selectedUnit,
  onSelectUnit,
  sampler,
  push,
  orbit,
}: Pick<
  KeyframePlayerProps,
  | "doc"
  | "series"
  | "impacts"
  | "time"
  | "mode"
  | "overlay"
  | "format"
  | "revision"
  | "compactLabels"
  | "selectedUnit"
  | "onSelectUnit"
  | "sampler"
  | "push"
> & {
  /** Draw the flat shadow under the truck that stands in for shadow maps. */
  contactShadow: boolean;
  orbit: RefObject<OrbitControls | null>;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const compact = compactLabels ?? width <= COMPACT_LABELS_MAX_WIDTH;
  // A new replay time, a new view or a pointer over the scene each ask for a fresh frame.
  useEffect(() => {
    invalidate();
  }, [invalidate, revision, mode, doc]);
  // The instant being drawn, shared by every part of the scene.
  const live = useRef<Live>({ t: 0, sample: sampleFrame(doc, 0), distance: 0, height: 0, activeStrap: -1 });
  const world = useRef<Group>(null);
  const wheels = useRef<Group>(null);
  const body = useRef<Group>(null);
  const motion = useRef({ pitch: 0, roll: 0, lag: 0 });
  const floorHeight = doc.bed.floor_height_m;
  // After the end of the event the truck keeps the speed it had.
  const finalSpeed = doc.frames[doc.frames.length - 1]?.truck_speed_mps ?? 0;
  const unitHandlers = useUnitPush({ doc, live, body, orbit, push });

  // Runs before every other part of the scene, so they all draw the same instant.
  useFrame((_, delta) => {
    const state = live.current;
    const t = Math.min(Math.max(time.current, 0), doc.duration_s);
    state.t = t;
    // A model stepped live is drawn as it is; otherwise the keyframes at the replay time. A
    // state left over from another model (other units or lashings) is not drawn.
    const stepped = sampler?.current?.() ?? null;
    const fits =
      stepped !== null &&
      stepped.sample.units.length === doc.units.length &&
      stepped.sample.straps.length === doc.straps.length;
    state.sample = fits ? stepped.sample : sampleFrame(doc, t);
    const beyond = fits ? Math.max(stepped.time - doc.duration_s, 0) : 0;
    state.distance = seriesAt(doc, series.distance, t) + beyond * finalSpeed;
    state.height = seriesAt(doc, series.bedHeight, t);

    // Suspension and camera follow the acceleration with a short lag.
    const [ax, ay] = state.sample.bedAccel;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) / RESPONSE_S);
    const braking = -ax / GRAVITY;
    const sideways = ay / GRAVITY;
    const current = motion.current;
    const unsettled =
      Math.abs(braking * PITCH_RAD_PER_G - current.pitch) + Math.abs(sideways * ROLL_RAD_PER_G - current.roll);
    current.pitch += (braking * PITCH_RAD_PER_G - current.pitch) * k;
    current.roll += (sideways * ROLL_RAD_PER_G - current.roll) * k;
    current.lag += (braking * CAMERA_LAG_M_PER_G - current.lag) * k;
    // When paused, keep drawing until the body has settled into its new attitude.
    if (unsettled > 1e-4) invalidate();

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
          invalidate();
        }}
        onPointerMove={() => invalidate()}
      >
        <Road live={live} mode={mode} />
        {contactShadow && <ContactShadow bed={doc.bed} />}
        <group ref={wheels}>
          <Wheels bed={doc.bed} mode={mode} />
        </group>
        <group ref={body} position={[0, floorHeight, 0]}>
          <TruckBody bed={doc.bed} mode={mode} />
          <Units {...scene} unitHandlers={unitHandlers} />
          <Lashings {...scene} />
          <ForceArrows doc={doc} live={live} />
          {push && <PushArrow doc={doc} live={live} push={push.state} />}
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
      <Labels
        {...scene}
        overlay={overlay}
        format={format}
        anchor={body}
        compact={compact}
        selectedUnit={selectedUnit}
        onSelectUnit={onSelectUnit}
      />
    </>
  );
}

function CameraRig({
  view,
  controlsRef,
}: {
  view: CameraView;
  /** Receives the camera controls, so a drag on a unit can hold the camera still. */
  controlsRef: RefObject<OrbitControls | null>;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const aspect = useThree((state) => state.size.width / state.size.height);
  const invalidate = useThree((state) => state.invalidate);
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
    controlsRef.current?.update();
    invalidate();
  }, [aspect, camera, view, invalidate, controlsRef]);

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
    const onChange = () => invalidate();
    orbit.addEventListener("start", onStart);
    orbit.addEventListener("change", onChange);
    orbit.update();
    controlsRef.current = orbit;
    return () => {
      orbit.removeEventListener("start", onStart);
      orbit.removeEventListener("change", onChange);
      orbit.dispose();
      controlsRef.current = null;
    };
  }, [camera, canvas, invalidate, controlsRef]);

  useFrame(() => controlsRef.current?.update());
  return null;
}
